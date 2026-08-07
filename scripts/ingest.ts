import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { fetchClaudeCode } from '../lib/sources/claudeCode.js';
import { fetchCodex } from '../lib/sources/codex.js';
import { fetchDevTools } from '../lib/sources/devTools.js';
import { fetchOpenModels } from '../lib/sources/openModels.js';
import { fetchHackathons } from '../lib/sources/hackathons.js';
// company_internships is temporarily disabled by project-owner decision
// (2026-08-07): Wuzzuf's endpoint now 404s, and the ITIDA/ITI scraper
// selectors were never verified against live markup. The fetcher/normalizer
// are left importable below (commented) so re-enabling is a one-line change
// once the real endpoints are confirmed.
// import { fetchCompanyInternships } from '../lib/sources/companyInternships.js';

import {
  normalizeClaudeCode,
  normalizeCodex,
  normalizeDevTools,
  normalizeOpenModels,
  normalizeHackathons,
  // normalizeCompanyInternships, // see companyInternships import note above
} from '../lib/normalize.js';

import { loadSeenIds, partitionNewItems, appendSeenIds } from '../lib/dedupe.js';
import { logSourceFailure } from '../lib/logger.js';
import type { ContentItem, SourceFailure } from '../lib/types.js';

const CONTENT_ITEMS_PATH = 'data/content-items.json';

export interface IngestResult {
  newItems: ContentItem[];
  alreadySeenCount: number;
  failures: SourceFailure[];
}

/**
 * One entry per source, each isolated in its own try/catch. FR-004: if any
 * single source's fetcher throws outright (a bug, not just a handled
 * fetch/validation error), the other five must still produce results.
 */
async function runSource<TRaw>(
  name: string,
  fetcher: () => Promise<{ items: TRaw[]; failures: SourceFailure[] }>,
  normalizer: (items: TRaw[]) => Promise<ContentItem[]> | ContentItem[],
): Promise<{ items: ContentItem[]; failures: SourceFailure[] }> {
  try {
    const { items: raw, failures } = await fetcher();
    const items = await normalizer(raw);
    return { items, failures };
  } catch (err) {
    return {
      items: [],
      failures: [logSourceFailure(name, 'fetch_error', err instanceof Error ? err.message : String(err))],
    };
  }
}

export async function runIngest(): Promise<IngestResult> {
  const results = await Promise.all([
    runSource('claude_code', fetchClaudeCode, normalizeClaudeCode),
    runSource('codex', fetchCodex, normalizeCodex),
    runSource('dev_tools', fetchDevTools, normalizeDevTools),
    runSource('open_models', fetchOpenModels, (items) => normalizeOpenModels(items)),
    runSource('hackathons', fetchHackathons, (items) => normalizeHackathons(items)),
    // runSource('company_internships', fetchCompanyInternships, normalizeCompanyInternships),
  ]);

  const candidates = results.flatMap((r) => r.items);
  const failures = results.flatMap((r) => r.failures);

  const seenIds = await loadSeenIds();
  const { newItems, alreadySeen } = partitionNewItems(candidates, seenIds);

  await mkdir(dirname(CONTENT_ITEMS_PATH), { recursive: true });
  await writeFile(CONTENT_ITEMS_PATH, JSON.stringify(newItems, null, 2), 'utf-8');
  await appendSeenIds(newItems.map((i) => i.id));

  return { newItems, alreadySeenCount: alreadySeen.length, failures };
}

const isMainModule = process.argv[1]?.endsWith('ingest.ts') || process.argv[1]?.endsWith('ingest.js');
if (isMainModule) {
  runIngest()
    .then((result) => {
      console.log(
        `\nIngest complete: ${result.newItems.length} new item(s), ` +
          `${result.alreadySeenCount} already seen, ${result.failures.length} source failure(s).`,
      );
      if (result.failures.length > 0) {
        console.log('Failures:');
        for (const f of result.failures) {
          console.log(`  - [${f.kind}] ${f.source}: ${f.reason}`);
        }
      }
    })
    .catch((err) => {
      console.error('Ingest failed unexpectedly:', err);
      process.exitCode = 1;
    });
}
