create table if not exists meal_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  meal_index integer not null,
  date text not null,  -- YYYY-MM-DD local date
  checked_at timestamptz default now() not null,
  unique (user_id, meal_index, date)
);

alter table meal_checks enable row level security;
create policy "users_own_meal_checks" on meal_checks
  for all using (user_id = auth.uid());
