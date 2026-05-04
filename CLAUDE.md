# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

StravaEat is a React Native app that connects to Strava, calculates precise energy expenditure from heart rate data, and helps athletes plan their nutrition around training. Calories are computed per heart rate zone using either MET × weight or a user-defined custom burn schema (HR → kcal/hr). The app shows daily weather, an AI-powered workout planner, and a dynamic daily calorie target that updates with completed and planned workouts.

## Development Commands

```bash
# Mobile (run from mobile/)
npm start          # Expo dev server
npm run ios        # iOS simulator
npm run android    # Android emulator

# Supabase (run from repo root)
supabase db push                        # Apply migrations to remote
supabase functions deploy <name>        # Deploy Edge Function
supabase functions serve <name>         # Local Edge Function dev
supabase secrets set KEY=value
supabase secrets list
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
| AI Coach | Anthropic API (claude-opus-4-7) via `ai-coach` Edge Function |

## Environment Variables

Mobile `.env.local`:
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_STRAVA_CLIENT_ID=
```

Supabase Edge Function secrets (set via `supabase secrets set`):
`STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `ANTHROPIC_API_KEY`
Auto-injected by Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

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
                       linked_sport_type   -- reuse another sport's burn schema
                       UNIQUE (user_id, sport_type)

-- User's planned workouts (from Planner tab or future TP/Runna integration)
planned_workouts: id, user_id, sport_type, target_kcal,
                  zone_id, target_duration_min, target_hr,
                  distance_m, workout_description,   -- workout_description set by AI Coach
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
Linear interpolation between user-defined HR → kcal/hr points. Extrapolation clamps to the nearest endpoint. Requires ≥ 2 points.

**Workout Planner (reverse):**
```
duration_hours = target_kcal / kcal_per_hour_at_zone_midpoint
```

**Home screen calorie widget:**
```
totalTarget    = daily_kcal_target + burned_today        (confirmed)
projectedTotal = totalTarget + planned_kcal_today        (includes planned workouts)
```
Widget shows `projectedTotal` as the main number. Breakdown row: "X baseline + Y burned + Z projected".

## Tab Structure

| File | Tab | Icon |
|---|---|---|
| `(tabs)/home.tsx` | Home | home-outline |
| `(tabs)/index.tsx` | Activities | flash-outline |
| `(tabs)/planner.tsx` | Planner | calculator-outline |
| `(tabs)/nutrition.tsx` | Nutrition | restaurant-outline |
| `(tabs)/settings.tsx` | Settings | settings-outline |
| `(tabs)/zones.tsx` | — | hidden (href: null) |
| `(tabs)/profile.tsx` | — | hidden (href: null) |

## Key Screens

- **Home** (`home.tsx`): greeting, calorie widget (tappable modal — baseline + burned activities + projected planned workouts), weather card (Today/Week toggle + hourly scroll + 7-day forecast + workout recommendation), today's workout card (shows `planned_workouts` from DB — AI Coach plans show description text, regular plans show chips)
- **Activities** (`index.tsx`): period dropdown (All/Day/Week/Month/Year/Custom), sport-colored cards with left border + icon, summary card, collapsible month calendars. Custom range: DD-MM-YYYY or DD/MM/YYYY format.
- **Activity Detail** (`activity/[id].tsx`): map, HR stats, fat/carb breakdown, zone split bar, laps table
- **Planner** (`planner.tsx`): 3 modes selected via segmented toggle:
  1. *Target kcal* — enter kcal → per-zone duration/distance/pace suggestions → "Plan for today"
  2. *Describe workout* — enter distance + pick zone → estimates kcal/duration from historical avg pace → "Plan for today"
  3. *AI Coach* — natural language → `ai-coach` Edge Function → structured plan → "Save as today's plan" (stores `workout_description`)
- **Settings** (`settings.tsx`): segmented Personal Info / Heart Rate Zones. Personal Info: name/age/weight/height/max HR/resting HR/daily kcal target + Strava connect + sign out. Heart Rate Zones: zone cards (inline edit) + per-sport energy method (Standard / Custom / Same as…). Custom → `/energy/[sport]`.
- **Nutrition** (`nutrition.tsx`): progress bar (consumed vs. target = baseline + burned + planned), quick-add form (name + kcal + optional protein_g), today's food log list with delete. Target breakdown chips mirror the home calorie widget.
- **Burn Schema Editor** (`energy/[sport].tsx`): table of HR→kcal/hr points, SVG line chart, add/delete rows

## Edge Functions

- **`sync-recent`**: fetches Strava activities + HR streams + laps. Computes zone splits using standard MET or custom burn schema. Respects `linked_sport_type` when loading burn schema points.
- **`strava-callback`**: handles Strava OAuth, stores tokens on `users` table.
- **`ai-coach`**: receives `{message, sport}`. Fetches user profile + zones + historical paces. Calls Anthropic API (`claude-opus-4-7`). Returns `{plan: string, estimated_kcal: number|null}`.

## Push Notifications

- `lib/notifications.ts`: `registerForNotifications()` requests permission, gets Expo push token, saves to `users.push_token`. `notifyWorkoutSynced(burnedKcal, newTarget)` fires an immediate local notification.
- Registered on startup in `app/_layout.tsx` when a session exists.
- Triggered in `index.tsx` `syncStrava()` after a successful sync — queries today's burned kcal then calls `notifyWorkoutSynced`.
- Local notifications work in Expo Go. Remote push (server → device) requires EAS Build with `users.push_token` populated.

**Critical Deno pattern** — all Edge Functions use:
```typescript
Deno.serve(async (req) => { ... })   // NOT: import { serve } from deno std
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
```

## Sport Colors & Icons

| Pattern | Color | MaterialCommunityIcons |
|---|---|---|
| swim | #29B6F6 | swim |
| run / jog | #EF5350 | run |
| walk | #FF8A65 | walk |
| ride / bike / cycling / virtual | #66BB6A | bike |
| default | #90A4AE | lightning-bolt |

## Key Design Decisions

- **Raw Strava HR stream is never stored** — zone splits are computed in the Edge Function and the stream is discarded
- **Zone changes are non-retroactive** — editing zones only affects future syncs
- **Sport linking** — `linked_sport_type` on `sport_energy_settings` lets e.g. Virtual Ride reuse Ride's burn schema
- **Planned workouts replace** — saving a new plan for the same sport+date deletes the previous one (delete + insert)
- **AI Coach plans** — identified by non-null `workout_description`; shown with purple border + sparkles icon on home screen
- **TrainingPeaks / Runna** — currently placeholder UI only; no API access
- **Weather** uses Open-Meteo (no API key); location via expo-location foreground permission
