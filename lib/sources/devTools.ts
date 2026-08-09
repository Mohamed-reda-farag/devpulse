import {
  ossInsightSchema,
  hackerNewsSchema,
  type OssInsightRow,
} from '../schemas.js';
import { z } from 'zod';
import { logSourceFailure } from '../logger.js';
import type { SourceResult, SourceFailure } from '../types.js';

const OSSINSIGHT_URL = 'https://api.ossinsight.io/v1/trends/repos/?period=past_24_hours&language=All';
const HN_TOP_STORIES_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const HN_ITEM_URL = (id: number) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
const HN_STORIES_TO_CHECK = 30;
// dev_tools previously had no volume cap at all, unlike claude_code/codex's
// existing 15-most-recent-entries limit (README). A cold-start run against
// full history (empty content_items) exposed this: dev_tools was a major
// contributor to burning through Groq's *daily* token budget (100K TPD for
// llama-3.3-70b-versatile — see README status note). Capped here to match
// the same per-run budget claude_code/codex already respect.
export const MAX_ITEMS_PER_SUBSOURCE = 15;

export const OSSINSIGHT_SOURCE_NAME = 'OSSInsight trending repositories';
export const HN_SOURCE_NAME = 'Hacker News';

export type HackerNewsItem = z.infer<typeof hackerNewsSchema>;

export type DevToolsRawItem =
  | { kind: 'ossinsight'; row: OssInsightRow }
  | { kind: 'hackernews'; story: HackerNewsItem };

/** Candidate source_url for a raw item — used to dedupe before normalize.ts's
 * (Groq-calling) summarization step, and reused by normalize.ts itself. */
export function devToolsItemUrl(item: DevToolsRawItem): string {
  return item.kind === 'ossinsight'
    ? `https://github.com/${item.row.repo_name}`
    : (item.story.url ?? `https://news.ycombinator.com/item?id=${item.story.id}`);
}

// Loose keyword heuristic for "dev tool" relevance among HN top stories. This
// is a Phase 1 simplification — Phase 3's per-user filtering does the real
// topic filtering; this just keeps obviously irrelevant HN stories out.
const DEV_TOOL_KEYWORDS =
  /\b(cli|sdk|ide|compiler|framework|library|open.?source|linter|debugger|runtime|package manager|build tool|dev ?tool)\b/i;

async function fetchOssInsight(): Promise<SourceResult<DevToolsRawItem>> {
  try {
    const res = await fetch(OSSINSIGHT_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json: unknown = await res.json();
    const validation = ossInsightSchema.safeParse(json);
    if (!validation.success) {
      return {
        items: [],
        failures: [
          logSourceFailure('dev_tools:ossinsight', 'source_contract_changed', validation.error.message),
        ],
      };
    }
    return {
      items: validation.data.data.rows
        .slice(0, MAX_ITEMS_PER_SUBSOURCE)
        .map((row) => ({ kind: 'ossinsight' as const, row })),
      failures: [],
    };
  } catch (err) {
    return {
      items: [],
      failures: [
        logSourceFailure(
          'dev_tools:ossinsight',
          'fetch_error',
          err instanceof Error ? err.message : String(err),
        ),
      ],
    };
  }
}

async function fetchHackerNews(): Promise<SourceResult<DevToolsRawItem>> {
  try {
    const idsRes = await fetch(HN_TOP_STORIES_URL);
    if (!idsRes.ok) throw new Error(`HTTP ${idsRes.status} ${idsRes.statusText}`);
    const idsJson: unknown = await idsRes.json();
    const ids = z.array(z.number()).parse(idsJson).slice(0, HN_STORIES_TO_CHECK);

    const items: DevToolsRawItem[] = [];
    const failures: SourceFailure[] = [];

    for (const id of ids) {
      if (items.length >= MAX_ITEMS_PER_SUBSOURCE) break; // cap reached — skip remaining stories this run
      try {
        const itemRes = await fetch(HN_ITEM_URL(id));
        if (!itemRes.ok) throw new Error(`HTTP ${itemRes.status}`);
        const itemJson: unknown = await itemRes.json();
        const validation = hackerNewsSchema.safeParse(itemJson);
        if (!validation.success) {
          failures.push(
            logSourceFailure('dev_tools:hackernews', 'source_contract_changed', validation.error.message),
          );
          continue;
        }
        const story = validation.data;
        if (story.type === 'story' && story.title && DEV_TOOL_KEYWORDS.test(story.title)) {
          items.push({ kind: 'hackernews', story });
        }
      } catch {
        // A single story failing to fetch isn't fatal to the whole sub-source;
        // skip it and keep going.
        continue;
      }
    }

    return { items, failures };
  } catch (err) {
    return {
      items: [],
      failures: [
        logSourceFailure(
          'dev_tools:hackernews',
          'fetch_error',
          err instanceof Error ? err.message : String(err),
        ),
      ],
    };
  }
}

/**
 * Fetches both dev_tools sub-sources independently — one failing must not
 * drop the other (same isolation pattern used across all multi-sub-source topics).
 */
export async function fetchDevTools(): Promise<SourceResult<DevToolsRawItem>> {
  const [ossinsight, hackernews] = await Promise.all([fetchOssInsight(), fetchHackerNews()]);
  return {
    items: [...ossinsight.items, ...hackernews.items],
    failures: [...ossinsight.failures, ...hackernews.failures],
  };
}
