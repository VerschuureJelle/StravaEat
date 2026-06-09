import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Population-prior mu values — must match periodCalibration.ts PERIOD_DEFAULTS
const DEFAULTS: Record<'minor' | 'medium', number> = {
  minor:  0.20,
  medium: 0.40,
}

const MAX_STEP = 0.10  // max 10% week-over-week increase in post-period ramp

function addDays(base: number, days: number) {
  return new Date(base + days * 86_400_000).toISOString().split('T')[0]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) throw new Error('No authorization header')

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) throw new Error('Unauthorized')

    const { action, severity } = await req.json()
    if (!['adjust', 'restore'].includes(action)) throw new Error('Invalid action')

    const now       = Date.now()
    const today     = addDays(now, 0)
    // Period window: current 7-day week
    const periodEnd      = addDays(now,  6)
    // Post-period windows
    const post1Start = addDays(now,  7); const post1End = addDays(now, 13)
    const post2Start = addDays(now, 14); const post2End = addDays(now, 20)
    // Full window for restore
    const restoreEnd = post2End

    // ── RESTORE ──────────────────────────────────────────────────────────────
    if (action === 'restore') {
      const { data: adjusted } = await supabase
        .from('planned_workouts')
        .select('id, orig_distance_m, orig_duration_min, orig_kcal, orig_target_hr, orig_zone_id')
        .eq('user_id', user.id)
        .eq('period_adjusted', true)
        .gte('planned_for', today)
        .lte('planned_for', restoreEnd)

      if (!adjusted?.length) {
        return new Response(
          JSON.stringify({ restored: 0 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      for (const w of adjusted) {
        await supabase.from('planned_workouts').update({
          distance_m:          w.orig_distance_m,
          target_duration_min: w.orig_duration_min,
          target_kcal:         w.orig_kcal,
          target_hr:           w.orig_target_hr,
          zone_id:             w.orig_zone_id ?? undefined,
          period_adjusted:          false,
          period_adjusted_severity: null,
          orig_distance_m:          null,
          orig_duration_min:        null,
          orig_kcal:                null,
          orig_target_hr:           null,
          orig_zone_id:             null,
        }).eq('id', w.id)
      }

      return new Response(
        JSON.stringify({ restored: adjusted.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── ADJUST ────────────────────────────────────────────────────────────────
    if (!['minor', 'medium', 'severe'].includes(severity)) throw new Error('Invalid severity')

    // Resolve calibrated mu (or population default)
    let mu = 0
    if (severity !== 'severe') {
      const { data: calib } = await supabase
        .from('period_calibration')
        .select('mu')
        .eq('user_id', user.id)
        .eq('severity', severity)
        .maybeSingle()
      mu = calib?.mu ?? DEFAULTS[severity as 'minor' | 'medium']
    }

    // Zone-drop map for medium severity (Z3→Z2, Z4→Z3, etc.)
    let lowerZoneMap: Record<string, string> = {}
    if (severity === 'medium') {
      const { data: zones } = await supabase
        .from('heart_rate_zones')
        .select('id, zone_number')
        .eq('user_id', user.id)
        .order('zone_number')
      if (zones) {
        const byNumber: Record<number, string> = {}
        for (const z of zones) byNumber[z.zone_number] = z.id
        for (const z of zones) {
          const lower = byNumber[z.zone_number - 1]
          if (lower) lowerZoneMap[z.id] = lower
        }
      }
    }

    // ── Recent comfortable level (last 14 days, up to 6 workouts) ────────────
    // This is the athlete's demonstrated fitness baseline — the period week
    // does not erase it, so post-period ramp starts here (× 0.90), not from
    // the adjusted period value.
    const prePeriodStart = addDays(now, -14)

    const { data: preWorkouts } = await supabase
      .from('planned_workouts')
      .select('distance_m, target_duration_min, target_kcal')
      .eq('user_id', user.id)
      .eq('period_adjusted', false)
      .gte('planned_for', prePeriodStart)
      .lt('planned_for', today)
      .not('distance_m', 'is', null)
      .order('planned_for', { ascending: false })
      .limit(6)

    let rcDist: number | null = null
    let rcDur:  number | null = null
    let rcKcal: number | null = null

    if (preWorkouts?.length) {
      const withDist  = preWorkouts.filter(w => w.distance_m          != null)
      const withDur   = preWorkouts.filter(w => w.target_duration_min  != null)
      const withKcal  = preWorkouts.filter(w => w.target_kcal          != null)
      if (withDist.length)  rcDist  = withDist.reduce((s, w)  => s + w.distance_m!,          0) / withDist.length
      if (withDur.length)   rcDur   = withDur.reduce((s, w)   => s + w.target_duration_min!,  0) / withDur.length
      if (withKcal.length)  rcKcal  = withKcal.reduce((s, w)  => s + w.target_kcal!,          0) / withKcal.length
    }

    // ── Adjust period week ────────────────────────────────────────────────────
    const { data: periodWorkouts } = await supabase
      .from('planned_workouts')
      .select('id, distance_m, target_duration_min, target_kcal, target_hr, zone_id, workout_description')
      .eq('user_id', user.id)
      .eq('period_adjusted', false)
      .gte('planned_for', today)
      .lte('planned_for', periodEnd)

    let adjustedCount = 0

    for (const w of periodWorkouts ?? []) {
      const orig = {
        period_adjusted:          true,
        period_adjusted_severity: severity,
        orig_distance_m:    w.distance_m,
        orig_duration_min:  w.target_duration_min,
        orig_kcal:          w.target_kcal,
        orig_target_hr:     w.target_hr,
        orig_zone_id:       w.zone_id ?? null,
      }

      if (severity === 'severe') {
        await supabase.from('planned_workouts').update({
          ...orig,
          distance_m:          null,
          target_duration_min: 20,
          target_kcal:         0,
          target_hr:           null,
          zone_id:             null,
          workout_description: '🔴 Rust & herstel — zachte stretching of yoga (20 min)\n\nOriginal workout postponed due to severe period symptoms.',
        }).eq('id', w.id)
      } else {
        const vf = 1 - mu        // volume factor, e.g. 0.60
        const hf = 1 - mu / 2   // HR factor,     e.g. 0.80
        await supabase.from('planned_workouts').update({
          ...orig,
          distance_m:          w.distance_m          != null ? Math.round(w.distance_m * vf) : null,
          target_duration_min: w.target_duration_min  != null ? Math.round(w.target_duration_min * vf * 10) / 10 : null,
          target_kcal:         w.target_kcal          != null ? Math.round(w.target_kcal * vf) : null,
          target_hr:           w.target_hr            != null ? Math.round(w.target_hr * hf) : null,
          zone_id:             lowerZoneMap[w.zone_id] ?? w.zone_id,
        }).eq('id', w.id)
      }
      adjustedCount++
    }

    // ── Adjust post-period weeks (minor / medium only) ────────────────────────
    // Return level = recent_comfortable × 0.90 (10% safety buffer)
    // Week K+1 cap: return_level  (= rc × 0.90)
    // Week K+2 cap: return_level × 1.10
    // Only cap a workout if its planned value exceeds the cap — otherwise leave it.
    if (severity !== 'severe' && rcDist != null) {
      const returnDist  = rcDist  * 0.90
      const returnDur   = rcDur   != null ? rcDur   * 0.90 : null
      const returnKcal  = rcKcal  != null ? rcKcal  * 0.90 : null

      const postWindows: [string, string, number][] = [
        [post1Start, post1End, 1],
        [post2Start, post2End, 2],
      ]

      for (const [wStart, wEnd, weekOffset] of postWindows) {
        const multiplier = Math.pow(1 + MAX_STEP, weekOffset - 1)  // 1.00 for week+1, 1.10 for week+2
        const capDist  = returnDist  * multiplier
        const capDur   = returnDur   != null ? returnDur   * multiplier : null
        const capKcal  = returnKcal  != null ? returnKcal  * multiplier : null

        const { data: postW } = await supabase
          .from('planned_workouts')
          .select('id, distance_m, target_duration_min, target_kcal, target_hr')
          .eq('user_id', user.id)
          .eq('period_adjusted', false)
          .gte('planned_for', wStart)
          .lte('planned_for', wEnd)

        for (const w of postW ?? []) {
          const distNeedsCap = w.distance_m          != null && w.distance_m          > capDist
          const durNeedsCap  = w.target_duration_min  != null && capDur  != null && w.target_duration_min  > capDur

          if (!distNeedsCap && !durNeedsCap) continue  // plan already conservative enough

          await supabase.from('planned_workouts').update({
            period_adjusted:          true,
            period_adjusted_severity: severity,
            orig_distance_m:    w.distance_m,
            orig_duration_min:  w.target_duration_min,
            orig_kcal:          w.target_kcal,
            orig_target_hr:     w.target_hr,
            distance_m:          w.distance_m          != null ? Math.round(Math.min(w.distance_m,         capDist)) : null,
            target_duration_min: w.target_duration_min  != null && capDur  != null
              ? Math.round(Math.min(w.target_duration_min, capDur)  * 10) / 10 : w.target_duration_min,
            target_kcal:         w.target_kcal          != null && capKcal != null
              ? Math.round(Math.min(w.target_kcal,        capKcal)) : w.target_kcal,
          }).eq('id', w.id)
          adjustedCount++
        }
      }
    }

    return new Response(
      JSON.stringify({ adjusted: adjustedCount, mu, severity }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
