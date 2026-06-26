// Coach sends a note or workout plan to an athlete.
// Inserts into coach_notes and sends an Expo push notification if the athlete has a push token.
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

    const {
      athlete_id, content, note_type = 'note',
      // Structured workout scheduling (optional)
      schedule_workout = false,
      planned_for = null,       // YYYY-MM-DD
      sport_type = null,
      target_kcal = null,
      target_duration_min = null,
    } = await req.json()
    if (!athlete_id) throw new Error('athlete_id is required')
    if (!content?.trim()) throw new Error('content is required')
    if (!['note', 'workout', 'nutrition'].includes(note_type)) throw new Error('invalid note_type')
    if (schedule_workout) {
      if (!planned_for || !/^\d{4}-\d{2}-\d{2}$/.test(planned_for)) throw new Error('planned_for (YYYY-MM-DD) is required when schedule_workout is true')
      if (!sport_type?.trim()) throw new Error('sport_type is required when schedule_workout is true')
    }

    // Verify active coach relationship
    const { data: rel } = await supabase
      .from('coach_athletes')
      .select('active')
      .eq('coach_id', user.id)
      .eq('athlete_id', athlete_id)
      .eq('active', true)
      .maybeSingle()

    if (!rel) throw new Error('Not connected to this athlete')

    // Optionally create a planned_workout for the athlete
    let planned_workout_id: string | null = null
    if (schedule_workout) {
      const { data: pw, error: pwErr } = await supabase
        .from('planned_workouts')
        .insert({
          user_id: athlete_id,
          sport_type: sport_type.trim(),
          target_kcal: target_kcal ?? 0,
          target_duration_min: target_duration_min ?? null,
          workout_description: content.trim(),
          planned_for,
          zone_id: null,
          target_hr: null,
          distance_m: null,
          is_key: false,
          status: null,
        })
        .select('id')
        .single()
      if (pwErr) throw pwErr
      planned_workout_id = pw.id
    }

    // Insert the note
    const { data: note, error: noteErr } = await supabase
      .from('coach_notes')
      .insert({
        coach_id: user.id,
        athlete_id,
        content: content.trim(),
        note_type,
        planned_workout_id,
      })
      .select()
      .single()

    if (noteErr) throw noteErr

    // Fetch coach name + athlete push token for notification
    const [coachRes, athleteRes] = await Promise.all([
      supabase.from('users').select('name').eq('id', user.id).single(),
      supabase.from('users').select('push_token').eq('id', athlete_id).single(),
    ])

    const coachName = coachRes.data?.name ?? 'Your coach'
    const pushToken: string | null = athleteRes.data?.push_token ?? null

    if (pushToken?.startsWith('ExponentPushToken[')) {
      const title = note_type === 'workout'
        ? `${coachName} assigned you a workout`
        : note_type === 'nutrition'
          ? `${coachName} left a nutrition tip`
          : `${coachName} left you a note`

      // Expo push API
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: pushToken,
          title,
          body: content.trim().slice(0, 120),
          data: { note_id: note.id, note_type },
        }),
      })
    }

    return new Response(
      JSON.stringify({ success: true, note_id: note.id, planned_workout_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
