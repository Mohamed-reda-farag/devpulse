import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/sources/claudeCode.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/sources/claudeCode.js')>('../lib/sources/claudeCode.js');
  return { ...actual, fetchClaudeCode: vi.fn() };
});
vi.mock('../lib/sources/codex.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/sources/codex.js')>('../lib/sources/codex.js');
  return { ...actual, fetchCodex: vi.fn() };
});
vi.mock('../lib/sources/devTools.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/sources/devTools.js')>('../lib/sources/devTools.js');
  return { ...actual, fetchDevTools: vi.fn() };
});
vi.mock('../lib/sources/openModels.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/sources/openModels.js')>('../lib/sources/openModels.js');
  return { ...actual, fetchOpenModels: vi.fn() };
});
vi.mock('../lib/sources/hackathons.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/sources/hackathons.js')>('../lib/sources/hackathons.js');
  return { ...actual, fetchHackathons: vi.fn() };
});
// Only the Supabase-facing I/O boundary is mocked — partitionNewItems (pure
// logic) comes through untouched via importActual, so these tests exercise
// the real dedupe decision, not a stand-in for it.
vi.mock('../lib/dedupe.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/dedupe.js')>('../lib/dedupe.js');
  return { ...actual, loadExistingIds: vi.fn(), insertNewItems: vi.fn() };
});
// normalize.ts itself (title truncation, id derivation, etc.) is real and
// unmocked — only its one network-touching dependency, Groq, is stubbed.
// Without this, claude_code/codex/dev_tools normalization silently fails
// (caught by normalize.ts's own per-item try/catch) whenever GROQ_API_KEY
// isn't set or api.groq.com isn't reachable — exactly the live-network
// dependency Article VI forbids in the automated suite.
vi.mock('../lib/groqClient.js', () => ({
  summarize: vi.fn().mockResolvedValue('mocked summary'),
}));

import { fetchClaudeCode } from '../lib/sources/claudeCode.js';
import { fetchCodex } from '../lib/sources/codex.js';
import { fetchDevTools } from '../lib/sources/devTools.js';
import { fetchOpenModels } from '../lib/sources/openModels.js';
import { fetchHackathons } from '../lib/sources/hackathons.js';
import { loadExistingIds, insertNewItems } from '../lib/dedupe.js';
import { claudeCodeEntryUrl } from '../lib/sources/claudeCode.js';
import { idFromUrl } from '../lib/normalize.js';
import { runIngest, main } from '../scripts/ingest.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchClaudeCode).mockResolvedValue({ items: [], failures: [] });
  vi.mocked(fetchCodex).mockResolvedValue({ items: [], failures: [] });
  vi.mocked(fetchDevTools).mockResolvedValue({ items: [], failures: [] });
  vi.mocked(fetchOpenModels).mockResolvedValue({ items: [], failures: [] });
  vi.mocked(fetchHackathons).mockResolvedValue({ items: [], failures: [] });
  vi.mocked(loadExistingIds).mockResolvedValue(new Set());
  vi.mocked(insertNewItems).mockResolvedValue(undefined);
  process.exitCode = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe('runIngest', () => {
  it('only passes genuinely-new items to insertNewItems, filtering out ones already in existingIds', async () => {
    const seenUrl = claudeCodeEntryUrl({ version: 'v1', body: 'body1' });
    const seenId = idFromUrl(seenUrl);
    vi.mocked(loadExistingIds).mockResolvedValue(new Set([seenId]));
    vi.mocked(fetchClaudeCode).mockResolvedValue({
      items: [
        { version: 'v1', body: 'body1' },
        { version: 'v2', body: 'body2' },
      ],
      failures: [],
    });

    const result = await runIngest();

    expect(result.newItems.map((i) => i.title)).toEqual(['Claude Code v2']);
    expect(insertNewItems).toHaveBeenCalledTimes(1);
    const insertedItems = vi.mocked(insertNewItems).mock.calls[0][0];
    expect(insertedItems.map((i) => i.title)).toEqual(['Claude Code v2']);
  });

  it('isolates a per-source fetch failure so the other sources still produce results (Phase 1 FR-004, unchanged)', async () => {
    vi.mocked(fetchClaudeCode).mockRejectedValue(new Error('boom'));
    vi.mocked(fetchCodex).mockResolvedValue({
      items: [{ version: 'c1', body: 'codex body' }],
      failures: [],
    });

    const result = await runIngest();

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ source: 'claude_code', kind: 'fetch_error' });
    expect(result.newItems.some((i) => i.title === 'Codex c1')).toBe(true);
  });

  it('propagates a database_unreachable failure from loadExistingIds without catching it', async () => {
    vi.mocked(loadExistingIds).mockRejectedValue(new Error('database_unreachable: connection refused'));
    await expect(runIngest()).rejects.toThrow(/database_unreachable/);
  });

  it('propagates a database_unreachable failure from insertNewItems without catching it', async () => {
    vi.mocked(insertNewItems).mockRejectedValue(new Error('database_unreachable: connection refused'));
    vi.mocked(fetchClaudeCode).mockResolvedValue({
      items: [{ version: 'v1', body: 'body1' }],
      failures: [],
    });
    await expect(runIngest()).rejects.toThrow(/database_unreachable/);
  });
});

describe('main (CLI entry point)', () => {
  it('logs a distinct database_unreachable message and sets a non-zero exit code when Supabase is unreachable', async () => {
    vi.mocked(loadExistingIds).mockRejectedValue(new Error('database_unreachable: connection refused'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await main();

    expect(process.exitCode).toBe(1);
    const loggedDatabaseUnreachable = errorSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('database_unreachable')),
    );
    expect(loggedDatabaseUnreachable).toBe(true);
  });

  it('does not fold a database_unreachable failure into the per-source "Failures:" report', async () => {
    vi.mocked(loadExistingIds).mockRejectedValue(new Error('database_unreachable: connection refused'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await main();

    // The per-source "Failures:" report is only ever printed after a
    // successful runIngest() resolution — a database_unreachable rejection
    // short-circuits before that point, so a source-failure-style line
    // (e.g. "[fetch_error] ...") must never appear here.
    const loggedAsSourceFailure = [...logSpy.mock.calls, ...errorSpy.mock.calls].some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('[fetch_error]')),
    );
    expect(loggedAsSourceFailure).toBe(false);
  });

  it('exits 0 (unset) and reports normally on a successful run with per-source failures still listed', async () => {
    vi.mocked(fetchClaudeCode).mockRejectedValue(new Error('boom'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await main();

    expect(process.exitCode).toBe(0);
    const loggedSourceFailure = logSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('[fetch_error] claude_code')),
    );
    expect(loggedSourceFailure).toBe(true);
  });
});
