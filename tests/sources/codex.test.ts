import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchCodex } from '../../lib/sources/codex.js';

// Mirrors the real page's structure (confirmed live 2026-08-07): a date line
// immediately before each entry's <h3>, unrelated nav/footer <h3>s elsewhere
// on the page, and a "Full Changelog:" PR-link dump that must be excluded.
const SAMPLE_HTML = `
<html><body>
  <nav><h3>Getting Started</h3><p>Some nav content</p></nav>
  <main>
    <h1>Codex changelog</h1>
    <div>2026-06-09</div>
    <h3>Codex CLI 0.139.0</h3>
    <ul>
      <li>Released gpt-5.1-codex-max to the Responses API</li>
      <li>Added support for rendering Mermaid diagrams inline in task transcripts</li>
    </ul>
    <p>Full Changelog: <a href="#">rust-v0.138.0...rust-v0.139.0</a></p>
    <ul><li>[#26741](url) fix(remote-control): preserve enrollment</li></ul>

    <div>2026-06-04</div>
    <h3>Codex CLI 0.137.0</h3>
    <ul>
      <li>Reduced startup and large-context overhead with concurrent skill/plugin discovery</li>
    </ul>
    <p>Full Changelog: <a href="#">rust-v0.136.0...rust-v0.137.0</a></p>
  </main>
  <footer><h3>Topics</h3><p>Agents, Evals, Multimodal</p></footer>
</body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCodex', () => {
  it('parses entries whose <h3> is preceded by a date, ignoring nav/footer headings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => SAMPLE_HTML,
      }),
    );

    const result = await fetchCodex();
    expect(result.failures).toEqual([]);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.version).toBe('Codex CLI 0.139.0');
    expect(result.items[0]?.body).toContain('gpt-5.1-codex-max');
  });

  it('excludes the Full Changelog PR-link dump from the parsed body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => SAMPLE_HTML,
      }),
    );

    const result = await fetchCodex();
    for (const entry of result.items) {
      expect(entry.body).not.toContain('Full Changelog');
      expect(entry.body).not.toContain('#26741');
    }
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

  it('reports a source_contract_changed failure when no dated entries can be found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '<html><body><h1>Redesigned page</h1><p>no entries here</p></body></html>',
      }),
    );

    const result = await fetchCodex();
    expect(result.items).toEqual([]);
    expect(result.failures[0]?.kind).toBe('source_contract_changed');
  });
});
