export type SportHistory = 'beginner' | 'intermediate' | 'advanced'
export type Sex = 'male' | 'female' | 'other'

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
}

export interface HeartRateZone {
  id: string
  user_id: string
  zone_number: number
  name: string
  min_bpm: number
  max_bpm: number
  met_value: number
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
}

export interface SportEnergySetting {
  id: string
  user_id: string
  sport_type: string
  method: 'standard' | 'custom'
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

export interface ActivityZoneSplit {
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
