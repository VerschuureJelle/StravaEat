import * as WebBrowser from 'expo-web-browser'
import { supabase } from './supabase'

const MICROSOFT_CLIENT_ID = process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID!
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/microsoft-cal-callback`
const STATE_TTL_MS = 10 * 60 * 1000

function randomHex(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

export async function initiateMicrosoftCalOAuth(): Promise<'linked' | 'cancelled' | 'error'> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'error'

  const state = randomHex()
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString()

  await supabase.from('users').update({
    pending_oauth_state: state,
    pending_oauth_state_expires_at: expiresAt,
  }).eq('id', user.id)

  const params = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'Calendars.ReadWrite offline_access',
    state,
  })

  const result = await WebBrowser.openAuthSessionAsync(
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`,
    'stravaeat://calendar-auth',
  )

  if (result.type === 'success' && result.url.includes('linked=true')) return 'linked'
  if (result.type === 'success' && result.url.includes('error=')) return 'error'
  return 'cancelled'
}
