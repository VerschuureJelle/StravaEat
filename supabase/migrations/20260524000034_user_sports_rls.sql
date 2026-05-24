-- Enable RLS and add full CRUD policies for user_sports
alter table public.user_sports enable row level security;

create policy "users can select own user_sports"
  on public.user_sports for select
  using (auth.uid() = user_id);

create policy "users can insert own user_sports"
  on public.user_sports for insert
  with check (auth.uid() = user_id);

create policy "users can update own user_sports"
  on public.user_sports for update
  using (auth.uid() = user_id);

create policy "users can delete own user_sports"
  on public.user_sports for delete
  using (auth.uid() = user_id);
