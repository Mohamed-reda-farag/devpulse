# DevPulse

A personalized, 3-day developer digest across five topics: `claude_code`, `codex`, `dev_tools`,
`open_models`, and `hackathons`.

**This repository currently implements Phases 1–2** — content ingestion plus persistence to a
shared Supabase database. There is no web app, no auth, and no scheduling yet; those land in
Phases 3–4. See each phase's `spec.md`, `plan.md`, and `tasks.md` for its exact scope, and
`constitution.md` for the rules every phase follows.

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
>
> **Status (2026-08-09):** Phase 2's first real `npm run ingest` against Supabase (an empty
> `content_items` table, so every historical item across all five sources counted as "new" in one
> run, not the small incremental batches later runs will see) burned through Groq's **daily** token
> budget for `llama-3.3-70b-versatile` — 100K TPD on the free tier — well before its per-minute
> limit, which is the only figure constitution.md Article II had tracked. Confirmed via Groq's own
> usage dashboard (console.groq.com/settings/limits), not guesswork; no real billing impact (Free
> plan, `$0`, confirmed in Billing). Two fixes: `groqClient.ts` now caps how long it will honor a
> 429's `retry-after` at 30s (`MAX_BACKOFF_MS`) — a multi-minute `retry-after` signals the *daily*
> quota, which can't recover mid-run no matter how long one item's retry loop waits, and the old
> unbounded wait let a single item block the whole per-source sequential loop for many minutes;
> and `dev_tools` (`lib/sources/devTools.ts`) had no volume cap at all before this — both its
> sub-sources (OSSInsight, Hacker News) are now capped at 15 items each per run
> (`MAX_ITEMS_PER_SUBSOURCE`), matching `claude_code`/`codex`'s existing cap. Also decided (not yet
> implemented — Phase 4 builds the actual scheduler): once scheduled, `npm run ingest` will run
> **daily**, decoupled from the 3-day **digest** cadence in Article I — same total volume either
> way, but spread across more resets of the daily quota instead of concentrated into one run.
>
> **Status (2026-08-10):** The TPD diagnosis above was real (confirmed via the dashboard) but
> incomplete — 429s kept recurring on a later run even with that day's total Groq usage nowhere
> near the 100K TPD ceiling (well under 50%), which ruled the daily quota out for *that*
> particular run. The actual recurring cause: `groqClient.ts` only ever paced by *request count*
> (`MIN_INTERVAL_MS`), never by *token volume* — but the binding free-tier constraint for
> `llama-3.3-70b-versatile` is TPM (12K tokens/minute), separate from RPM (30/minute). A request
> rate safely under 30/min can still exceed 12K TPM if individual requests carry enough tokens
> each, which a request-count-only pace can't see coming. Fixed properly rather than by guessing
> at interval numbers: Groq returns live `x-ratelimit-remaining-tokens` / `x-ratelimit-reset-tokens`
> headers on every response, success or 429 — `groqClient.ts` now tracks these and proactively
> waits out the TPM window *before* sending the next request once remaining budget drops below a
> reserve (`TOKEN_RESERVE`), instead of firing blind and reacting to the 429 afterward. Also
> trimmed `max_tokens` from 300 to 200 per call, since summaries are truncated to 500 characters
> (roughly 125-150 tokens) regardless — the extra 100 was wasted TPM budget that never reached the
> final output. Separately: this session also surfaced (and worked around) a real gotcha in
> Supabase's Data API — a `GRANT`/`REVOKE` change doesn't auto-propagate to PostgREST's schema
> cache the way a `CREATE TABLE`/`ALTER TABLE` does (those are DDL, `GRANT`/`REVOKE` are DCL, and
> only DDL triggers Supabase's automatic reload); a migration ending in
> `notify pgrst, 'reload schema';` is required after any grant change for it to take effect
> immediately rather than eventually.

## Phase 1: Content Ingestion Pipeline

Fetches from five independent sources, normalizes everything into a single `ContentItem` shape
(constitution Article V), deduplicates against previous runs, and writes the result to a local
JSON file for manual inspection. Runnable with one command; no scheduling, no per-user filtering.

### Prerequisites

- Node.js >= 20
- Six free-tier credentials (see below): three API keys carried over from Phase 1, plus a
  Supabase project's URL and two of its keys, added in Phase 2

### Setup

```bash
npm install
cp .env.example .env
# then fill in all six keys below in .env
```

### Required environment variables

| Variable | Used by | Where to get it |
|---|---|---|
| `GROQ_API_KEY` | Summarizing `claude_code`, `codex`, `dev_tools` (`llama-3.3-70b-versatile`, free tier) | https://console.groq.com |
| `ARTIFICIAL_ANALYSIS_API_KEY` | One of `open_models`'s two sub-sources | https://artificialanalysis.ai/insights |
| `LLM_STATS_API_KEY` | The other `open_models` sub-source | https://llm-stats.com/developer |
| `SUPABASE_URL` | The pipeline's Supabase project URL | Supabase project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses Row Level Security — server-side only (Article III.2). The single most sensitive credential in this project so far | Supabase project → Settings → API |
| `SUPABASE_ANON_KEY` | Manual RLS verification only — never imported by any script | Supabase project → Settings → API |

No secret is ever written into source code — all six live only in `.env` (gitignored) or,
in CI/production, GitHub Actions secrets / Vercel env vars (constitution Article III.1).

### Database schema

Defined in version-controlled migration files under `/supabase/migrations` (constitution Article
IV) — never created or edited by hand through the Supabase dashboard. Apply with `supabase db push`
(or equivalent) against your project before running `npm run ingest` for the first time.

### Run it

```bash
npm run ingest
```

This inserts every genuinely new item straight into Supabase's `content_items` table, in the same
`ContentItem` shape defined in the constitution (Article V). There's no local `data/*.json` file to
check anymore (Phase 1's `data/` exception to Article IV's fixed folder structure was retired in
Phase 2) — query the table directly, via the Supabase dashboard or a plain
`select * from content_items`, to see everything the pipeline has produced so far.

Deciding "is this new?" now happens against the database (`content_items.id`) instead of a local
`seen-ids.json` file — same first-seen-wins behavior as Phase 1, different source of truth. Running
`npm run ingest` twice in a row with no real-world changes at the sources still inserts zero new
rows the second time — expected, not a bug, same as Phase 1's SC-002.

If Supabase itself is unreachable — not a single source failing, but the connection to the database
— the script logs a distinct `database_unreachable` error and exits non-zero, rather than silently
"succeeding" while persisting nothing.

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

All source-fetcher, normalization, and dedupe/persistence tests run against static mocked fixtures
or a mocked Supabase client — **no live network calls happen in the automated suite** (constitution
Article VI). This covers dedupe/insert logic against `content_items` (a genuinely-new id, an
already-present id, a mixed batch, and a mocked connection failure), all five source fetchers
(including sub-source isolation and the distinct `source_contract_changed` failure mode), the
normalize layer's Groq usage boundaries, and the orchestrator's per-source failure isolation,
dedupe-before-normalize ordering, and the distinct `database_unreachable` failure path.

What the automated suite deliberately does **not** cover: whether the real migration SQL under
`/supabase/migrations` is syntactically correct and actually produces the schema and RLS behavior
described above — mocking the Supabase client (required by Article VI) means the migration itself
is never executed by the test suite. This is closed by a manual check instead (applying the
migration to a real Supabase project and confirming it in the dashboard) — see each phase's
`tasks.md` for the exact Manual Actions checklist.

### What's verified vs. what needs your local run

Phase 1's five sources were run against the real internet with real keys and confirmed working
(project owner, 2026-08-08): a full `npm run ingest` produced items from all five with zero source
failures, and a second consecutive run correctly produced zero new items (SC-002). `hackathons`
specifically was confirmed via a real item, which is also how a real data-quality bug was caught:
Devpost's `prize_amount` field arrives with raw HTML embedded in it (e.g.
`"$<span data-currency-value>0</span>"`), not clean text. Fixed in `lib/sources/hackathons.ts`
(`stripHtml()`), with a regression test using the exact real payload.

Phase 1's local run-state files (`data/seen-ids.json`, `data/content-items-history.jsonl`,
`data/content-items.json`) were deliberately deleted by the project owner before Phase 2 began, so
there was no historical data to migrate into Supabase — `content_items` starts empty and becomes
the system of record from Phase 2's real launch onward. What Phase 2 itself needs verified against
a real Supabase project (schema applied, RLS actually enforced, a real double-run of
`npm run ingest`) is tracked in `phase2_tasks.md`'s Manual Actions section, not here.

## Project structure

```
/lib
  types.ts            Shared ContentItem contract (Article V)
  schemas.ts           7 Zod schemas, one per raw payload shape (Article III.11)
  logger.ts             fetch_error vs source_contract_changed logging
  groqClient.ts         Groq API wrapper (mockable, rate-limited, retries on 429)
  parseChangelog.ts    Shared markdown changelog parser
  normalize.ts          Converts every source's raw output into ContentItem
  dedupe.ts              Checks candidates against content_items (Supabase), batches inserts
  /db
    supabaseClient.ts    Server-side Supabase client — service role, never client-side (Article III.2)
  /sources
    claudeCode.ts codex.ts devTools.ts openModels.ts hackathons.ts
/scripts
  ingest.ts             Orchestrates all five sources with per-source isolation
/supabase
  /migrations           Version-controlled schema + RLS policies (Article IV)
/tests
  dedupe.test.ts normalize.test.ts ingest.test.ts groqClient.test.ts
  /sources  (one test file per topic)
```
