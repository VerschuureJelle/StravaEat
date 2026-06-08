CREATE INDEX IF NOT EXISTS idx_activities_user_date        ON activities(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_food_logs_user_date         ON food_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_planned_workouts_user_date  ON planned_workouts(user_id, planned_for);
CREATE INDEX IF NOT EXISTS idx_activity_zone_splits_activity ON activity_zone_splits(activity_id);
