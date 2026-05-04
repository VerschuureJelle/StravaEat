create table if not exists meal_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  meal_index integer not null,
  name text not null,
  scheduled_time text not null,  -- HH:MM
  unique (user_id, meal_index)
);

alter table meal_templates enable row level security;
create policy "users_own_meal_templates" on meal_templates
  for all using (user_id = auth.uid());

alter table food_logs add column if not exists meal_name text;
