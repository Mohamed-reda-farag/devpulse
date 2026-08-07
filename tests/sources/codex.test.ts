import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchCodex } from '../../lib/sources/codex.js';

const SAMPLE_CHANGELOG = `# Codex Changelog

## 0.58.0
- Released gpt-5.1-codex-max to the Responses API
- Added support for rendering Mermaid diagrams inline in task transcripts

## 0.57.0
- Reduced startup and large-context overhead with concurrent skill/plugin discovery
`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCodex', () => {
  it('parses a mocked changelog response into versioned entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => SAMPLE_CHANGELOG,
      }),
    );

    const result = await fetchCodex();
    expect(result.failures).toEqual([]);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.version).toBe('0.58.0');
  });

  it('reports a fetch_error failure on an HTTP error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => '',
      }),
    );

    const result = await fetchCodex();
    expect(result.items).toEqual([]);
    expect(result.failures[0]?.kind).toBe('fetch_error');
    expect(result.failures[0]?.source).toBe('codex');
  });

  it('reports a source_contract_changed failure when no entries can be parsed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '<html>unexpected redesign, no markdown here</html>',
      }),
    );

    const result = await fetchCodex();
    expect(result.items).toEqual([]);
    expect(result.failures[0]?.kind).toBe('source_contract_changed');
  });
});
