import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';

vi.mock('../lib/sources/claudeCode.js', () => ({
  fetchClaudeCode: vi.fn(),
}));
vi.mock('../lib/sources/codex.js', () => ({
  fetchCodex: vi.fn(),
}));
vi.mock('../lib/sources/devTools.js', () => ({
  fetchDevTools: vi.fn(),
}));
vi.mock('../lib/sources/openModels.js', () => ({
  fetchOpenModels: vi.fn(),
}));
vi.mock('../lib/sources/hackathons.js', () => ({
  fetchHackathons: vi.fn(),
}));
vi.mock('../lib/sources/companyInternships.js', () => ({
  fetchCompanyInternships: vi.fn(),
}));

vi.mock('../lib/normalize.js', () => ({
  normalizeClaudeCode: vi.fn(async (items: unknown[]) => items),
  normalizeCodex: vi.fn(async (items: unknown[]) => items),
  normalizeDevTools: vi.fn(async (items: unknown[]) => items),
  normalizeOpenModels: vi.fn((items: unknown[]) => items),
  normalizeHackathons: vi.fn((items: unknown[]) => items),
  normalizeCompanyInternships: vi.fn(async (items: unknown[]) => items),
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
import { fetchCompanyInternships } from '../lib/sources/companyInternships.js';

// This fixture must satisfy five structurally different raw-item types across the six mocked
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
  vi.mocked(fetchCompanyInternships).mockResolvedValue({
    items: [fakeItem('company_internships')],
    failures: [],
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm('data/content-items.json', { force: true });
});

describe('runIngest — per-source isolation (FR-004)', () => {
  it('returns results from the other five sources when one fetcher throws, with a failure entry naming it', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { runIngest } = await import('../scripts/ingest.js');
    const result = await runIngest();

    expect(result.newItems).toHaveLength(5);
    expect(result.newItems.map((i) => i.topic).sort()).toEqual(
      ['codex', 'company_internships', 'dev_tools', 'hackathons', 'open_models'].sort(),
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
