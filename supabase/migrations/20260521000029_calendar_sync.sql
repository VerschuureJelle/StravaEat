-- Phase 1: Calendar sync infrastructure

-- 1.1 Token columns on users (mirrors strava_* columns)
alter table users
  add column if not exists google_cal_access_token     text,
  add column if not exists google_cal_refresh_token    text,
  add column if not exists google_cal_token_expires_at timestamptz,
  add column if not exists google_cal_id               text default 'primary',
  add column if not exists microsoft_cal_access_token     text,
  add column if not exists microsoft_cal_refresh_token    text,
  add column if not exists microsoft_cal_token_expires_at timestamptz,
  add column if not exists microsoft_cal_id               text;

-- 1.2 Event linking + conflict resolution on planned_workouts
alter table planned_workouts
  add column if not exists google_event_id    text unique,
  add column if not exists microsoft_event_id text unique,
  add column if not exists updated_at         timestamptz default now(),
  add column if not exists sync_source        text default 'app'
    check (sync_source in ('app', 'google', 'microsoft'));

-- Auto-update updated_at on every change (drives conflict resolution)
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger planned_workouts_set_updated_at
  before update on planned_workouts
  for each row execute function update_updated_at_column();

-- 1.3 Webhook subscription tracking
-- Google channels expire after 7 days, Microsoft after 3 days — this table drives renewal
create table if not exists calendar_webhook_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references users(id) on delete cascade not null,
  provider        text not null check (provider in ('google', 'microsoft')),
  subscription_id text not null,   -- Google channel id / Microsoft subscription id
  resource_id     text,            -- Google only: needed to stop a channel
  secret          text not null,   -- anti-spoofing token stored and verified on each notification
  expiry          timestamptz not null,
  created_at      timestamptz default now(),
  unique (user_id, provider)       -- one active subscription per user per provider
);

alter table calendar_webhook_subscriptions enable row level security;
create policy "users_own_cal_subs" on calendar_webhook_subscriptions
  for all using (user_id = auth.uid());
