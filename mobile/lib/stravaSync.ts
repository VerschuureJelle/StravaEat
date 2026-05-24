import { supabase } from './supabase'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const COOLDOWN_MS = 3 * 60 * 1000  // 3 minutes between syncs

let _lastSyncAt = 0
let _inFlight = false

export type SyncResult =
  | { ok: true; synced: number; json: any }
  | { ok: false; skipped: true }
  | { ok: false; error: string; rateLimitMinutes?: number }

export function isSyncCoolingDown() {
  return _inFlight || Date.now() - _lastSyncAt < COOLDOWN_MS
}

export async function callSyncRecent(): Promise<SyncResult> {
  if (_inFlight || Date.now() - _lastSyncAt < COOLDOWN_MS) {
    return { ok: false, skipped: true }
  }

  _inFlight = true
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { ok: false, error: 'Not signed in' }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-recent`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const text = await res.text()
    let json: any = {}
    try { json = JSON.parse(text) } catch { /* non-JSON gateway response */ }

    if (!res.ok) {
      if (json.error === 'strava_not_connected') return { ok: false, error: 'strava_not_connected' }
      if (String(json.error).startsWith('rate_limit:')) {
        const minutes = Number(String(json.error).split(':')[1]) || 15
        return { ok: false, error: 'rate_limit', rateLimitMinutes: minutes }
      }
      return { ok: false, error: json.error ?? `HTTP ${res.status}` }
    }

    _lastSyncAt = Date.now()
    return { ok: true, synced: json.synced ?? 0, json }
  } finally {
    _inFlight = false
  }
}
