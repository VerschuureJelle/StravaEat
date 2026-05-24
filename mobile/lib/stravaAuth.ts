import * as WebBrowser from 'expo-web-browser'
import { supabase } from './supabase'

const STRAVA_CLIENT_ID = process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID!
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/strava-callback`
const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function initiateStravaOAuth(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const state = randomHex()
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString()

  await supabase.from('users').update({
    pending_oauth_state: state,
    pending_oauth_state_expires_at: expiresAt,
  }).eq('id', user.id)

  const params = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    redirect_uri: CALLBACK_URL,
    response_type: 'code',
    scope: 'activity:read_all',
    approval_prompt: 'auto',
    state,
  })

  await WebBrowser.openAuthSessionAsync(
    `https://www.strava.com/oauth/authorize?${params}`,
    'stravaeat://auth',
  )
}
