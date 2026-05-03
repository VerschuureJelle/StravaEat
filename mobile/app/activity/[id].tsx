import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import type { ActivityWithZones } from '../../types'

const ZONE_COLORS = ['#b3e5fc', '#81d4fa', '#4fc3f7', '#FF9800', '#f44336']

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`
}

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [activity, setActivity] = useState<ActivityWithZones | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from('activities')
        .select(`
          *,
          zone_splits:activity_zone_splits (
            *,
            zone:heart_rate_zones (*)
          )
        `)
        .eq('id', id)
        .single()
      setActivity(data)
      setLoading(false)
    }
    fetch()
  }, [id])

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ flex: 1 }} size="large" />
      </SafeAreaView>
    )
  }

  if (!activity) {
    return (
      <SafeAreaView style={styles.container}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
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
  const totalTimeSec = activity.duration_sec

  return (
    <SafeAreaView style={styles.container}>
      <Pressable style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.name}>{activity.name}</Text>
        <Text style={styles.meta}>
          {activity.type} · {new Date(activity.date).toLocaleDateString(undefined, {
            day: 'numeric', month: 'long', year: 'numeric',
          })} · {formatDuration(totalTimeSec)}
        </Text>

        {activity.total_kcal == null ? (
          <View style={styles.noHrCard}>
            <Text style={styles.noHrTitle}>No heart rate data</Text>
            <Text style={styles.noHrText}>
              This activity was recorded without a heart rate monitor. Energy expenditure cannot be calculated.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.kcalCard}>
              <Text style={styles.kcalValue}>{Math.round(activity.total_kcal)}</Text>
              <Text style={styles.kcalUnit}>kcal</Text>
            </View>

            {sortedSplits.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Zone breakdown</Text>

                {/* Stacked bar */}
                <View style={styles.stackedBar}>
                  {sortedSplits.map((split, i) => {
                    const pct = split.time_in_zone_sec / totalTimeSec
                    return (
                      <View
                        key={split.id}
                        style={[
                          styles.stackedSegment,
                          {
                            flex: pct,
                            backgroundColor: ZONE_COLORS[(split.zone.zone_number - 1) % ZONE_COLORS.length],
                          },
                        ]}
                      />
                    )
                  })}
                </View>

                {/* Zone rows */}
                {sortedSplits.map((split, i) => {
                  const pct = Math.round((split.time_in_zone_sec / totalTimeSec) * 100)
                  const color = ZONE_COLORS[(split.zone.zone_number - 1) % ZONE_COLORS.length]
                  return (
                    <View key={split.id} style={styles.zoneRow}>
                      <View style={[styles.zoneDot, { backgroundColor: color }]} />
                      <View style={styles.zoneInfo}>
                        <Text style={styles.zoneName}>{split.zone.name}</Text>
                        <Text style={styles.zoneBpm}>
                          {split.zone.min_bpm}–{split.zone.max_bpm} bpm
                        </Text>
                      </View>
                      <View style={styles.zoneStats}>
                        <Text style={styles.zoneTime}>{formatDuration(split.time_in_zone_sec)}</Text>
                        <Text style={styles.zoneKcal}>{Math.round(split.kcal_in_zone)} kcal</Text>
                      </View>
                      <Text style={styles.zonePct}>{pct}%</Text>
                    </View>
                  )
                })}
              </>
            )}

            {activity.avg_hr && (
              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{activity.avg_hr}</Text>
                  <Text style={styles.statLabel}>Avg HR (bpm)</Text>
                </View>
                {activity.max_hr && (
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{activity.max_hr}</Text>
                    <Text style={styles.statLabel}>Max HR (bpm)</Text>
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  back: { paddingHorizontal: 16, paddingVertical: 12 },
  backText: { fontSize: 16, color: '#FC4C02', fontWeight: '600' },
  content: { padding: 16, paddingTop: 0, paddingBottom: 40 },
  name: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  meta: { fontSize: 13, color: '#888', marginBottom: 24 },
  kcalCard: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 32,
  },
  kcalValue: { fontSize: 64, fontWeight: '900', color: '#FC4C02', lineHeight: 72 },
  kcalUnit: { fontSize: 20, color: '#FC4C02', fontWeight: '600', marginBottom: 10, marginLeft: 6 },
  noHrCard: {
    backgroundColor: '#FFF8E1',
    borderRadius: 12,
    padding: 20,
    marginTop: 8,
  },
  noHrTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6, color: '#795548' },
  noHrText: { fontSize: 14, color: '#795548', lineHeight: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  stackedBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 20,
    backgroundColor: '#f0f0f0',
  },
  stackedSegment: { height: 12 },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  zoneDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  zoneInfo: { flex: 1 },
  zoneName: { fontSize: 14, fontWeight: '600' },
  zoneBpm: { fontSize: 12, color: '#aaa', marginTop: 1 },
  zoneStats: { alignItems: 'flex-end', marginRight: 12 },
  zoneTime: { fontSize: 13, fontWeight: '600' },
  zoneKcal: { fontSize: 12, color: '#888' },
  zonePct: { fontSize: 14, fontWeight: '700', width: 36, textAlign: 'right', color: '#555' },
  statsRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  statBox: {
    flex: 1,
    backgroundColor: '#f8f8f8',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  statValue: { fontSize: 28, fontWeight: '800' },
  statLabel: { fontSize: 12, color: '#888', marginTop: 4 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: '#999' },
})
