import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInsert = vi.fn();
const mockGetUser = vi.fn();

vi.mock('../../lib/supabase/server', () => ({
  getServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      if (table !== 'user_topics') {
        throw new Error(`unexpected table in test mock: ${table}`);
      }
      return { insert: mockInsert };
    },
  })),
}));

// Imported after the mock above so the mocked module is what actions.ts sees.
const { submitTopics } = await import('../../app/onboarding/actions');

const SIGNED_IN_USER = { id: 'user-123' };

describe('submitTopics', () => {
  beforeEach(() => {
    mockInsert.mockReset();
    mockGetUser.mockReset();
    mockGetUser.mockResolvedValue({ data: { user: SIGNED_IN_USER }, error: null });
    mockInsert.mockResolvedValue({ error: null });
  });

  it('rejects an empty array without ever reaching Supabase', async () => {
    const result = await submitTopics([]);

    expect(result.success).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects an array containing an unknown topic slug', async () => {
    const result = await submitTopics(['claude_code', 'not_a_real_topic']);

    expect(result.success).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('reaches the mocked insert call with the signed-in user id for a valid selection', async () => {
    const result = await submitTopics(['claude_code', 'hackathons']);

    expect(result.success).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith([
      { user_id: SIGNED_IN_USER.id, topic_slug: 'claude_code' },
      { user_id: SIGNED_IN_USER.id, topic_slug: 'hackathons' },
    ]);
  });

  it('does not insert and reports failure when nobody is signed in', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await submitTopics(['claude_code']);

    expect(result.success).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('reports failure (without throwing) when the insert itself fails', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'db down' } });

    const result = await submitTopics(['claude_code']);

    expect(result.success).toBe(false);
  });
});
