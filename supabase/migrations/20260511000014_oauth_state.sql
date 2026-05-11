-- Temporary column to store a CSRF state token during Strava OAuth
alter table users
  add column if not exists pending_oauth_state text,
  add column if not exists pending_oauth_state_expires_at timestamptz;
