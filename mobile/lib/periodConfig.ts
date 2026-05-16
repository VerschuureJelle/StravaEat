export type PeriodSeverity = 'minor' | 'medium' | 'severe'

// ─── Zone reduction percentages ──────────────────────────────────────────────
// Edit these values to tune the adjustments per severity level.
// Values are the fraction to REMOVE (0.2 = remove 20%, keep 80%).
// 'to_z3' means the zone is replaced by Zone 3 instead.

export const PERIOD_REDUCTIONS: Record<
  Exclude<PeriodSeverity, 'severe'>,
  Record<number, number | 'to_z3'>
> = {
  minor: {
    2: 0.20,   // Z2 reduced by 20%
    3: 0.30,   // Z3 reduced by 30%
    4: 0.40,   // Z4 reduced by 40%
  },
  medium: {
    2: 0.40,   // Z2 reduced by 40%
    3: 0.50,   // Z3 reduced by 50%
    4: 'to_z3', // Z4 replaced by Z3
    5: 'to_z3', // Z5 replaced by Z3
  },
}

// Returns the duration multiplier for a given zone number and severity.
// e.g. getZoneFactor('minor', 2) → 0.80 (keep 80%)
// Returns null for 'severe' (no training).
// Returns { factor, convertToZ3 } for zone conversions.
export function getZoneAdjustment(
  severity: PeriodSeverity,
  zoneNumber: number,
): { factor: number; convertToZ3: boolean } | null {
  if (severity === 'severe') return null

  const rule = PERIOD_REDUCTIONS[severity][zoneNumber]
  if (rule === undefined) return { factor: 1, convertToZ3: false }  // Z1 unaffected
  if (rule === 'to_z3') {
    // Use Z3's reduction factor when converting
    const z3Rule = PERIOD_REDUCTIONS[severity][3] as number
    return { factor: 1 - z3Rule, convertToZ3: true }
  }
  return { factor: 1 - rule, convertToZ3: false }
}

export const SEVERITY_LABELS: Record<PeriodSeverity, string> = {
  minor:  'Minor',
  medium: 'Medium',
  severe: 'Severe',
}

export const SEVERITY_DESCRIPTIONS: Record<PeriodSeverity, string> = {
  minor:  'Light symptoms — reduced intensity across zones',
  medium: 'Moderate symptoms — significant load reduction, no high-intensity',
  severe: 'Heavy symptoms — rest day recommended',
}
