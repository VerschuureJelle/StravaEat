create table meal_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  meal_index integer not null,
  name text not null,
  kcal integer not null,
  protein_g real,
  fat_g real,
  carb_g real,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

create index on meal_presets (user_id, meal_index);

alter table meal_presets enable row level security;

create policy "Users manage own meal presets"
  on meal_presets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
