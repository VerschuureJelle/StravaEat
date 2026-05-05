create table if not exists user_sports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  sport_name text not null,
  sort_order integer not null default 0,
  unique (user_id, sport_name)
);

alter table user_sports enable row level security;
create policy "users_own_user_sports" on user_sports
  for all using (user_id = auth.uid());
