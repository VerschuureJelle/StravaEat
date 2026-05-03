import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const { code } = await req.json()
  if (!code) return new Response('code required', { status: 400 })

  // Exchange auth code for Strava tokens — server-side to protect client_secret
  const tokenRes = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: Deno.env.get('STRAVA_CLIENT_ID'),
      client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
      code,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    return new Response(`Strava token exchange failed: ${err}`, { status: 502 })
  }

  const tokens = await tokenRes.json()
  const athlete = tokens.athlete

  // Use a synthetic email so we never depend on Strava providing one
  const email = `strava_${athlete.id}@stravaeat.internal`
  const displayName = `${athlete.firstname} ${athlete.lastname}`.trim()

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Find existing Supabase user by strava_id in the users table
  const { data: existingProfile } = await supabase
    .from('users')
    .select('id')
    .eq('strava_id', String(athlete.id))
    .maybeSingle()

  let userId: string

  if (existingProfile) {
    userId = existingProfile.id
  } else {
    const { data: newUser, error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { strava_id: athlete.id, name: displayName },
    })
    if (error || !newUser.user) {
      return new Response(`User creation failed: ${error?.message}`, { status: 500 })
    }
    userId = newUser.user.id
  }

  // Upsert Strava tokens and basic profile info
  await supabase.from('users').upsert({
    id: userId,
    name: displayName,
    strava_id: String(athlete.id),
    strava_access_token: tokens.access_token,
    strava_refresh_token: tokens.refresh_token,
    strava_token_expires_at: new Date(tokens.expires_at * 1000).toISOString(),
  })

  // Generate a magic link token for the mobile app to exchange for a session
  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  if (linkError || !link?.properties?.hashed_token) {
    return new Response(`Session generation failed: ${linkError?.message}`, { status: 500 })
  }

  return new Response(
    JSON.stringify({ token_hash: link.properties.hashed_token, email }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
