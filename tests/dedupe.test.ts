import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { loadSeenIds, partitionNewItems, appendSeenIds } from '../lib/dedupe.js';
import { idFromUrl } from '../lib/normalize.js';
import type { ContentItem } from '../lib/types.js';

const TMP_PATH = 'data/.test-seen-ids.json';

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  const url = overrides.source_url ?? 'https://example.com/item-1';
  return {
    id: idFromUrl(url),
    topic: 'claude_code',
    title: 'Test item',
    summary: 'A test summary.',
    source_name: 'Test Source',
    source_url: url,
    published_at: '2026-07-01T00:00:00.000Z',
    fetched_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(async () => {
  await rm(TMP_PATH, { force: true });
});

describe('partitionNewItems', () => {
  it('treats an item whose id has not been seen before as new', () => {
    const item = makeItem();
    const { newItems, alreadySeen } = partitionNewItems([item], new Set());
    expect(newItems).toEqual([item]);
    expect(alreadySeen).toEqual([]);
  });

  it('treats an item whose id is already in the seen set as already-seen', () => {
    const item = makeItem();
    const { newItems, alreadySeen } = partitionNewItems([item], new Set([item.id]));
    expect(newItems).toEqual([]);
    expect(alreadySeen).toEqual([item]);
  });

  it('treats the same source_url with a changed title as already-seen (first-seen wins)', () => {
    const url = 'https://example.com/changelog#2.1.0';
    const original = makeItem({ source_url: url, title: 'Original title' });
    const edited = makeItem({ source_url: url, title: 'Edited title after publish' });

    // id is derived from source_url, so both share the same id.
    expect(original.id).toBe(edited.id);

    const seenIds = new Set([original.id]);
    const { newItems, alreadySeen } = partitionNewItems([edited], seenIds);
    expect(newItems).toEqual([]);
    expect(alreadySeen).toEqual([edited]);
  });
});

describe('loadSeenIds / appendSeenIds', () => {
  it('returns an empty set when the file does not exist yet', async () => {
    const ids = await loadSeenIds(TMP_PATH);
    expect(ids.size).toBe(0);
  });

  it('persists appended ids and loads them back on the next run', async () => {
    await appendSeenIds(['id-a', 'id-b'], TMP_PATH);
    const ids = await loadSeenIds(TMP_PATH);
    expect(ids.has('id-a')).toBe(true);
    expect(ids.has('id-b')).toBe(true);
  });

  it('is append-only — a second call adds without dropping earlier ids', async () => {
    await appendSeenIds(['id-a'], TMP_PATH);
    await appendSeenIds(['id-c'], TMP_PATH);
    const ids = await loadSeenIds(TMP_PATH);
    expect([...ids].sort()).toEqual(['id-a', 'id-c']);
  });
});
