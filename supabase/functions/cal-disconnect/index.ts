import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidGoogleToken, getValidMicrosoftToken } from '../_shared/calendarTokens.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { provider } = await req.json() as { provider: 'google' | 'microsoft' }

  const [{ data: sub }, { data: profile }] = await Promise.all([
    supabase
      .from('calendar_webhook_subscriptions')
      .select('subscription_id, resource_id')
      .eq('user_id', user.id)
      .eq('provider', provider)
      .maybeSingle(),
    supabase
      .from('users')
      .select('google_cal_access_token, google_cal_refresh_token, google_cal_token_expires_at, microsoft_cal_access_token, microsoft_cal_refresh_token, microsoft_cal_token_expires_at')
      .eq('id', user.id)
      .single(),
  ])

  // Best-effort: stop the webhook subscription at the provider
  if (sub && profile) {
    if (provider === 'google' && profile.google_cal_refresh_token) {
      try {
        const token = await getValidGoogleToken(supabase, user.id, profile as any)
        await fetch('https://www.googleapis.com/calendar/v3/channels/stop', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: sub.subscription_id, resourceId: sub.resource_id }),
        })
      } catch { /* ignore — tokens may already be invalid */ }
    } else if (provider === 'microsoft' && profile.microsoft_cal_refresh_token) {
      try {
        const token = await getValidMicrosoftToken(supabase, user.id, profile as any)
        await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${sub.subscription_id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch { /* ignore */ }
    }
  }

  // Remove subscription record and clear tokens
  const clearTokens = provider === 'google'
    ? { google_cal_access_token: null, google_cal_refresh_token: null, google_cal_token_expires_at: null }
    : { microsoft_cal_access_token: null, microsoft_cal_refresh_token: null, microsoft_cal_token_expires_at: null }

  const clearEventId = provider === 'google'
    ? { google_event_id: null }
    : { microsoft_event_id: null }

  await Promise.all([
    supabase.from('calendar_webhook_subscriptions').delete().eq('user_id', user.id).eq('provider', provider),
    supabase.from('users').update(clearTokens).eq('id', user.id),
    supabase.from('planned_workouts').update(clearEventId).eq('user_id', user.id),
  ])

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
