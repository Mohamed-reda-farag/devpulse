import 'dotenv/config';

import { fetchClaudeCode } from '../lib/sources/claudeCode.js';
import { fetchCodex } from '../lib/sources/codex.js';
import { fetchDevTools, devToolsItemUrl } from '../lib/sources/devTools.js';
import { fetchOpenModels, openModelsItemUrl } from '../lib/sources/openModels.js';
import { fetchHackathons } from '../lib/sources/hackathons.js';

import {
  normalizeClaudeCode,
  normalizeCodex,
  normalizeDevTools,
  normalizeOpenModels,
  normalizeHackathons,
  idFromUrl,
} from '../lib/normalize.js';
import { claudeCodeEntryUrl } from '../lib/sources/claudeCode.js';
import { codexEntryUrl } from '../lib/sources/codex.js';

import { loadExistingIds, partitionNewItems, insertNewItems } from '../lib/dedupe.js';
import { logSourceFailure } from '../lib/logger.js';
import type { ContentItem, SourceFailure } from '../lib/types.js';

export interface IngestResult {
  newItems: ContentItem[];
  alreadySeenCount: number;
  failures: SourceFailure[];
}

/**
 * One entry per source, each isolated in its own try/catch. FR-004 (Phase 1):
 * if any single source's fetcher throws outright (a bug, not just a handled
 * fetch/validation error), the other four (of five active sources) must
 * still produce results.
 *
 * Unchanged from Phase 1: raw items are filtered against `existingIds`
 * BEFORE `normalizer` runs, not after. normalize.ts is where the expensive
 * rate-limited Groq calls happen — normalizing already-seen items every run
 * is what blew through Groq's free-tier rate limit in Phase 1 production.
 * `getUrl` lets us derive each raw item's would-be id cheaply, without
 * normalizing it first. `existingIds` now comes from `content_items` via
 * Supabase instead of `data/seen-ids.json`, but this function's contract is
 * otherwise identical to Phase 1's.
 */
async function runSource<TRaw>(
  name: string,
  fetcher: () => Promise<{ items: TRaw[]; failures: SourceFailure[] }>,
  getUrl: (raw: TRaw) => string,
  normalizer: (items: TRaw[]) => Promise<ContentItem[]> | ContentItem[],
  existingIds: ReadonlySet<string>,
): Promise<{ items: ContentItem[]; failures: SourceFailure[] }> {
  try {
    const { items: raw, failures } = await fetcher();
    const newRaw = raw.filter((item) => !existingIds.has(idFromUrl(getUrl(item))));
    const items = await normalizer(newRaw);
    return { items, failures };
  } catch (err) {
    return {
      items: [],
      failures: [logSourceFailure(name, 'fetch_error', err instanceof Error ? err.message : String(err))],
    };
  }
}

/**
 * Runs the full pipeline: load existing ids from Supabase, fetch+normalize
 * all five sources (isolated per source), and insert genuinely-new items
 * into `content_items`.
 *
 * Deliberately does NOT catch failures from `loadExistingIds` or
 * `insertNewItems` — those are Supabase connectivity failures (spec.md's
 * "database itself is unreachable" edge case), not a single source failing,
 * and must propagate so the caller can treat them as a distinct
 * `database_unreachable` failure rather than folding them into the
 * per-source `failures` array. Both throw with a `database_unreachable:`
 * message prefix (see lib/dedupe.ts) precisely so callers can tell the two
 * failure modes apart.
 */
export async function runIngest(): Promise<IngestResult> {
  const existingIds = await loadExistingIds();

  const results = await Promise.all([
    runSource('claude_code', fetchClaudeCode, claudeCodeEntryUrl, normalizeClaudeCode, existingIds),
    runSource('codex', fetchCodex, codexEntryUrl, normalizeCodex, existingIds),
    runSource('dev_tools', fetchDevTools, devToolsItemUrl, normalizeDevTools, existingIds),
    runSource(
      'open_models',
      fetchOpenModels,
      openModelsItemUrl,
      (items) => normalizeOpenModels(items),
      existingIds,
    ),
    runSource(
      'hackathons',
      fetchHackathons,
      (item) => item.url,
      (items) => normalizeHackathons(items),
      existingIds,
    ),
  ]);

  const candidates = results.flatMap((r) => r.items);
  const failures = results.flatMap((r) => r.failures);

  // Safety-net second pass: catches same-id collisions across sources or
  // within one fetch (e.g. two duplicate URLs in a single response) that the
  // per-source pre-filter above can't see, since it only compares against
  // ids already persisted in `content_items`, not against other items
  // produced in this same run.
  const { newItems, alreadySeen } = partitionNewItems(candidates, existingIds);

  await insertNewItems(newItems);

  return { newItems, alreadySeenCount: alreadySeen.length, failures };
}

/**
 * CLI entry point, factored out from the `isMainModule` guard so it's
 * directly unit-testable (T006): asserting on `console.log`/`console.error`
 * calls and on `process.exitCode` doesn't require spawning a subprocess.
 */
export async function main(): Promise<void> {
  try {
    const result = await runIngest();
    console.log(
      `\nIngest complete: ${result.newItems.length} new item(s), ` +
        `${result.alreadySeenCount} already seen, ${result.failures.length} source failure(s).`,
    );
    console.log(`${result.newItems.length} new item(s) inserted into Supabase's content_items table.`);
    if (result.failures.length > 0) {
      console.log('Failures:');
      for (const f of result.failures) {
        console.log(`  - [${f.kind}] ${f.source}: ${f.reason}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('database_unreachable')) {
      // Distinct from a per-source failure (spec.md's edge case default):
      // the storage layer itself is unreachable, so nothing this run could
      // have been persisted — fail loudly rather than exit 0 having
      // silently stored nothing.
      console.error(`\ndatabase_unreachable: ${message}`);
      console.error('The pipeline could not reach Supabase — no items were persisted this run.');
    } else {
      console.error('Ingest failed unexpectedly:', err);
    }
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1]?.endsWith('ingest.ts') || process.argv[1]?.endsWith('ingest.js');
if (isMainModule) {
  void main();
}
