const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

// Groq's free tier is roughly 30 requests/minute (constitution Article II).
// Firing calls back-to-back with no pacing blew straight through that in
// production (~350 items normalized in a burst → wall of 429s). One request
// every 2.2s keeps us under the *request-count* limit with margin. This is
// a lightweight baseline pace only — the real defense against 429s is the
// header-driven token check below. The binding constraint turned out to be
// TPM (tokens/minute, 12K for this model), not RPM: a request rate safely
// under 30/min can still blow through 12K TPM if individual requests carry
// enough tokens each. Confirmed 2026-08-10 — persistent 429s with that
// day's total Groq usage nowhere near the 100K TPD ceiling, which ruled
// the daily quota out as this particular run's cause.
const MIN_INTERVAL_MS = 2200;
const MAX_RETRIES = 3;
// Never sleep longer than this for a single retry, even if Groq's
// retry-after header says more. A large retry-after almost always means the
// DAILY (RPD/TPD) quota was hit, not the per-minute one — that won't reset
// mid-run no matter how long we wait, so honoring it literally just blocks
// this item (and everything sequential after it in normalize.ts's per-source
// loop) for however long the header says, sometimes many minutes. Capping
// bounds one item's worst case to MAX_RETRIES * MAX_BACKOFF_MS (~90s); if
// the quota genuinely hasn't recovered by then, the item is skipped via the
// existing per-item try/catch in normalize.ts, same as any other failure.
const MAX_BACKOFF_MS = 30_000;
// Proactive TPM guard: Groq returns live remaining-tokens-this-minute
// counts on EVERY response (x-ratelimit-remaining-tokens), not just on
// 429s — see console.groq.com/settings/limits and Groq's rate-limit
// headers docs. Once tracked remaining budget drops below this reserve, we
// wait out the TPM window (x-ratelimit-reset-tokens) BEFORE sending the
// next request, instead of firing anyway and only reacting after a 429.
// The reserve is a conservative one-request budget: system prompt
// (~80 tokens) + max_tokens output (200, see below) + a generous input
// allowance on top.
const TOKEN_RESERVE = 600;

let lastCallAt = 0;

interface TpmState {
  remainingTokens: number | null;
  resetAt: number | null; // epoch ms
}
const tpmState: TpmState = { remainingTokens: null, resetAt: null };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parses Groq's reset-time strings ("7.66s", "2m59.56s", "120ms") into ms. */
function parseResetToMs(value: string | null): number | null {
  if (!value) return null;
  const msMatch = /^(\d+(?:\.\d+)?)ms$/.exec(value);
  if (msMatch) return Number(msMatch[1]);
  const minSecMatch = /^(?:(\d+)m)?(\d+(?:\.\d+)?)s$/.exec(value);
  if (minSecMatch) {
    const minutes = minSecMatch[1] ? Number(minSecMatch[1]) : 0;
    const seconds = Number(minSecMatch[2]);
    return (minutes * 60 + seconds) * 1000;
  }
  return null;
}

/**
 * Updates the tracked TPM state from whatever Groq's response reports.
 * Called after every response — success or 429 — since Groq sends these
 * headers either way, not only when the limit is actually hit.
 */
function updateTpmState(headers: { get(name: string): string | null }): void {
  const remaining = headers.get('x-ratelimit-remaining-tokens');
  if (remaining != null && Number.isFinite(Number(remaining))) {
    tpmState.remainingTokens = Number(remaining);
  }
  const resetMs = parseResetToMs(headers.get('x-ratelimit-reset-tokens'));
  if (resetMs != null) {
    tpmState.resetAt = Date.now() + resetMs;
  }
}

async function throttle(): Promise<void> {
  // Baseline request-count pace (defense in depth if headers are ever
  // missing or malformed).
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);

  // Proactive TPM guard: if the last response told us we're low on tokens
  // for this minute, wait out the window before sending — capped the same
  // way as the 429 backoff (MAX_BACKOFF_MS), for the same reason: never
  // block indefinitely on a single number we're trusting from a header.
  if (
    tpmState.remainingTokens != null &&
    tpmState.remainingTokens < TOKEN_RESERVE &&
    tpmState.resetAt != null
  ) {
    const untilReset = tpmState.resetAt - Date.now();
    if (untilReset > 0) {
      await sleep(Math.min(untilReset, MAX_BACKOFF_MS));
    }
  }

  lastCallAt = Date.now();
}

interface GroqChatResponse {
  choices?: { message?: { content?: string } }[];
}

async function callGroq(systemPrompt: string, userContent: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set');
  }

  let lastError: Error = new Error('Groq API call did not run');
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle();
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        // Was 300 — cut to 200. Summaries are truncated to 500 chars
        // (roughly 125-150 tokens) regardless, so anything requested beyond
        // that is wasted TPM budget that never reaches the final output.
        max_tokens: 200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
    });

    updateTpmState(res.headers);

    if (res.status === 429) {
      // Respect Retry-After when Groq sends one; otherwise back off
      // exponentially (2s, 4s, 8s) on top of the base throttle interval —
      // but never beyond MAX_BACKOFF_MS (see comment above).
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
      const suggestedMs = Number.isFinite(retryAfterMs) ? retryAfterMs : 2 ** (attempt + 1) * 1000;
      const backoffMs = Math.min(suggestedMs, MAX_BACKOFF_MS);
      lastError = new Error(`Groq API error: HTTP 429 Too Many Requests`);
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs);
        continue;
      }
      throw lastError;
    }

    if (!res.ok) {
      throw new Error(`Groq API error: HTTP ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as GroqChatResponse;
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('Groq API returned no content');
    }
    return content.trim();
  }

  throw lastError;
}

/**
 * Summarizes English-language source text in the pipeline's own words.
 * Never a verbatim copy of the input (FR-006 / Article V).
 */
export async function summarize(rawText: string, sourceContext: string): Promise<string> {
  const systemPrompt =
    'You write short, original English summaries of developer-news items for a personal ' +
    'digest. Rewrite the content in your own words — never copy phrases verbatim from the ' +
    'input. Keep the summary under 500 characters, factual, and free of hype. ' +
    'Respond with only the summary text, no preamble.';
  const userContent = `Source: ${sourceContext}\n\nContent:\n${rawText}`;
  const summary = await callGroq(systemPrompt, userContent);
  return summary.slice(0, 500);
}
