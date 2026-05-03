import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STRAVA_API = 'https://www.strava.com/api/v3'

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Verify the calling user
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401 })

  // Load user profile (need weight + zones)
  const { data: profile } = await supabase
    .from('users')
    .select('weight_kg, strava_access_token, strava_refresh_token, strava_token_expires_at')
    .eq('id', user.id)
    .single()

  if (!profile) return new Response('Profile not found', { status: 404 })
  if (!profile.weight_kg) return new Response('Weight not set in profile', { status: 422 })

  const { stravaActivityId } = await req.json()
  if (!stravaActivityId) return new Response('stravaActivityId required', { status: 400 })

  // Refresh Strava token if expired
  const accessToken = await getValidStravaToken(supabase, user.id, profile)

  // Fetch activity metadata from Strava
  const activityRes = await fetch(`${STRAVA_API}/activities/${stravaActivityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!activityRes.ok) return new Response('Strava activity fetch failed', { status: 502 })
  const stravaActivity = await activityRes.json()

  // Fetch HR stream from Strava
  const streamRes = await fetch(
    `${STRAVA_API}/activities/${stravaActivityId}/streams?keys=heartrate&key_by_type=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const streamData = streamRes.ok ? await streamRes.json() : null
  const hrStream: number[] | null = streamData?.heartrate?.data ?? null

  // Load user's current HR zones (at time of sync — non-retroactive by design)
  const { data: zones } = await supabase
    .from('heart_rate_zones')
    .select('*')
    .eq('user_id', user.id)
    .order('zone_number')

  // Upsert activity
  const { data: activity, error: activityError } = await supabase
    .from('activities')
    .upsert({
      user_id: user.id,
      strava_activity_id: String(stravaActivityId),
      name: stravaActivity.name,
      type: stravaActivity.type,
      date: stravaActivity.start_date,
      duration_sec: stravaActivity.elapsed_time,
      avg_hr: stravaActivity.average_heartrate ?? null,
      max_hr: stravaActivity.max_heartrate ?? null,
      total_kcal: null, // set below
    }, { onConflict: 'user_id,strava_activity_id' })
    .select()
    .single()

  if (activityError || !activity) {
    return new Response(`Activity upsert failed: ${activityError?.message}`, { status: 500 })
  }

  // If no HR data, return early — total_kcal stays null
  if (!hrStream || !zones || zones.length === 0) {
    return new Response(JSON.stringify({ activity_id: activity.id, kcal: null }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Calculate time per zone (each HR data point = 1 second)
  const timePerZone: Record<string, number> = {}
  for (const bpm of hrStream) {
    const zone = zones.find((z) => bpm >= z.min_bpm && bpm < z.max_bpm)
    if (zone) timePerZone[zone.id] = (timePerZone[zone.id] ?? 0) + 1
  }

  // Calculate kcal per zone and build splits
  const splits = Object.entries(timePerZone)
    .filter(([, sec]) => sec > 0)
    .map(([zoneId, sec]) => {
      const zone = zones.find((z) => z.id === zoneId)!
      const kcal = zone.met_value * profile.weight_kg * (sec / 3600)
      return { activity_id: activity.id, zone_id: zoneId, time_in_zone_sec: sec, kcal_in_zone: kcal }
    })

  const totalKcal = splits.reduce((sum, s) => sum + s.kcal_in_zone, 0)

  // Delete old splits for this activity (handles re-sync)
  await supabase.from('activity_zone_splits').delete().eq('activity_id', activity.id)

  // Insert new splits
  if (splits.length > 0) {
    await supabase.from('activity_zone_splits').insert(splits)
  }

  // Update total_kcal on activity
  await supabase
    .from('activities')
    .update({ total_kcal: totalKcal })
    .eq('id', activity.id)

  return new Response(
    JSON.stringify({ activity_id: activity.id, kcal: Math.round(totalKcal), zones: splits.length }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})

async function getValidStravaToken(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  profile: { strava_access_token: string; strava_refresh_token: string; strava_token_expires_at: string },
): Promise<string> {
  const expiresAt = new Date(profile.strava_token_expires_at).getTime()
  const now = Date.now()

  // Return existing token if still valid (with 60s buffer)
  if (expiresAt - now > 60_000) return profile.strava_access_token

  // Refresh expired token
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

  const tokens = await res.json()

  await supabase.from('users').update({
    strava_access_token: tokens.access_token,
    strava_refresh_token: tokens.refresh_token,
    strava_token_expires_at: new Date(tokens.expires_at * 1000).toISOString(),
  }).eq('id', userId)

  return tokens.access_token
}
