-- Phase lengths for irregular cycles: lets users manually define typical
-- follicular and luteal duration so we can draw the segmented progress bar.
-- Ovulation is always estimated at 2 days and computed from these.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS follicular_length integer DEFAULT 8,
  ADD COLUMN IF NOT EXISTS luteal_length     integer DEFAULT 12;
