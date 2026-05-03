-- Allow a sport to reference another sport's burn schema
alter table sport_energy_settings
  add column if not exists linked_sport_type text;
