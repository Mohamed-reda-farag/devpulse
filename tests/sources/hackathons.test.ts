import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchHackathons } from '../../lib/sources/hackathons.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchHackathons', () => {
  it('extracts a valid mocked response into structured listings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          hackathons: [
            {
              id: 42,
              title: 'AI for Good Hackathon',
              url: 'https://ai-for-good.devpost.com',
              prize_amount: '$10,000',
              submission_period_dates: 'Aug 01 - Aug 30, 2026',
              themes: ['AI', 'Social Good'],
              organization_name: 'Devpost',
            },
          ],
        }),
      }),
    );

    const result = await fetchHackathons();
    expect(result.failures).toEqual([]);
    expect(result.items).toEqual([
      {
        id: 42,
        title: 'AI for Good Hackathon',
        url: 'https://ai-for-good.devpost.com',
        prize: '$10,000',
        deadline: 'Aug 01 - Aug 30, 2026',
        tags: ['AI', 'Social Good'],
      },
    ]);
  });

  it('reports a distinct source_contract_changed error on a malformed/unexpected shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ results: 'this is not the hackathons array we expect' }),
      }),
    );

    const result = await fetchHackathons();
    expect(result.items).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.kind).toBe('source_contract_changed');
    expect(result.failures[0]?.source).toBe('hackathons');
  });

  it('never carries a free-text description/tagline field through, even when present in the raw payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          hackathons: [
            {
              id: 7,
              title: 'Global Climate Hack',
              url: 'https://global-climate-hack.devpost.com',
              prize_amount: '$5,000',
              submission_period_dates: 'Sep 01 - Sep 15, 2026',
              themes: ['Climate'],
              tagline:
                'Join thousands of hackers building the next generation of climate tech in a whirlwind weekend of coding, pizza, and world-changing ideas!',
            },
          ],
        }),
      }),
    );

    const result = await fetchHackathons();
    expect(result.items).toHaveLength(1);
    const listing = result.items[0]!;
    // Only these five fields exist on the extracted shape — `tagline` cannot
    // leak because the type doesn't carry it at all.
    expect(Object.keys(listing).sort()).toEqual(
      ['deadline', 'id', 'prize', 'tags', 'title', 'url'].sort(),
    );
    expect(JSON.stringify(listing)).not.toContain('whirlwind weekend');
  });

  it('strips embedded HTML from prize/deadline/title/tags (regression, real item 2026-08-08)', async () => {
    // Exact shape confirmed from a real Devpost API response: prize_amount
    // arrives with a currency-formatting <span> embedded in it, not clean text.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          hackathons: [
            {
              id: '4c9dd07a11271349a4bb5ad4',
              title: 'SpaceXAI Grokathon',
              url: 'https://spacexai-grokathon.devpost.com/',
              prize_amount: '$<span data-currency-value>0</span>',
              submission_period_dates: 'Aug 08 - 09, 2026',
              themes: ['Machine Learning/AI'],
            },
          ],
        }),
      }),
    );

    const result = await fetchHackathons();
    expect(result.failures).toEqual([]);
    expect(result.items).toEqual([
      {
        id: '4c9dd07a11271349a4bb5ad4',
        title: 'SpaceXAI Grokathon',
        url: 'https://spacexai-grokathon.devpost.com/',
        prize: '$0',
        deadline: 'Aug 08 - 09, 2026',
        tags: ['Machine Learning/AI'],
      },
    ]);
    expect(result.items[0]?.prize).not.toContain('<');
    expect(result.items[0]?.prize).not.toContain('span');
  });
});
