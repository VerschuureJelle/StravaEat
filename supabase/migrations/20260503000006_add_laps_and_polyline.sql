alter table activities add column if not exists summary_polyline text;

create table if not exists activity_laps (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid references activities(id) on delete cascade not null,
  strava_lap_id bigint,
  lap_index integer not null,
  name text,
  elapsed_time_sec integer,
  distance_m numeric,
  avg_speed_ms numeric,
  avg_hr integer,
  max_hr integer,
  avg_watts numeric,
  total_elevation_gain numeric
);

alter table activity_laps enable row level security;

create policy "users_own_laps" on activity_laps
  for all using (
    exists (
      select 1 from activities
      where activities.id = activity_laps.activity_id
        and activities.user_id = auth.uid()
    )
  );
