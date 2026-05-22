import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidGoogleToken, getValidMicrosoftToken } from '../_shared/calendarTokens.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { workout_id, action } = await req.json() as {
    workout_id: string
    action: 'create' | 'update' | 'delete'
  }

  const { data: workout } = await supabase
    .from('planned_workouts')
    .select('id, sport_type, target_kcal, target_duration_min, planned_for, workout_description, sync_source, google_event_id, microsoft_event_id')
    .eq('id', workout_id)
    .eq('user_id', user.id)
    .single()

  if (!workout) return new Response('Not found', { status: 404 })

  // Suppress echo: calendar-sourced rows must not be pushed back to calendar
  if (workout.sync_source !== 'app') {
    return new Response(JSON.stringify({ skipped: 'echo_suppressed' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('google_cal_access_token, google_cal_refresh_token, google_cal_token_expires_at, google_cal_id, microsoft_cal_access_token, microsoft_cal_refresh_token, microsoft_cal_token_expires_at, microsoft_cal_id, preferred_workout_time')
    .eq('id', user.id)
    .single()

  if (!profile) return new Response('Profile not found', { status: 404 })

  const results: Record<string, string> = {}

  // ── Google Calendar ──────────────────────────────────────────────────────────
  if (profile.google_cal_refresh_token) {
    try {
      const token = await getValidGoogleToken(supabase, user.id, profile as any)
      const calId = encodeURIComponent(profile.google_cal_id ?? 'primary')
      const eventsBase = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`

      if (action === 'delete') {
        if (workout.google_event_id) {
          const r = await fetch(`${eventsBase}/${workout.google_event_id}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
          })
          results.google = (r.ok || r.status === 404) ? 'ok' : 'error'
        } else {
          results.google = 'skipped'
        }
      } else if (action === 'create' || (action === 'update' && !workout.google_event_id)) {
        const r = await fetch(eventsBase, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildGoogleEvent(workout, (profile as any).preferred_workout_time ?? '07:00')),
        })
        if (r.ok) {
          const ev = await r.json()
          await supabase.from('planned_workouts').update({ google_event_id: ev.id }).eq('id', workout_id)
          results.google = 'ok'
        } else {
          results.google = 'error'
        }
      } else if (action === 'update' && workout.google_event_id) {
        const r = await fetch(`${eventsBase}/${workout.google_event_id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildGoogleEvent(workout, (profile as any).preferred_workout_time ?? '07:00')),
        })
        results.google = r.ok ? 'ok' : 'error'
      }
    } catch (e) {
      results.google = e instanceof Error ? e.message : 'error'
    }
  } else {
    results.google = 'not_connected'
  }

  // ── Microsoft Graph ──────────────────────────────────────────────────────────
  if (profile.microsoft_cal_refresh_token) {
    try {
      const token = await getValidMicrosoftToken(supabase, user.id, profile as any)
      const eventsBase = 'https://graph.microsoft.com/v1.0/me/events'

      if (action === 'delete') {
        if (workout.microsoft_event_id) {
          const r = await fetch(`${eventsBase}/${workout.microsoft_event_id}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
          })
          results.microsoft = (r.ok || r.status === 404) ? 'ok' : 'error'
        } else {
          results.microsoft = 'skipped'
        }
      } else if (action === 'create' || (action === 'update' && !workout.microsoft_event_id)) {
        const r = await fetch(eventsBase, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildMicrosoftEvent(workout, (profile as any).preferred_workout_time ?? '07:00')),
        })
        if (r.ok) {
          const ev = await r.json()
          await supabase.from('planned_workouts').update({ microsoft_event_id: ev.id }).eq('id', workout_id)
          results.microsoft = 'ok'
        } else {
          results.microsoft = 'error'
        }
      } else if (action === 'update' && workout.microsoft_event_id) {
        const r = await fetch(`${eventsBase}/${workout.microsoft_event_id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildMicrosoftEvent(workout, (profile as any).preferred_workout_time ?? '07:00')),
        })
        results.microsoft = r.ok ? 'ok' : 'error'
      }
    } catch (e) {
      results.microsoft = e instanceof Error ? e.message : 'error'
    }
  } else {
    results.microsoft = 'not_connected'
  }

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  })
})

function workoutTimes(date: string, preferredTime: string, durationMin: number | null) {
  const dur = durationMin ?? 60
  const [sh, sm] = preferredTime.split(':').map(Number)
  const totalEnd = sh * 60 + sm + dur
  const eh = Math.floor(totalEnd / 60) % 24
  const em = totalEnd % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    startDT: `${date}T${pad(sh)}:${pad(sm)}:00`,
    endDT:   `${date}T${pad(eh)}:${pad(em)}:00`,
  }
}

function buildGoogleEvent(w: any, preferredTime: string) {
  const { startDT, endDT } = workoutTimes(w.planned_for, preferredTime, w.target_duration_min)
  const lines = [
    `Sport: ${w.sport_type}`,
    `Target: ${w.target_kcal} kcal`,
    w.target_duration_min ? `Duration: ${w.target_duration_min} min` : null,
    w.workout_description ?? null,
    `---\nstravaeat_id:${w.id}`,
  ].filter(Boolean)

  return {
    summary: `${w.sport_type} workout`,
    description: lines.join('\n'),
    start: { dateTime: `${startDT}`, timeZone: 'UTC' },
    end:   { dateTime: `${endDT}`,   timeZone: 'UTC' },
    extendedProperties: {
      private: {
        stravaeat: 'true',
        stravaeat_id: w.id,
        kcal: String(w.target_kcal),
        sport: w.sport_type,
      },
    },
  }
}

function buildMicrosoftEvent(w: any, preferredTime: string) {
  const { startDT, endDT } = workoutTimes(w.planned_for, preferredTime, w.target_duration_min)
  const lines = [
    `Sport: ${w.sport_type}`,
    `Target: ${w.target_kcal} kcal`,
    w.target_duration_min ? `Duration: ${w.target_duration_min} min` : null,
    w.workout_description ?? null,
    `---\nstravaeat_id:${w.id}`,
  ].filter(Boolean)

  return {
    subject: `${w.sport_type} workout`,
    body: { contentType: 'text', content: lines.join('\n') },
    isAllDay: false,
    start: { dateTime: `${startDT}`, timeZone: 'UTC' },
    end:   { dateTime: `${endDT}`,   timeZone: 'UTC' },
    singleValueExtendedProperties: [
      { id: 'String {00020329-0000-0000-C000-000000000046} Name stravaeat', value: 'true' },
      { id: 'String {00020329-0000-0000-C000-000000000046} Name stravaeat_id', value: w.id },
      { id: 'String {00020329-0000-0000-C000-000000000046} Name kcal', value: String(w.target_kcal) },
      { id: 'String {00020329-0000-0000-C000-000000000046} Name sport', value: w.sport_type },
    ],
  }
}
