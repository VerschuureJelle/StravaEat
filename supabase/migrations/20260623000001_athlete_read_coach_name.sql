-- Allow an athlete to read basic profile info (name) of their connected coaches.
-- Needed so the "From your coach" card in today.tsx can show the coach's name.
create policy "athlete_view_coach_name" on users
  for select using (
    exists (
      select 1 from coach_athletes
      where coach_id = id
        and athlete_id = auth.uid()
        and active = true
    )
  );
