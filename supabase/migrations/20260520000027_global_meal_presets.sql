-- Join table linking presets to meal slots (many-to-many)
create table meal_slot_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  meal_index integer not null,
  preset_id uuid references meal_presets(id) on delete cascade not null,
  sort_order integer not null default 0,
  unique(user_id, meal_index, preset_id)
);

create index on meal_slot_presets (user_id, meal_index);

alter table meal_slot_presets enable row level security;

create policy "Users manage own slot presets"
  on meal_slot_presets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Migrate existing data: each preset was tied to exactly one meal via meal_index
insert into meal_slot_presets (user_id, meal_index, preset_id, sort_order)
select user_id, meal_index, id, sort_order from meal_presets;

-- Remove meal_index from meal_presets — presets are now global
alter table meal_presets drop column if exists meal_index;
