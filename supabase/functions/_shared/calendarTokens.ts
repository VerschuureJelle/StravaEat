import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!
const MICROSOFT_CLIENT_ID = Deno.env.get('MICROSOFT_CLIENT_ID')!
const MICROSOFT_CLIENT_SECRET = Deno.env.get('MICROSOFT_CLIENT_SECRET')!

type GoogleProfile = {
  google_cal_access_token: string
  google_cal_refresh_token: string
  google_cal_token_expires_at: string
}

type MicrosoftProfile = {
  microsoft_cal_access_token: string
  microsoft_cal_refresh_token: string
  microsoft_cal_token_expires_at: string
}

export async function getValidGoogleToken(
  supabase: SupabaseClient,
  userId: string,
  profile: GoogleProfile,
): Promise<string> {
  const expiresAt = new Date(profile.google_cal_token_expires_at).getTime()
  if (Date.now() < expiresAt - 60_000) return profile.google_cal_access_token

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: profile.google_cal_refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) throw new Error('google_auth_expired')

  const tokens = await res.json()
  await supabase.from('users').update({
    google_cal_access_token: tokens.access_token,
    google_cal_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  }).eq('id', userId)

  return tokens.access_token as string
}

export async function getValidMicrosoftToken(
  supabase: SupabaseClient,
  userId: string,
  profile: MicrosoftProfile,
): Promise<string> {
  const expiresAt = new Date(profile.microsoft_cal_token_expires_at).getTime()
  if (Date.now() < expiresAt - 60_000) return profile.microsoft_cal_access_token

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      client_secret: MICROSOFT_CLIENT_SECRET,
      refresh_token: profile.microsoft_cal_refresh_token,
      grant_type: 'refresh_token',
      scope: 'Calendars.ReadWrite offline_access',
    }),
  })

  if (!res.ok) throw new Error('microsoft_auth_expired')

  const tokens = await res.json()
  await supabase.from('users').update({
    microsoft_cal_access_token: tokens.access_token,
    microsoft_cal_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  }).eq('id', userId)

  return tokens.access_token as string
}
