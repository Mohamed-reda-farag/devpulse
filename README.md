# DevPulse

A personalized, 3-day developer digest across six topics: `claude_code`, `codex`, `dev_tools`,
`open_models`, `hackathons`, and `company_internships` (Egypt/regional programs only).

**This repository currently implements Phase 1 only** — the content ingestion pipeline. There is
no database, no web app, and no scheduling yet; those land in Phases 2–4. See `spec.md`, `plan.md`,
and `tasks.md` for this phase's exact scope, and `constitution.md` for the rules every phase follows.

> **Status (2026-08-07):** `company_internships` is temporarily disabled in `scripts/ingest.ts` by
> project-owner decision — Wuzzuf's endpoint now returns HTTP 404 (its URL/API has changed), and
> the ITIDA/ITI scraper selectors were never verified against live markup. Five sources are
> currently active: `claude_code`, `codex`, `dev_tools`, `open_models`, `hackathons`. Re-enabling
> `company_internships` is a one-line uncomment in `scripts/ingest.ts` once its sources are fixed.

## Phase 1: Content Ingestion Pipeline

Fetches from six independent sources, normalizes everything into a single `ContentItem` shape
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
| `GROQ_API_KEY` | Summarizing/translating `claude_code`, `codex`, `dev_tools`, `company_internships` (`llama-3.3-70b-versatile`, free tier) | https://console.groq.com |
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
  a cumulative history — Phase 2's database becomes the historical record).
- **`data/seen-ids.json`** — an append-only index of every item id ever produced, used to decide
  "is this new?" on the next run. Never overwritten, only grown.

`data/` is a deliberate, time-boxed exception to Article IV's fixed folder structure, scoped to
this phase only — both files disappear once Phase 2 replaces them with Supabase tables.

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
calls happen in the automated suite** (constitution Article VI). 31 tests currently pass across 9
files, covering dedupe logic, all six source fetchers (including sub-source isolation and the
distinct `source_contract_changed` failure mode), the normalize layer's Groq usage boundaries, and
the orchestrator's per-source failure isolation.

### Scope note: `company_internships`

Scoped to Egypt/regional programs only (ITIDA, ITI, Wuzzuf) by explicit project-owner decision —
internship listings are inherently tied to a country's job market, unlike the other five topics.
None of the three have a documented public API, so they're scraped; **the CSS selectors in
`lib/sources/companyInternships.ts` are a best-effort starting point and have not been verified
against the live markup** (those three domains aren't reachable from the environment this phase
was built in). Verify and adjust before relying on real output from this source. Wuzzuf's terms of
service specifically have not been reviewed for scraping — flagged for Phase 7's hardening pass,
not assumed to be fine.

### What's verified vs. what needs your local run

- `claude_code`'s fetcher was run live against the real changelog endpoint during development (353
  entries parsed, zero validation failures) — this one is confirmed working end-to-end.
- The other five sources' real endpoints/response shapes were researched but not exercised live
  (either the domain wasn't reachable from the build environment, or a real API key was needed).
  Automated tests simulate their success/failure paths with realistic mocked fixtures instead.
- Running `npm run ingest` twice in a row with real keys (SC-002) and deliberately breaking one
  source at a time (SC-003) — described in `tasks.md` T023/T024 — still need to happen against
  the real internet with your own keys before this phase is considered fully verified.

## Project structure

```
/lib
  types.ts            Shared ContentItem contract (Article V)
  schemas.ts           10 Zod schemas, one per raw payload shape (Article III.11)
  logger.ts             fetch_error vs source_contract_changed logging
  groqClient.ts         Groq API wrapper (mockable)
  parseChangelog.ts    Shared markdown changelog parser
  normalize.ts          Converts every source's raw output into ContentItem
  dedupe.ts              Checks candidates against data/seen-ids.json
  /sources
    claudeCode.ts codex.ts devTools.ts openModels.ts hackathons.ts companyInternships.ts
/scripts
  ingest.ts             Orchestrates all six sources with per-source isolation
/tests
  dedupe.test.ts normalize.test.ts ingest.test.ts
  /sources  (one test file per topic)
/data                  Phase-1-only run state (gitignored)
```
