-- Add sport_type to heart_rate_zones for per-sport zone configuration.
-- 'default' means the zone applies to all sports that have no custom zones.
alter table public.heart_rate_zones
  add column if not exists sport_type text not null default 'default';

-- Replace (user_id, zone_number) unique constraint with one that includes sport_type
alter table public.heart_rate_zones
  drop constraint if exists heart_rate_zones_user_id_zone_number_key;

alter table public.heart_rate_zones
  add constraint heart_rate_zones_user_id_zone_number_sport_type_key
  unique (user_id, zone_number, sport_type);
