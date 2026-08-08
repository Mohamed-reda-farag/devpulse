import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';

vi.mock('../lib/sources/claudeCode.js', () => ({
  fetchClaudeCode: vi.fn(),
  claudeCodeEntryUrl: vi.fn((entry: { version: string }) => `https://example.com/claude_code/${entry.version}`),
}));
vi.mock('../lib/sources/codex.js', () => ({
  fetchCodex: vi.fn(),
  codexEntryUrl: vi.fn((entry: { version: string }) => `https://example.com/codex/${entry.version}`),
}));
vi.mock('../lib/sources/devTools.js', () => ({
  fetchDevTools: vi.fn(),
  devToolsItemUrl: vi.fn(() => 'https://example.com/dev_tools'),
}));
vi.mock('../lib/sources/openModels.js', () => ({
  fetchOpenModels: vi.fn(),
  openModelsItemUrl: vi.fn(() => 'https://example.com/open_models'),
}));
vi.mock('../lib/sources/hackathons.js', () => ({
  fetchHackathons: vi.fn(),
}));

vi.mock('../lib/normalize.js', () => ({
  normalizeClaudeCode: vi.fn(async (items: unknown[]) => items),
  normalizeCodex: vi.fn(async (items: unknown[]) => items),
  normalizeDevTools: vi.fn(async (items: unknown[]) => items),
  normalizeOpenModels: vi.fn((items: unknown[]) => items),
  normalizeHackathons: vi.fn((items: unknown[]) => items),
  idFromUrl: vi.fn((url: string) => url),
}));

vi.mock('../lib/dedupe.js', () => ({
  loadSeenIds: vi.fn(async () => new Set()),
  partitionNewItems: vi.fn((candidates: unknown[]) => ({ newItems: candidates, alreadySeen: [] })),
  appendSeenIds: vi.fn(async () => undefined),
}));

import { fetchClaudeCode } from '../lib/sources/claudeCode.js';
import { fetchCodex } from '../lib/sources/codex.js';
import { fetchDevTools } from '../lib/sources/devTools.js';
import { fetchOpenModels } from '../lib/sources/openModels.js';
import { fetchHackathons } from '../lib/sources/hackathons.js';
import { loadSeenIds } from '../lib/dedupe.js';
import { normalizeCodex } from '../lib/normalize.js';

// This fixture must satisfy several structurally different raw-item types across the mocked
// fetchers below, so a concrete type isn't practical here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeItem(tag: string): any {
  return {
    id: `id-${tag}`,
    topic: tag,
    title: tag,
    summary: tag,
    source_name: tag,
    source_url: `https://example.com/${tag}`,
    published_at: '2026-07-30T00:00:00.000Z',
    fetched_at: '2026-07-30T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.mocked(fetchClaudeCode).mockRejectedValue(new Error('unexpected crash in claude_code fetcher'));
  vi.mocked(fetchCodex).mockResolvedValue({ items: [fakeItem('codex')], failures: [] });
  vi.mocked(fetchDevTools).mockResolvedValue({ items: [fakeItem('dev_tools')], failures: [] });
  vi.mocked(fetchOpenModels).mockResolvedValue({ items: [fakeItem('open_models')], failures: [] });
  vi.mocked(fetchHackathons).mockResolvedValue({ items: [fakeItem('hackathons')], failures: [] });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm('data/content-items.json', { force: true });
  await rm('data/content-items-history.jsonl', { force: true });
});

describe('runIngest — per-source isolation (FR-004)', () => {
  it('returns results from the other four sources when one fetcher throws, with a failure entry naming it', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { runIngest } = await import('../scripts/ingest.js');
    const result = await runIngest();

    expect(result.newItems).toHaveLength(4);
    expect(result.newItems.map((i) => i.topic).sort()).toEqual(
      ['codex', 'dev_tools', 'hackathons', 'open_models'].sort(),
    );

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.source).toBe('claude_code');
    expect(result.failures[0]?.kind).toBe('fetch_error');
    expect(result.failures[0]?.reason).toContain('unexpected crash in claude_code fetcher');

    // A clear log entry identifying the failed source was produced (SC-003).
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('claude_code'));

    consoleErrorSpy.mockRestore();
  });
});

describe('runIngest — dedupe happens BEFORE the expensive normalize/Groq step (regression, 2026-08-07)', () => {
  it('filters out already-seen raw items before calling normalize, not after', async () => {
    // Real production bug: normalize (which calls Groq) used to run on every
    // raw item every time, with dedupe only applied afterward — so a
    // steady-state run still re-summarized hundreds of already-seen
    // changelog entries and blew through Groq's rate limit. normalize must
    // only ever see genuinely new items.
    const seenUrl = 'https://example.com/codex/v1-old';
    vi.mocked(loadSeenIds).mockResolvedValue(new Set([seenUrl]));

    vi.mocked(fetchClaudeCode).mockResolvedValue({ items: [], failures: [] });
    vi.mocked(fetchCodex).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: [{ version: 'v1-old' }, { version: 'v2-new' }] as any,
      failures: [],
    });
    vi.mocked(fetchDevTools).mockResolvedValue({ items: [], failures: [] });
    vi.mocked(fetchOpenModels).mockResolvedValue({ items: [], failures: [] });
    vi.mocked(fetchHackathons).mockResolvedValue({ items: [], failures: [] });

    const { runIngest } = await import('../scripts/ingest.js');
    await runIngest();

    expect(normalizeCodex).toHaveBeenCalledWith([{ version: 'v2-new' }]);
  });
});

describe('runIngest — cross-run history file (fix for reported bug, 2026-08-08)', () => {
  it('accumulates items across multiple runs in the history file, unlike content-items.json which is overwritten each run', async () => {
    const { readFile } = await import('node:fs/promises');

    vi.mocked(loadSeenIds).mockResolvedValue(new Set());

    // Run 1: two sources succeed with one item each.
    vi.mocked(fetchClaudeCode).mockResolvedValue({ items: [], failures: [] });
    vi.mocked(fetchCodex).mockResolvedValue({ items: [], failures: [] });
    vi.mocked(fetchDevTools).mockResolvedValue({ items: [fakeItem('dev_tools')], failures: [] });
    vi.mocked(fetchOpenModels).mockResolvedValue({ items: [], failures: [] });
    vi.mocked(fetchHackathons).mockResolvedValue({ items: [fakeItem('hackathons')], failures: [] });

    const { runIngest } = await import('../scripts/ingest.js');
    await runIngest();

    // Run 2: nothing new (as if everything from run 1 is now already-seen) —
    // content-items.json would go back to empty, but history must keep run 1's items.
    vi.mocked(fetchDevTools).mockResolvedValue({ items: [], failures: [] });
    vi.mocked(fetchHackathons).mockResolvedValue({ items: [], failures: [] });
    await runIngest();

    const historyRaw = await readFile('data/content-items-history.jsonl', 'utf-8');
    const historyLines = historyRaw.trim().split('\n');
    expect(historyLines).toHaveLength(2);
    const topics = historyLines.map((line) => JSON.parse(line).topic).sort();
    expect(topics).toEqual(['dev_tools', 'hackathons']);
  });
});
