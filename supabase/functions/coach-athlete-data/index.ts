// Returns aggregated athlete data for a coach.
// The coach must have an active relationship with the athlete.
// Only returns data the athlete has granted access to via coach_privacy_settings.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) throw new Error('Unauthorized')

    const { athlete_id } = await req.json()
    if (!athlete_id) throw new Error('athlete_id is required')

    // Verify active coach–athlete relationship and fetch privacy settings
    const { data: rel } = await supabase
      .from('coach_athletes')
      .select('active')
      .eq('coach_id', user.id)
      .eq('athlete_id', athlete_id)
      .eq('active', true)
      .maybeSingle()

    if (!rel) throw new Error('Not connected to this athlete')

    const { data: privacy } = await supabase
      .from('coach_privacy_settings')
      .select('*')
      .eq('coach_id', user.id)
      .eq('athlete_id', athlete_id)
      .single()

    // ── profile (always visible) ─────────────────────────────────────────────
    const { data: profile } = await supabase
      .from('users')
      .select('name, weight_kg, height_cm, age, sex, sport_history, max_hr, resting_hr, daily_kcal_target')
      .eq('id', athlete_id)
      .single()

    const { data: zones } = await supabase
      .from('heart_rate_zones')
      .select('zone_number, name, min_bpm, max_bpm, met_value')
      .eq('user_id', athlete_id)
      .order('zone_number')

    // ── activities (if granted) ──────────────────────────────────────────────
    let activities: any[] | null = null
    if (privacy?.see_activities) {
      const since = new Date()
      since.setDate(since.getDate() - 30)
      const { data } = await supabase
        .from('activities')
        .select('id, name, type, date, duration_sec, distance_m, elevation_gain_m, avg_hr, total_kcal')
        .eq('user_id', athlete_id)
        .gte('date', since.toISOString())
        .order('date', { ascending: false })
        .limit(50)
      activities = data ?? []
    }

    // ── nutrition (if granted) ───────────────────────────────────────────────
    let nutrition: any[] | null = null
    if (privacy?.see_nutrition) {
      const since = new Date()
      since.setDate(since.getDate() - 7)
      const sinceStr = since.toISOString().slice(0, 10)
      const { data } = await supabase
        .from('food_logs')
        .select('name, kcal, protein_g, logged_at')
        .eq('user_id', athlete_id)
        .gte('logged_at', sinceStr)
        .order('logged_at', { ascending: false })
      nutrition = data ?? []
    }

    // ── meals (if granted) ───────────────────────────────────────────────────
    let meal_templates: any[] | null = null
    if (privacy?.see_meals) {
      const { data } = await supabase
        .from('meal_templates')
        .select('meal_index, name, scheduled_time')
        .eq('user_id', athlete_id)
        .order('meal_index')
      meal_templates = data ?? []
    }

    // ── coach notes for this athlete (always visible to coach) ───────────────
    const { data: notes } = await supabase
      .from('coach_notes')
      .select('id, content, note_type, created_at, planned_workout_id')
      .eq('coach_id', user.id)
      .eq('athlete_id', athlete_id)
      .order('created_at', { ascending: false })
      .limit(20)

    // ── scheduled workouts this coach has assigned (via coach_notes linkage) ──
    const noteWithWorkout = (notes ?? []).filter(n => n.planned_workout_id)
    const workoutIds = noteWithWorkout.map(n => n.planned_workout_id)
    let scheduled_workouts: any[] = []
    if (workoutIds.length > 0) {
      const { data: pwData } = await supabase
        .from('planned_workouts')
        .select('id, sport_type, target_kcal, target_duration_min, workout_description, planned_for, status')
        .in('id', workoutIds)
        .order('planned_for', { ascending: false })
      scheduled_workouts = pwData ?? []
    }

    return new Response(
      JSON.stringify({
        profile,
        zones: zones ?? [],
        privacy: {
          see_activities: privacy?.see_activities ?? false,
          see_nutrition: privacy?.see_nutrition ?? false,
          see_meals: privacy?.see_meals ?? false,
          see_weight: privacy?.see_weight ?? false,
        },
        activities,
        nutrition,
        meal_templates,
        notes: notes ?? [],
        scheduled_workouts,
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
