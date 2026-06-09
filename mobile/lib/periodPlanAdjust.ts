import { supabase } from './supabase'
import { PeriodSeverity } from './periodConfig'

const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/adjust-plan-for-period`

async function call(body: object) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Adjust failed')
  return json as { adjusted?: number; restored?: number; mu?: number; severity?: string }
}

/**
 * Adjust planned workouts for the current 7-day window based on period severity.
 * Uses the user's Bayesian-calibrated mu if available, otherwise population default.
 * Only affects workouts not already adjusted.
 */
export function adjustPlanForPeriod(severity: PeriodSeverity) {
  return call({ action: 'adjust', severity })
}

/**
 * Restore all adjusted workouts in the current 7-day window to their original values.
 */
export function restorePlanAfterPeriod() {
  return call({ action: 'restore' })
}
