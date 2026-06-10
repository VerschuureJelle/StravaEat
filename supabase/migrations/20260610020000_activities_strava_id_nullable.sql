-- Manual activities have no Strava ID; allow NULL on strava_activity_id.
-- The UNIQUE constraint already permits multiple NULLs in PostgreSQL.
ALTER TABLE activities
  ALTER COLUMN strava_activity_id DROP NOT NULL;
