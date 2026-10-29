-- ScoreNest admin tables. Run once in Supabase: SQL Editor > New query > paste > Run.
-- Everything is prefixed sn_ so it never touches other tables in the same project.
-- Row Level Security is on with no policies, so only the server's service-role key can read
-- or write these tables (the public anon key cannot see admin password hashes).

create table if not exists public.sn_admins (
  id bigserial primary key,
  username text not null,
  username_key text not null unique,
  name text not null default '',
  pass_hash text not null,
  role text not null check (role in ('owner', 'editor')),
  token_version integer not null default 0,
  created_at bigint not null,
  last_login bigint
);

create table if not exists public.sn_matches (
  id text primary key,
  kickoff bigint not null,
  data jsonb not null,
  created_by bigint references public.sn_admins(id) on delete set null,
  updated_by bigint references public.sn_admins(id) on delete set null,
  created_at bigint not null,
  updated_at bigint not null
);
create index if not exists sn_matches_kickoff on public.sn_matches (kickoff);
create index if not exists sn_matches_updated on public.sn_matches (updated_at);

create table if not exists public.sn_activity (
  id bigserial primary key,
  at bigint not null,
  user_id bigint references public.sn_admins(id) on delete set null,
  username text not null,
  match_id text,
  summary text not null
);

alter table public.sn_admins enable row level security;
alter table public.sn_matches enable row level security;
alter table public.sn_activity enable row level security;

-- Make the new tables visible to the REST API right away.
notify pgrst, 'reload schema';
