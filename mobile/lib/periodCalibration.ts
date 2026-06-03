/**
 * Bayesian convergence model for personalising period intensity reduction.
 *
 * Prior parameters derived from:
 *   McNulty et al. (2020) BMJ Open Sport Exerc Med — inter-individual SD of
 *   menstrual phase effects on perceived exertion ≈ 8–12%.
 *   Sports medicine consensus for symptomatic training prescription:
 *   minor symptoms 15–25%, moderate symptoms 30–50% reduction range.
 *
 * σ_obs = 0.07: single-session RPE feedback has ~7% noise (test-retest
 *   reliability of subjective effort scales, Borg & Noble 1974 replication).
 *
 * Step sizes Δ = [−0.10, −0.04, +0.04, +0.10] for ratings 1–4:
 *   outer steps ≈ σ₀ (strong signal → shift by ~1 population SD)
 *   inner steps ≈ 0.4 × σ₀ (weak signal → gentle nudge)
 */

export type PeriodSeverityCalib = 'minor' | 'medium'

export interface PeriodCalibration {
  severity: PeriodSeverityCalib
  mu: number        // current posterior mean (the active reduction fraction)
  sigma_sq: number  // current posterior variance (shrinks with each observation)
  n_obs: number
  last_feedback_date: string | null
}

// Population priors — match the current static defaults
export const PERIOD_DEFAULTS: Record<PeriodSeverityCalib, { mu: number; sigma_sq: number }> = {
  minor:  { mu: 0.20, sigma_sq: 0.0100 },  // σ₀ = 0.10
  medium: { mu: 0.40, sigma_sq: 0.0144 },  // σ₀ = 0.12
}

// Observation noise variance (σ_obs² = 0.07² = 0.0049)
const SIGMA_OBS_SQ = 0.0049

// Implied shift per feedback rating (1 = much too easy … 4 = too hard)
const FEEDBACK_DELTAS: Record<1 | 2 | 3 | 4, number> = {
  1: -0.10,
  2: -0.04,
  3: +0.04,
  4: +0.10,
}

export const FEEDBACK_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'too easy',
  2: 'Slightly easy',
  3: 'Slightly hard',
  4: 'Too hard',
}

/** Bounds on the posterior mean — prevents degenerate values. */
const MU_MIN = 0.05
const MU_MAX = 0.70

/**
 * Perform a single Bayesian update given the user's feedback rating.
 * Returns the new posterior mean and variance.
 */
export function bayesianUpdate(
  mu: number,
  sigma_sq: number,
  prescribedReduction: number,
  rating: 1 | 2 | 3 | 4,
): { mu: number; sigma_sq: number } {
  const x = prescribedReduction + FEEDBACK_DELTAS[rating]
  const new_sigma_sq = 1 / (1 / sigma_sq + 1 / SIGMA_OBS_SQ)
  const new_mu = new_sigma_sq * (mu / sigma_sq + x / SIGMA_OBS_SQ)
  return {
    mu: Math.max(MU_MIN, Math.min(MU_MAX, new_mu)),
    sigma_sq: new_sigma_sq,
  }
}

/**
 * Returns a human-readable confidence label for the UI.
 * Based on posterior σ thresholds.
 */
export function calibrationLabel(n_obs: number): string {
  if (n_obs === 0) return 'Population default'
  if (n_obs < 3)   return 'Early learning'
  if (n_obs < 6)   return 'Personalising'
  return 'Personalised'
}

/**
 * Percentage confidence to show as a progress indicator (0–100).
 * Asymptotically approaches 100 but won't claim full certainty early.
 */
export function calibrationConfidencePct(sigma_sq: number, defaultSigmaSq: number): number {
  const reduction = 1 - sigma_sq / defaultSigmaSq
  return Math.round(Math.min(reduction * 100, 97))
}
