import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidGoogleToken, getValidMicrosoftToken } from '../_shared/calendarTokens.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Sport keywords for parsing user-created calendar events
const SPORT_MAP: Record<string, string[]> = {
  Run:            ['run', 'running', 'jog', 'jogging'],
  Ride:           ['ride', 'cycling', 'bike', 'biking', 'bicycle'],
  Swim:           ['swim', 'swimming'],
  Walk:           ['walk', 'walking', 'hike', 'hiking'],
  WeightTraining: ['gym', 'strength', 'weights', 'lift', 'lifting'],
  Workout:        ['workout', 'training', 'hiit', 'cardio', 'crossfit'],
}

function parseSport(title: string): string | null {
  const lower = title.toLowerCase()
  for (const [sport, kws] of Object.entries(SPORT_MAP)) {
    if (kws.some(kw => lower.includes(kw))) return sport
  }
  return null
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const provider = url.searchParams.get('provider') as 'google' | 'microsoft' | null

  // ── Microsoft validation challenge ──────────────────────────────────────────
  // Microsoft sends a GET with ?validationToken= before accepting the subscription.
  // Must echo the token back as text/plain within 10 seconds.
  if (req.method === 'GET') {
    const validationToken = url.searchParams.get('validationToken')
    if (validationToken) {
      return new Response(validationToken, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }
  }

  if (!provider) return new Response('Missing provider', { status: 400 })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  if (provider === 'google') {
    return handleGoogle(req, supabase)
  } else if (provider === 'microsoft') {
    return handleMicrosoft(req, supabase)
  }

  return new Response('Unknown provider', { status: 400 })
})

// ── Google ───────────────────────────────────────────────────────────────────

async function handleGoogle(req: Request, supabase: ReturnType<typeof createClient>) {
  const channelId = req.headers.get('X-Goog-Channel-Id')
  const channelToken = req.headers.get('X-Goog-Channel-Token')
  const resourceState = req.headers.get('X-Goog-Resource-State')

  // Respond immediately — Google requires a fast 200
  // (fire-and-forget the actual sync work)
  if (resourceState === 'sync') {
    // Initial notification after channel creation — nothing to do
    return new Response(null, { status: 200 })
  }

  if (!channelId) return new Response('Missing channel id', { status: 400 })

  const { data: sub } = await supabase
    .from('calendar_webhook_subscriptions')
    .select('user_id, secret')
    .eq('subscription_id', channelId)
    .eq('provider', 'google')
    .maybeSingle()

  if (!sub) return new Response('Unknown channel', { status: 200 }) // 200 to stop retries
  if (channelToken !== sub.secret) return new Response('Invalid token', { status: 200 })

  // Sync in background — must return 200 before doing any async work
  syncGoogleEvents(supabase, sub.user_id).catch(console.error)
  return new Response(null, { status: 200 })
}

async function syncGoogleEvents(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: profile } = await supabase
    .from('users')
    .select('google_cal_access_token, google_cal_refresh_token, google_cal_token_expires_at, google_cal_id')
    .eq('id', userId)
    .single()

  if (!profile?.google_cal_refresh_token) return

  const token = await getValidGoogleToken(supabase, userId, profile as any)
  const calId = encodeURIComponent(profile.google_cal_id ?? 'primary')

  // Fetch events updated in the last 15 minutes to catch any recent changes
  const updatedMin = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?updatedMin=${encodeURIComponent(updatedMin)}&showDeleted=true&singleEvents=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (!res.ok) { console.error('Google events fetch failed:', await res.text()); return }

  const data = await res.json()
  const events: any[] = data.items ?? []

  for (const event of events) {
    await processGoogleEvent(supabase, userId, event)
  }
}

async function processGoogleEvent(supabase: ReturnType<typeof createClient>, userId: string, event: any) {
  const isDeleted = event.status === 'cancelled'
  const isAllDay = !!event.start?.date && !event.start?.dateTime
  if (!isAllDay && !isDeleted) return // ignore time-specific events we didn't create

  const extProps = event.extendedProperties?.private ?? {}
  const isOurs = extProps.stravaeat === 'true'
  const plannedFor: string = event.start?.date ?? event.originalStartTime?.date

  if (isDeleted) {
    // Delete the corresponding planned workout
    await supabase.from('planned_workouts')
      .delete()
      .eq('user_id', userId)
      .eq('google_event_id', event.id)
    return
  }

  // Check if we already track this event
  const { data: existing } = await supabase
    .from('planned_workouts')
    .select('id, updated_at, sync_source')
    .eq('user_id', userId)
    .eq('google_event_id', event.id)
    .maybeSingle()

  // Conflict resolution: skip if our local row was updated more recently (within 60s grace)
  if (existing) {
    const localMs = new Date(existing.updated_at).getTime()
    const remoteMs = new Date(event.updated).getTime()
    if (localMs > remoteMs - 60_000) return // local is newer or within grace window
  }

  if (isOurs) {
    // StravaEat-originated event edited in calendar: update our row
    if (existing) {
      await supabase.from('planned_workouts').update({
        sport_type: extProps.sport ?? existing['sport_type'],
        target_kcal: parseInt(extProps.kcal) || existing['target_kcal'],
        workout_description: event.summary,
        sync_source: 'google',
      }).eq('id', existing.id)
    }
  } else {
    // User-created calendar event: only import if it looks like a workout
    const sport = parseSport(event.summary ?? '')
    if (!sport) return

    if (existing) {
      await supabase.from('planned_workouts').update({
        workout_description: event.summary,
        planned_for: plannedFor,
        sync_source: 'google',
      }).eq('id', existing.id)
    } else {
      await supabase.from('planned_workouts').insert({
        user_id: userId,
        sport_type: sport,
        target_kcal: 0,
        planned_for: plannedFor,
        workout_description: event.summary,
        google_event_id: event.id,
        sync_source: 'google',
      })
    }
  }
}

// ── Microsoft ────────────────────────────────────────────────────────────────

async function handleMicrosoft(req: Request, supabase: ReturnType<typeof createClient>) {
  let body: any
  try { body = await req.json() } catch { return new Response('Bad body', { status: 400 }) }

  const notifications: any[] = body.value ?? []

  // Process each notification (may be batched)
  for (const notif of notifications) {
    const { data: sub } = await supabase
      .from('calendar_webhook_subscriptions')
      .select('user_id, secret')
      .eq('subscription_id', notif.subscriptionId)
      .eq('provider', 'microsoft')
      .maybeSingle()

    if (!sub || notif.clientState !== sub.secret) continue

    // Fire-and-forget per notification
    processMicrosoftNotification(supabase, sub.user_id, notif).catch(console.error)
  }

  return new Response(null, { status: 202 })
}

async function processMicrosoftNotification(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  notif: any,
) {
  const { data: profile } = await supabase
    .from('users')
    .select('microsoft_cal_access_token, microsoft_cal_refresh_token, microsoft_cal_token_expires_at')
    .eq('id', userId)
    .single()

  if (!profile?.microsoft_cal_refresh_token) return

  const token = await getValidMicrosoftToken(supabase, userId, profile as any)
  const eventId: string = notif.resourceData?.id

  if (notif.changeType === 'deleted') {
    if (eventId) {
      await supabase.from('planned_workouts')
        .delete()
        .eq('user_id', userId)
        .eq('microsoft_event_id', eventId)
    }
    return
  }

  if (!eventId) return

  const res = await fetch(`https://graph.microsoft.com/v1.0/me/events/${eventId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return

  const event = await res.json()
  const isAllDay: boolean = event.isAllDay ?? false
  if (!isAllDay) return // ignore time-specific events

  // Parse StravaEat extended property
  const extProps: Record<string, string> = {}
  for (const prop of (event.singleValueExtendedProperties ?? [])) {
    const name = (prop.id as string).split(' Name ').pop()
    if (name) extProps[name] = prop.value
  }
  const isOurs = extProps['stravaeat'] === 'true'
  const plannedFor: string = event.start?.dateTime?.split('T')[0] ?? event.start?.date

  if (!plannedFor) return

  const { data: existing } = await supabase
    .from('planned_workouts')
    .select('id, updated_at')
    .eq('user_id', userId)
    .eq('microsoft_event_id', eventId)
    .maybeSingle()

  if (existing) {
    const localMs = new Date(existing.updated_at).getTime()
    const remoteMs = new Date(event.lastModifiedDateTime).getTime()
    if (localMs > remoteMs - 60_000) return
  }

  if (isOurs) {
    if (existing) {
      await supabase.from('planned_workouts').update({
        sport_type: extProps['sport'] ?? undefined,
        target_kcal: parseInt(extProps['kcal'] ?? '0') || undefined,
        workout_description: event.subject,
        sync_source: 'microsoft',
      }).eq('id', existing.id)
    }
  } else {
    const sport = parseSport(event.subject ?? '')
    if (!sport) return

    if (existing) {
      await supabase.from('planned_workouts').update({
        workout_description: event.subject,
        planned_for: plannedFor,
        sync_source: 'microsoft',
      }).eq('id', existing.id)
    } else {
      await supabase.from('planned_workouts').insert({
        user_id: userId,
        sport_type: sport,
        target_kcal: 0,
        planned_for: plannedFor,
        workout_description: event.subject,
        microsoft_event_id: eventId,
        sync_source: 'microsoft',
      })
    }
  }
}
