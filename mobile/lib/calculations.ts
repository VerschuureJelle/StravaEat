import type { HeartRateZone } from '../types'

export function calculateZoneKcal(
  zone: HeartRateZone,
  timeInZoneSec: number,
  weightKg: number,
): number {
  return zone.met_value * weightKg * (timeInZoneSec / 3600)
}

export function assignHRToZone(bpm: number, zones: HeartRateZone[]): HeartRateZone | null {
  return zones.find((z) => bpm >= z.min_bpm && bpm < z.max_bpm) ?? null
}

export function processHRStream(
  hrStream: number[],
  zones: HeartRateZone[],
  weightKg: number,
): { zone_id: string; time_in_zone_sec: number; kcal_in_zone: number }[] {
  const timePerZone: Record<string, number> = {}
  zones.forEach((z) => (timePerZone[z.id] = 0))

  for (const bpm of hrStream) {
    const zone = assignHRToZone(bpm, zones)
    if (zone) timePerZone[zone.id] = (timePerZone[zone.id] ?? 0) + 1
  }

  return zones
    .filter((z) => timePerZone[z.id] > 0)
    .map((z) => ({
      zone_id: z.id,
      time_in_zone_sec: timePerZone[z.id],
      kcal_in_zone: calculateZoneKcal(z, timePerZone[z.id], weightKg),
    }))
}
