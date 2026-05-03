-- Fix incorrect column reference in update policy
drop policy if exists "users: update own" on public.users;
create policy "users: update own" on public.users for update using (auth.uid() = id);

-- Add insert policy so upsert works from the app
create policy "users: insert own" on public.users for insert with check (auth.uid() = id);
