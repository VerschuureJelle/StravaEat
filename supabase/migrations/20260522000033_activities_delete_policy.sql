-- Allow users to delete their own activities (e.g. to force a resync from Strava).
-- Cascade constraints on activity_zone_splits and activity_laps handle cleanup automatically.
create policy "activities: delete own"
  on public.activities for delete
  using (auth.uid() = user_id);
