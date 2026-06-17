-- ════════════════════════════════════════════════════════════════════════════
-- Padyalu Sync — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Dashboard → SQL Editor).
-- Safe to re-run: every statement is guarded with IF NOT EXISTS / OR REPLACE.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. PROFILES ──────────────────────────────────────────────────────────────
-- One row per auth user. Holds the human-readable username (auth itself only
-- stores a synthetic email, see app/login/page.tsx) and the role used for
-- access control everywhere below.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (
    id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- 2. ATTEMPTS ──────────────────────────────────────────────────────────────
-- One row per recording+analysis. This is the full history (used for trend
-- data and for the "overall suggestions" rollup); progress/best-score on the
-- home page is just MAX(final_score) grouped by poem_id over this table.
create table if not exists public.attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  poem_id text not null,
  sync_score int not null,
  timing_score int not null,
  rhythm_score int not null,
  lyrics_score int,                  -- null when STT wasn't available (e.g. unsupported browser/codec)
  final_score int not null,
  transcript text,
  tips text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists attempts_user_poem_idx on public.attempts (user_id, poem_id);

alter table public.attempts enable row level security;

drop policy if exists "attempts_select_own_or_admin" on public.attempts;
create policy "attempts_select_own_or_admin" on public.attempts
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists "attempts_insert_own" on public.attempts;
create policy "attempts_insert_own" on public.attempts
  for insert with check (user_id = auth.uid());

-- 3. SUGGESTIONS ───────────────────────────────────────────────────────────
-- Free-text improvement suggestions a user can submit about the app/poems,
-- separate from the auto-generated per-attempt "tips" above. Admins see all.
create table if not exists public.suggestions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  poem_id text,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.suggestions enable row level security;

drop policy if exists "suggestions_select_own_or_admin" on public.suggestions;
create policy "suggestions_select_own_or_admin" on public.suggestions
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists "suggestions_insert_own" on public.suggestions;
create policy "suggestions_insert_own" on public.suggestions
  for insert with check (user_id = auth.uid());

-- 4. AUTO-CREATE PROFILE ON SIGNUP ─────────────────────────────────────────
-- The very first person to ever sign up becomes admin automatically (zero
-- manual SQL needed to bootstrap one admin account). Everyone after that is
-- a normal user. Promote additional admins later with:
--   update public.profiles set role = 'admin' where username = 'someone';
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, username, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    case when is_first then 'admin' else 'user' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
