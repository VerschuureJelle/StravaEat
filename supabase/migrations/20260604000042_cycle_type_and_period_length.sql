ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cycle_type TEXT NOT NULL DEFAULT 'regular'
    CHECK (cycle_type IN ('regular', 'irregular')),
  ADD COLUMN IF NOT EXISTS period_length INTEGER NOT NULL DEFAULT 5;
