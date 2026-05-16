-- Default kcal per meal template (optional)
alter table meal_templates
  add column if not exists kcal integer default null;

-- Track which food_log entries were auto-logged from a meal check-off
alter table food_logs
  add column if not exists meal_index integer default null;

-- Index so uncheck can quickly find and delete the auto-logged entry
create index if not exists food_logs_user_date_meal
  on food_logs(user_id, date, meal_index)
  where meal_index is not null;
