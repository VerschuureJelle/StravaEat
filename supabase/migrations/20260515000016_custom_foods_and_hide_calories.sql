-- Hide calorie numbers preference
alter table users
  add column if not exists hide_calories boolean not null default false;

-- Custom food templates (quick-add library)
create table if not exists custom_foods (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  kcal        integer not null,
  protein_g   numeric,
  fat_g       numeric,
  carb_g      numeric,
  created_at  timestamptz not null default now()
);

create index if not exists custom_foods_user on custom_foods(user_id, name);
alter table custom_foods enable row level security;
create policy "own rows only" on custom_foods
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
