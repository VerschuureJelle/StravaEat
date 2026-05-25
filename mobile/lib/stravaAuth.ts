import * as WebBrowser from 'expo-web-browser'
import * as Crypto from 'expo-crypto'
import { supabase } from './supabase'

const STRAVA_CLIENT_ID = process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID!
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/strava-callback`
const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function randomHex(bytes = 16): string {
  // expo-crypto's getRandomBytes works in Expo Go on JS-only runtimes.
  // The Web Crypto API global isn't available in plain React Native.
  const arr = Crypto.getRandomBytes(bytes)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function initiateStravaOAuth(): Promise<'linked' | 'cancelled'> {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)
  if (!user) throw new Error('You must be signed in to connect Strava.')

  const state = randomHex()
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString()

  // Upsert (not update) so the row is created if a public.users row doesn't
  // yet exist for this auth user — otherwise update matches 0 rows silently
  // and the callback fails state validation with no signal to the user.
  const { error: dbError } = await supabase.from('users').upsert({
    id: user.id,
    pending_oauth_state: state,
    pending_oauth_state_expires_at: expiresAt,
  }, { onConflict: 'id' })
  if (dbError) throw new Error(`Could not start Strava connection: ${dbError.message}`)

  const params = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    redirect_uri: CALLBACK_URL,
    response_type: 'code',
    scope: 'activity:read_all',
    approval_prompt: 'auto',
    state,
  })

  const result = await WebBrowser.openAuthSessionAsync(
    `https://www.strava.com/oauth/authorize?${params}`,
    'stravaeat://auth',
  )

  if (result.type === 'success') {
    if (result.url.includes('linked=true')) return 'linked' as const
    const error = new URL(result.url).searchParams.get('error') ?? 'unknown'
    throw new Error(error)
  }

  return 'cancelled' as const
}
