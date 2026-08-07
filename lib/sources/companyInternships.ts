import * as cheerio from 'cheerio';
import { itidaSchema, itiSchema, wuzzufSchema, type ItidaListing, type ItiListing, type WuzzufListing } from '../schemas.js';
import { logSourceFailure } from '../logger.js';
import type { SourceResult } from '../types.js';

/**
 * None of ITIDA, ITI, or Wuzzuf publish a documented public API (constitution
 * Article I / spec.md edge cases), so these are scraped. The exact selectors
 * below are a best-effort starting point and MUST be verified by the project
 * owner against the live markup before this ships — flagged explicitly here
 * rather than silently assumed correct, per Article IX's spirit. Wuzzuf's ToS
 * status specifically is unreviewed; see plan.md's Wuzzuf ToS note (Phase 7).
 */
const ITIDA_URL = 'https://www.itida.gov.eg/Arabic/Pages/default.aspx';
const ITI_URL = 'https://iti.gov.eg/iti/announcements';
const WUZZUF_URL = 'https://wuzzuf.net/internships/egypt?filters%5Bcategory_names%5D%5B0%5D=Software%20Development';

export const ITIDA_SOURCE_NAME = 'ITIDA';
export const ITI_SOURCE_NAME = 'ITI Summer Code Camp';
export const WUZZUF_SOURCE_NAME = 'Wuzzuf';

export type CompanyInternshipsRawItem =
  | { kind: 'itida'; listing: ItidaListing }
  | { kind: 'iti'; listing: ItiListing }
  | { kind: 'wuzzuf'; listing: WuzzufListing };

async function fetchItida(): Promise<SourceResult<CompanyInternshipsRawItem>> {
  try {
    const res = await fetch(ITIDA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const raw: unknown[] = [];
    $('.internship-item, .program-card').each((_, el) => {
      const $el = $(el);
      raw.push({
        title_ar: $el.find('.title').text().trim(),
        url: $el.find('a').attr('href') ?? '',
        deadline_ar: $el.find('.deadline').text().trim() || undefined,
        description_ar: $el.find('.description').text().trim() || undefined,
      });
    });

    const items: CompanyInternshipsRawItem[] = [];
    const failures = [];
    for (const entry of raw) {
      const validation = itidaSchema.safeParse(entry);
      if (!validation.success) {
        failures.push(
          logSourceFailure('company_internships:itida', 'source_contract_changed', validation.error.message),
        );
        continue;
      }
      items.push({ kind: 'itida', listing: validation.data });
    }
    return { items, failures };
  } catch (err) {
    return {
      items: [],
      failures: [
        logSourceFailure(
          'company_internships:itida',
          'fetch_error',
          err instanceof Error ? err.message : String(err),
        ),
      ],
    };
  }
}

async function fetchIti(): Promise<SourceResult<CompanyInternshipsRawItem>> {
  try {
    const res = await fetch(ITI_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const raw: unknown[] = [];
    $('.announcement, .news-item').each((_, el) => {
      const $el = $(el);
      raw.push({
        program_title_ar: $el.find('.headline, h3').first().text().trim(),
        link: $el.find('a').attr('href') ?? '',
        announcement_date_ar: $el.find('.date').text().trim() || undefined,
        details_ar: $el.find('.summary, p').first().text().trim() || undefined,
      });
    });

    const items: CompanyInternshipsRawItem[] = [];
    const failures = [];
    for (const entry of raw) {
      const validation = itiSchema.safeParse(entry);
      if (!validation.success) {
        failures.push(
          logSourceFailure('company_internships:iti', 'source_contract_changed', validation.error.message),
        );
        continue;
      }
      items.push({ kind: 'iti', listing: validation.data });
    }
    return { items, failures };
  } catch (err) {
    return {
      items: [],
      failures: [
        logSourceFailure(
          'company_internships:iti',
          'fetch_error',
          err instanceof Error ? err.message : String(err),
        ),
      ],
    };
  }
}

async function fetchWuzzuf(): Promise<SourceResult<CompanyInternshipsRawItem>> {
  try {
    const res = await fetch(WUZZUF_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const raw: unknown[] = [];
    $('.css-1gatmva, .job-card').each((_, el) => {
      const $el = $(el);
      raw.push({
        job_title_ar: $el.find('h2, .job-title').first().text().trim(),
        job_url: $el.find('a').attr('href') ?? '',
        company_ar: $el.find('.company, a.company-name').first().text().trim() || undefined,
        posted_ar: $el.find('.posted-date, .css-4c4ojb').first().text().trim() || undefined,
        job_description_ar: $el.find('.job-description').first().text().trim() || undefined,
      });
    });

    const items: CompanyInternshipsRawItem[] = [];
    const failures = [];
    for (const entry of raw) {
      const validation = wuzzufSchema.safeParse(entry);
      if (!validation.success) {
        failures.push(
          logSourceFailure('company_internships:wuzzuf', 'source_contract_changed', validation.error.message),
        );
        continue;
      }
      items.push({ kind: 'wuzzuf', listing: validation.data });
    }
    return { items, failures };
  } catch (err) {
    return {
      items: [],
      failures: [
        logSourceFailure(
          'company_internships:wuzzuf',
          'fetch_error',
          err instanceof Error ? err.message : String(err),
        ),
      ],
    };
  }
}

/**
 * Fetches all three Egypt/regional sub-sources independently. One sub-source
 * failing (e.g. Wuzzuf blocking the request) must not drop the other two.
 */
export async function fetchCompanyInternships(): Promise<SourceResult<CompanyInternshipsRawItem>> {
  const [itida, iti, wuzzuf] = await Promise.all([fetchItida(), fetchIti(), fetchWuzzuf()]);
  return {
    items: [...itida.items, ...iti.items, ...wuzzuf.items],
    failures: [...itida.failures, ...iti.failures, ...wuzzuf.failures],
  };
}
