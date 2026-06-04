import { supabase } from './supabase'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const COOLDOWN_MS = 60 * 1000  // 1 minute between syncs (server has its own 20s dedup)

let _lastSyncAt = 0
let _inFlight = false

// Listeners called after every successful sync (including startup background sync)
const _listeners: (() => void)[] = []

export function onSyncComplete(cb: () => void): () => void {
  _listeners.push(cb)
  return () => { const i = _listeners.indexOf(cb); if (i >= 0) _listeners.splice(i, 1) }
}

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
    _listeners.forEach(cb => cb())
    return { ok: true, synced: json.synced ?? 0, json }
  } finally {
    _inFlight = false
  }
}
