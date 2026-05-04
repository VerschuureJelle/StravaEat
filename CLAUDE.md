# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

StravaEat is a React Native app that connects to Strava, calculates precise energy expenditure from heart rate data, and helps athletes plan their nutrition around training. Calories are computed per heart rate zone using either MET × weight or a user-defined custom burn schema (HR → kcal/hr). The app also shows daily weather, suggests workouts based on a target calorie burn, and tracks the adjusted daily calorie intake target.

## Development Commands

```bash
# Mobile (run from mobile/)
npm start          # Expo dev server
npm run ios        # iOS simulator
npm run android    # Android emulator

# Supabase (run from repo root)
supabase db push                        # Apply migrations to remote
supabase functions deploy sync-recent   # Deploy sync Edge Function
supabase functions serve sync-recent    # Local Edge Function dev
supabase secrets set STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=...
```

## Architecture

| Layer | Choice |
|---|---|
| Mobile | React Native + Expo SDK 54, Expo Router v6 |
| Backend / DB | Supabase (PostgreSQL + Edge Functions + Auth) |
| Auth | Supabase Auth with Strava OAuth (via `strava-callback` Edge Function) |
| Strava sync | `sync-recent` Edge Function (Deno/TypeScript) — fetches last 20 activities, HR streams, laps |
| Weather | Open-Meteo API (free, no key) + expo-location |
| Icons | @expo/vector-icons (Ionicons + MaterialCommunityIcons) |
| Charts | react-native-svg |
| Maps | react-native-maps |

## Environment Variables

Mobile `.env.local`:
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_STRAVA_CLIENT_ID=
```

Supabase Edge Function secrets: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## Database Schema

```sql
-- Core user profile (extends auth.users)
users: id, name, weight_kg, height_cm, age, sex, sport_history,
       max_hr, resting_hr, daily_kcal_target,
       strava_id, strava_access_token, strava_refresh_token, strava_token_expires_at

-- HR zones per user (5 zones, editable)
heart_rate_zones: id, user_id, zone_number, name, min_bpm, max_bpm, met_value

-- Synced Strava activities
activities: id, user_id, strava_activity_id (unique), name, type, date,
            duration_sec, distance_m, elevation_gain_m, avg_hr, max_hr,
            total_kcal, total_fat_g, total_carb_g, summary_polyline, synced_at

-- Time-in-zone breakdown per activity
activity_zone_splits: id, activity_id, zone_id,
                      time_in_zone_sec, kcal_in_zone, fat_g_in_zone, carb_g_in_zone

-- Lap data from Strava
activity_laps: id, activity_id, strava_lap_id, lap_index, name,
               elapsed_time_sec, distance_m, avg_speed_ms, avg_hr, max_hr,
               avg_watts, total_elevation_gain

-- User-defined calorie burn curve per sport (HR → kcal/hr)
burn_schema_points: id, user_id, sport_type, hr_value,
                    kcal_per_hour, fat_g_per_hour, carb_g_per_hour
                    UNIQUE (user_id, sport_type, hr_value)

-- Whether to use MET or custom burn schema per sport
sport_energy_settings: id, user_id, sport_type, method ('standard'|'custom'),
                       linked_sport_type   -- if set, use this other sport's burn schema
                       UNIQUE (user_id, sport_type)

-- User's planned workouts (from Workout Planner or future TP integration)
planned_workouts: id, user_id, sport_type, target_kcal,
                  zone_id, target_duration_min, target_hr,
                  planned_for (date), created_at
```

RLS enabled on all tables — users can only read/write their own rows.

## Calorie Calculation Logic

**Standard (MET):**
```
kcal_per_second = met_value × weight_kg / 3600
total_kcal = Σ (kcal_per_second × seconds_in_zone)
```

**Custom burn schema:**
Linear interpolation between user-defined HR → kcal/hr points. Extrapolation clamps to the nearest endpoint. Requires ≥ 2 points. Values are per hour; divide by 3600 for per-second rate.

**Workout Planner (reverse calculation):**
```
duration_hours = target_kcal / kcal_per_hour_at_zone_midpoint
```
kcal/hr at zone midpoint uses the same standard/custom logic as sync.

## Tab Structure

| File | Tab | Icon |
|---|---|---|
| `(tabs)/home.tsx` | Home | home-outline |
| `(tabs)/index.tsx` | Activities | flash-outline |
| `(tabs)/planner.tsx` | Workout Planner | calculator-outline |
| `(tabs)/settings.tsx` | Settings | settings-outline |
| `(tabs)/zones.tsx` | — | hidden (href: null) |
| `(tabs)/profile.tsx` | — | hidden (href: null) |

## Key Screens

- **Home** (`home.tsx`): greeting, daily calorie target widget (tappable breakdown modal), weather card with Today/Week toggle + hourly scroll + workout recommendation, training plan card (TrainingPeaks/Runna placeholder + planned workouts from DB)
- **Activities** (`index.tsx`): activity list with period dropdown (All/Day/Week/Month/Year/Custom), sport-coloured cards (swim=blue, run=red, ride=green), summary card, collapsible month calendars
- **Activity Detail** (`activity/[id].tsx`): map, HR stats, fat/carb breakdown, zone split bar, laps table
- **Workout Planner** (`planner.tsx`): select sport + target kcal → get zone-by-zone suggestions with duration, distance, pace → save as today's plan
- **Settings** (`settings.tsx`): segmented Personal Info / Heart Rate Zones; Personal Info = profile + Strava connect + sign out; Heart Rate Zones = zone editing + per-sport energy method (Standard / Custom / Same as…); Custom opens `/energy/[sport]` for burn schema editing
- **Burn Schema Editor** (`energy/[sport].tsx`): table of HR→kcal/hr points, SVG line chart, add/delete

## Key Design Decisions

- **Raw Strava HR stream is never stored** — zone splits are computed in the Edge Function and the stream is discarded
- **Zone changes are non-retroactive** — editing zones only affects future syncs
- **Sport linking** — `linked_sport_type` on `sport_energy_settings` lets e.g. Virtual Ride reuse Ride's burn schema
- **Planned workout kcal** feeds into the home screen calorie target widget alongside completed workout kcal
- **Weather** uses Open-Meteo (no API key required); location via expo-location foreground permission
