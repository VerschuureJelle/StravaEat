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

    const { event_id, provider } = await req.json() as {
      event_id: string          // raw provider event ID (no prefix)
      provider: 'google' | 'microsoft'
    }

    if (!event_id || !provider) throw new Error('event_id and provider are required')

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
        { method: 'DELETE', headers: { Authorization: `Bearer ${gToken}` } },
      )
      if (!r.ok && r.status !== 404 && r.status !== 410) {
        throw new Error(`Google delete failed: ${r.status}`)
      }
    } else if (provider === 'microsoft') {
      if (!profile.microsoft_cal_refresh_token) throw new Error('Microsoft not connected')
      const mToken = await getValidMicrosoftToken(supabase, user.id, profile as any)
      const r = await fetch(
        `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(event_id)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${mToken}` } },
      )
      if (!r.ok && r.status !== 404) {
        throw new Error(`Microsoft delete failed: ${r.status}`)
      }
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
