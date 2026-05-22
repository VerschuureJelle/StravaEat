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

    const { event_id, provider, title, date, startTime, endTime, isAllDay, notes } = await req.json() as {
      event_id: string          // raw provider event ID (no prefix)
      provider: 'google' | 'microsoft'
      title: string
      date: string              // YYYY-MM-DD
      startTime?: string        // HH:MM
      endTime?: string          // HH:MM
      isAllDay: boolean
      notes?: string
    }

    if (!event_id || !provider || !title?.trim() || !date) {
      throw new Error('event_id, provider, title and date are required')
    }

    const { data: profile } = await supabase
      .from('users')
      .select('google_cal_access_token, google_cal_refresh_token, google_cal_token_expires_at, google_cal_id, microsoft_cal_access_token, microsoft_cal_refresh_token, microsoft_cal_token_expires_at')
      .eq('id', user.id)
      .single()

    if (!profile) throw new Error('Profile not found')

    if (provider === 'google') {
      if (!profile.google_cal_refresh_token) throw new Error('Google not connected')
      const gToken = await getValidGoogleToken(supabase, user.id, profile as any)
      const calId = encodeURIComponent((profile as any).google_cal_id ?? 'primary')
      const r = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(event_id)}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${gToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildGoogleEvent({ title, date, startTime, endTime, isAllDay, notes })),
        },
      )
      if (!r.ok) throw new Error(`Google update failed: ${r.status}`)
    } else if (provider === 'microsoft') {
      if (!profile.microsoft_cal_refresh_token) throw new Error('Microsoft not connected')
      const mToken = await getValidMicrosoftToken(supabase, user.id, profile as any)
      const r = await fetch(
        `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(event_id)}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${mToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildMicrosoftEvent({ title, date, startTime, endTime, isAllDay, notes })),
        },
      )
      if (!r.ok) throw new Error(`Microsoft update failed: ${r.status}`)
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

interface EventInput { title: string; date: string; startTime?: string; endTime?: string; isAllDay: boolean; notes?: string }

function buildGoogleEvent(e: EventInput) {
  if (e.isAllDay) {
    return { summary: e.title, description: e.notes ?? '', start: { date: e.date }, end: { date: e.date } }
  }
  return {
    summary: e.title,
    description: e.notes ?? '',
    start: { dateTime: `${e.date}T${e.startTime ?? '09:00'}:00`, timeZone: 'UTC' },
    end:   { dateTime: `${e.date}T${e.endTime   ?? '10:00'}:00`, timeZone: 'UTC' },
  }
}

function buildMicrosoftEvent(e: EventInput) {
  if (e.isAllDay) {
    return {
      subject: e.title, body: { contentType: 'text', content: e.notes ?? '' },
      isAllDay: true,
      start: { dateTime: `${e.date}T00:00:00`, timeZone: 'UTC' },
      end:   { dateTime: `${e.date}T00:00:00`, timeZone: 'UTC' },
    }
  }
  return {
    subject: e.title, body: { contentType: 'text', content: e.notes ?? '' },
    isAllDay: false,
    start: { dateTime: `${e.date}T${e.startTime ?? '09:00'}:00`, timeZone: 'UTC' },
    end:   { dateTime: `${e.date}T${e.endTime   ?? '10:00'}:00`, timeZone: 'UTC' },
  }
}
