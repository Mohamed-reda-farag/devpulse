import { codexSchema, type ChangelogEntry } from '../schemas.js';
import { parseMarkdownChangelog } from '../parseChangelog.js';
import { logSourceFailure } from '../logger.js';
import type { SourceResult } from '../types.js';

// developers.openai.com serves a markdown version of any docs page by
// appending .md to the URL.
const CHANGELOG_URL = 'https://developers.openai.com/codex/changelog.md';
export const SOURCE_NAME = 'Codex official changelog';
export const SOURCE_PAGE_URL = 'https://developers.openai.com/codex/changelog';

/**
 * Fetches + parses the official Codex changelog. Independently-shaped source
 * from claude_code's, so it gets its own schema even though the parser is shared.
 */
export async function fetchCodex(): Promise<SourceResult<ChangelogEntry>> {
  let markdown: string;
  try {
    const res = await fetch(CHANGELOG_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    markdown = await res.text();
  } catch (err) {
    return {
      items: [],
      failures: [
        logSourceFailure('codex', 'fetch_error', err instanceof Error ? err.message : String(err)),
      ],
    };
  }

  const parsed = parseMarkdownChangelog(markdown);
  const validation = codexSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      items: [],
      failures: [logSourceFailure('codex', 'source_contract_changed', validation.error.message)],
    };
  }

  return { items: validation.data, failures: [] };
}
