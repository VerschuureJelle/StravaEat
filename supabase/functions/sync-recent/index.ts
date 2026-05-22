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

const jsonErr = (msg: string, status: number) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonErr('Method not allowed', 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr('Unauthorized', 401)

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
  if (authError || !user) return jsonErr('Unauthorized', 401)

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
  if (!activitiesRes.ok) {
    if (activitiesRes.status === 429) {
      const retryAfter = activitiesRes.headers.get('Retry-After')
      const minutes = retryAfter ? Math.ceil(Number(retryAfter) / 60) : 15
      return jsonErr(`rate_limit:${minutes}`, 429)
    }
    const body = await activitiesRes.text().catch(() => '')
    return jsonErr(`Strava error ${activitiesRes.status}: ${body.slice(0, 200)}`, 502)
  }
  const stravaActivities = await activitiesRes.json()

  // Load zones, burn schema, sport settings, and already-processed activity IDs in parallel
  const stravaIds = stravaActivities.map((a: any) => String(a.id))
  const [{ data: zones }, { data: burnSchema }, { data: sportSettings }, { data: existingRows }] = await Promise.all([
    supabase.from('heart_rate_zones').select('*').eq('user_id', user.id).order('zone_number'),
    supabase.from('burn_schema_points').select('*').eq('user_id', user.id).order('hr_value'),
    supabase.from('sport_energy_settings').select('*').eq('user_id', user.id),
    supabase.from('activities').select('strava_activity_id').eq('user_id', user.id).in('strava_activity_id', stravaIds),
  ])

  // Activities already in the DB don't need stream/laps re-fetched
  const alreadySynced = new Set((existingRows ?? []).map((r: any) => r.strava_activity_id))

  const weightKg = profile.weight_kg ?? 0
  const results = []

  for (const act of stravaActivities) {
    // Skip stream/laps API calls for activities already stored
    if (alreadySynced.has(String(act.id))) {
      results.push({ strava_id: act.id, reason: 'already_synced' })
      continue
    }

    const [streamRes, lapsRes] = await Promise.all([
      fetch(`${STRAVA_API}/activities/${act.id}/streams?keys=heartrate,time&key_by_type=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`${STRAVA_API}/activities/${act.id}/laps`,
        { headers: { Authorization: `Bearer ${accessToken}` } }),
    ])

    // Rate limited mid-sync — stop early, report what was done
    if (streamRes.status === 429 || lapsRes.status === 429) {
      const retryAfter = (streamRes.headers.get('Retry-After') ?? lapsRes.headers.get('Retry-After'))
      const minutes = retryAfter ? Math.ceil(Number(retryAfter) / 60) : 15
      return jsonErr(`rate_limit:${minutes}`, 429)
    }

    const [streamBody, lapsData] = await Promise.all([
      streamRes.ok ? streamRes.json() : Promise.resolve(null),
      lapsRes.ok ? lapsRes.json() : Promise.resolve([]),
    ])

    const hrStream: number[] | null = streamBody?.heartrate?.data ?? null
    const timeStream: number[] | null = streamBody?.time?.data ?? null

    // Build per-sample durations so variable-rate recordings (e.g. Garmin Smart Recording)
    // are weighted correctly instead of always counting as 1 second each.
    function buildDurations(times: number[], totalSec: number): number[] {
      const n = times.length
      if (n === 0) return []
      if (n === 1) return [totalSec]
      return times.map((t, i) => {
        if (i < n - 1) return times[i + 1] - t
        const remaining = totalSec - t
        return remaining > 0 ? remaining : times[n - 1] - times[n - 2]
      })
    }

    const durations: number[] | null =
      timeStream && timeStream.length === hrStream?.length
        ? buildDurations(timeStream, act.elapsed_time)
        : null

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

    // Resolve zones for this sport: sport-specific zones take priority over 'default'
    const sportSpecificZones = zones.filter(z => (z.sport_type ?? 'default') === act.type)
    const activeZones = (sportSpecificZones.length >= 5 ? sportSpecificZones : zones.filter(z => (z.sport_type ?? 'default') === 'default'))
      .sort((a, b) => a.zone_number - b.zone_number)

    if (activeZones.length === 0) { results.push({ strava_id: act.id, reason: 'no_zones_configured' }); continue }

    // Zone lookup with open-ended boundaries: below Z1 → Z1, above Z5 → Z5
    function findZone(bpm: number) {
      const z = activeZones.find(z => bpm >= z.min_bpm && bpm < z.max_bpm)
      if (z) return z
      return bpm < activeZones[0].min_bpm ? activeZones[0] : activeZones[activeZones.length - 1]
    }

    // Calculate per zone
    const zoneStats: Record<string, { sec: number; kcal: number; fat: number; carb: number }> = {}

    for (let i = 0; i < hrStream.length; i++) {
      const bpm = hrStream[i]
      // Use time-stream delta if available; fall back to 1s per sample
      const dur = durations ? durations[i] : 1

      const zone = findZone(bpm)
      if (!zoneStats[zone.id]) zoneStats[zone.id] = { sec: 0, kcal: 0, fat: 0, carb: 0 }
      zoneStats[zone.id].sec += dur

      if (useCustom) {
        const rate = interpolateBurn(bpm, sportBurnPts as BurnPoint[])
        zoneStats[zone.id].kcal += rate.kcal * dur / 3600
        zoneStats[zone.id].fat  += rate.fat  * dur / 3600
        zoneStats[zone.id].carb += rate.carb * dur / 3600
      } else {
        zoneStats[zone.id].kcal += (zone.met_value * weightKg) * dur / 3600
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

  const newCount = results.filter(r => r.reason !== 'already_synced').length
  return new Response(JSON.stringify({ synced: newCount, results }), {
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

  if (!res.ok) {
    const errText = await res.text()
    console.error('Strava token refresh failed:', res.status, errText)
    throw new Error('strava_auth_expired')
  }

  const tokens = await res.json()
  await supabase.from('users').update({
    strava_access_token: tokens.access_token,
    strava_refresh_token: tokens.refresh_token,
    strava_token_expires_at: new Date(tokens.expires_at * 1000).toISOString(),
  }).eq('id', userId)
  return tokens.access_token
}
