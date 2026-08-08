# DevPulse

A personalized, 3-day developer digest across five topics: `claude_code`, `codex`, `dev_tools`,
`open_models`, and `hackathons`.

**This repository currently implements Phase 1 only** — the content ingestion pipeline. There is
no database, no web app, and no scheduling yet; those land in Phases 2–4. See `spec.md`, `plan.md`,
and `tasks.md` for this phase's exact scope, and `constitution.md` for the rules every phase follows.

> **Status (2026-08-08):** `company_internships` (ITIDA/ITI/Wuzzuf) has been **fully removed** by
> explicit project-owner decision — not disabled, deleted: the source module, its Zod schemas, its
> normalize branch, its tests, and every reference to it are gone. The scope is now five topics.
> If this is revisited later, it needs to be rebuilt from scratch against real, verified endpoints
> (Wuzzuf's was already confirmed dead — HTTP 404 — before removal), not restored from history.
>
> **Also fixed after the first real production runs (2026-08-07 – 2026-08-08):** LLM Stats'
> `license` field turned out to be an object, not the plain string the schema assumed; Artificial
> Analysis's endpoint path and the Codex changelog's real DOM structure were both wrong on the
> first attempt and corrected against live diagnostics; some benchmark metrics come back `null`
> and are now dropped instead of rendered literally; dedupe now runs *before* the Groq-calling
> normalize step (it used to run after, so every run re-summarized hundreds of already-seen items
> and blew through Groq's rate limit); `claude_code`/`codex` are capped to the 15 most recent
> entries per run; `groqClient.ts` paces calls and retries on 429; and a `content-items-history.jsonl`
> file was added since `content-items.json` is overwritten every run (by design) and was mistaken
> for a bug when it went empty after a run with zero new items.

## Phase 1: Content Ingestion Pipeline

Fetches from five independent sources, normalizes everything into a single `ContentItem` shape
(constitution Article V), deduplicates against previous runs, and writes the result to a local
JSON file for manual inspection. Runnable with one command; no scheduling, no per-user filtering.

### Prerequisites

- Node.js >= 20
- Three free-tier API keys (see below)

### Setup

```bash
npm install
cp .env.example .env.local
# then fill in the three keys below in .env.local
```

### Required environment variables

| Variable | Used by | Where to get it |
|---|---|---|
| `GROQ_API_KEY` | Summarizing `claude_code`, `codex`, `dev_tools` (`llama-3.3-70b-versatile`, free tier) | https://console.groq.com |
| `ARTIFICIAL_ANALYSIS_API_KEY` | One of `open_models`'s two sub-sources | https://artificialanalysis.ai/insights |
| `LLM_STATS_API_KEY` | The other `open_models` sub-source | https://llm-stats.com/developer |

No secret is ever written into source code — all three live only in `.env.local` (gitignored) or,
in CI/production, GitHub Actions secrets / Vercel env vars (constitution Article III.1).

### Run it

```bash
npm run ingest
```

This writes:
- **`data/content-items.json`** — the new items from *this* run only (overwritten every run; not
  a cumulative history — Phase 2's database becomes the historical record). **This means running
  `npm run ingest` twice in a row typically leaves this file empty** (nothing new on the second
  run) — that's expected, not a bug, but it's easy to mistake for one if you check the file after
  more than one run.
- **`data/content-items-history.jsonl`** — every item found across *all* runs, one JSON object per
  line, never overwritten. Not part of the original Article V contract; added purely so a human
  can review what's been found without racing the per-run overwrite above. Check this file, not
  `content-items.json`, if you want to see everything the pipeline has produced so far.
- **`data/seen-ids.json`** — an append-only index of every item id ever produced, used to decide
  "is this new?" on the next run. Never overwritten, only grown.

`data/` is a deliberate, time-boxed exception to Article IV's fixed folder structure, scoped to
this phase only — all three files disappear once Phase 2 replaces them with Supabase tables.

Console output after a run summarizes how many new items were found, how many were already seen,
and lists any source failures with their kind (`fetch_error` vs `source_contract_changed`) and
reason.

### Testing

```bash
npm test        # run once
npm run test:watch
npm run lint
npm run build    # tsc --noEmit
```

All source-fetcher and normalization tests run against static mocked fixtures — **no live network
calls happen in the automated suite** (constitution Article VI). 39 tests currently pass across 9
files, covering dedupe logic, all five source fetchers (including sub-source isolation and the
distinct `source_contract_changed` failure mode), the normalize layer's Groq usage boundaries, and
the orchestrator's per-source failure isolation and dedupe-before-normalize ordering.

### What's verified vs. what needs your local run

All five sources have been run against the real internet with real keys and confirmed working
(project owner, 2026-08-08): a full `npm run ingest` produced items from all five with zero source
failures, and a second consecutive run correctly produced zero new items (SC-002). `hackathons`
specifically was confirmed via a real item found in `data/content-items-history.jsonl` — which is
also how a real data-quality bug was caught: Devpost's `prize_amount` field arrives with raw HTML
embedded in it (e.g. `"$<span data-currency-value>0</span>"`), not clean text. Fixed in
`lib/sources/hackathons.ts` (`stripHtml()`), with a regression test using the exact real payload.

## Project structure

```
/lib
  types.ts            Shared ContentItem contract (Article V)
  schemas.ts           7 Zod schemas, one per raw payload shape (Article III.11)
  logger.ts             fetch_error vs source_contract_changed logging
  groqClient.ts         Groq API wrapper (mockable, rate-limited, retries on 429)
  parseChangelog.ts    Shared markdown changelog parser
  normalize.ts          Converts every source's raw output into ContentItem
  dedupe.ts              Checks candidates against data/seen-ids.json
  /sources
    claudeCode.ts codex.ts devTools.ts openModels.ts hackathons.ts
/scripts
  ingest.ts             Orchestrates all five sources with per-source isolation
/tests
  dedupe.test.ts normalize.test.ts ingest.test.ts groqClient.test.ts
  /sources  (one test file per topic)
/data                  Phase-1-only run state (gitignored)
```
