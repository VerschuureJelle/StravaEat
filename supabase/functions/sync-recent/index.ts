import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STRAVA_API = 'https://www.strava.com/api/v3'

type BurnPoint = {
  hr_value: number
  kcal_per_hour: number
  fat_g_per_hour: number | null
  carb_g_per_hour: number | null
}

function lerp(a: number, b: number, t: number) { return a + t * (b - a) }

// Linear interpolation (and extrapolation at edges) — same algorithm both ways
function interpolateBurn(hr: number, pts: BurnPoint[]): { kcal: number; fat: number; carb: number } {
  if (pts.length === 0) return { kcal: 0, fat: 0, carb: 0 }
  const p0 = pts[0], pN = pts[pts.length - 1]
  if (hr <= p0.hr_value) return { kcal: p0.kcal_per_hour, fat: p0.fat_g_per_hour ?? 0, carb: p0.carb_g_per_hour ?? 0 }
  if (hr >= pN.hr_value) return { kcal: pN.kcal_per_hour, fat: pN.fat_g_per_hour ?? 0, carb: pN.carb_g_per_hour ?? 0 }
  for (let i = 0; i < pts.length - 1; i++) {
    const lo = pts[i], hi = pts[i + 1]
    if (hr >= lo.hr_value && hr <= hi.hr_value) {
      const t = (hr - lo.hr_value) / (hi.hr_value - lo.hr_value)
      return {
        kcal: lerp(lo.kcal_per_hour, hi.kcal_per_hour, t),
        fat:  lerp(lo.fat_g_per_hour  ?? 0, hi.fat_g_per_hour  ?? 0, t),
        carb: lerp(lo.carb_g_per_hour ?? 0, hi.carb_g_per_hour ?? 0, t),
      }
    }
  }
  return { kcal: 0, fat: 0, carb: 0 }
}

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
    .select('strava_access_token, strava_refresh_token, strava_token_expires_at, weight_kg')
    .eq('id', user.id)
    .single()

  if (!profile?.strava_access_token) {
    return new Response(JSON.stringify({ error: 'strava_not_connected' }), {
      status: 422, headers: { 'Content-Type': 'application/json' },
    })
  }

  const accessToken = await getValidStravaToken(supabase, user.id, profile)

  const activitiesRes = await fetch(
    `${STRAVA_API}/athlete/activities?per_page=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!activitiesRes.ok) return new Response('Strava activities fetch failed', { status: 502 })
  const stravaActivities = await activitiesRes.json()

  // Load zones, burn schema and sport energy settings once
  const [{ data: zones }, { data: burnSchema }, { data: sportSettings }] = await Promise.all([
    supabase.from('heart_rate_zones').select('*').eq('user_id', user.id).order('zone_number'),
    supabase.from('burn_schema_points').select('*').eq('user_id', user.id).order('hr_value'),
    supabase.from('sport_energy_settings').select('*').eq('user_id', user.id),
  ])

  const weightKg = profile.weight_kg ?? 0
  const results = []

  for (const act of stravaActivities) {
    const [streamRes, lapsRes] = await Promise.all([
      fetch(`${STRAVA_API}/activities/${act.id}/streams?keys=heartrate&key_by_type=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`${STRAVA_API}/activities/${act.id}/laps`,
        { headers: { Authorization: `Bearer ${accessToken}` } }),
    ])

    const [streamBody, lapsData] = await Promise.all([
      streamRes.ok ? streamRes.json() : Promise.resolve(null),
      lapsRes.ok ? lapsRes.json() : Promise.resolve([]),
    ])

    const hrStream: number[] | null = streamBody?.heartrate?.data ?? null

    const { data: activity } = await supabase
      .from('activities')
      .upsert({
        user_id: user.id,
        strava_activity_id: String(act.id),
        name: act.name,
        type: act.type,
        date: act.start_date,
        duration_sec: act.elapsed_time,
        avg_hr: act.average_heartrate != null ? Math.round(act.average_heartrate) : null,
        max_hr: act.max_heartrate != null ? Math.round(act.max_heartrate) : null,
        summary_polyline: act.map?.summary_polyline ?? null,
        distance_m: act.distance ?? null,
        elevation_gain_m: act.total_elevation_gain ?? null,
        total_kcal: null, total_fat_g: null, total_carb_g: null,
      }, { onConflict: 'strava_activity_id' })
      .select()
      .single()

    if (!activity) { results.push({ strava_id: act.id, reason: 'db_upsert_failed' }); continue }

    // Laps
    await supabase.from('activity_laps').delete().eq('activity_id', activity.id)
    if (Array.isArray(lapsData) && lapsData.length > 0) {
      await supabase.from('activity_laps').insert(
        lapsData.map((lap: any) => ({
          activity_id: activity.id,
          strava_lap_id: lap.id,
          lap_index: lap.lap_index,
          name: lap.name,
          elapsed_time_sec: lap.elapsed_time,
          distance_m: lap.distance ?? null,
          avg_speed_ms: lap.average_speed ?? null,
          avg_hr: lap.average_heartrate != null ? Math.round(lap.average_heartrate) : null,
          max_hr: lap.max_heartrate != null ? Math.round(lap.max_heartrate) : null,
          avg_watts: lap.average_watts ?? null,
          total_elevation_gain: lap.total_elevation_gain ?? null,
        })),
      )
    }

    if (!hrStream || hrStream.length === 0) { results.push({ strava_id: act.id, reason: 'no_hr_stream' }); continue }
    if (!zones || zones.length === 0) { results.push({ strava_id: act.id, reason: 'no_zones_configured' }); continue }

    // Determine energy method for this sport
    const sportSetting = sportSettings?.find(s => s.sport_type === act.type)
    const method = sportSetting?.method ?? 'standard'
    // If linked to another sport, use that sport's burn schema
    const effectiveSport = sportSetting?.linked_sport_type ?? act.type

    // Sport-specific burn points (need ≥ 2 for custom)
    const sportBurnPts = (burnSchema ?? []).filter(p => p.sport_type === effectiveSport)
    const useCustom = method === 'custom' && sportBurnPts.length >= 2

    // Calculate per zone
    const zoneStats: Record<string, { sec: number; kcal: number; fat: number; carb: number }> = {}

    for (const bpm of hrStream) {
      const zone = zones.find(z => bpm >= z.min_bpm && bpm < z.max_bpm)
      if (!zone) continue
      if (!zoneStats[zone.id]) zoneStats[zone.id] = { sec: 0, kcal: 0, fat: 0, carb: 0 }
      zoneStats[zone.id].sec += 1

      if (useCustom) {
        // Interpolate burn schema (per_hour → per_second ÷ 3600)
        const rate = interpolateBurn(bpm, sportBurnPts as BurnPoint[])
        zoneStats[zone.id].kcal += rate.kcal / 3600
        zoneStats[zone.id].fat  += rate.fat  / 3600
        zoneStats[zone.id].carb += rate.carb / 3600
      } else {
        // Standard: MET × weight × hours
        zoneStats[zone.id].kcal += (zone.met_value * weightKg) / 3600
      }
    }

    const totalKcal = Object.values(zoneStats).reduce((s, z) => s + z.kcal, 0)
    const totalFat  = Object.values(zoneStats).reduce((s, z) => s + z.fat,  0)
    const totalCarb = Object.values(zoneStats).reduce((s, z) => s + z.carb, 0)

    if (totalKcal > 0) {
      await supabase.from('activities').update({
        total_kcal:  totalKcal,
        total_fat_g:  useCustom && totalFat  > 0 ? totalFat  : null,
        total_carb_g: useCustom && totalCarb > 0 ? totalCarb : null,
      }).eq('id', activity.id)
    }

    const splits = Object.entries(zoneStats)
      .filter(([, s]) => s.sec > 0)
      .map(([zoneId, s]) => ({
        activity_id: activity.id,
        zone_id: zoneId,
        time_in_zone_sec: s.sec,
        kcal_in_zone: s.kcal,
        fat_g_in_zone:  useCustom && s.fat  > 0 ? s.fat  : null,
        carb_g_in_zone: useCustom && s.carb > 0 ? s.carb : null,
      }))

    await supabase.from('activity_zone_splits').delete().eq('activity_id', activity.id)
    if (splits.length > 0) await supabase.from('activity_zone_splits').insert(splits)

    results.push({
      strava_id: act.id,
      method,
      zones_found: splits.length,
      total_kcal: Math.round(totalKcal),
    })
  }

  // Auto-pair synced activities with pending training program sessions
  try {
    const { data: programs } = await supabase
      .from('training_programs')
      .select('id')
      .eq('user_id', user.id)
      .eq('active', true)

    if (programs && programs.length > 0) {
      const programIds = programs.map((p: any) => p.id)

      const { data: pendingSessions } = await supabase
        .from('training_program_sessions')
        .select('id, session_name')
        .in('program_id', programIds)
        .eq('completed', false)

      if (pendingSessions && pendingSessions.length > 0) {
        for (const act of stravaActivities) {
          const actName = (act.name as string).toLowerCase().trim()
          for (const session of pendingSessions as { id: string; session_name: string }[]) {
            const sessName = session.session_name.toLowerCase().trim()
            if (actName === sessName || actName.includes(sessName)) {
              await supabase
                .from('training_program_sessions')
                .update({
                  completed: true,
                  completed_at: act.start_date,
                  strava_activity_id: String(act.id),
                })
                .eq('id', session.id)
              break
            }
          }
        }
      }
    }
  } catch (_) {
    // Activity pairing is non-critical; ignore errors
  }

  return new Response(JSON.stringify({ synced: results.length, results }), {
    headers: { 'Content-Type': 'application/json' },
  })
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
  const tokens = await res.json()
  await supabase.from('users').update({
    strava_access_token: tokens.access_token,
    strava_refresh_token: tokens.refresh_token,
    strava_token_expires_at: new Date(tokens.expires_at * 1000).toISOString(),
  }).eq('id', userId)
  return tokens.access_token
}
