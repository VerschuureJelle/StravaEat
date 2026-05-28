import { supabase } from './supabase'

export type ProgressionLevel = 'low' | 'moderate' | 'high'
export type ProgressionMetric = 'km' | 'min'

export interface ProgressionAnalysis {
  metric: ProgressionMetric
  lastLoad: number | null       // most recent completed activity
  recentAvg: number | null      // rolling avg of last 6 completed activities
  skippedLoad: number           // the workout being skipped
  nextLoad: number | null       // next planned workout load
  nextPlanId: string | null     // id of next planned workout (for scale-down)
  nextPlanKcal: number          // kcal of next planned workout (for proportional scaling)
  safeLoad: number | null       // lastLoad * 1.10 — recommended safe next step
  jumpIfSkipped: number | null  // % gap from lastCompleted → nextPlanned (if skip)
  jumpNormal: number | null     // % gap from lastCompleted → skipped (if done)
  level: ProgressionLevel
}

function extractLoad(distanceM: number | null, durationSec: number | null, metric: ProgressionMetric): number | null {
  if (metric === 'km') return distanceM != null && distanceM > 0 ? distanceM / 1000 : null
  return durationSec != null && durationSec > 0 ? durationSec / 60 : null
}

function jumpPct(from: number, to: number): number {
  if (from <= 0) return 0
  return Math.round(((to - from) / from) * 100)
}

function classifyJump(pct: number | null): ProgressionLevel {
  if (pct == null || pct <= 15) return 'low'
  if (pct <= 35) return 'moderate'
  return 'high'
}

export async function analyzeSkip(
  userId: string,
  sportType: string,
  skippedDate: string,
  skippedDistanceM: number | null,
  skippedDurationMin: number | null,
): Promise<ProgressionAnalysis> {
  const sport = sportType.toLowerCase()

  const [recentActsRes, nextPlanRes] = await Promise.all([
    supabase.from('activities')
      .select('distance_m, duration_sec')
      .eq('user_id', userId)
      .ilike('type', `%${sport}%`)
      .lt('date', skippedDate)
      .order('date', { ascending: false })
      .limit(6),
    supabase.from('planned_workouts')
      .select('id, distance_m, target_duration_min, target_kcal')
      .eq('user_id', userId)
      .eq('sport_type', sportType)
      .is('status', null)
      .gt('planned_for', skippedDate)
      .order('planned_for', { ascending: true })
      .limit(1),
  ])

  const recentActs = recentActsRes.data ?? []

  const hasDistance = recentActs.some(a => (a.distance_m ?? 0) > 0)
    || (skippedDistanceM ?? 0) > 0
  const metric: ProgressionMetric = hasDistance ? 'km' : 'min'

  const loads = recentActs
    .map(a => extractLoad(a.distance_m, a.duration_sec, metric))
    .filter((v): v is number => v != null)

  const lastLoad = loads[0] ?? null
  const recentAvg = loads.length > 0
    ? Math.round((loads.reduce((s, v) => s + v, 0) / loads.length) * 10) / 10
    : null

  const skippedLoad = metric === 'km'
    ? (skippedDistanceM ?? 0) / 1000
    : (skippedDurationMin ?? 0)

  const nextPlan = nextPlanRes.data?.[0] ?? null
  const nextLoad = nextPlan
    ? extractLoad(nextPlan.distance_m, nextPlan.target_duration_min != null ? nextPlan.target_duration_min * 60 : null, metric)
    : null

  const safeLoad = lastLoad != null
    ? Math.round(lastLoad * 1.10 * 10) / 10
    : null

  const jumpIfSkipped = lastLoad != null && nextLoad != null
    ? jumpPct(lastLoad, nextLoad)
    : null

  const jumpNormal = lastLoad != null && skippedLoad > 0
    ? jumpPct(lastLoad, skippedLoad)
    : null

  return {
    metric,
    lastLoad,
    recentAvg,
    skippedLoad,
    nextLoad,
    nextPlanId: nextPlan?.id ?? null,
    nextPlanKcal: nextPlan?.target_kcal ?? 0,
    safeLoad,
    jumpIfSkipped,
    jumpNormal,
    level: classifyJump(jumpIfSkipped),
  }
}
