import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchOpenModels } from '../../lib/sources/openModels.js';

const AA_RESPONSE = {
  data: [
    {
      id: 'llama-3.3-70b',
      name: 'Llama 3.3 70B',
      slug: 'meta-llama_3-3-70b',
      model_creator: { id: 'meta', name: 'Meta' },
      release_date: '2025-12-01',
      open_weights: true,
      evaluations: { intelligence_index: 61.2 },
    },
    {
      id: 'gpt-5',
      name: 'GPT-5',
      slug: 'openai_gpt-5',
      model_creator: { id: 'openai', name: 'OpenAI' },
      release_date: '2025-08-07',
      open_weights: false,
      evaluations: { intelligence_index: 71.4 },
    },
  ],
};

const LLM_STATS_RESPONSE = {
  models: [
    {
      id: 'qwen-2-5-72b',
      name: 'Qwen 2.5 72B',
      organization: { id: 'alibaba', name: 'Alibaba' },
      license: 'Apache 2.0',
      top_scores: { code: 58.1 },
    },
    {
      id: 'claude-4-sonnet',
      name: 'Claude 4 Sonnet',
      organization: { id: 'anthropic', name: 'Anthropic' },
      license: 'Proprietary',
      top_scores: { code: 94.2 },
    },
  ],
};

function mockFetchImpl(url: string) {
  if (url.startsWith('https://artificialanalysis.ai')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => AA_RESPONSE,
    });
  }
  if (url.startsWith('https://api.zeroeval.com')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => LLM_STATS_RESPONSE,
    });
  }
  throw new Error(`Unexpected URL in test: ${url}`);
}

beforeEach(() => {
  vi.stubEnv('ARTIFICIAL_ANALYSIS_API_KEY', 'test-aa-key');
  vi.stubEnv('LLM_STATS_API_KEY', 'test-llmstats-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('fetchOpenModels', () => {
  it('filters to open-weight/non-proprietary models only, from both sub-sources', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(mockFetchImpl));

    const result = await fetchOpenModels();
    expect(result.failures).toEqual([]);

    const aaItems = result.items.filter((i) => i.kind === 'artificial_analysis');
    expect(aaItems).toHaveLength(1);
    expect(aaItems[0]?.kind === 'artificial_analysis' && aaItems[0].model.name).toBe(
      'Llama 3.3 70B',
    );

    const llmStatsItems = result.items.filter((i) => i.kind === 'llm_stats');
    expect(llmStatsItems).toHaveLength(1);
    expect(llmStatsItems[0]?.kind === 'llm_stats' && llmStatsItems[0].model.name).toBe(
      'Qwen 2.5 72B',
    );
  });

  it('isolates a failure in one sub-source from the other', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.startsWith('https://artificialanalysis.ai')) {
          return Promise.reject(new Error('AA API is down'));
        }
        return mockFetchImpl(url);
      }),
    );

    const result = await fetchOpenModels();
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.source).toBe('open_models:artificial_analysis');
    expect(result.items.some((i) => i.kind === 'llm_stats')).toBe(true);
  });
});
