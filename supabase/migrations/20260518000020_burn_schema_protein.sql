alter table burn_schema_points
  add column if not exists protein_g_per_hour numeric(6,2);
