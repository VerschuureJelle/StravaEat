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

    const { athlete_id, content, note_type = 'note', planned_workout_id = null } = await req.json()
    if (!athlete_id) throw new Error('athlete_id is required')
    if (!content?.trim()) throw new Error('content is required')
    if (!['note', 'workout', 'nutrition'].includes(note_type)) throw new Error('invalid note_type')

    // Verify active coach relationship
    const { data: rel } = await supabase
      .from('coach_athletes')
      .select('active')
      .eq('coach_id', user.id)
      .eq('athlete_id', athlete_id)
      .eq('active', true)
      .maybeSingle()

    if (!rel) throw new Error('Not connected to this athlete')

    // Insert the note
    const { data: note, error: noteErr } = await supabase
      .from('coach_notes')
      .insert({
        coach_id: user.id,
        athlete_id,
        content: content.trim(),
        note_type,
        planned_workout_id: planned_workout_id ?? null,
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
      JSON.stringify({ success: true, note_id: note.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
