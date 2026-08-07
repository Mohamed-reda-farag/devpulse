import { claudeCodeSchema, type ChangelogEntry } from '../schemas.js';
import { parseMarkdownChangelog } from '../parseChangelog.js';
import { logSourceFailure } from '../logger.js';
import type { SourceResult } from '../types.js';

const CHANGELOG_URL = 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md';
export const SOURCE_NAME = 'Claude Code official changelog';

// Bounds Groq usage on a cold-start run (no seen-ids yet) — this changelog
// has 350+ historical entries, and summarizing all of them in one run blows
// straight through Groq's free-tier rate limit. Only the newest N matter for
// a rolling 3-day digest anyway; the entry-level dedupe (Article V/spec.md)
// still applies on top of this for steady-state runs.
const MAX_ENTRIES = 15;

/**
 * Fetches + parses the official Claude Code changelog. Raw payload is
 * validated against `claudeCodeSchema` before any field is read (Article III.11).
 */
export async function fetchClaudeCode(): Promise<SourceResult<ChangelogEntry>> {
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
        logSourceFailure(
          'claude_code',
          'fetch_error',
          err instanceof Error ? err.message : String(err),
        ),
      ],
    };
  }

  const parsed = parseMarkdownChangelog(markdown).slice(0, MAX_ENTRIES);
  const validation = claudeCodeSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      items: [],
      failures: [
        logSourceFailure('claude_code', 'source_contract_changed', validation.error.message),
      ],
    };
  }

  return { items: validation.data, failures: [] };
}

export function claudeCodeEntryUrl(entry: ChangelogEntry): string {
  return `https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#${entry.version.replace(/\./g, '')}`;
}
