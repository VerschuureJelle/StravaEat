-- ============================================================
-- Users (extends auth.users)
-- ============================================================
create table public.users (
  id              uuid references auth.users(id) on delete cascade primary key,
  email           text,
  name            text,
  weight_kg       numeric,
  age             integer,
  sex             text check (sex in ('male', 'female', 'other')),
  sport_history   text check (sport_history in ('beginner', 'intermediate', 'advanced')),
  max_hr          integer,
  resting_hr      integer,
  strava_id               text unique,
  strava_access_token     text,
  strava_refresh_token    text,
  strava_token_expires_at timestamptz,
  created_at      timestamptz default now()
);

-- Auto-create a users row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- Heart Rate Zones
-- ============================================================
create table public.heart_rate_zones (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.users(id) on delete cascade not null,
  zone_number   integer not null check (zone_number between 1 and 5),
  name          text not null,
  min_bpm       integer not null,
  max_bpm       integer not null,
  met_value     numeric not null,
  created_at    timestamptz default now(),
  unique (user_id, zone_number)
);

-- ============================================================
-- Activities
-- ============================================================
create table public.activities (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references public.users(id) on delete cascade not null,
  strava_activity_id  text not null,
  name                text not null,
  type                text not null,
  date                timestamptz not null,
  duration_sec        integer not null,
  avg_hr              integer,
  max_hr              integer,
  total_kcal          numeric,    -- null = no HR data available
  synced_at           timestamptz default now(),
  unique (user_id, strava_activity_id)
);

-- ============================================================
-- Activity Zone Splits
-- ============================================================
create table public.activity_zone_splits (
  id               uuid primary key default gen_random_uuid(),
  activity_id      uuid references public.activities(id) on delete cascade not null,
  zone_id          uuid references public.heart_rate_zones(id) on delete restrict not null,
  time_in_zone_sec integer not null,
  kcal_in_zone     numeric not null
);

-- ============================================================
-- Indexes
-- ============================================================
create index on public.activities (user_id, date desc);
create index on public.activity_zone_splits (activity_id);
create index on public.heart_rate_zones (user_id, zone_number);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.users               enable row level security;
alter table public.heart_rate_zones    enable row level security;
alter table public.activities          enable row level security;
alter table public.activity_zone_splits enable row level security;

-- users: read and update own row only
create policy "users: select own"  on public.users for select using (auth.uid() = id);
create policy "users: update own"  on public.users for update using (auth.uid() = id);

-- heart_rate_zones: full CRUD on own rows
create policy "zones: select own"  on public.heart_rate_zones for select using (auth.uid() = user_id);
create policy "zones: insert own"  on public.heart_rate_zones for insert with check (auth.uid() = user_id);
create policy "zones: update own"  on public.heart_rate_zones for update using (auth.uid() = user_id);
create policy "zones: delete own"  on public.heart_rate_zones for delete using (auth.uid() = user_id);

-- activities: read own; insert/update via service role (Edge Function) only
create policy "activities: select own" on public.activities for select using (auth.uid() = user_id);

-- activity_zone_splits: read if parent activity belongs to user
create policy "splits: select own" on public.activity_zone_splits for select
  using (
    exists (
      select 1 from public.activities a
      where a.id = activity_zone_splits.activity_id
        and a.user_id = auth.uid()
    )
  );
