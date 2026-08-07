import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchCodex } from '../../lib/sources/codex.js';

// Mirrors the REAL confirmed page structure (verified live 2026-08-07 via a
// diagnostic dump of the actual DOM): a <time> element immediately preceding
// an <h3> whose title is split across nested <span>s, plus unrelated nav/
// sidebar <h3>s with no <time> nearby, plus a "Full Changelog:" PR-link dump
// that must be excluded from the body.
const SAMPLE_HTML = `
<html><body>
  <nav>
    <h3>Suggested</h3>
    <h3>Get started</h3>
  </nav>
  <main>
    <h1>Codex changelog</h1>

    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <time class="text-sm text-secondary">2026-08-07</time>
      </div>
      <h3 class="group flex items-center gap-2 heading-xl mb-4">
        <span>Codex CLI<span class="text-tertiary"> 0.147.0</span></span>
        <button type="button" aria-label="Copy link"><svg></svg></button>
      </h3>
      <div>
        <p>New Features</p>
        <ul><li>Released gpt-5.1-codex-max to the Responses API</li></ul>
        <p>Bug Fixes</p>
        <ul><li>Fixed a crash in MCP tool discovery</li></ul>
      </div>
      <p>Full Changelog: <a href="#">rust-v0.146.0...rust-v0.147.0</a></p>
      <ul><li><a href="#">#35623</a> fix(mcp): support 2026-07-28 protocol</li></ul>
    </div>

    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <time class="text-sm text-secondary">2026-07-30</time>
      </div>
      <h3 class="group flex items-center gap-2 heading-xl mb-4">
        <span>Codex CLI<span class="text-tertiary"> 0.146.0</span></span>
        <button type="button" aria-label="Copy link"><svg></svg></button>
      </h3>
      <div>
        <p>Chores</p>
        <ul><li>Reduced startup overhead with concurrent plugin discovery</li></ul>
      </div>
      <p>Full Changelog: <a href="#">rust-v0.145.0...rust-v0.146.0</a></p>
    </div>
  </main>
  <footer><h3>Topics</h3><p>Agents, Evals, Multimodal</p></footer>
</body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCodex', () => {
  it('parses entries anchored on a real <time> element, ignoring nav/footer headings', async () => {
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
    expect(result.items[0]?.version).toBe('Codex CLI 0.147.0');
    expect(result.items[0]?.body).toContain('gpt-5.1-codex-max');
  });

  it('strips the copy-link button from the title and excludes the PR-link dump from the body', async () => {
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
      expect(entry.version).not.toContain('Copy link');
      expect(entry.body).not.toContain('Full Changelog');
      expect(entry.body).not.toContain('#35623');
    }
  });

  it('does not mistake a date-like string inside body text for a real entry boundary', async () => {
    // "2026-07-28" appears inside the first entry's own PR-link text, before
    // the cutoff — must not be picked up as a second, spurious entry.
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
    expect(result.items.map((e) => e.version)).toEqual(['Codex CLI 0.147.0', 'Codex CLI 0.146.0']);
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
