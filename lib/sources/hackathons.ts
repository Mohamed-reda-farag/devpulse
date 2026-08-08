import { hackathonsSchema, type DevpostHackathon } from '../schemas.js';
import { logSourceFailure } from '../logger.js';
import type { SourceResult } from '../types.js';

// Undocumented internal endpoint (no public API is published for Devpost —
// confirmed during spec review). Fragile by design; wrapped in explicit
// try/catch per plan.md.
const DEVPOST_URL = 'https://devpost.com/api/hackathons?status[]=open&order_by=recently-added';
export const SOURCE_NAME = 'Devpost';

/**
 * Article X: only structured fields ever leave this module. `tagline` (free
 * text) exists on the validated raw payload but is deliberately dropped here
 * — never partially included, never passed downstream.
 */
export interface HackathonListing {
  id: string | number;
  title: string;
  url: string;
  prize: string | null;
  deadline: string | null;
  tags: string[];
}

/**
 * Devpost's real payload embeds raw HTML inside otherwise-plain fields — e.g.
 * prize_amount arrives as `"$<span data-currency-value>0</span>"`, not a
 * clean "$0" (confirmed against a live item, 2026-08-08). Zod's `z.string()`
 * happily accepts that shape, so the schema alone can't catch it; this strips
 * markup before any of these fields are ever displayed or inlined into a
 * summary.
 */
function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function toListing(raw: DevpostHackathon): HackathonListing {
  return {
    id: raw.id,
    title: stripHtml(raw.title),
    url: raw.url,
    prize: raw.prize_amount ? stripHtml(raw.prize_amount) : null,
    deadline: raw.submission_period_dates ? stripHtml(raw.submission_period_dates) : null,
    tags: (raw.themes ?? []).map((t) => stripHtml(typeof t === 'string' ? t : t.name)),
  };
}

export async function fetchHackathons(): Promise<SourceResult<HackathonListing>> {
  try {
    const res = await fetch(DEVPOST_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const json: unknown = await res.json();
    const validation = hackathonsSchema.safeParse(json);
    if (!validation.success) {
      return {
        items: [],
        failures: [
          logSourceFailure('hackathons', 'source_contract_changed', validation.error.message),
        ],
      };
    }
    return { items: validation.data.hackathons.map(toListing), failures: [] };
  } catch (err) {
    return {
      items: [],
      failures: [
        logSourceFailure('hackathons', 'fetch_error', err instanceof Error ? err.message : String(err)),
      ],
    };
  }
}
