import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function randomCode(len = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous chars (0/O, 1/I)
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
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

    const body = await req.json()
    const action: string = body.action

    // ── generate ────────────────────────────────────────────────────────────
    if (action === 'generate') {
      // Revoke any existing pending invite for this athlete
      await supabase
        .from('coach_invites')
        .update({ status: 'revoked' })
        .eq('athlete_id', user.id)
        .eq('status', 'pending')

      // Generate a unique code (retry on collision)
      let code = ''
      for (let attempt = 0; attempt < 5; attempt++) {
        code = randomCode()
        const { data: existing } = await supabase
          .from('coach_invites')
          .select('id')
          .eq('code', code)
          .maybeSingle()
        if (!existing) break
      }

      const { data: invite, error } = await supabase
        .from('coach_invites')
        .insert({ athlete_id: user.id, code })
        .select()
        .single()

      if (error) throw error

      return new Response(
        JSON.stringify({ code: invite.code, expires_at: invite.expires_at }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── accept ───────────────────────────────────────────────────────────────
    if (action === 'accept') {
      const code: string = (body.code ?? '').trim().toUpperCase()
      if (!code) throw new Error('code is required')

      const { data: invite, error: inviteErr } = await supabase
        .from('coach_invites')
        .select('*')
        .eq('code', code)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()

      if (inviteErr) throw inviteErr
      if (!invite) throw new Error('Invalid or expired invite code')
      if (invite.athlete_id === user.id) throw new Error('You cannot be your own coach')

      // Check not already linked
      const { data: existing } = await supabase
        .from('coach_athletes')
        .select('id')
        .eq('coach_id', user.id)
        .eq('athlete_id', invite.athlete_id)
        .maybeSingle()

      if (!existing) {
        // Create the relationship
        await supabase.from('coach_athletes').insert({
          coach_id: user.id,
          athlete_id: invite.athlete_id,
          active: true,
        })

        // Create default privacy settings (activities on, everything else off)
        await supabase.from('coach_privacy_settings').upsert(
          {
            athlete_id: invite.athlete_id,
            coach_id: user.id,
            see_activities: true,
            see_nutrition: false,
            see_meals: false,
            see_weight: false,
          },
          { onConflict: 'athlete_id,coach_id' },
        )
      } else {
        // Reactivate if previously disconnected
        await supabase
          .from('coach_athletes')
          .update({ active: true })
          .eq('coach_id', user.id)
          .eq('athlete_id', invite.athlete_id)
      }

      // Mark invite accepted
      await supabase
        .from('coach_invites')
        .update({ status: 'accepted', coach_id: user.id })
        .eq('id', invite.id)

      // Fetch athlete name for the response
      const { data: athlete } = await supabase
        .from('users')
        .select('name')
        .eq('id', invite.athlete_id)
        .single()

      return new Response(
        JSON.stringify({ success: true, athlete_id: invite.athlete_id, athlete_name: athlete?.name ?? null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── revoke (athlete disconnects a coach) ──────────────────────────────────
    if (action === 'revoke') {
      const coachId: string = body.coach_id
      if (!coachId) throw new Error('coach_id is required')

      await supabase
        .from('coach_athletes')
        .update({ active: false })
        .eq('coach_id', coachId)
        .eq('athlete_id', user.id)

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    throw new Error(`Unknown action: ${action}`)
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
