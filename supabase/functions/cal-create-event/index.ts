import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidGoogleToken, getValidMicrosoftToken } from '../_shared/calendarTokens.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) throw new Error('No authorization header')

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) throw new Error('Unauthorized')

    const body = await req.json()
    const { title, date, startTime, endTime, isAllDay, notes, providers } = body as {
      title: string
      date: string       // YYYY-MM-DD
      startTime?: string // HH:MM
      endTime?: string   // HH:MM
      isAllDay: boolean
      notes?: string
      providers: ('google' | 'microsoft')[]
    }

    if (!title?.trim() || !date) throw new Error('title and date are required')

    const { data: profile } = await supabase
      .from('users')
      .select('google_cal_access_token, google_cal_refresh_token, google_cal_token_expires_at, google_cal_id, microsoft_cal_access_token, microsoft_cal_refresh_token, microsoft_cal_token_expires_at')
      .eq('id', user.id)
      .single()

    const results: Record<string, string> = {}

    // ── Google Calendar ────────────────────────────────────────────────────────
    if (providers.includes('google') && profile?.google_cal_refresh_token) {
      try {
        const gToken = await getValidGoogleToken(supabase, user.id, profile as any)
        const calId = encodeURIComponent((profile as any).google_cal_id ?? 'primary')
        const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${gToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildGoogleEvent({ title, date, startTime, endTime, isAllDay, notes })),
        })
        results.google = r.ok ? 'ok' : `error_${r.status}`
      } catch (e) {
        results.google = e instanceof Error ? e.message : 'error'
      }
    } else if (providers.includes('google')) {
      results.google = 'not_connected'
    }

    // ── Microsoft Graph ────────────────────────────────────────────────────────
    if (providers.includes('microsoft') && profile?.microsoft_cal_refresh_token) {
      try {
        const mToken = await getValidMicrosoftToken(supabase, user.id, profile as any)
        const r = await fetch('https://graph.microsoft.com/v1.0/me/events', {
          method: 'POST',
          headers: { Authorization: `Bearer ${mToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildMicrosoftEvent({ title, date, startTime, endTime, isAllDay, notes })),
        })
        results.microsoft = r.ok ? 'ok' : `error_${r.status}`
      } catch (e) {
        results.microsoft = e instanceof Error ? e.message : 'error'
      }
    } else if (providers.includes('microsoft')) {
      results.microsoft = 'not_connected'
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

interface EventInput {
  title: string
  date: string
  startTime?: string
  endTime?: string
  isAllDay: boolean
  notes?: string
}

function buildGoogleEvent(e: EventInput) {
  if (e.isAllDay) {
    return {
      summary: e.title,
      description: e.notes ?? '',
      start: { date: e.date },
      end: { date: e.date },
    }
  }
  const tz = 'UTC'
  return {
    summary: e.title,
    description: e.notes ?? '',
    start: { dateTime: `${e.date}T${e.startTime ?? '09:00'}:00`, timeZone: tz },
    end:   { dateTime: `${e.date}T${e.endTime   ?? '10:00'}:00`, timeZone: tz },
  }
}

function buildMicrosoftEvent(e: EventInput) {
  if (e.isAllDay) {
    return {
      subject: e.title,
      body: { contentType: 'text', content: e.notes ?? '' },
      isAllDay: true,
      start: { dateTime: `${e.date}T00:00:00`, timeZone: 'UTC' },
      end:   { dateTime: `${e.date}T00:00:00`, timeZone: 'UTC' },
    }
  }
  return {
    subject: e.title,
    body: { contentType: 'text', content: e.notes ?? '' },
    isAllDay: false,
    start: { dateTime: `${e.date}T${e.startTime ?? '09:00'}:00`, timeZone: 'UTC' },
    end:   { dateTime: `${e.date}T${e.endTime   ?? '10:00'}:00`, timeZone: 'UTC' },
  }
}
