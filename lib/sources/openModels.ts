import {
  artificialAnalysisSchema,
  llmStatsSchema,
  llmStatsLicenseLabel,
  type ArtificialAnalysisModel,
  type LlmStatsModel,
} from '../schemas.js';
import { logSourceFailure } from '../logger.js';
import type { SourceResult } from '../types.js';

// Real list-all-models endpoint (verified against docs 2026-08-07). The
// previous /api/v2/language/models path returned 403 in production — either
// the wrong path or Cloudflare bot-blocking Node's default fetch UA.
const AA_URL = 'https://artificialanalysis.ai/api/v2/data/llms/models';
const LLM_STATS_URL = 'https://api.zeroeval.com/stats/v1/models?limit=100';
const USER_AGENT = 'DevPulse-Ingestion/1.0 (personal dev-news digest; contact via project owner)';

export const AA_SOURCE_NAME = 'Artificial Analysis';
export const LLM_STATS_SOURCE_NAME = 'LLM Stats';

export type OpenModelsRawItem =
  | { kind: 'artificial_analysis'; model: ArtificialAnalysisModel }
  | { kind: 'llm_stats'; model: LlmStatsModel };

/** Candidate source_url for a raw item — used to dedupe BEFORE the (Groq-free,
 * but still worth skipping) normalize step, and reused by normalize.ts so the
 * two never drift apart. */
export function openModelsItemUrl(item: OpenModelsRawItem): string {
  return item.kind === 'artificial_analysis'
    ? `https://artificialanalysis.ai/models/${item.model.slug ?? item.model.id}`
    : `https://llm-stats.com/models/${item.model.id}`;
}

async function fetchArtificialAnalysis(): Promise<SourceResult<OpenModelsRawItem>> {
  const apiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  if (!apiKey) {
    return {
      items: [],
      failures: [
        logSourceFailure('open_models:artificial_analysis', 'fetch_error', 'ARTIFICIAL_ANALYSIS_API_KEY is not set'),
      ],
    };
  }
  try {
    const res = await fetch(AA_URL, { headers: { 'x-api-key': apiKey, 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json: unknown = await res.json();
    const validation = artificialAnalysisSchema.safeParse(json);
    if (!validation.success) {
      return {
        items: [],
        failures: [
          logSourceFailure(
            'open_models:artificial_analysis',
            'source_contract_changed',
            validation.error.message,
          ),
        ],
      };
    }
    // Only genuinely open-weight models belong in this feed — Article I scopes
    // this pipeline to what a solo dev cares about, not every proprietary model.
    const openOnly = validation.data.data.filter((m) => m.open_weights === true);
    return {
      items: openOnly.map((model) => ({ kind: 'artificial_analysis' as const, model })),
      failures: [],
    };
  } catch (err) {
    return {
      items: [],
      failures: [
        logSourceFailure(
          'open_models:artificial_analysis',
          'fetch_error',
          err instanceof Error ? err.message : String(err),
        ),
      ],
    };
  }
}

async function fetchLlmStats(): Promise<SourceResult<OpenModelsRawItem>> {
  const apiKey = process.env.LLM_STATS_API_KEY;
  if (!apiKey) {
    return {
      items: [],
      failures: [
        logSourceFailure('open_models:llm_stats', 'fetch_error', 'LLM_STATS_API_KEY is not set'),
      ],
    };
  }
  try {
    const res = await fetch(LLM_STATS_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json: unknown = await res.json();
    const validation = llmStatsSchema.safeParse(json);
    if (!validation.success) {
      return {
        items: [],
        failures: [
          logSourceFailure('open_models:llm_stats', 'source_contract_changed', validation.error.message),
        ],
      };
    }
    const openOnly = validation.data.models.filter((m) => {
      const label = llmStatsLicenseLabel(m.license);
      return label != null && !/proprietary|closed/i.test(label);
    });
    return {
      items: openOnly.map((model) => ({ kind: 'llm_stats' as const, model })),
      failures: [],
    };
  } catch (err) {
    return {
      items: [],
      failures: [
        logSourceFailure(
          'open_models:llm_stats',
          'fetch_error',
          err instanceof Error ? err.message : String(err),
        ),
      ],
    };
  }
}

/** Fetches both open_models sub-sources independently, same isolation pattern as devTools. */
export async function fetchOpenModels(): Promise<SourceResult<OpenModelsRawItem>> {
  const [aa, llmStats] = await Promise.all([fetchArtificialAnalysis(), fetchLlmStats()]);
  return {
    items: [...aa.items, ...llmStats.items],
    failures: [...aa.failures, ...llmStats.failures],
  };
}
