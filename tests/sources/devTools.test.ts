import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchDevTools, MAX_ITEMS_PER_SUBSOURCE } from '../../lib/sources/devTools.js';

const OSSINSIGHT_RESPONSE = {
  type: 'sql_endpoint',
  data: {
    columns: [
      { col: 'repo_id', data_type: 'BIGINT', nullable: false },
      { col: 'repo_name', data_type: 'VARCHAR', nullable: false },
    ],
    rows: [
      {
        repo_id: 123,
        repo_name: 'someorg/some-cli-tool',
        description: 'A fast CLI tool for developers.',
        language: 'Rust',
        stars: '4200',
        forks: '120',
      },
    ],
  },
};

const HN_TOP_IDS = [1, 2, 3];
const HN_ITEMS: Record<number, unknown> = {
  1: {
    id: 1,
    type: 'story',
    title: 'Show HN: A new open source CLI framework',
    url: 'https://example.com/cli-framework',
    by: 'someuser',
    time: 1750000000,
    score: 150,
  },
  2: {
    id: 2,
    type: 'story',
    title: 'What I ate for breakfast today',
    url: 'https://example.com/breakfast',
    by: 'someuser2',
    time: 1750000001,
    score: 5,
  },
  3: {
    id: 3,
    type: 'job',
    title: 'We are hiring',
    by: 'someuser3',
    time: 1750000002,
  },
};

function mockFetchImpl(url: string) {
  if (url.startsWith('https://api.ossinsight.io')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => OSSINSIGHT_RESPONSE,
    });
  }
  if (url.includes('topstories.json')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => HN_TOP_IDS,
    });
  }
  const match = /item\/(\d+)\.json/.exec(url);
  if (match?.[1]) {
    const id = Number(match[1]);
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => HN_ITEMS[id],
    });
  }
  throw new Error(`Unexpected URL in test: ${url}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchDevTools', () => {
  it('merges OSSInsight rows and relevant Hacker News stories', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(mockFetchImpl));

    const result = await fetchDevTools();
    expect(result.failures).toEqual([]);

    const ossinsightItems = result.items.filter((i) => i.kind === 'ossinsight');
    expect(ossinsightItems).toHaveLength(1);

    const hnItems = result.items.filter((i) => i.kind === 'hackernews');
    // Only story #1 matches the dev-tool keyword heuristic and is type "story".
    expect(hnItems).toHaveLength(1);
    expect(hnItems[0]?.kind === 'hackernews' && hnItems[0].story.id).toBe(1);
  });

  it('keeps Hacker News results when OSSInsight fails (independent sub-source isolation)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.startsWith('https://api.ossinsight.io')) {
          return Promise.reject(new Error('OSSInsight is down'));
        }
        return mockFetchImpl(url);
      }),
    );

    const result = await fetchDevTools();
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.source).toBe('dev_tools:ossinsight');
    expect(result.failures[0]?.kind).toBe('fetch_error');
    expect(result.items.some((i) => i.kind === 'hackernews')).toBe(true);
  });

  it('reports source_contract_changed when OSSInsight payload no longer matches the schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.startsWith('https://api.ossinsight.io')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ unexpected: 'shape' }),
          });
        }
        return mockFetchImpl(url);
      }),
    );

    const result = await fetchDevTools();
    const ossFailure = result.failures.find((f) => f.source === 'dev_tools:ossinsight');
    expect(ossFailure?.kind).toBe('source_contract_changed');
  });

  it(`caps OSSInsight rows at ${MAX_ITEMS_PER_SUBSOURCE} even when the API returns more`, async () => {
    const manyRows = Array.from({ length: MAX_ITEMS_PER_SUBSOURCE + 10 }, (_, i) => ({
      repo_id: i,
      repo_name: `someorg/repo-${i}`,
      description: 'A repo.',
      language: 'Rust',
      stars: '100',
      forks: '10',
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.startsWith('https://api.ossinsight.io')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ ...OSSINSIGHT_RESPONSE, data: { ...OSSINSIGHT_RESPONSE.data, rows: manyRows } }),
          });
        }
        return mockFetchImpl(url);
      }),
    );

    const result = await fetchDevTools();
    const ossinsightItems = result.items.filter((i) => i.kind === 'ossinsight');
    expect(ossinsightItems).toHaveLength(MAX_ITEMS_PER_SUBSOURCE);
  });

  it(`caps Hacker News matches at ${MAX_ITEMS_PER_SUBSOURCE} and stops checking further stories once reached`, async () => {
    // 20 story ids, every one a "story" whose title matches the dev-tool
    // keyword regex — more than enough to exceed the cap if it weren't there.
    const manyIds = Array.from({ length: 20 }, (_, i) => i + 1);
    const manyItems: Record<number, unknown> = Object.fromEntries(
      manyIds.map((id) => [
        id,
        { id, type: 'story', title: `A new open source CLI tool #${id}`, url: `https://example.com/${id}`, by: 'u', time: 1750000000 + id, score: 10 },
      ]),
    );
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('https://api.ossinsight.io')) {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: async () => OSSINSIGHT_RESPONSE });
      }
      if (url.includes('topstories.json')) {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: async () => manyIds });
      }
      const match = /item\/(\d+)\.json/.exec(url);
      if (match?.[1]) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => manyItems[Number(match[1])],
        });
      }
      throw new Error(`Unexpected URL in test: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchDevTools();
    const hnItems = result.items.filter((i) => i.kind === 'hackernews');
    expect(hnItems).toHaveLength(MAX_ITEMS_PER_SUBSOURCE);

    // Early-exit check: once the cap is reached, remaining stories shouldn't
    // even be fetched. Total HN item-fetch calls = 1 (topstories) + exactly
    // MAX_ITEMS_PER_SUBSOURCE (one per story up to the cap), regardless of
    // the 20 ids available.
    const itemFetchCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/item/'));
    expect(itemFetchCalls).toHaveLength(MAX_ITEMS_PER_SUBSOURCE);
  });
});
