-- Add height to users
alter table users add column if not exists height_cm integer;

-- Rename burn_schema_points columns from per_min to per_hour
alter table burn_schema_points rename column kcal_per_min to kcal_per_hour;
alter table burn_schema_points rename column fat_g_per_min to fat_g_per_hour;
alter table burn_schema_points rename column carb_g_per_min to carb_g_per_hour;

-- Convert existing values (per_min × 60 = per_hour)
update burn_schema_points set
  kcal_per_hour = kcal_per_hour * 60,
  fat_g_per_hour  = case when fat_g_per_hour  is not null then fat_g_per_hour  * 60 end,
  carb_g_per_hour = case when carb_g_per_hour is not null then carb_g_per_hour * 60 end;

-- Add sport_type to burn_schema_points (each sport gets its own curve)
alter table burn_schema_points add column if not exists sport_type text not null default 'default';

-- Replace unique constraint to be sport-aware
alter table burn_schema_points drop constraint if exists burn_schema_user_hr;
alter table burn_schema_points
  add constraint burn_schema_user_sport_hr unique (user_id, sport_type, hr_value);

-- Per-sport energy method preference (standard = MET-based, custom = user schema)
create table if not exists sport_energy_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  sport_type text not null,
  method text not null default 'standard',
  constraint sport_energy_user_sport unique (user_id, sport_type)
);

alter table sport_energy_settings enable row level security;
create policy "users_own_sport_settings" on sport_energy_settings
  for all using (user_id = auth.uid());
