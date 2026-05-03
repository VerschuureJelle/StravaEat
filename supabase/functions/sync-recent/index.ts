import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STRAVA_API = 'https://www.strava.com/api/v3'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401 })

  const { data: profile } = await supabase
    .from('users')
    .select('weight_kg, strava_access_token, strava_refresh_token, strava_token_expires_at')
    .eq('id', user.id)
    .single()

  if (!profile?.strava_access_token) {
    return new Response(JSON.stringify({ error: 'strava_not_connected' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!profile.weight_kg) {
    return new Response(JSON.stringify({ error: 'weight_not_set' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const accessToken = await getValidStravaToken(supabase, user.id, profile)

  // Fetch last 20 activities from Strava
  const activitiesRes = await fetch(
    `${STRAVA_API}/athlete/activities?per_page=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!activitiesRes.ok) return new Response('Strava activities fetch failed', { status: 502 })
  const stravaActivities = await activitiesRes.json()

  const { data: zones } = await supabase
    .from('heart_rate_zones')
    .select('*')
    .eq('user_id', user.id)
    .order('zone_number')

  const results = []

  for (const act of stravaActivities) {
    // Always attempt to fetch the HR stream — has_heartrate in the summary
    // list is unreliable and can be false even when HR data exists
    const streamRes = await fetch(
      `${STRAVA_API}/activities/${act.id}/streams?keys=heartrate&key_by_type=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const hrStream: number[] | null = streamRes.ok
      ? ((await streamRes.json())?.heartrate?.data ?? null)
      : null

    const activity = await upsertActivity(supabase, user.id, act, null)
    if (!activity || !hrStream || !zones?.length) {
      results.push({ strava_id: act.id, kcal: null, reason: 'no_zones_or_stream' })
      continue
    }

    // Calculate time per zone (each data point = 1 second)
    const timePerZone: Record<string, number> = {}
    for (const bpm of hrStream) {
      const zone = zones.find((z) => bpm >= z.min_bpm && bpm < z.max_bpm)
      if (zone) timePerZone[zone.id] = (timePerZone[zone.id] ?? 0) + 1
    }

    const splits = Object.entries(timePerZone)
      .filter(([, sec]) => sec > 0)
      .map(([zoneId, sec]) => {
        const zone = zones.find((z) => z.id === zoneId)!
        return {
          activity_id: activity.id,
          zone_id: zoneId,
          time_in_zone_sec: sec,
          kcal_in_zone: zone.met_value * profile.weight_kg * (sec / 3600),
        }
      })

    const totalKcal = splits.reduce((sum, s) => sum + s.kcal_in_zone, 0)

    await supabase.from('activity_zone_splits').delete().eq('activity_id', activity.id)
    if (splits.length > 0) await supabase.from('activity_zone_splits').insert(splits)
    await supabase.from('activities').update({ total_kcal: totalKcal }).eq('id', activity.id)

    results.push({ strava_id: act.id, kcal: Math.round(totalKcal) })
  }

  return new Response(JSON.stringify({ synced: results.length, results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

async function upsertActivity(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  act: any,
  totalKcal: number | null,
) {
  const { data } = await supabase
    .from('activities')
    .upsert({
      user_id: userId,
      strava_activity_id: String(act.id),
      name: act.name,
      type: act.type,
      date: act.start_date,
      duration_sec: act.elapsed_time,
      avg_hr: act.average_heartrate ?? null,
      max_hr: act.max_heartrate ?? null,
      total_kcal: totalKcal,
    }, { onConflict: 'user_id,strava_activity_id' })
    .select()
    .single()
  return data
}

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

  const tokens = await res.json()
  await supabase.from('users').update({
    strava_access_token: tokens.access_token,
    strava_refresh_token: tokens.refresh_token,
    strava_token_expires_at: new Date(tokens.expires_at * 1000).toISOString(),
  }).eq('id', userId)

  return tokens.access_token
}
