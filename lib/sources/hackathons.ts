import { hackathonsSchema, type DevpostHackathon } from '../schemas.js';
import { logSourceFailure } from '../logger.js';
import type { SourceResult } from '../types.js';

// Undocumented internal endpoint (no public API is published for Devpost —
// confirmed during spec review). Fragile by design; wrapped in explicit
// try/catch per plan.md, same treatment as the company_internships sub-sources.
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

function toListing(raw: DevpostHackathon): HackathonListing {
  return {
    id: raw.id,
    title: raw.title,
    url: raw.url,
    prize: raw.prize_amount ?? null,
    deadline: raw.submission_period_dates ?? null,
    tags: (raw.themes ?? []).map((t) => (typeof t === 'string' ? t : t.name)),
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
