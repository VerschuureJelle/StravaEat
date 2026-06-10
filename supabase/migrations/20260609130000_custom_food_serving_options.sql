ALTER TABLE custom_foods
  ADD COLUMN IF NOT EXISTS serving_options jsonb DEFAULT '[]'::jsonb;
