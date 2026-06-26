import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STRAVA_API = 'https://www.strava.com/api/v3'

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

    const { strava_activity_id } = await req.json()
    if (!strava_activity_id) throw new Error('Missing strava_activity_id')

    // Verify activity belongs to this user and get its stored duration
    const { data: activity } = await supabase
      .from('activities')
      .select('id, duration_sec')
      .eq('user_id', user.id)
      .eq('strava_activity_id', String(strava_activity_id))
      .single()
    if (!activity) throw new Error('Activity not found')

    const { data: profile } = await supabase
      .from('users')
      .select('strava_access_token, strava_refresh_token, strava_token_expires_at')
      .eq('id', user.id)
      .single()
    if (!profile?.strava_access_token) throw new Error('Strava not connected')

    const accessToken = await getValidStravaToken(supabase, user.id, profile)

    const streamRes = await fetch(
      `${STRAVA_API}/activities/${strava_activity_id}/streams?keys=heartrate,time&key_by_type=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!streamRes.ok) throw new Error(`Strava API error: ${streamRes.status}`)

    const streamBody = await streamRes.json()
    const stream: number[] = streamBody?.heartrate?.data ?? []
    const timeStream: number[] = streamBody?.time?.data ?? []

    const hasTimeStream = timeStream.length === stream.length && stream.length >= 2
    const last_timestamp: number | null = hasTimeStream ? timeStream[timeStream.length - 1] : null

    const min_hr = stream.length > 0 ? Math.min(...stream) : null
    const max_hr = stream.length > 0 ? Math.max(...stream) : null

    let avg_hr: number | null = null
    if (stream.length > 0) {
      if (hasTimeStream) {
        let weightedSum = 0, totalWeight = 0
        for (let i = 0; i < stream.length; i++) {
          const dur = i < stream.length - 1
            ? timeStream[i + 1] - timeStream[i]
            : timeStream[i] - timeStream[i - 1]
          weightedSum += stream[i] * dur
          totalWeight += dur
        }
        avg_hr = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : Math.round(stream.reduce((s, v) => s + v, 0) / stream.length)
      } else {
        avg_hr = Math.round(stream.reduce((s, v) => s + v, 0) / stream.length)
      }
    }

    const avg_interval_sec = hasTimeStream
      ? Math.round(((timeStream[timeStream.length - 1] - timeStream[0]) / (stream.length - 1)) * 10) / 10
      : null

    return new Response(
      JSON.stringify({
        sample_count: stream.length,
        expected_samples: activity.duration_sec,
        last_timestamp,
        avg_interval_sec,
        min_hr,
        max_hr,
        avg_hr,
        stream,
        time_stream: hasTimeStream ? timeStream : undefined,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

async function getValidStravaToken(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  profile: { strava_access_token: string; strava_refresh_token: string; strava_token_expires_at: string },
): Promise<string> {
  const expiresAt = new Date(profile.strava_token_expires_at).getTime()
  if (Date.now() < expiresAt - 60_000) return profile.strava_access_token

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: Deno.env.get('STRAVA_CLIENT_ID'),
      client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: profile.strava_refresh_token,
    }),
  })
  if (!res.ok) throw new Error('strava_auth_expired')

  const tokens = await res.json()
  await supabase.from('users').update({
    strava_access_token: tokens.access_token,
    strava_refresh_token: tokens.refresh_token,
    strava_token_expires_at: new Date(tokens.expires_at * 1000).toISOString(),
  }).eq('id', userId)
  return tokens.access_token
}
