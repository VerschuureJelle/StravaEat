alter table users
  add column if not exists preferred_workout_time text default '07:00';
