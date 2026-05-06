-- ─── Training Programs ─────────────────────────────────────────────────────────

create table training_programs (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references users(id) on delete cascade not null,
  program_type         text not null,           -- '5k' | '10k' | 'half_marathon' | 'marathon'
  weeks                int not null,
  start_date           date not null default current_date,
  starting_km          numeric(6,2) not null,   -- longest comfortable run today (km)
  starting_pace_sec_km int not null,            -- current pace in seconds per km
  calibration_notes    text,
  active               boolean not null default true,
  created_at           timestamptz default now() not null
);

create table training_program_sessions (
  id                   uuid primary key default gen_random_uuid(),
  program_id           uuid references training_programs(id) on delete cascade not null,
  week_number          int not null,
  day_number           int not null,            -- 1–7, day within the week
  session_name         text not null,           -- e.g. "5k Program w1d1"
  description          text not null,
  target_km            numeric(6,2),
  target_pace_sec_km   int,
  estimated_kcal       int,
  completed            boolean not null default false,
  completed_at         timestamptz,
  strava_activity_id   text,                    -- set when auto-paired with a Strava activity
  planned_for          date
);

-- ─── RLS ───────────────────────────────────────────────────────────────────────

alter table training_programs enable row level security;
alter table training_program_sessions enable row level security;

create policy "user_own_programs" on training_programs
  for all using (user_id = auth.uid());

create policy "user_own_program_sessions" on training_program_sessions
  for all using (
    exists (select 1 from training_programs where id = program_id and user_id = auth.uid())
  );
