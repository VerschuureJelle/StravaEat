ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'strava';
