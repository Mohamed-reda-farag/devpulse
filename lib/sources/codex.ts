import * as cheerio from 'cheerio';
import { codexSchema, type ChangelogEntry } from '../schemas.js';
import { logSourceFailure } from '../logger.js';
import type { SourceResult } from '../types.js';

/**
 * The real page (confirmed live 2026-08-07) is a rendered docs site, not a
 * flat markdown file — developers.openai.com/codex/changelog.md 404s. Each
 * release is an <h3> preceded by a YYYY-MM-DD date, mixed in with unrelated
 * <h3>s from nav/footer sections, and followed by a huge per-PR link list
 * that isn't useful to summarize. We only keep <h3>s with a date immediately
 * before them, and cut body text well before the PR list.
 */
const CHANGELOG_URL = 'https://developers.openai.com/codex/changelog';
export const SOURCE_NAME = 'Codex official changelog';
export const SOURCE_PAGE_URL = 'https://developers.openai.com/codex/changelog';

// Bounds Groq usage on a cold-start run — this is a rolling digest, not a
// historical archive, so only the most recent entries matter (see also
// claudeCode.ts, which caps for the same reason).
const MAX_ENTRIES = 15;
const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/;
const MAX_BODY_CHARS = 900;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function codexEntryUrl(entry: ChangelogEntry): string {
  return `${SOURCE_PAGE_URL}#${slugify(entry.version)}`;
}

function parseCodexChangelog(html: string): ChangelogEntry[] {
  const $ = cheerio.load(html);
  const entries: ChangelogEntry[] = [];

  $('h3').each((_, el) => {
    const $el = $(el);
    const title = $el.text().trim();
    if (!title) return;

    // Only treat this h3 as a real entry if a date appears in the text
    // immediately preceding it (nav/footer h3s like "Topics" or "Recent"
    // won't have one).
    const precedingText = $el.prevAll().slice(0, 3).text();
    if (!DATE_PATTERN.test(precedingText)) return;

    // Body = text of siblings up to the next heading, stopping early once we
    // hit the raw per-PR "Full Changelog:" link dump.
    let body = '';
    let node = $el.next();
    while (node.length > 0) {
      const tag = (node.get(0) as { tagName?: string } | undefined)?.tagName?.toLowerCase();
      if (tag === 'h3') break;
      const text = node.text().trim();
      if (/^Full Changelog:/.test(text) || text.startsWith('[#')) break;
      if (text) body += (body ? ' ' : '') + text;
      if (body.length >= MAX_BODY_CHARS) break;
      node = node.next();
    }
    body = body.slice(0, MAX_BODY_CHARS).trim();
    if (!body) return;

    entries.push({ version: title, body });
  });

  return entries.slice(0, MAX_ENTRIES);
}

export async function fetchCodex(): Promise<SourceResult<ChangelogEntry>> {
  let html: string;
  try {
    const res = await fetch(CHANGELOG_URL, {
      headers: { 'User-Agent': 'DevPulse-Ingestion/1.0 (personal dev-news digest)' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    html = await res.text();
  } catch (err) {
    return {
      items: [],
      failures: [
        logSourceFailure('codex', 'fetch_error', err instanceof Error ? err.message : String(err)),
      ],
    };
  }

  const parsed = parseCodexChangelog(html);
  const validation = codexSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      items: [],
      failures: [logSourceFailure('codex', 'source_contract_changed', validation.error.message)],
    };
  }

  return { items: validation.data, failures: [] };
}
