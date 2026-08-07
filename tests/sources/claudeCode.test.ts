import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchClaudeCode } from '../../lib/sources/claudeCode.js';

const SAMPLE_CHANGELOG = `# Changelog

## 2.1.39
- Added guard against launching Claude Code inside another Claude Code session
- Fixed Agent Teams using wrong model identifier for Bedrock, Vertex, and Foundry customers

## 2.1.38
- Fixed a crash when MCP tools return image content during streaming
`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchClaudeCode', () => {
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

    const result = await fetchClaudeCode();
    expect(result.failures).toEqual([]);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      version: '2.1.39',
      body: expect.stringContaining('Added guard against launching Claude Code'),
    });
  });

  it('reports a fetch_error failure (not source_contract_changed) on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND raw.githubusercontent.com')),
    );

    const result = await fetchClaudeCode();
    expect(result.items).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.kind).toBe('fetch_error');
    expect(result.failures[0]?.source).toBe('claude_code');
  });

  it('reports a source_contract_changed failure when the payload no longer parses into any entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => 'this is not a changelog at all, no version headers here',
      }),
    );

    const result = await fetchClaudeCode();
    expect(result.items).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.kind).toBe('source_contract_changed');
  });
});
