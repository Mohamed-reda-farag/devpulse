// Loaded automatically before every test file (see vitest.config.ts's
// `setupFiles`). `npm run ingest` picks up .env via its own first import
// (`import 'dotenv/config'` in scripts/ingest.ts) — `npm test` had no
// equivalent, so vitest never saw real env vars, only whatever the shell
// running it happened to export manually. This closes that gap the same
// way, without touching any production code.
import 'dotenv/config';
