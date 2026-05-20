-- Ingredient rows for meal presets
create table meal_preset_items (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid references meal_presets(id) on delete cascade not null,
  name text not null,
  amount_label text,           -- e.g. "200g", "1 piece"
  kcal integer not null default 0,
  protein_g real,
  fat_g real,
  carb_g real,
  sort_order integer not null default 0
);

create index on meal_preset_items (preset_id);

alter table meal_preset_items enable row level security;

create policy "Users manage own preset items"
  on meal_preset_items for all
  using (
    exists (
      select 1 from meal_presets
      where meal_presets.id = meal_preset_items.preset_id
      and meal_presets.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from meal_presets
      where meal_presets.id = meal_preset_items.preset_id
      and meal_presets.user_id = auth.uid()
    )
  );

-- Remove flat macro columns — totals are now derived from items
alter table meal_presets
  drop column if exists kcal,
  drop column if exists protein_g,
  drop column if exists fat_g,
  drop column if exists carb_g;
