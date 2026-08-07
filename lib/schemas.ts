import { z } from 'zod';

/**
 * Ten schemas for ten distinct raw-payload shapes (constitution Article III.11).
 * Two topics merge multiple independently-shaped sub-sources, which is why there
 * are more schemas than topics: devTools (OSSInsight + Hacker News), openModels
 * (Artificial Analysis + LLM Stats), companyInternships (ITIDA + ITI + Wuzzuf).
 *
 * A schema failure here must be logged as `source_contract_changed`
 * (see lib/logger.ts), never folded into a generic fetch-error.
 */

// ---------------------------------------------------------------------------
// claude_code — parsed entries from the official markdown CHANGELOG.md
// ---------------------------------------------------------------------------
export const changelogEntrySchema = z.object({
  version: z.string().min(1),
  body: z.string().min(1),
});
export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;

export const claudeCodeSchema = z.array(changelogEntrySchema).min(1);

// ---------------------------------------------------------------------------
// codex — same shape as claude_code; independently-shaped raw source (a
// separately maintained changelog), kept as its own schema per T012 rather
// than reused, so the two sources can drift independently without silently
// sharing a contract.
// ---------------------------------------------------------------------------
export const codexSchema = z.array(changelogEntrySchema).min(1);

// ---------------------------------------------------------------------------
// dev_tools sub-source 1 — OSSInsight public API (api.ossinsight.io)
// ---------------------------------------------------------------------------
export const ossInsightRowSchema = z
  .object({
    repo_id: z.union([z.string(), z.number()]),
    repo_name: z.string().min(1),
    description: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    stars: z.union([z.string(), z.number()]).optional(),
    forks: z.union([z.string(), z.number()]).optional(),
    total_score: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export const ossInsightSchema = z
  .object({
    data: z.object({
      rows: z.array(ossInsightRowSchema),
    }),
  })
  .passthrough();
export type OssInsightRow = z.infer<typeof ossInsightRowSchema>;

// ---------------------------------------------------------------------------
// dev_tools sub-source 2 — Hacker News official Firebase API
// ---------------------------------------------------------------------------
export const hackerNewsSchema = z
  .object({
    id: z.number(),
    type: z.string(),
    title: z.string().optional(),
    url: z.string().optional(),
    text: z.string().optional(),
    by: z.string().optional(),
    time: z.number(),
    score: z.number().optional(),
    descendants: z.number().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// open_models sub-source 1 — Artificial Analysis Data API
// ---------------------------------------------------------------------------
export const artificialAnalysisModelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string().optional(),
    model_creator: z.object({ id: z.string(), name: z.string() }),
    release_date: z.string().nullable().optional(),
    open_weights: z.boolean().optional(),
    // Real payload (confirmed live 2026-08-07): individual metrics are `null`
    // when that benchmark wasn't run for a given model, not always a number.
    evaluations: z.record(z.string(), z.number().nullable()).optional(),
  })
  .passthrough();

export const artificialAnalysisSchema = z
  .object({
    data: z.array(artificialAnalysisModelSchema),
  })
  .passthrough();
export type ArtificialAnalysisModel = z.infer<typeof artificialAnalysisModelSchema>;

// ---------------------------------------------------------------------------
// open_models sub-source 2 — LLM Stats Data API (api.zeroeval.com)
// ---------------------------------------------------------------------------

// The real API returns `license` as an object (e.g. { name, url, id }), not a
// plain string as originally assumed — discovered against the live endpoint
// (2026-08-07). Accepting both shapes keeps the schema honest about what's
// actually out there instead of silently coercing it.
export const llmStatsLicenseSchema = z
  .union([
    z.string(),
    z
      .object({
        name: z.string().optional(),
        id: z.string().optional(),
        type: z.string().optional(),
        url: z.string().optional(),
      })
      .passthrough(),
  ])
  .nullable()
  .optional();

export const llmStatsModelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    organization: z.object({ id: z.string(), name: z.string() }),
    license: llmStatsLicenseSchema,
    // Preemptively nullable, matching the same "benchmark not run for this
    // model" pattern just confirmed on Artificial Analysis's evaluations
    // field (2026-08-07) — not yet confirmed against a live LLM Stats
    // response, but the same shape is likely.
    top_scores: z.record(z.string(), z.number().nullable()).optional(),
  })
  .passthrough();

export const llmStatsSchema = z
  .object({
    models: z.array(llmStatsModelSchema),
  })
  .passthrough();
export type LlmStatsModel = z.infer<typeof llmStatsModelSchema>;

/** Normalizes the string-or-object license shape into a single display string. */
export function llmStatsLicenseLabel(license: LlmStatsModel['license']): string | null {
  if (license == null) return null;
  if (typeof license === 'string') return license;
  return license.name ?? license.id ?? license.type ?? null;
}


// ---------------------------------------------------------------------------
// hackathons — Devpost's undocumented internal endpoint. `tagline` is the
// free-text field Article X forbids leaking into `summary`.
// ---------------------------------------------------------------------------
export const devpostHackathonSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string().min(1),
    url: z.string().min(1),
    prize_amount: z.string().nullable().optional(),
    submission_period_dates: z.string().nullable().optional(),
    themes: z.array(z.union([z.string(), z.object({ name: z.string() }).passthrough()])).optional(),
    /** Free-text blurb — deliberately excluded from summary per Article X. */
    tagline: z.string().nullable().optional(),
    organization_name: z.string().nullable().optional(),
  })
  .passthrough();

export const hackathonsSchema = z
  .object({
    hackathons: z.array(devpostHackathonSchema),
  })
  .passthrough();
export type DevpostHackathon = z.infer<typeof devpostHackathonSchema>;

// ---------------------------------------------------------------------------
// company_internships sub-source 1 — ITIDA (no public API; scraped)
// Validates the structured intermediate shape produced by the scraper, not
// raw HTML — see lib/sources/companyInternships.ts.
// ---------------------------------------------------------------------------
export const itidaSchema = z.object({
  title_ar: z.string().min(1),
  url: z.string().min(1),
  deadline_ar: z.string().nullable().optional(),
  description_ar: z.string().nullable().optional(),
});
export type ItidaListing = z.infer<typeof itidaSchema>;

// ---------------------------------------------------------------------------
// company_internships sub-source 2 — ITI Summer Code Camp (no public API; scraped)
// ---------------------------------------------------------------------------
export const itiSchema = z.object({
  program_title_ar: z.string().min(1),
  link: z.string().min(1),
  announcement_date_ar: z.string().nullable().optional(),
  details_ar: z.string().nullable().optional(),
});
export type ItiListing = z.infer<typeof itiSchema>;

// ---------------------------------------------------------------------------
// company_internships sub-source 3 — Wuzzuf (no public API; scraped, ToS
// unreviewed — flagged for Phase 7, see plan.md)
// ---------------------------------------------------------------------------
export const wuzzufSchema = z.object({
  job_title_ar: z.string().min(1),
  job_url: z.string().min(1),
  company_ar: z.string().nullable().optional(),
  posted_ar: z.string().nullable().optional(),
  job_description_ar: z.string().nullable().optional(),
});
export type WuzzufListing = z.infer<typeof wuzzufSchema>;
