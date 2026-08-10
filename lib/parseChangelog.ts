import type { ChangelogEntry } from './schemas.js';

/**
 * Splits a "## <version>" style markdown changelog into per-version entries.
 * Used by claude_code's real CHANGELOG.md. codex.ts does NOT use this —
 * codex's real changelog turned out to be a rendered docs page, not flat
 * markdown (see codex.ts's own comment), so it parses HTML via cheerio
 * instead. Kept general/source-agnostic in case a future source publishes
 * this same flat-markdown shape.
 */
export function parseMarkdownChangelog(markdown: string): ChangelogEntry[] {
  const lines = markdown.split('\n');
  const entries: ChangelogEntry[] = [];
  let currentVersion: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (currentVersion !== null) {
      const body = currentBody.join('\n').trim();
      if (body.length > 0) {
        entries.push({ version: currentVersion, body });
      }
    }
  };

  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      flush();
      currentVersion = heading[1];
      currentBody = [];
    } else if (currentVersion !== null) {
      currentBody.push(line);
    }
  }
  flush();

  return entries;
}
