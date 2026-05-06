-- ─── Food log macros ───────────────────────────────────────────────────────────
alter table food_logs
  add column if not exists fat_g  numeric,
  add column if not exists carb_g numeric;

-- ─── Cycling FTP on user profile ───────────────────────────────────────────────
alter table users
  add column if not exists ftp_watts int;

-- ─── Sport-specific sub-config for training programs ───────────────────────────
-- e.g. for strength: {"focus": "hypertrophy", "body_parts": ["chest","back","legs"]}
-- for swimming:      {"goal": "1500m", "pool": true}
-- for cycling:       {"event": "gran_fondo", "use_ftp": true}
alter table training_programs
  add column if not exists subtype_config jsonb;
