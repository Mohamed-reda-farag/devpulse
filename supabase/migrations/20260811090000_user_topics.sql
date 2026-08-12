-- Phase 3: Auth & User Preferences
-- Creates the first user-specific table (constitution Article III.3): each
-- row is one person's selection of one topic. RLS scopes every read/write to
-- auth.uid() = user_id — nobody else, whether signed in as someone else or
-- not signed in at all, can read or write another person's rows (spec.md
-- FR-005, SC-004).

create table user_topics (
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_slug text not null references topics(slug),
  created_at timestamptz not null default now(),
  primary key (user_id, topic_slug)
);

alter table user_topics enable row level security;

create policy "select own topics" on user_topics
  for select using (auth.uid() = user_id);
create policy "insert own topics" on user_topics
  for insert with check (auth.uid() = user_id);
create policy "delete own topics" on user_topics
  for delete using (auth.uid() = user_id);
-- No update policy: changing a selection is a delete + insert, not an edit
-- in place (plan.md's Database Schema section).

-- Explicit Data API grant (same lesson as Phase 2's
-- 20260809134659_grant_service_role_write.sql: a GRANT is required in
-- addition to the RLS policies above, evaluated before RLS ever runs).
-- Deliberately no grant to `anon` — unlike content_items/topics, this table
-- has no public-read use case; an unauthenticated request should see
-- nothing here at all.
grant select, insert, delete on user_topics to authenticated;

-- Same follow-up Phase 2 needed (20260809143434_reload_postgrest_schema_cache.sql):
-- GRANT/REVOKE are DCL, not DDL, so PostgREST's automatic reload trigger
-- (which only fires on DDL) won't pick this up on its own.
notify pgrst, 'reload schema';
