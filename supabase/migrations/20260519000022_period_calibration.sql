create table if not exists period_calibration (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  severity           text not null check (severity in ('minor', 'medium')),
  mu                 float8 not null,
  sigma_sq           float8 not null,
  n_obs              integer not null default 0,
  last_feedback_date date,
  updated_at         timestamptz default now(),
  unique (user_id, severity)
);

alter table period_calibration enable row level security;

create policy "Users manage own period calibration"
  on period_calibration
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
