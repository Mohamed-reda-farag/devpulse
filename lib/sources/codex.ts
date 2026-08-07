import * as cheerio from 'cheerio';
import { codexSchema, type ChangelogEntry } from '../schemas.js';
import { logSourceFailure } from '../logger.js';
import type { SourceResult } from '../types.js';

/**
 * The real page (confirmed live 2026-08-07) is a rendered docs site, not a
 * flat markdown file — developers.openai.com/codex/changelog.md 404s. Each
 * release is a genuine <time>YYYY-MM-DD</time> element immediately followed
 * (as a sibling of its wrapper div) by an <h3> title, mixed in with ~290
 * unrelated <h3>s from nav/sidebar/footer sections that have no <time>
 * nearby. A raw text-regex date search is NOT reliable here — version-like
 * date strings ("MCP 2026-07-28 protocol") appear inside body text too, so
 * matching must anchor on the real <time> element, not text pattern-matching.
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

type CheerioEl = ReturnType<ReturnType<typeof cheerio.load>>;

function findEntryTitle($: ReturnType<typeof cheerio.load>, $time: CheerioEl): CheerioEl {
  // Observed shape: <div><time>...</time></div><h3>...</h3> as siblings of
  // time's wrapper div. Try that first; fall back to the nearest h3 inside
  // time's closest ancestor div, then to the next h3 anywhere after it.
  const direct = $time.parent().next();
  if (direct.is('h3')) return direct;
  const withinAncestor = $time.closest('div').find('h3').first();
  if (withinAncestor.length > 0) return withinAncestor;
  return $time.nextAll('h3').first();
}

function extractTitle($: ReturnType<typeof cheerio.load>, $h3: CheerioEl): string {
  // The title text is nested in <span> elements; a trailing <button> (a copy-
  // link icon) has no meaningful text of its own but is stripped defensively
  // so it can never contaminate the title.
  return $h3.clone().find('button, svg').remove().end().text().trim();
}

function parseCodexChangelog(html: string): ChangelogEntry[] {
  const $ = cheerio.load(html);
  const allTimes = $('time').toArray();
  const entries: ChangelogEntry[] = [];

  for (const timeEl of allTimes) {
    const $time = $(timeEl);
    const dateText = $time.text().trim();
    if (!DATE_PATTERN.test(dateText)) continue;

    const $h3 = findEntryTitle($, $time);
    if ($h3.length === 0) continue;
    const title = extractTitle($, $h3);
    if (!title) continue;

    // Body = text of the entry's following siblings (New Features, Bug
    // Fixes, Chores, ...). Diagnostic against the live page (2026-08-07)
    // confirmed $h3.next() is ALWAYS empty — the <h3> is the last child of
    // its own wrapper div, so the body content is a sibling of that
    // wrapper, not of the <h3> itself.
    let body = '';
    let node = $h3.parent().next();
    while (node.length > 0) {
      if (node.is('time') || node.find('time').length > 0) break;
      const text = node.text().trim();
      body += (body ? ' ' : '') + text;
      // "Full Changelog:" isn't guaranteed to be its own sibling node — it
      // can appear mid-way through a single consolidated block alongside
      // real content, so cut at the substring rather than only checking
      // whether a whole node starts with it.
      const cutIndex = body.indexOf('Full Changelog:');
      if (cutIndex !== -1) {
        body = body.slice(0, cutIndex);
        break;
      }
      if (body.length >= MAX_BODY_CHARS) break;
      node = node.next();
    }
    body = body.slice(0, MAX_BODY_CHARS).trim();
    if (!body) continue;

    entries.push({ version: title, body });
  }

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
