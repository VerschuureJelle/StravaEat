-- Add workout status tracking and key-workout flag to planned_workouts
ALTER TABLE planned_workouts
  ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('completed', 'skipped')) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_key BOOLEAN NOT NULL DEFAULT FALSE;
