begin;

create table if not exists public.wrld_user_favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

create table if not exists public.wrld_user_playlists (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  track_ids text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.wrld_user_favorites enable row level security;
alter table public.wrld_user_playlists enable row level security;

revoke all on public.wrld_user_favorites from anon, public;
revoke all on public.wrld_user_playlists from anon, public;
grant select, insert, update, delete on public.wrld_user_favorites to authenticated;
grant select, insert, update, delete on public.wrld_user_playlists to authenticated;

drop policy if exists "Users manage their own favorites" on public.wrld_user_favorites;
create policy "Users manage their own favorites"
  on public.wrld_user_favorites
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own playlists" on public.wrld_user_playlists;
create policy "Users manage their own playlists"
  on public.wrld_user_playlists
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
