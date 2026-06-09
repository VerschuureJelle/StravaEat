-- Columns to support reversible period adjustments on planned_workouts.
-- orig_* columns store the pre-adjustment values so the plan can be restored.

ALTER TABLE planned_workouts
  ADD COLUMN IF NOT EXISTS period_adjusted          boolean  DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS period_adjusted_severity text     CHECK (period_adjusted_severity IN ('minor', 'medium', 'severe')),
  ADD COLUMN IF NOT EXISTS orig_distance_m          float8,
  ADD COLUMN IF NOT EXISTS orig_duration_min        float8,
  ADD COLUMN IF NOT EXISTS orig_kcal                float8,
  ADD COLUMN IF NOT EXISTS orig_target_hr           integer,
  ADD COLUMN IF NOT EXISTS orig_zone_id             uuid     REFERENCES heart_rate_zones(id);
