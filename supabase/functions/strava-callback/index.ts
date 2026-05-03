import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STRAVA_CLIENT_ID = Deno.env.get('STRAVA_CLIENT_ID')!
const STRAVA_CLIENT_SECRET = Deno.env.get('STRAVA_CLIENT_SECRET')!

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const state = url.searchParams.get('state') // existing user ID if linking from onboarding

  const appScheme = 'stravaeat://auth'

  if (error || !code) {
    return Response.redirect(`${appScheme}?error=${error ?? 'missing_code'}`)
  }

  // Exchange auth code for Strava tokens
  const tokenRes = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    return Response.redirect(`${appScheme}?error=strava_token_exchange_failed`)
  }

  const tokens = await tokenRes.json()
  const athlete = tokens.athlete
  const displayName = `${athlete.firstname} ${athlete.lastname}`.trim()

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const stravaTokenData = {
    name: displayName,
    strava_id: String(athlete.id),
    strava_access_token: tokens.access_token,
    strava_refresh_token: tokens.refresh_token,
    strava_token_expires_at: new Date(tokens.expires_at * 1000).toISOString(),
  }

  // If state contains an existing user ID, link Strava to that account
  if (state) {
    const { error: updateError } = await supabase
      .from('users')
      .update(stravaTokenData)
      .eq('id', state)

    if (updateError) {
      return Response.redirect(`${appScheme}?error=link_failed`)
    }

    // Signal to app that linking succeeded (no new session needed)
    return Response.redirect(`${appScheme}?linked=true`)
  }

  // No state — this is a fresh Strava-only sign-in, find or create user
  const email = `strava_${athlete.id}@stravaeat.internal`

  const { data: existingProfile } = await supabase
    .from('users')
    .select('id')
    .eq('strava_id', String(athlete.id))
    .maybeSingle()

  let userId: string

  if (existingProfile) {
    userId = existingProfile.id
  } else {
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { strava_id: athlete.id, name: displayName },
    })
    if (createError || !newUser.user) {
      return Response.redirect(`${appScheme}?error=user_creation_failed`)
    }
    userId = newUser.user.id
  }

  await supabase.from('users').upsert({ id: userId, email, ...stravaTokenData })

  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  if (linkError || !link?.properties?.hashed_token) {
    return Response.redirect(`${appScheme}?error=session_generation_failed`)
  }

  return Response.redirect(
    `${appScheme}?token_hash=${link.properties.hashed_token}&email=${encodeURIComponent(email)}`,
  )
})
