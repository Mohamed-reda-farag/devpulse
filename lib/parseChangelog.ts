import type { ChangelogEntry } from './schemas.js';

/**
 * Splits a "## <version>" style markdown changelog into per-version entries.
 * Both claude_code and codex publish this shape; the parsing itself is
 * independent of which source it came from.
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
