import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidGoogleToken, getValidMicrosoftToken } from '../_shared/calendarTokens.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Find subscriptions expiring within the next 24 hours
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const { data: subs } = await supabase
    .from('calendar_webhook_subscriptions')
    .select('id, user_id, provider, subscription_id, resource_id, secret')
    .lt('expiry', cutoff)

  if (!subs?.length) {
    return new Response(JSON.stringify({ renewed: 0 }), { headers: { 'Content-Type': 'application/json' } })
  }

  let renewed = 0

  for (const sub of subs) {
    const { data: profile } = await supabase
      .from('users')
      .select('google_cal_access_token, google_cal_refresh_token, google_cal_token_expires_at, google_cal_id, microsoft_cal_access_token, microsoft_cal_refresh_token, microsoft_cal_token_expires_at')
      .eq('id', sub.user_id)
      .single()

    if (!profile) continue

    try {
      if (sub.provider === 'google' && profile.google_cal_refresh_token) {
        const token = await getValidGoogleToken(supabase, sub.user_id, profile as any)
        await renewGoogle(supabase, sub, token, profile.google_cal_id ?? 'primary')
        renewed++
      } else if (sub.provider === 'microsoft' && profile.microsoft_cal_refresh_token) {
        const token = await getValidMicrosoftToken(supabase, sub.user_id, profile as any)
        await renewMicrosoft(supabase, sub, token)
        renewed++
      }
    } catch (e) {
      console.error(`Failed to renew ${sub.provider} subscription for user ${sub.user_id}:`, e)
    }
  }

  return new Response(JSON.stringify({ renewed }), { headers: { 'Content-Type': 'application/json' } })
})

async function renewGoogle(
  supabase: ReturnType<typeof createClient>,
  sub: { id: string; user_id: string; subscription_id: string; resource_id: string | null; secret: string },
  token: string,
  calId: string,
) {
  // Stop the old channel
  try {
    await fetch('https://www.googleapis.com/calendar/v3/channels/stop', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sub.subscription_id, resourceId: sub.resource_id }),
    })
  } catch { /* ignore — may already be expired */ }

  const channelId = crypto.randomUUID()
  const webhookUrl = `${SUPABASE_URL}/functions/v1/cal-webhook-receiver?provider=google`

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/watch`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        token: sub.secret,
        expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    },
  )

  if (!res.ok) {
    console.error('Google webhook renewal failed:', await res.text())
    return
  }

  const data = await res.json()

  await supabase.from('calendar_webhook_subscriptions').update({
    subscription_id: channelId,
    resource_id: data.resourceId,
    expiry: new Date(Number(data.expiration)).toISOString(),
  }).eq('id', sub.id)
}

async function renewMicrosoft(
  supabase: ReturnType<typeof createClient>,
  sub: { id: string; user_id: string; subscription_id: string; secret: string },
  token: string,
) {
  const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

  const res = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${sub.subscription_id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expirationDateTime: expiry }),
  })

  if (!res.ok) {
    console.error('Microsoft webhook renewal failed:', await res.text())
    return
  }

  await supabase.from('calendar_webhook_subscriptions').update({
    expiry,
  }).eq('id', sub.id)
}
