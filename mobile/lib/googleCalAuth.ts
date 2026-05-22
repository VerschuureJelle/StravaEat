import * as WebBrowser from 'expo-web-browser'
import { supabase } from './supabase'

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID!
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-cal-callback`
const STATE_TTL_MS = 10 * 60 * 1000

function randomHex(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

export async function initiateGoogleCalOAuth(): Promise<'linked' | 'cancelled' | 'error'> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'error'

  const state = randomHex()
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString()

  await supabase.from('users').update({
    pending_oauth_state: state,
    pending_oauth_state_expires_at: expiresAt,
  }).eq('id', user.id)

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  const result = await WebBrowser.openAuthSessionAsync(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    'stravaeat://calendar-auth',
  )

  if (result.type === 'success' && result.url.includes('linked=true')) return 'linked'
  if (result.type === 'success') {
    const error = new URL(result.url).searchParams.get('error') ?? 'unknown'
    return error as any
  }
  return 'cancelled'
}
