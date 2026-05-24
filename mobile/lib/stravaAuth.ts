import * as WebBrowser from 'expo-web-browser'
import * as ExpoCrypto from 'expo-crypto'
import { supabase } from './supabase'

const STRAVA_CLIENT_ID = process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID!
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/strava-callback`
const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function randomHex(bytes = 16): string {
  const arr = ExpoCrypto.getRandomBytes(bytes)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function initiateStravaOAuth(): Promise<void> {
  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user) throw new Error('Not signed in')

  const state = randomHex()
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString()

  const { error: updateErr } = await supabase.from('users').upsert(
    { id: user.id, pending_oauth_state: state, pending_oauth_state_expires_at: expiresAt },
    { onConflict: 'id' },
  )
  if (updateErr) throw new Error(updateErr.message)

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
