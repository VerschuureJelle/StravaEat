-- Fueling settings per sport: wanneer en hoeveel eten tijdens een training
create table fueling_settings (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references auth.users(id) on delete cascade not null,
  sport_type           text not null,
  threshold_min        integer not null default 60,   -- training langer dan X min → aanbeveling
  carbs_per_interval_g integer not null default 30,   -- g koolhydraten per interval
  interval_min         integer not null default 30,   -- interval in minuten
  created_at           timestamptz default now(),
  unique (user_id, sport_type)
);

alter table fueling_settings enable row level security;

create policy "Users manage own fueling settings"
  on fueling_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
