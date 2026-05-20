alter table meal_templates
  add column if not exists protein_g numeric(6,1),
  add column if not exists fat_g     numeric(6,1),
  add column if not exists carb_g    numeric(6,1);
