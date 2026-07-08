export type SportHistory = 'beginner' | 'intermediate' | 'advanced'
export type Sex = 'male' | 'female' | 'other'
export type PeriodSeverity = 'minor' | 'medium' | 'severe'

export interface UserProfile {
  id: string
  email: string
  name: string | null
  weight_kg: number | null
  height_cm: number | null
  age: number | null
  sex: Sex | null
  sport_history: SportHistory | null
  max_hr: number | null
  resting_hr: number | null
  strava_id: string | null
  strava_access_token: string | null
  strava_refresh_token: string | null
  strava_token_expires_at: string | null
  daily_kcal_target: number | null
  max_kcal_target: number | null
  goal_protein_g: number | null
  goal_fat_g: number | null
  goal_carb_g: number | null
  ftp_watts: number | null
  push_token: string | null
  on_period: boolean
  period_severity: PeriodSeverity | null
  hide_calories: boolean
  avatar_url: string | null
}

export interface FoodLog {
  id: string
  user_id: string
  date: string
  name: string
  kcal: number
  protein_g: number | null
  fat_g: number | null
  carb_g: number | null
  meal_name: string | null
  meal_index: number | null
  logged_at: string
}

export interface MealTemplate {
  id: string
  user_id: string
  meal_index: number
  name: string
  scheduled_time: string  // HH:MM
  kcal: number | null
  protein_g: number | null
  fat_g: number | null
  carb_g: number | null
  notify_enabled: boolean
}

export interface MealPresetItem {
  id: string
  preset_id: string
  name: string
  amount_label: string | null
  kcal: number
  protein_g: number | null
  fat_g: number | null
  carb_g: number | null
  sort_order: number
  ingredient_id?: string | null
  amount_g?: number | null
  ingredient?: {
    kcal_per_100g: number
    protein_per_100g: number | null
    fat_per_100g: number | null
    carb_per_100g: number | null
  } | null
}

export interface MealPreset {
  id: string
  user_id: string
  name: string
  sort_order: number
  items?: MealPresetItem[]
}

export interface Ingredient {
  id: string
  user_id: string
  name: string
  kcal_per_100g: number
  protein_per_100g: number | null
  fat_per_100g: number | null
  carb_per_100g: number | null
  barcode: string | null
  created_at: string
}

export interface HeartRateZone {
  id: string
  user_id: string
  zone_number: number
  name: string
  min_bpm: number
  max_bpm: number
  met_value: number
  sport_type: string
  created_at: string
}

export interface Activity {
  id: string
  user_id: string
  strava_activity_id: string
  name: string
  type: string
  date: string
  duration_sec: number
  distance_m: number | null
  elevation_gain_m: number | null
  avg_hr: number | null
  max_hr: number | null
  total_kcal: number | null
  total_fat_g: number | null
  total_carb_g: number | null
  summary_polyline: string | null
  synced_at: string
}

export interface BurnSchemaPoint {
  id: string
  user_id: string
  sport_type: string
  hr_value: number
  kcal_per_hour: number
  fat_g_per_hour: number | null
  carb_g_per_hour: number | null
  protein_g_per_hour: number | null
}

export interface SportEnergySetting {
  id: string
  user_id: string
  sport_type: string
  method: 'standard' | 'custom'
  linked_sport_type: string | null
}

export interface Lap {
  id: string
  activity_id: string
  strava_lap_id: number
  lap_index: number
  name: string
  elapsed_time_sec: number
  distance_m: number | null
  avg_speed_ms: number | null
  avg_hr: number | null
  max_hr: number | null
  avg_watts: number | null
  total_elevation_gain: number | null
}

interface ActivityZoneSplit {
  id: string
  activity_id: string
  zone_id: string
  time_in_zone_sec: number
  kcal_in_zone: number
  fat_g_in_zone: number | null
  carb_g_in_zone: number | null
}

export interface ActivityWithZones extends Activity {
  zone_splits: (ActivityZoneSplit & { zone: HeartRateZone })[]
  laps: Lap[]
}

export interface PlannedWorkout {
  id: string
  user_id: string
  sport_type: string
  target_kcal: number
  zone_id: string | null
  target_duration_min: number | null
  target_hr: number | null
  planned_for: string
  created_at: string
  distance_m: number | null
  workout_description: string | null
  status: 'completed' | 'skipped' | null
  is_key: boolean
}

export interface UserSport {
  id: string
  user_id: string
  sport_name: string
  sort_order: number
}

export type ProgramType = '5k' | '10k' | 'half_marathon' | 'marathon' | 'swim' | 'cycling' | 'strength'

export interface TrainingProgram {
  id: string
  user_id: string
  program_type: ProgramType
  weeks: number
  start_date: string
  starting_km: number
  starting_pace_sec_km: number
  calibration_notes: string | null
  subtype_config: Record<string, any> | null
  active: boolean
  created_at: string
}

export interface TrainingProgramSession {
  id: string
  program_id: string
  week_number: number
  day_number: number
  session_name: string
  description: string
  target_km: number | null
  target_pace_sec_km: number | null
  estimated_kcal: number | null
  completed: boolean
  completed_at: string | null
  strava_activity_id: string | null
  planned_for: string | null
}
