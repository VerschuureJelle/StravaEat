create table if not exists planned_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  sport_type text not null,
  target_kcal integer not null,
  zone_id uuid references heart_rate_zones(id) on delete set null,
  target_duration_min integer,
  target_hr integer,
  planned_for date not null default current_date,
  created_at timestamptz default now()
);

alter table planned_workouts enable row level security;
create policy "users_own_planned_workouts" on planned_workouts
  for all using (user_id = auth.uid());
