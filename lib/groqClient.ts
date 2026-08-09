const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

// Groq's free tier is roughly 30 requests/minute (constitution Article II).
// Firing calls back-to-back with no pacing blew straight through that in
// production (~350 items normalized in a burst → wall of 429s). One request
// every 2.2s keeps us under the limit with margin.
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

let lastCallAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle(): Promise<void> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
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
        max_tokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
    });

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
