-- Server-side dedup for Strava sync.
-- Prevents concurrent or rapid-fire sync invocations from burning the
-- per-app 100/15-minute Strava API quota. The sync-recent function
-- atomically claims this timestamp via claim_strava_sync() before
-- calling Strava; if another invocation claimed it within the cooldown
-- window, the function returns NULL and the caller skips the Strava
-- API call entirely.
alter table users add column if not exists last_strava_sync_at timestamptz;

-- Atomic claim: succeeds and returns the profile only if no other sync
-- has run in the last `cooldown_sec` seconds. SECURITY DEFINER so the
-- Edge Function can call it with the service-role client.
create or replace function claim_strava_sync(p_user_id uuid, p_cooldown_sec int)
returns table (
  strava_access_token text,
  strava_refresh_token text,
  strava_token_expires_at timestamptz,
  weight_kg numeric
)
language plpgsql
security definer
as $$
begin
  return query
  update users
  set last_strava_sync_at = now()
  where id = p_user_id
    and (
      users.last_strava_sync_at is null
      or users.last_strava_sync_at < now() - (p_cooldown_sec || ' seconds')::interval
    )
  returning
    users.strava_access_token,
    users.strava_refresh_token,
    users.strava_token_expires_at,
    users.weight_kg;
end;
$$;
