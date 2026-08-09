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
