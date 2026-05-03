# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

StravaEat calculates precise energy expenditure from Strava activities by analyzing time spent in heart rate zones. Zones are defined as % of max HR; calories are calculated using MET × weight × hours per zone.

## Current State

The Expo mobile app scaffold and Supabase schema are built. Strava OAuth and the activity sync Edge Function are the next steps.

The legacy GitHub Actions workflow (`.github/workflows/strava_runner.yml`) ran a Python script for early Strava experiments — it will be superseded by the Edge Function.

## Development Commands

```bash
# Mobile (run from mobile/)
npm start              # Expo dev server (scan QR with Expo Go)
npm run ios            # iOS simulator
npm run android        # Android emulator

# Supabase (run from repo root, requires Supabase CLI)
supabase login
supabase link --project-ref <your-ref>
supabase db push                          # Apply migrations to remote
supabase functions deploy sync-strava     # Deploy Edge Function
supabase functions serve sync-strava      # Local Edge Function dev
```

## Supabase Edge Function Secrets

Set these in the Supabase dashboard → Project Settings → Edge Functions, or via CLI:

```bash
supabase secrets set STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=...
```

## Target Architecture

| Layer | Choice |
|---|---|
| Mobile | React Native + Expo |
| Backend / DB | Supabase (PostgreSQL + Edge Functions + Auth + Storage) |
| Auth | Supabase Auth with Strava OAuth |
| Strava sync | Supabase Edge Function (Deno/TypeScript) |

## Database Schema

```sql
-- Extends Supabase auth.users
create table users (
  id uuid references auth.users primary key,
  name text,
  weight_kg numeric,
  age integer,
  sex text,
  sport_history text, -- 'beginner' | 'intermediate' | 'advanced'
  max_hr integer,
  resting_hr integer,
  strava_id text unique,
  strava_access_token text,
  strava_refresh_token text,
  strava_token_expires_at timestamptz
);

create table heart_rate_zones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  zone_number integer, -- 1–5
  name text,
  min_bpm integer,
  max_bpm integer,
  met_value numeric,
  created_at timestamptz default now()
);

create table activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  strava_activity_id text unique,
  name text,
  type text,
  date timestamptz,
  duration_sec integer,
  avg_hr integer,
  max_hr integer,
  total_kcal numeric, -- null if activity has no HR data
  synced_at timestamptz default now()
);

create table activity_zone_splits (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid references activities(id) on delete cascade,
  zone_id uuid references heart_rate_zones(id),
  time_in_zone_sec integer,
  kcal_in_zone numeric
);
```

RLS must be enabled on all tables. Users can only read/write their own rows.

## Core Calculation Logic

```
kcal_in_zone = met_value × weight_kg × (time_in_zone_sec / 3600)
total_kcal   = sum of kcal_in_zone across all zones
```

Default MET values:
- Zone 1 (<60% max HR): 2.5
- Zone 2 (60–70%): 4.5
- Zone 3 (70–80%): 6.0
- Zone 4 (80–90%): 8.5
- Zone 5 (>90%): 11.0

Zone boundaries are generated as % of `max_hr` (not Karvonen/HRR method).

## Key Design Decisions

- **Raw Strava HR stream is never stored** — process zone splits in the Edge Function and discard the stream
- **Zone changes are non-retroactive** — editing zones only affects future synced activities
- **Activities with no HR data** are stored with `total_kcal = null` and shown with a warning in the UI
- **Strava token refresh** must be handled automatically inside the Edge Function before any API call

## Screens

- **Onboarding**: Strava OAuth → profile questions (age, weight, sex, max HR, sport history) → zone preview → confirm or adjust
- **Home**: recent activities list with total kcal per activity
- **Activity Detail**: zone split bar chart + time per zone + total kcal
- **Zone Settings**: view/edit all 5 zones, regenerate from max HR
- **Profile**: personal stats and HR settings

## Environment Variables

```
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REFRESH_TOKEN=
STRAVA_TOKEN_EXPIRY=
PUSHOVER_USER_KEY=       # legacy — Python script only
PUSHOVER_APP_TOKEN=      # legacy — Python script only
```

Supabase keys (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) go in `.env.local` for the Expo app and as Supabase Edge Function secrets.

## GitHub Actions

`.github/workflows/strava_runner.yml` — runs `main.py` (Python) daily at 08:00 UTC. This is the legacy prototype; it will be superseded by the Supabase Edge Function sync.
