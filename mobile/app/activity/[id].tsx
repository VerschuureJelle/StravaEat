import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import MapView, { Polyline } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { C } from '../../lib/theme'
import type { ActivityWithZones, Lap } from '../../types'

const ZONE_COLORS = [C.swim, C.success, C.warning, C.run, C.danger]

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`
}

function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const coords: { latitude: number; longitude: number }[] = []
  let index = 0, lat = 0, lng = 0
  while (index < encoded.length) {
    let shift = 0, result = 0, b: number
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)
    shift = result = 0
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)
    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 })
  }
  return coords
}

function getBoundingRegion(coords: { latitude: number; longitude: number }[]) {
  const lats = coords.map(c => c.latitude)
  const lngs = coords.map(c => c.longitude)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.005),
    longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.005),
  }
}

function formatLapSpeed(lap: Lap, activityType: string): string | null {
  if (!lap.avg_speed_ms) return null
  const isRun = /run/i.test(activityType)
  const isSwim = /swim/i.test(activityType)
  if (isSwim) {
    const secPer100m = 100 / lap.avg_speed_ms
    const min = Math.floor(secPer100m / 60)
    const sec = Math.round(secPer100m % 60)
    return `${min}:${String(sec).padStart(2, '0')} /100m`
  }
  if (isRun) {
    const secPerKm = 1000 / lap.avg_speed_ms
    const min = Math.floor(secPerKm / 60)
    const sec = Math.round(secPerKm % 60)
    return `${min}:${String(sec).padStart(2, '0')} /km`
  }
  return `${(lap.avg_speed_ms * 3.6).toFixed(1)} km/h`
}

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [activity, setActivity] = useState<ActivityWithZones | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('activities')
        .select(`
          *,
          zone_splits:activity_zone_splits (
            *,
            zone:heart_rate_zones (*)
          ),
          laps:activity_laps (*)
        `)
        .eq('id', id)
        .single()
      setActivity(data)
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ flex: 1 }} size="large" color={C.accent} />
      </SafeAreaView>
    )
  }

  if (!activity) {
    return (
      <SafeAreaView style={styles.container}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={C.accent} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Activity not found.</Text>
        </View>
      </SafeAreaView>
    )
  }

  const sortedSplits = [...(activity.zone_splits ?? [])].sort(
    (a, b) => a.zone.zone_number - b.zone.zone_number,
  )
  const sortedLaps = [...(activity.laps ?? [])].sort((a, b) => a.lap_index - b.lap_index)
  const totalTimeSec = activity.duration_sec

  const mapCoords = activity.summary_polyline ? decodePolyline(activity.summary_polyline) : null

  return (
    <SafeAreaView style={styles.container}>
      <Pressable style={styles.back} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={20} color={C.accent} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.name}>{activity.name}</Text>
        <Text style={styles.meta}>
          {activity.type} · {new Date(activity.date).toLocaleDateString(undefined, {
            day: 'numeric', month: 'long', year: 'numeric',
          })} · {formatDuration(totalTimeSec)}
        </Text>

        {mapCoords && mapCoords.length > 1 && (
          <View style={styles.mapContainer}>
            <MapView
              style={styles.map}
              initialRegion={getBoundingRegion(mapCoords)}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
            >
              <Polyline coordinates={mapCoords} strokeColor={C.accent} strokeWidth={3} />
            </MapView>
          </View>
        )}

        {/* HR stats */}
        {(activity.avg_hr != null || activity.total_kcal != null) && (
          <View style={styles.statsRow}>
            {activity.avg_hr != null && (
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{activity.avg_hr}</Text>
                <Text style={styles.statLabel}>Avg HR</Text>
              </View>
            )}
            {activity.max_hr != null && (
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{activity.max_hr}</Text>
                <Text style={styles.statLabel}>Max HR</Text>
              </View>
            )}
            {activity.total_kcal != null && (
              <View style={[styles.statBox, styles.statBoxOrange]}>
                <Text style={[styles.statValue, styles.statValueOrange]}>
                  {Math.round(activity.total_kcal)}
                </Text>
                <Text style={[styles.statLabel, styles.statLabelOrange]}>kcal</Text>
              </View>
            )}
          </View>
        )}

        {/* Fat / carb breakdown */}
        {(activity.total_fat_g != null || activity.total_carb_g != null) && (
          <View style={styles.statsRow}>
            {activity.total_fat_g != null && (
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{Math.round(activity.total_fat_g)}g</Text>
                <Text style={styles.statLabel}>Fat burned</Text>
              </View>
            )}
            {activity.total_carb_g != null && (
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{Math.round(activity.total_carb_g)}g</Text>
                <Text style={styles.statLabel}>Carbs burned</Text>
              </View>
            )}
          </View>
        )}

        {/* Zone breakdown */}
        {sortedSplits.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Heart rate zones</Text>
            <View style={styles.stackedBar}>
              {sortedSplits.map((split) => (
                <View
                  key={split.id}
                  style={[
                    styles.stackedSegment,
                    {
                      flex: split.time_in_zone_sec / totalTimeSec,
                      backgroundColor: ZONE_COLORS[(split.zone.zone_number - 1) % ZONE_COLORS.length],
                    },
                  ]}
                />
              ))}
            </View>
            {sortedSplits.map((split) => {
              const pct = Math.round((split.time_in_zone_sec / totalTimeSec) * 100)
              const color = ZONE_COLORS[(split.zone.zone_number - 1) % ZONE_COLORS.length]
              return (
                <View key={split.id} style={styles.zoneRow}>
                  <View style={[styles.zoneDot, { backgroundColor: color }]} />
                  <View style={styles.zoneInfo}>
                    <Text style={styles.zoneName}>{split.zone.name}</Text>
                    <Text style={styles.zoneBpm}>{split.zone.min_bpm}–{split.zone.max_bpm} bpm</Text>
                  </View>
                  <View style={styles.zoneStats}>
                    <Text style={styles.zoneTime}>{formatDuration(split.time_in_zone_sec)}</Text>
                    {split.kcal_in_zone > 0 && (
                      <Text style={styles.zoneKcal}>{Math.round(split.kcal_in_zone)} kcal</Text>
                    )}
                  </View>
                  <Text style={styles.zonePct}>{pct}%</Text>
                </View>
              )
            })}
          </>
        )}

        {sortedSplits.length === 0 && (
          <View style={styles.noHrCard}>
            <Text style={styles.noHrTitle}>No heart rate data</Text>
            <Text style={styles.noHrText}>
              This activity has no HR stream. Zone breakdown is unavailable.
            </Text>
          </View>
        )}

        {/* Laps */}
        {sortedLaps.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Laps</Text>
            {sortedLaps.map((lap) => {
              const speed = formatLapSpeed(lap, activity.type)
              const distance = lap.distance_m
                ? lap.distance_m >= 1000
                  ? `${(lap.distance_m / 1000).toFixed(2)} km`
                  : `${Math.round(lap.distance_m)} m`
                : null
              return (
                <View key={lap.id} style={styles.lapRow}>
                  <View style={styles.lapIndex}>
                    <Text style={styles.lapIndexText}>{lap.lap_index}</Text>
                  </View>
                  <View style={styles.lapMain}>
                    {distance && <Text style={styles.lapDistance}>{distance}</Text>}
                    <View style={styles.lapSecondary}>
                      {speed && <Text style={styles.lapStat}>{speed}</Text>}
                      {lap.avg_watts != null && (
                        <Text style={styles.lapStat}>{Math.round(lap.avg_watts)} W</Text>
                      )}
                      {lap.avg_hr != null && (
                        <Text style={styles.lapStat}>{lap.avg_hr} bpm</Text>
                      )}
                    </View>
                  </View>
                  <Text style={styles.lapDuration}>{formatDuration(lap.elapsed_time_sec)}</Text>
                </View>
              )
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 12 },
  backText: { fontSize: 15, color: C.accent, fontWeight: '600' },
  content: { padding: 16, paddingTop: 0, paddingBottom: 48 },
  name: { fontSize: 22, fontWeight: '800', color: C.text1, marginBottom: 4 },
  meta: { fontSize: 13, color: C.text2, marginBottom: 20 },
  mapContainer: { height: 200, borderRadius: 14, overflow: 'hidden', marginBottom: 20 },
  map: { flex: 1 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  statBox: {
    flex: 1, backgroundColor: C.surface, borderRadius: 10, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  statBoxOrange: { backgroundColor: C.accentBg, borderColor: C.border },
  statValue: { fontSize: 26, fontWeight: '800', color: C.text1 },
  statValueOrange: { color: C.accent },
  statLabel: { fontSize: 11, color: C.text2, marginTop: 3, fontWeight: '600' },
  statLabelOrange: { color: C.accent },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.text1, marginBottom: 12, marginTop: 4 },
  stackedBar: {
    flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden',
    marginBottom: 16, backgroundColor: C.surface2,
  },
  stackedSegment: { height: 10 },
  zoneRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  zoneDot: { width: 11, height: 11, borderRadius: 6, marginRight: 12 },
  zoneInfo: { flex: 1 },
  zoneName: { fontSize: 14, fontWeight: '600', color: C.text1 },
  zoneBpm: { fontSize: 12, color: C.text3, marginTop: 1 },
  zoneStats: { alignItems: 'flex-end', marginRight: 10 },
  zoneTime: { fontSize: 13, fontWeight: '600', color: C.text1 },
  zoneKcal: { fontSize: 12, color: C.text2 },
  zonePct: { fontSize: 13, fontWeight: '700', width: 34, textAlign: 'right', color: C.text2 },
  noHrCard: {
    backgroundColor: C.surface, borderRadius: 12, padding: 18, marginBottom: 24,
    borderWidth: 1, borderColor: C.border,
  },
  noHrTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4, color: C.text2 },
  noHrText: { fontSize: 13, color: C.text3, lineHeight: 19 },
  lapRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  lapIndex: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.surface2,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  lapIndexText: { fontSize: 12, fontWeight: '700', color: C.text2 },
  lapMain: { flex: 1 },
  lapDistance: { fontSize: 14, fontWeight: '700', color: C.text1, marginBottom: 2 },
  lapSecondary: { flexDirection: 'row', gap: 10 },
  lapStat: { fontSize: 12, color: C.text2 },
  lapDuration: { fontSize: 13, fontWeight: '600', color: C.text2 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: C.text3 },
})
