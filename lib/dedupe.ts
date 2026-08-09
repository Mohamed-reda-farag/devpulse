import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './db/supabaseClient.js';
import type { ContentItem } from './types.js';

/**
 * Loads every `ContentItem.id` currently stored in `content_items`.
 *
 * Deliberately a single *unfiltered* `select id`, not a per-candidate
 * `where id = any($1)`: the full candidate list isn't known until each of
 * the five sources' fetchers resolves, and `scripts/ingest.ts` needs this
 * set *before* normalize runs for each source (the dedupe-before-normalize
 * ordering that protects Groq's rate limit — see README's Phase 1 fix).
 * One query for the whole run either way; given the project's actual scale
 * (constitution Article II: ~15-25 new items/3 days), a full-table id read
 * is cheap. Revisit if `content_items` grows large.
 *
 * Throws (rather than returning an empty set) if Supabase itself is
 * unreachable, so a connection failure is never silently treated as
 * "nothing has been seen yet" — that would double-insert if the connection
 * later recovers mid-run. Callers should let this propagate as the
 * `database_unreachable` failure path (spec.md's edge case), not swallow it.
 */
export async function loadExistingIds(client: SupabaseClient = supabase): Promise<Set<string>> {
  const { data, error } = await client.from('content_items').select('id');
  if (error) {
    throw new Error(`database_unreachable: failed to load existing ids (${error.message})`);
  }
  return new Set((data ?? []).map((row: { id: string }) => row.id));
}

/**
 * Splits candidates into genuinely-new items vs already-seen ones (same
 * source_url reappearing, possibly with an edited title/summary, is treated
 * as immutable — first-seen wins, per spec.md's stated default assumption).
 * Pure and unchanged from Phase 1 — only where `existingIds` comes from
 * changed (Supabase instead of `data/seen-ids.json`).
 */
export function partitionNewItems(
  candidates: ContentItem[],
  existingIds: ReadonlySet<string>,
): { newItems: ContentItem[]; alreadySeen: ContentItem[] } {
  const newItems: ContentItem[] = [];
  const alreadySeen: ContentItem[] = [];
  // Guards against duplicate ids within the same run (e.g. a source returning
  // the same URL twice, or two sources coincidentally producing the same id)
  // as well as against previously-persisted ids.
  const seenThisRun = new Set<string>();
  for (const item of candidates) {
    if (existingIds.has(item.id) || seenThisRun.has(item.id)) {
      alreadySeen.push(item);
      continue;
    }
    seenThisRun.add(item.id);
    newItems.push(item);
  }
  return { newItems, alreadySeen };
}

/**
 * Batched insert of genuinely-new items into `content_items`. A no-op (no
 * network call) when `items` is empty, so a run with zero new items never
 * touches the database on this step. Throws on failure, same
 * `database_unreachable`-prefixed convention as `loadExistingIds`, so
 * `scripts/ingest.ts` can distinguish this from a per-source failure.
 */
export async function insertNewItems(
  items: ContentItem[],
  client: SupabaseClient = supabase,
): Promise<void> {
  if (items.length === 0) return;
  const { error } = await client.from('content_items').insert(items);
  if (error) {
    throw new Error(`database_unreachable: failed to insert new items (${error.message})`);
  }
}
