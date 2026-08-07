import { createHash } from 'node:crypto';
import type { ContentItem } from './types.js';
import type { ChangelogEntry } from './schemas.js';
import type { HackathonListing } from './sources/hackathons.js';
import { summarize, translateAndSummarize } from './groqClient.js';
import { SOURCE_NAME as CLAUDE_CODE_SOURCE_NAME, claudeCodeEntryUrl } from './sources/claudeCode.js';
import { SOURCE_NAME as CODEX_SOURCE_NAME, codexEntryUrl } from './sources/codex.js';
import {
  OSSINSIGHT_SOURCE_NAME,
  HN_SOURCE_NAME,
  devToolsItemUrl,
  type DevToolsRawItem,
} from './sources/devTools.js';
import {
  AA_SOURCE_NAME,
  LLM_STATS_SOURCE_NAME,
  openModelsItemUrl,
  type OpenModelsRawItem,
} from './sources/openModels.js';
import {
  ITIDA_SOURCE_NAME,
  ITI_SOURCE_NAME,
  WUZZUF_SOURCE_NAME,
  type CompanyInternshipsRawItem,
} from './sources/companyInternships.js';

/** id = hash derived from source_url (Article V) — collisions mean "same item". */
export function idFromUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 24);
}

function isoOrFallback(candidate: string | undefined | null, fallback: string): string {
  if (!candidate) return fallback;
  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}

/** Formats a metrics record for a human-readable summary: drops metrics that
 * weren't run for this model (null) and caps the count so the summary stays
 * readable instead of dumping every published benchmark. */
function formatMetrics(metrics: Record<string, number | null> | undefined, max = 4): string {
  if (!metrics) return 'no published benchmark scores yet';
  const entries = Object.entries(metrics).filter(
    (entry): entry is [string, number] => entry[1] != null,
  );
  if (entries.length === 0) return 'no published benchmark scores yet';
  return entries
    .slice(0, max)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
}

// ---------------------------------------------------------------------------
// claude_code — Groq-summarized (one of the four free-text sources)
// ---------------------------------------------------------------------------
export async function normalizeClaudeCode(entries: ChangelogEntry[]): Promise<ContentItem[]> {
  const fetchedAt = new Date().toISOString();
  const results: ContentItem[] = [];
  for (const entry of entries) {
    const url = claudeCodeEntryUrl(entry);
    try {
      const summary = await summarize(entry.body, CLAUDE_CODE_SOURCE_NAME);
      results.push({
        id: idFromUrl(url),
        topic: 'claude_code',
        title: truncate(`Claude Code ${entry.version}`, 120),
        summary,
        source_name: CLAUDE_CODE_SOURCE_NAME,
        source_url: url,
        published_at: fetchedAt,
        fetched_at: fetchedAt,
      });
    } catch (err) {
      console.warn(`[normalize:claude_code] skipping ${entry.version}: ${String(err)}`);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// codex — Groq-summarized
// ---------------------------------------------------------------------------
export async function normalizeCodex(entries: ChangelogEntry[]): Promise<ContentItem[]> {
  const fetchedAt = new Date().toISOString();
  const results: ContentItem[] = [];
  for (const entry of entries) {
    const url = codexEntryUrl(entry);
    try {
      const summary = await summarize(entry.body, CODEX_SOURCE_NAME);
      results.push({
        id: idFromUrl(url),
        topic: 'codex',
        title: truncate(`Codex ${entry.version}`, 120),
        summary,
        source_name: CODEX_SOURCE_NAME,
        source_url: url,
        published_at: fetchedAt,
        fetched_at: fetchedAt,
      });
    } catch (err) {
      console.warn(`[normalize:codex] skipping ${entry.version}: ${String(err)}`);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// dev_tools — Groq-summarized (two sub-sources merged into one topic)
// ---------------------------------------------------------------------------
export async function normalizeDevTools(items: DevToolsRawItem[]): Promise<ContentItem[]> {
  const fetchedAt = new Date().toISOString();
  const results: ContentItem[] = [];
  for (const item of items) {
    try {
      if (item.kind === 'ossinsight') {
        const { row } = item;
        const url = devToolsItemUrl(item);
        const summary = await summarize(row.description ?? row.repo_name, OSSINSIGHT_SOURCE_NAME);
        results.push({
          id: idFromUrl(url),
          topic: 'dev_tools',
          title: truncate(row.repo_name, 120),
          summary,
          source_name: OSSINSIGHT_SOURCE_NAME,
          source_url: url,
          published_at: fetchedAt,
          fetched_at: fetchedAt,
        });
      } else {
        const { story } = item;
        const url = devToolsItemUrl(item);
        const summary = await summarize(story.text ?? story.title ?? '', HN_SOURCE_NAME);
        results.push({
          id: idFromUrl(url),
          topic: 'dev_tools',
          title: truncate(story.title ?? url, 120),
          summary,
          source_name: HN_SOURCE_NAME,
          source_url: url,
          published_at: new Date(story.time * 1000).toISOString(),
          fetched_at: fetchedAt,
        });
      }
    } catch (err) {
      console.warn(`[normalize:dev_tools] skipping item: ${String(err)}`);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// open_models — direct formatting from structured fields ONLY, Groq is never
// called (constitution Article II scope note + Article X's sibling rule).
// ---------------------------------------------------------------------------
export function normalizeOpenModels(items: OpenModelsRawItem[]): ContentItem[] {
  const fetchedAt = new Date().toISOString();
  const results: ContentItem[] = [];
  for (const item of items) {
    if (item.kind === 'artificial_analysis') {
      const { model } = item;
      const url = openModelsItemUrl(item);
      const evalStr = formatMetrics(model.evaluations);
      const summary = truncate(
        `${model.name} (open-weight) from ${model.model_creator.name}` +
          `${model.release_date ? `, released ${model.release_date}` : ''}. Benchmarks — ${evalStr}.`,
        500,
      );
      results.push({
        id: idFromUrl(url),
        topic: 'open_models',
        title: truncate(model.name, 120),
        summary,
        source_name: AA_SOURCE_NAME,
        source_url: url,
        published_at: isoOrFallback(model.release_date ?? undefined, fetchedAt),
        fetched_at: fetchedAt,
      });
    } else {
      const { model } = item;
      const url = openModelsItemUrl(item);
      const scoresStr = formatMetrics(model.top_scores);
      const summary = truncate(
        `${model.name} (open-weight) from ${model.organization.name}. Scores — ${scoresStr}.`,
        500,
      );
      results.push({
        id: idFromUrl(url),
        topic: 'open_models',
        title: truncate(model.name, 120),
        summary,
        source_name: LLM_STATS_SOURCE_NAME,
        source_url: url,
        published_at: fetchedAt,
        fetched_at: fetchedAt,
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// hackathons — direct formatting from structured fields ONLY (Article X).
// `tagline` (free text) is never read here. prize/deadline go into both
// `extra` and an inlined `summary`; `tags` goes only into `extra`.
// ---------------------------------------------------------------------------
export function normalizeHackathons(items: HackathonListing[]): ContentItem[] {
  const fetchedAt = new Date().toISOString();
  return items.map((h): ContentItem => {
    const parts: string[] = [];
    if (h.prize) parts.push(`Prize: ${h.prize}`);
    if (h.deadline) parts.push(`Submissions: ${h.deadline}`);
    const summary = truncate(
      parts.length > 0 ? parts.join(' · ') : `${h.title} — a Devpost hackathon.`,
      500,
    );
    return {
      id: idFromUrl(h.url),
      topic: 'hackathons',
      title: truncate(h.title, 120),
      summary,
      source_name: 'Devpost',
      source_url: h.url,
      published_at: fetchedAt,
      fetched_at: fetchedAt,
      extra: {
        prize: h.prize,
        deadline: h.deadline,
        tags: h.tags,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// company_internships — Groq-summarized AND translated in the same call
// (Article V language rule). Three sub-sources merged into one topic.
// ---------------------------------------------------------------------------
function absolutize(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

export async function normalizeCompanyInternships(
  items: CompanyInternshipsRawItem[],
): Promise<ContentItem[]> {
  const fetchedAt = new Date().toISOString();
  const results: ContentItem[] = [];
  for (const item of items) {
    try {
      if (item.kind === 'itida') {
        const { listing } = item;
        const url = absolutize(listing.url, 'https://www.itida.gov.eg');
        const { title, summary } = await translateAndSummarize(
          listing.title_ar,
          listing.description_ar ?? listing.deadline_ar ?? listing.title_ar,
          ITIDA_SOURCE_NAME,
        );
        results.push({
          id: idFromUrl(url),
          topic: 'company_internships',
          title,
          summary,
          source_name: ITIDA_SOURCE_NAME,
          source_url: url,
          published_at: fetchedAt,
          fetched_at: fetchedAt,
        });
      } else if (item.kind === 'iti') {
        const { listing } = item;
        const url = absolutize(listing.link, 'https://iti.gov.eg');
        const { title, summary } = await translateAndSummarize(
          listing.program_title_ar,
          listing.details_ar ?? listing.announcement_date_ar ?? listing.program_title_ar,
          ITI_SOURCE_NAME,
        );
        results.push({
          id: idFromUrl(url),
          topic: 'company_internships',
          title,
          summary,
          source_name: ITI_SOURCE_NAME,
          source_url: url,
          published_at: fetchedAt,
          fetched_at: fetchedAt,
        });
      } else {
        const { listing } = item;
        const url = absolutize(listing.job_url, 'https://wuzzuf.net');
        const { title, summary } = await translateAndSummarize(
          listing.job_title_ar,
          listing.job_description_ar ?? listing.company_ar ?? listing.job_title_ar,
          WUZZUF_SOURCE_NAME,
        );
        results.push({
          id: idFromUrl(url),
          topic: 'company_internships',
          title,
          summary,
          source_name: WUZZUF_SOURCE_NAME,
          source_url: url,
          published_at: fetchedAt,
          fetched_at: fetchedAt,
        });
      }
    } catch (err) {
      console.warn(`[normalize:company_internships] skipping item: ${String(err)}`);
    }
  }
  return results;
}
