import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MICROSOFT_CLIENT_ID = Deno.env.get('MICROSOFT_CLIENT_ID')!
const MICROSOFT_CLIENT_SECRET = Deno.env.get('MICROSOFT_CLIENT_SECRET')!

const APP_SCHEME = 'stravaeat://calendar-auth'
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/microsoft-cal-callback`

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const state = url.searchParams.get('state')

  if (error || !code || !state) {
    return Response.redirect(`${APP_SCHEME}?provider=microsoft&error=${error ?? 'missing_params'}`)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: userRow } = await supabase
    .from('users')
    .select('id, pending_oauth_state_expires_at')
    .eq('pending_oauth_state', state)
    .maybeSingle()

  if (!userRow) {
    return Response.redirect(`${APP_SCHEME}?provider=microsoft&error=invalid_state`)
  }
  if (Date.now() > new Date(userRow.pending_oauth_state_expires_at).getTime()) {
    return Response.redirect(`${APP_SCHEME}?provider=microsoft&error=state_expired`)
  }

  const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: MICROSOFT_CLIENT_ID,
      client_secret: MICROSOFT_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      scope: 'Calendars.ReadWrite offline_access',
    }),
  })

  if (!tokenRes.ok) {
    console.error('Microsoft token exchange failed:', await tokenRes.text())
    return Response.redirect(`${APP_SCHEME}?provider=microsoft&error=token_exchange_failed`)
  }

  const tokens = await tokenRes.json()

  const { error: updateError } = await supabase.from('users').update({
    microsoft_cal_access_token: tokens.access_token,
    microsoft_cal_refresh_token: tokens.refresh_token,
    microsoft_cal_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    pending_oauth_state: null,
    pending_oauth_state_expires_at: null,
  }).eq('id', userRow.id)

  if (updateError) {
    return Response.redirect(`${APP_SCHEME}?provider=microsoft&error=save_failed`)
  }

  registerMicrosoftWebhook(supabase, userRow.id, tokens.access_token).catch(console.error)

  return Response.redirect(`${APP_SCHEME}?provider=microsoft&linked=true`)
})

async function registerMicrosoftWebhook(supabase: ReturnType<typeof createClient>, userId: string, accessToken: string) {
  const secret = crypto.randomUUID()
  const webhookUrl = `${SUPABASE_URL}/functions/v1/cal-webhook-receiver?provider=microsoft`
  // Microsoft calendar subscriptions max out at 3 days
  const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

  const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      changeType: 'created,updated,deleted',
      notificationUrl: webhookUrl,
      resource: 'me/events',
      expirationDateTime: expiry,
      clientState: secret,
    }),
  })

  if (!res.ok) {
    console.error('Microsoft webhook registration failed:', await res.text())
    return
  }

  const data = await res.json()

  await supabase.from('calendar_webhook_subscriptions').upsert({
    user_id: userId,
    provider: 'microsoft',
    subscription_id: data.id,
    secret,
    expiry: data.expirationDateTime,
  }, { onConflict: 'user_id,provider' })
}
