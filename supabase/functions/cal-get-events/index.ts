import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidGoogleToken, getValidMicrosoftToken } from '../_shared/calendarTokens.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export interface CalEvent {
  id: string
  title: string
  date: string        // YYYY-MM-DD
  startTime: string | null  // HH:MM or null if all-day
  endTime: string | null
  isAllDay: boolean
  provider: 'google' | 'microsoft'
  isOurs: boolean     // created by StravaEat
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data: profile } = await supabase
    .from('users')
    .select('google_cal_access_token, google_cal_refresh_token, google_cal_token_expires_at, google_cal_id, microsoft_cal_access_token, microsoft_cal_refresh_token, microsoft_cal_token_expires_at')
    .eq('id', user.id)
    .single()

  if (!profile) return new Response('Not found', { status: 404 })

  let startDate: string | null = null
  let endDate: string | null = null
  try {
    const body = await req.json()
    startDate = body.startDate ?? null
    endDate = body.endDate ?? null
  } catch { /* no body */ }

  const now = startDate ? new Date(startDate + 'T00:00:00Z') : new Date()
  const twoWeeksLater = endDate
    ? new Date(endDate + 'T23:59:59Z')
    : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
  const events: CalEvent[] = []

  // ── Google ───────────────────────────────────────────────────────────────────
  if (profile.google_cal_refresh_token) {
    try {
      const token = await getValidGoogleToken(supabase, user.id, profile as any)
      const calId = encodeURIComponent(profile.google_cal_id ?? 'primary')
      const params = new URLSearchParams({
        timeMin: now.toISOString(),
        timeMax: twoWeeksLater.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '50',
      })
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (res.ok) {
        const data = await res.json()
        for (const e of (data.items ?? [])) {
          if (e.status === 'cancelled') continue
          const isAllDay = !!e.start?.date && !e.start?.dateTime
          const isOurs = e.extendedProperties?.private?.stravaeat === 'true'
          const date = isAllDay ? e.start.date : e.start.dateTime?.split('T')[0]
          if (!date) continue
          events.push({
            id: `google_${e.id}`,
            title: e.summary ?? '(no title)',
            date,
            startTime: isAllDay ? null : formatTime(e.start.dateTime),
            endTime: isAllDay ? null : formatTime(e.end?.dateTime),
            isAllDay,
            provider: 'google',
            isOurs,
          })
        }
      }
    } catch (e) {
      console.error('Google fetch error:', e)
    }
  }

  // ── Microsoft ────────────────────────────────────────────────────────────────
  if (profile.microsoft_cal_refresh_token) {
    try {
      const token = await getValidMicrosoftToken(supabase, user.id, profile as any)
      const params = new URLSearchParams({
        startDateTime: now.toISOString(),
        endDateTime: twoWeeksLater.toISOString(),
        '$orderby': 'start/dateTime',
        '$top': '50',
        '$select': 'id,subject,start,end,isAllDay,singleValueExtendedProperties',
        '$expand': "singleValueExtendedProperties($filter=id eq 'String {00020329-0000-0000-C000-000000000046} Name stravaeat')",
      })
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendarView?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (res.ok) {
        const data = await res.json()
        for (const e of (data.value ?? [])) {
          const isAllDay: boolean = e.isAllDay ?? false
          const isOurs = (e.singleValueExtendedProperties ?? []).some((p: any) => p.value === 'true')
          const date = isAllDay
            ? e.start?.dateTime?.split('T')[0]
            : e.start?.dateTime?.split('T')[0]
          if (!date) continue
          events.push({
            id: `microsoft_${e.id}`,
            title: e.subject ?? '(no title)',
            date,
            startTime: isAllDay ? null : formatTime(e.start?.dateTime),
            endTime: isAllDay ? null : formatTime(e.end?.dateTime),
            isAllDay,
            provider: 'microsoft',
            isOurs,
          })
        }
      }
    } catch (e) {
      console.error('Microsoft fetch error:', e)
    }
  }

  // Sort by date then by time
  events.sort((a, b) => {
    const d = a.date.localeCompare(b.date)
    if (d !== 0) return d
    if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime)
    if (a.isAllDay && !b.isAllDay) return -1
    if (!a.isAllDay && b.isAllDay) return 1
    return 0
  })

  return new Response(JSON.stringify(events), {
    headers: { 'Content-Type': 'application/json' },
  })
})

function formatTime(dt: string | null | undefined): string | null {
  if (!dt) return null
  const d = new Date(dt)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
