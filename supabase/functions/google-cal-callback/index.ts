import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!

const APP_SCHEME = 'stravaeat://calendar-auth'
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-cal-callback`

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const state = url.searchParams.get('state')

  if (error || !code || !state) {
    return Response.redirect(`${APP_SCHEME}?provider=google&error=${error ?? 'missing_params'}`)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Validate CSRF state — same pattern as strava-callback
  const { data: userRow } = await supabase
    .from('users')
    .select('id, pending_oauth_state_expires_at')
    .eq('pending_oauth_state', state)
    .maybeSingle()

  if (!userRow) {
    return Response.redirect(`${APP_SCHEME}?provider=google&error=invalid_state`)
  }
  if (Date.now() > new Date(userRow.pending_oauth_state_expires_at).getTime()) {
    return Response.redirect(`${APP_SCHEME}?provider=google&error=state_expired`)
  }

  // Exchange authorization code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    console.error('Google token exchange failed:', await tokenRes.text())
    return Response.redirect(`${APP_SCHEME}?provider=google&error=token_exchange_failed`)
  }

  const tokens = await tokenRes.json()

  const { error: updateError } = await supabase.from('users').update({
    google_cal_access_token: tokens.access_token,
    google_cal_refresh_token: tokens.refresh_token,
    google_cal_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    pending_oauth_state: null,
    pending_oauth_state_expires_at: null,
  }).eq('id', userRow.id)

  if (updateError) {
    return Response.redirect(`${APP_SCHEME}?provider=google&error=save_failed`)
  }

  // Register webhook subscription in the background
  registerGoogleWebhook(supabase, userRow.id, tokens.access_token).catch(console.error)

  return Response.redirect(`${APP_SCHEME}?provider=google&linked=true`)
})

async function registerGoogleWebhook(supabase: ReturnType<typeof createClient>, userId: string, accessToken: string) {
  const channelId = crypto.randomUUID()
  const secret = crypto.randomUUID()
  const webhookUrl = `${SUPABASE_URL}/functions/v1/cal-webhook-receiver?provider=google`

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events/watch',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        token: secret,
        // Google max is 7 days; store expiry to know when to renew
        expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    },
  )

  if (!res.ok) {
    console.error('Google webhook registration failed:', await res.text())
    return
  }

  const data = await res.json()

  await supabase.from('calendar_webhook_subscriptions').upsert({
    user_id: userId,
    provider: 'google',
    subscription_id: channelId,
    resource_id: data.resourceId,
    secret,
    expiry: new Date(Number(data.expiration)).toISOString(),
  }, { onConflict: 'user_id,provider' })
}
