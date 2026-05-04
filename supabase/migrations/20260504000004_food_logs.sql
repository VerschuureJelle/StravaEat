create table if not exists food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  date date not null default current_date,
  name text not null,
  kcal integer not null,
  protein_g numeric,
  logged_at timestamptz default now()
);

alter table food_logs enable row level security;
create policy "users_own_food_logs" on food_logs
  for all using (user_id = auth.uid());

create index food_logs_user_date on food_logs (user_id, date);
