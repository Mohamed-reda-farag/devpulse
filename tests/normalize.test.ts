import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/groqClient.js', () => ({
  summarize: vi.fn(),
  translateAndSummarize: vi.fn(),
}));

import { summarize, translateAndSummarize } from '../lib/groqClient.js';
import {
  normalizeClaudeCode,
  normalizeCodex,
  normalizeDevTools,
  normalizeOpenModels,
  normalizeHackathons,
  normalizeCompanyInternships,
} from '../lib/normalize.js';
import type { HackathonListing } from '../lib/sources/hackathons.js';
import type { OpenModelsRawItem } from '../lib/sources/openModels.js';
import type { CompanyInternshipsRawItem } from '../lib/sources/companyInternships.js';
import type { DevToolsRawItem } from '../lib/sources/devTools.js';

const mockedSummarize = vi.mocked(summarize);
const mockedTranslateAndSummarize = vi.mocked(translateAndSummarize);

beforeEach(() => {
  mockedSummarize.mockReset();
  mockedTranslateAndSummarize.mockReset();
});

describe('normalize — four free-text sources use Groq and never echo raw input verbatim', () => {
  it('claude_code: summary comes from Groq and is not a substring of the raw body', async () => {
    const rawBody =
      '- Added guard against launching Claude Code inside another Claude Code session';
    mockedSummarize.mockResolvedValue('Prevents accidentally starting a nested session.');

    const items = await normalizeClaudeCode([{ version: '2.1.39', body: rawBody }]);

    expect(items).toHaveLength(1);
    expect(items[0]?.summary).toBe('Prevents accidentally starting a nested session.');
    expect(rawBody).not.toContain(items[0]!.summary);
    expect(mockedSummarize).toHaveBeenCalledWith(rawBody, expect.any(String));
  });

  it('codex: summary comes from Groq and is not a substring of the raw body', async () => {
    const rawBody = '- Released gpt-5.1-codex-max to the Responses API';
    mockedSummarize.mockResolvedValue('Rolled out a new high-capability model to the API.');

    const items = await normalizeCodex([{ version: '0.58.0', body: rawBody }]);

    expect(items).toHaveLength(1);
    expect(rawBody).not.toContain(items[0]!.summary);
  });

  it('dev_tools: summary comes from Groq for both OSSInsight and Hacker News items', async () => {
    mockedSummarize.mockResolvedValue('A community CLI tool gaining traction among developers.');

    const raw: DevToolsRawItem[] = [
      {
        kind: 'ossinsight',
        row: { repo_id: 1, repo_name: 'someorg/some-cli-tool', description: 'A fast CLI tool.' },
      },
    ];
    const items = await normalizeDevTools(raw);

    expect(items).toHaveLength(1);
    expect(items[0]!.summary).not.toContain('A fast CLI tool.');
    expect(mockedSummarize).toHaveBeenCalled();
  });

  it('company_internships: Arabic fixtures produce an English-language summary via translateAndSummarize', async () => {
    mockedTranslateAndSummarize.mockResolvedValue({
      title: 'ITIDA Summer Internship Program',
      summary: 'An intensive summer training program for Egyptian IT graduates and students.',
    });

    const raw: CompanyInternshipsRawItem[] = [
      {
        kind: 'itida',
        listing: {
          title_ar: 'برنامج التدريب الصيفي لتكنولوجيا المعلومات',
          url: '/programs/summer-training-2026',
          deadline_ar: 'الموعد النهائي: 15 أغسطس 2026',
          description_ar: 'برنامج تدريبي مكثف لخريجي وطلاب تكنولوجيا المعلومات في مصر.',
        },
      },
    ];

    const items = await normalizeCompanyInternships(raw);

    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('ITIDA Summer Internship Program');
    expect(items[0]!.summary).toBe(
      'An intensive summer training program for Egyptian IT graduates and students.',
    );
    // Purely-Latin-script assertion is a light proxy for "is English" — no Arabic
    // characters should remain in the final title/summary.
    expect(/[\u0600-\u06FF]/.test(items[0]!.title)).toBe(false);
    expect(/[\u0600-\u06FF]/.test(items[0]!.summary)).toBe(false);
    expect(mockedTranslateAndSummarize).toHaveBeenCalledTimes(1);
  });
});

describe('normalize — open_models never calls Groq (Article X sibling rule)', () => {
  it('formats directly from structured evaluation/score fields', () => {
    const raw: OpenModelsRawItem[] = [
      {
        kind: 'artificial_analysis',
        model: {
          id: 'llama-3.3-70b',
          name: 'Llama 3.3 70B',
          slug: 'meta-llama_3-3-70b',
          model_creator: { id: 'meta', name: 'Meta' },
          release_date: '2025-12-01',
          open_weights: true,
          evaluations: { intelligence_index: 61.2 },
        },
      },
      {
        kind: 'llm_stats',
        model: {
          id: 'qwen-2-5-72b',
          name: 'Qwen 2.5 72B',
          organization: { id: 'alibaba', name: 'Alibaba' },
          license: 'Apache 2.0',
          top_scores: { code: 58.1 },
        },
      },
    ];

    const items = normalizeOpenModels(raw);

    expect(items).toHaveLength(2);
    expect(items[0]!.summary).toContain('intelligence_index');
    expect(items[1]!.summary).toContain('code');
    expect(mockedSummarize).not.toHaveBeenCalled();
    expect(mockedTranslateAndSummarize).not.toHaveBeenCalled();
  });
});

describe('normalize — hackathons never leaks free text and follows the extra/summary split (Article X)', () => {
  it('never surfaces any fragment of a free-text description, and splits prize/deadline/tags correctly', () => {
    const raw: HackathonListing[] = [
      {
        id: 7,
        title: 'Global Climate Hack',
        url: 'https://global-climate-hack.devpost.com',
        prize: '$5,000',
        deadline: 'Sep 01 - Sep 15, 2026',
        tags: ['Climate', 'Sustainability'],
      },
    ];

    const items = normalizeHackathons(raw);

    expect(items).toHaveLength(1);
    const item = items[0]!;

    // prize and deadline: both in extra AND inlined in summary
    expect(item.extra?.prize).toBe('$5,000');
    expect(item.extra?.deadline).toBe('Sep 01 - Sep 15, 2026');
    expect(item.summary).toContain('$5,000');
    expect(item.summary).toContain('Sep 01 - Sep 15, 2026');

    // tags: only in extra, never inlined into summary
    expect(item.extra?.tags).toEqual(['Climate', 'Sustainability']);
    expect(item.summary).not.toContain('Climate');
    expect(item.summary).not.toContain('Sustainability');

    // Groq is never called for hackathons.
    expect(mockedSummarize).not.toHaveBeenCalled();
    expect(mockedTranslateAndSummarize).not.toHaveBeenCalled();
  });
});
