-- WindSwordAI free-alpha storage. Paste into Supabase -> SQL Editor -> Run (once).
create table if not exists public.windsword_state (
  name       text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Lock it down: row level security on with no policies, and no access for the public keys.
-- Only the server's secret key (which bypasses RLS) can read or write it.
alter table public.windsword_state enable row level security;
revoke all on public.windsword_state from anon, authenticated;
