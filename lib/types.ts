/**
 * Shared data contract. Every source, regardless of format, is normalized into
 * this exact shape before being written anywhere (constitution Article V).
 * Do not change this shape without project-owner sign-off — every later phase
 * (database, digest generation, notifications) depends on it staying stable.
 */

export const TOPICS = ['claude_code', 'codex', 'dev_tools', 'open_models', 'hackathons'] as const;

export type Topic = (typeof TOPICS)[number];

export interface ContentItem {
  /** hash derived from source_url — prevents duplicates */
  id: string;
  topic: Topic;
  /** <= 120 chars */
  title: string;
  /** <= 500 chars, written in our own words — never a verbatim copy of source text */
  summary: string;
  /** e.g. "Claude Code official changelog" */
  source_name: string;
  source_url: string;
  /** ISO date, from source if available, else falls back to fetched_at */
  published_at: string;
  /** ISO date, when our pipeline pulled it */
  fetched_at: string;
  /** e.g. { prize, deadline } for hackathons */
  extra?: Record<string, unknown>;
}

/**
 * A single failure isolated to one source, produced instead of a thrown error
 * so one broken source never blocks the other five (Article III.9 / FR-004).
 */
export interface SourceFailure {
  source: string;
  timestamp: string;
  /** distinct from a generic failure when the raw payload shape itself changed (Article III.11) */
  kind: 'source_contract_changed' | 'fetch_error';
  reason: string;
}

/** What every `lib/sources/*.ts` fetcher returns to the orchestrator. */
export interface SourceResult<TRaw> {
  items: TRaw[];
  failures: SourceFailure[];
}
