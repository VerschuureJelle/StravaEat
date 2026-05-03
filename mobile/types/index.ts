export type SportHistory = 'beginner' | 'intermediate' | 'advanced'
export type Sex = 'male' | 'female' | 'other'

export interface UserProfile {
  id: string
  email: string
  name: string | null
  weight_kg: number | null
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
  avg_hr: number | null
  max_hr: number | null
  total_kcal: number | null
  synced_at: string
}

export interface ActivityZoneSplit {
  id: string
  activity_id: string
  zone_id: string
  time_in_zone_sec: number
  kcal_in_zone: number
}

export interface ActivityWithZones extends Activity {
  zone_splits: (ActivityZoneSplit & { zone: HeartRateZone })[]
}
