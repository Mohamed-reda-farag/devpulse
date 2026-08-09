-- Phase 2: Database Layer
-- Creates the two shared, non-user-specific tables (constitution Article III.4),
-- enables Row Level Security with public-read-only policies, and seeds `topics`
-- with the five fixed topics from Article I.

create table topics (
  slug text primary key,
  label text not null,
  created_at timestamptz not null default now()
);

create table content_items (
  id text primary key,
  topic text not null references topics(slug),
  title text not null check (char_length(title) <= 120),
  summary text not null check (char_length(summary) <= 500),
  source_name text not null,
  source_url text not null unique,
  published_at timestamptz not null,
  fetched_at timestamptz not null,
  extra jsonb,
  created_at timestamptz not null default now()
);

-- Row Level Security (constitution Article III.3/III.4): both tables are
-- publicly readable, writable only by the service role. The service role
-- bypasses RLS entirely (Supabase's built-in behavior), so it needs no
-- explicit write policy — deliberately no insert/update/delete policy is
-- defined for anon/authenticated below, and with RLS enabled + no matching
-- policy, Postgres denies by default.
alter table topics enable row level security;
alter table content_items enable row level security;

create policy "topics_public_read" on topics for select using (true);
create policy "content_items_public_read" on content_items for select using (true);

-- Explicit Data API grants. Whether a role can reach a table through Supabase's
-- Data API at all is controlled by Postgres GRANTs, evaluated BEFORE RLS ever
-- runs — without this, anon/authenticated get a 42501 permission-denied error
-- regardless of the select policies above. This is deliberately spelled out
-- here rather than left to the project's "Automatically expose new tables"
-- dashboard toggle, so the migration is fully self-contained and reproducible
-- from scratch (FR-006) no matter that toggle's state. Only SELECT is granted:
-- no insert/update/delete grant is given to anon/authenticated, so writes stay
-- blocked at the grant level too, not just by the absence of a write policy.
grant select on topics, content_items to anon, authenticated;

-- Seed the five fixed topics from constitution Article I. `company_internships`
-- is deliberately absent — removed in constitution v1.5.0.
insert into topics (slug, label) values
  ('claude_code', 'Claude Code'),
  ('codex', 'Codex'),
  ('dev_tools', 'Dev Tools'),
  ('open_models', 'Open Models'),
  ('hackathons', 'Hackathons');
