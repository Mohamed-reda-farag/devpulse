const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

interface GroqChatResponse {
  choices?: { message?: { content?: string } }[];
}

async function callGroq(systemPrompt: string, userContent: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set');
  }
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

/**
 * For company_internships: translates Arabic source text into English *and*
 * summarizes it in one call (Article V's language rule — translation is not a
 * separate step). Returns JSON so the caller gets a clean {title, summary} pair.
 */
export async function translateAndSummarize(
  rawTitleAr: string,
  rawTextAr: string,
  sourceContext: string,
): Promise<{ title: string; summary: string }> {
  const systemPrompt =
    'You translate Arabic internship/program listings into English and write a short, ' +
    'original English summary for a personal digest. Never copy phrases verbatim — always ' +
    'rewrite in your own words. Respond with ONLY a JSON object of the exact shape ' +
    '{"title": string, "summary": string}, no markdown fences, no preamble. ' +
    'title must be <=120 characters, summary must be <=500 characters.';
  const userContent = `Source: ${sourceContext}\n\nTitle (Arabic): ${rawTitleAr}\n\nDetails (Arabic):\n${rawTextAr}`;
  const raw = await callGroq(systemPrompt, userContent);
  const cleaned = raw.replace(/^```json\s*|\s*```$/g, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Groq translateAndSummarize returned non-JSON content');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).title !== 'string' ||
    typeof (parsed as Record<string, unknown>).summary !== 'string'
  ) {
    throw new Error('Groq translateAndSummarize returned an unexpected shape');
  }
  const { title, summary } = parsed as { title: string; summary: string };
  return { title: title.slice(0, 120), summary: summary.slice(0, 500) };
}
