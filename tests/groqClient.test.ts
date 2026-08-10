import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  vi.stubEnv('GROQ_API_KEY', 'test-key');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function mockResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'OK',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

describe('groqClient — retries on 429 instead of failing immediately', () => {
  it('retries after a 429 and succeeds on the second attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(429, {}, { 'retry-after': '1' }))
      .mockResolvedValueOnce(
        mockResponse(200, { choices: [{ message: { content: 'a real summary' } }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { summarize } = await import('../lib/groqClient.js');
    const promise = summarize('some raw text', 'Test Source');

    // Advance past the throttle interval and the Retry-After backoff.
    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result).toBe('a real summary');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries on persistent 429s', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(429, {}));
    vi.stubGlobal('fetch', fetchMock);

    const { summarize } = await import('../lib/groqClient.js');
    const promise = summarize('some raw text', 'Test Source').catch((e: Error) => e);

    await vi.advanceTimersByTimeAsync(60_000);

    const result = await promise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('429');
  });
});

describe('groqClient — caps backoff even when Groq suggests a much longer wait', () => {
  it('does not honor a multi-minute retry-after literally (daily RPD/TPD quota case)', async () => {
    // 371s ("6m 11s") mirrors Groq's own docs example for a daily-quota 429 —
    // long compared to the few-second waits a per-minute limit produces.
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(429, {}, { 'retry-after': '371' }));
    vi.stubGlobal('fetch', fetchMock);

    const { summarize } = await import('../lib/groqClient.js');
    const promise = summarize('some raw text', 'Test Source').catch((e: Error) => e);

    // Uncapped, exhausting retries here would take ~4 * 371s ≈ 25 minutes.
    // With the MAX_BACKOFF_MS cap, all 4 attempts (1 + 3 retries) should
    // finish well within 3 minutes of fake time instead.
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

    const result = await promise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('429');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('groqClient — proactively throttles on TPM headers, not just request count', () => {
  it('waits out the TPM window when a prior response reported low remaining tokens, instead of firing immediately and hitting a 429', async () => {
    // First call succeeds but reports we're nearly out of this minute's
    // token budget (below TOKEN_RESERVE), with 45s left until it resets.
    // Second call (a genuinely new, unrelated item) should NOT fire right
    // after the base 2.2s interval — it should wait out that 45s window
    // first, since request-count pacing alone can't see this coming.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(
          200,
          { choices: [{ message: { content: 'first summary' } }] },
          { 'x-ratelimit-remaining-tokens': '50', 'x-ratelimit-reset-tokens': '45s' },
        ),
      )
      .mockResolvedValueOnce(
        mockResponse(200, { choices: [{ message: { content: 'second summary' } }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    vi.resetModules(); // module-level lastCallAt/tpmState must start clean for this test
    const { summarize } = await import('../lib/groqClient.js');

    const first = await summarize('first item text', 'Test Source');
    expect(first).toBe('first summary');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const secondPromise = summarize('second item text', 'Test Source');

    // Only the base 2.2s interval has passed — with no TPM guard this would
    // already be enough to fire. It must NOT have fired yet.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Now advance past the reported 45s reset window — the second call
    // should proceed.
    await vi.advanceTimersByTimeAsync(45_000);
    const second = await secondPromise;
    expect(second).toBe('second summary');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not throttle proactively when remaining tokens are comfortably above the reserve', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(
          200,
          { choices: [{ message: { content: 'first summary' } }] },
          { 'x-ratelimit-remaining-tokens': '11000', 'x-ratelimit-reset-tokens': '58s' },
        ),
      )
      .mockResolvedValueOnce(
        mockResponse(200, { choices: [{ message: { content: 'second summary' } }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    vi.resetModules();
    const { summarize } = await import('../lib/groqClient.js');
    await summarize('first item text', 'Test Source');

    const secondPromise = summarize('second item text', 'Test Source');
    // Only the base MIN_INTERVAL_MS (2.2s) should gate this — no TPM wait.
    await vi.advanceTimersByTimeAsync(2_300);
    const second = await secondPromise;
    expect(second).toBe('second summary');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
