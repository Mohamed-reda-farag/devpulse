import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadExistingIds, partitionNewItems, insertNewItems } from '../lib/dedupe.js';
import type { ContentItem } from '../lib/types.js';

function makeItem(id: string): ContentItem {
  return {
    id,
    topic: 'claude_code',
    title: `Item ${id}`,
    summary: 'summary',
    source_name: 'Test Source',
    source_url: `https://example.com/${id}`,
    published_at: '2026-08-01T00:00:00.000Z',
    fetched_at: '2026-08-01T00:00:00.000Z',
  };
}

/**
 * A minimal fake matching the `.from(table).select(...)` / `.from(table).insert(...)`
 * shape `lib/dedupe.ts` actually calls — not the full SupabaseClient surface.
 * `loadExistingIds`/`insertNewItems` accept a client via an injectable default
 * parameter specifically so tests don't need `vi.mock()` module gymnastics.
 */
function makeMockClient(overrides: {
  selectResult?: { data: unknown; error: unknown };
  insertResult?: { data: unknown; error: unknown };
}) {
  const select = vi.fn().mockResolvedValue(overrides.selectResult ?? { data: [], error: null });
  const insert = vi.fn().mockResolvedValue(overrides.insertResult ?? { data: null, error: null });
  const from = vi.fn().mockReturnValue({ select, insert });
  const client = { from } as unknown as SupabaseClient;
  return { client, from, select, insert };
}

describe('loadExistingIds', () => {
  it('returns a Set of every id currently in content_items', async () => {
    const { client } = makeMockClient({
      selectResult: { data: [{ id: 'a' }, { id: 'b' }], error: null },
    });
    const ids = await loadExistingIds(client);
    expect(ids).toEqual(new Set(['a', 'b']));
  });

  it('returns an empty Set when the table is empty', async () => {
    const { client } = makeMockClient({ selectResult: { data: [], error: null } });
    const ids = await loadExistingIds(client);
    expect(ids.size).toBe(0);
  });

  it('queries content_items with a single select("id") call — one batched query, not one per candidate', async () => {
    const { client, from, select } = makeMockClient({ selectResult: { data: [], error: null } });
    await loadExistingIds(client);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('content_items');
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith('id');
  });

  it('throws a database_unreachable-prefixed error when the query itself fails', async () => {
    const { client } = makeMockClient({
      selectResult: { data: null, error: { message: 'connection refused' } },
    });
    await expect(loadExistingIds(client)).rejects.toThrow(/database_unreachable/);
  });
});

describe('partitionNewItems', () => {
  it('treats a genuinely-new id as new', () => {
    const { newItems, alreadySeen } = partitionNewItems([makeItem('new-1')], new Set());
    expect(newItems.map((i) => i.id)).toEqual(['new-1']);
    expect(alreadySeen).toHaveLength(0);
  });

  it('treats an already-present id as already-seen', () => {
    const { newItems, alreadySeen } = partitionNewItems([makeItem('seen-1')], new Set(['seen-1']));
    expect(newItems).toHaveLength(0);
    expect(alreadySeen.map((i) => i.id)).toEqual(['seen-1']);
  });

  it('correctly splits a mixed batch of new and already-seen ids', () => {
    const existing = new Set(['seen-1', 'seen-2']);
    const candidates = [makeItem('seen-1'), makeItem('new-1'), makeItem('seen-2'), makeItem('new-2')];
    const { newItems, alreadySeen } = partitionNewItems(candidates, existing);
    expect(newItems.map((i) => i.id).sort()).toEqual(['new-1', 'new-2']);
    expect(alreadySeen.map((i) => i.id).sort()).toEqual(['seen-1', 'seen-2']);
  });

  it('also catches a duplicate id appearing twice within the same run', () => {
    const { newItems, alreadySeen } = partitionNewItems([makeItem('a'), makeItem('a')], new Set());
    expect(newItems.map((i) => i.id)).toEqual(['a']);
    expect(alreadySeen.map((i) => i.id)).toEqual(['a']);
  });
});

describe('insertNewItems', () => {
  it('does not call the client at all when there is nothing to insert', async () => {
    const { client, from } = makeMockClient({});
    await insertNewItems([], client);
    expect(from).not.toHaveBeenCalled();
  });

  it('inserts every new item in a single batched call', async () => {
    const { client, from, insert } = makeMockClient({});
    const items = [makeItem('a'), makeItem('b')];
    await insertNewItems(items, client);
    expect(from).toHaveBeenCalledWith('content_items');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(items);
  });

  it('throws a database_unreachable-prefixed error when the insert itself fails', async () => {
    const { client } = makeMockClient({
      insertResult: { data: null, error: { message: 'connection refused' } },
    });
    await expect(insertNewItems([makeItem('a')], client)).rejects.toThrow(/database_unreachable/);
  });
});
