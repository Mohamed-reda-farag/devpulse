import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ContentItem } from './types.js';

const DEFAULT_SEEN_IDS_PATH = 'data/seen-ids.json';

/** Loads the append-only set of every ContentItem.id ever produced. */
export async function loadSeenIds(path = DEFAULT_SEEN_IDS_PATH): Promise<Set<string>> {
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Set();
    }
    throw err;
  }
}

/**
 * Splits candidates into genuinely-new items vs already-seen ones (same
 * source_url reappearing, possibly with an edited title/summary, is treated
 * as immutable — first-seen wins, per spec.md's stated default assumption).
 */
export function partitionNewItems(
  candidates: ContentItem[],
  seenIds: ReadonlySet<string>,
): { newItems: ContentItem[]; alreadySeen: ContentItem[] } {
  const newItems: ContentItem[] = [];
  const alreadySeen: ContentItem[] = [];
  // Guards against duplicate ids within the same run (e.g. a source returning
  // the same URL twice) as well as against previously-seen ids.
  const seenThisRun = new Set<string>();
  for (const item of candidates) {
    if (seenIds.has(item.id) || seenThisRun.has(item.id)) {
      alreadySeen.push(item);
      continue;
    }
    seenThisRun.add(item.id);
    newItems.push(item);
  }
  return { newItems, alreadySeen };
}

/** Appends the given ids to the persistent seen-ids index (never overwritten). */
export async function appendSeenIds(
  newIds: string[],
  path = DEFAULT_SEEN_IDS_PATH,
): Promise<void> {
  const existing = await loadSeenIds(path);
  for (const id of newIds) existing.add(id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify([...existing], null, 2), 'utf-8');
}
