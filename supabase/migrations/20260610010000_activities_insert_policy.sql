-- Allow users to insert their own activities (needed for manual workout logging).
-- Previously only the sync-recent Edge Function (service role) inserted activities,
-- so no client-side INSERT policy existed.
create policy "activities: insert own"
  on public.activities for insert
  with check (auth.uid() = user_id);
