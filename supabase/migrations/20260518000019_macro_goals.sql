alter table users
  add column if not exists goal_protein_g integer,
  add column if not exists goal_fat_g integer,
  add column if not exists goal_carb_g integer;
