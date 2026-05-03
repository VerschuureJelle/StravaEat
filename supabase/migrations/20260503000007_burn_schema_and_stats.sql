-- Burn schema (user-defined HR → burn rate data points)
create table burn_schema_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  hr_value integer not null,
  kcal_per_min numeric not null,
  fat_g_per_min numeric,
  carb_g_per_min numeric,
  created_at timestamptz default now(),
  constraint burn_schema_user_hr unique (user_id, hr_value)
);

alter table burn_schema_points enable row level security;
create policy "users_own_burn_schema" on burn_schema_points
  for all using (user_id = auth.uid());

-- Extended activity fields for summary stats and burn results
alter table activities
  add column if not exists distance_m numeric,
  add column if not exists elevation_gain_m numeric,
  add column if not exists total_fat_g numeric,
  add column if not exists total_carb_g numeric;

-- Extended zone split fields
alter table activity_zone_splits
  add column if not exists fat_g_in_zone numeric,
  add column if not exists carb_g_in_zone numeric;
