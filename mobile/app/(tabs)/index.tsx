import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, FlatList, Pressable, StyleSheet,
  RefreshControl, Alert, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import type { Activity } from '../../types'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function HomeScreen() {
  const router = useRouter()
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const fetchActivities = useCallback(async () => {
    const { data } = await supabase
      .from('activities')
      .select('*')
      .order('date', { ascending: false })
      .limit(50)
    setActivities(data ?? [])
  }, [])

  useEffect(() => {
    fetchActivities().finally(() => setLoading(false))
  }, [])

  const onRefresh = async () => {
    setRefreshing(true)
    await fetchActivities()
    setRefreshing(false)
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not signed in')

      const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-recent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      const text = await res.text()
      console.log('Sync response', res.status, text)

      const json = JSON.parse(text)

      if (!res.ok) {
        if (json.error === 'strava_not_connected') {
          Alert.alert('Strava not connected', 'Connect your Strava account in the onboarding screen.')
        } else if (json.error === 'weight_not_set') {
          Alert.alert('Profile incomplete', 'Set your weight in the Profile tab first.')
        } else {
          throw new Error(`${res.status}: ${json.error ?? text}`)
        }
        return
      }

      await fetchActivities()
      const withKcal = json.results.filter((r: any) => r.kcal !== null).length
      Alert.alert('Sync complete', `${json.synced} activities synced, ${withKcal} with HR data.`)
    } catch (err: any) {
      Alert.alert('Sync failed', err.message ?? 'Something went wrong')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ flex: 1 }} size="large" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Activities</Text>
        <Pressable
          style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
          onPress={handleSync}
          disabled={syncing}
        >
          {syncing
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.syncBtnText}>Sync Strava</Text>}
        </Pressable>
      </View>

      <FlatList
        data={activities}
        keyExtractor={(item) => item.id}
        contentContainerStyle={activities.length === 0 ? styles.emptyContainer : { padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No activities yet</Text>
            <Text style={styles.emptySubtitle}>Tap "Sync Strava" to import your recent activities.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/activity/${item.id}`)}>
            <View style={styles.cardLeft}>
              <Text style={styles.activityName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.activityMeta}>
                {item.type} · {formatDate(item.date)} · {formatDuration(item.duration_sec)}
              </Text>
            </View>
            <View style={styles.cardRight}>
              {item.total_kcal != null
                ? <Text style={styles.kcal}>{Math.round(item.total_kcal)}</Text>
                : <Text style={styles.noHr}>—</Text>}
              {item.total_kcal != null && <Text style={styles.kcalLabel}>kcal</Text>}
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  headerTitle: { fontSize: 24, fontWeight: '800' },
  syncBtn: {
    backgroundColor: '#FC4C02',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  syncBtnDisabled: { opacity: 0.6 },
  syncBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  empty: { alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#999', textAlign: 'center' },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: '#f8f8f8',
  },
  cardLeft: { flex: 1, marginRight: 12 },
  activityName: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  activityMeta: { fontSize: 13, color: '#888' },
  cardRight: { alignItems: 'flex-end' },
  kcal: { fontSize: 22, fontWeight: '800', color: '#FC4C02' },
  kcalLabel: { fontSize: 11, color: '#FC4C02', fontWeight: '600' },
  noHr: { fontSize: 20, color: '#ccc', fontWeight: '300' },
})
