export const DEFAULT_ZONE_DEFINITIONS = [
  { zone_number: 1, name: 'Zone 1 — Recovery',    pct_min: 0,    pct_max: 0.60, met_value: 2.5 },
  { zone_number: 2, name: 'Zone 2 — Aerobic Base', pct_min: 0.60, pct_max: 0.70, met_value: 4.5 },
  { zone_number: 3, name: 'Zone 3 — Tempo',        pct_min: 0.70, pct_max: 0.80, met_value: 6.0 },
  { zone_number: 4, name: 'Zone 4 — Threshold',    pct_min: 0.80, pct_max: 0.90, met_value: 8.5 },
  { zone_number: 5, name: 'Zone 5 — VO2max',       pct_min: 0.90, pct_max: 1.00, met_value: 11.0 },
]

export function generateZonesFromMaxHR(maxHR: number) {
  return DEFAULT_ZONE_DEFINITIONS.map((z) => ({
    zone_number: z.zone_number,
    name: z.name,
    min_bpm: Math.round(maxHR * z.pct_min),
    max_bpm: Math.round(maxHR * z.pct_max),
    met_value: z.met_value,
  }))
}
