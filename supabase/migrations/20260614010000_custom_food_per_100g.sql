alter table custom_foods
  add column if not exists kcal_per_100g float null,
  add column if not exists protein_per_100g float null,
  add column if not exists fat_per_100g float null,
  add column if not exists carb_per_100g float null;
