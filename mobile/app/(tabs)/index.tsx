import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, SectionList, ScrollView, Pressable, StyleSheet,
  RefreshControl, Alert, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import type { Activity } from '../../types'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!

type Period = 'total' | 'day' | 'week' | 'month' | 'year'
const PERIODS: { label: string; value: Period }[] = [
  { label: 'Alles', value: 'total' },
  { label: 'Dag', value: 'day' },
  { label: 'Week', value: 'week' },
  { label: 'Maand', value: 'month' },
  { label: 'Jaar', value: 'year' },
]

// ─── date helpers ──────────────────────────────────────────────────────────

function startOf(period: Exclude<Period, 'total'>, anchor: Date): Date {
  const d = new Date(anchor)
  switch (period) {
    case 'day': d.setHours(0, 0, 0, 0); return d
    case 'week': { const dow = d.getDay(); d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); d.setHours(0, 0, 0, 0); return d }
    case 'month': d.setDate(1); d.setHours(0, 0, 0, 0); return d
    case 'year': d.setMonth(0, 1); d.setHours(0, 0, 0, 0); return d
  }
}
function endOf(period: Exclude<Period, 'total'>, start: Date): Date {
  const d = new Date(start)
  switch (period) {
    case 'day': d.setHours(23, 59, 59, 999); return d
    case 'week': d.setDate(d.getDate() + 6); d.setHours(23, 59, 59, 999); return d
    case 'month': d.setMonth(d.getMonth() + 1, 0); d.setHours(23, 59, 59, 999); return d
    case 'year': d.setMonth(11, 31); d.setHours(23, 59, 59, 999); return d
  }
}
function advance(period: Exclude<Period, 'total'>, anchor: Date, delta: number): Date {
  const d = new Date(anchor)
  switch (period) {
    case 'day': d.setDate(d.getDate() + delta); break
    case 'week': d.setDate(d.getDate() + delta * 7); break
    case 'month': d.setMonth(d.getMonth() + delta); break
    case 'year': d.setFullYear(d.getFullYear() + delta); break
  }
  return d
}
function formatNavLabel(period: Exclude<Period, 'total'>, anchor: Date): string {
  const start = startOf(period, anchor), end = endOf(period, start)
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(undefined, o)
  switch (period) {
    case 'day': return fmt(start, { weekday: 'long', day: 'numeric', month: 'long' })
    case 'week': return `${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short', year: 'numeric' })}`
    case 'month': return fmt(start, { month: 'long', year: 'numeric' })
    case 'year': return String(start.getFullYear())
  }
}

function dayKey(iso: string) { return iso.slice(0, 10) }
function monthKey(iso: string) { return iso.slice(0, 7) }

function formatDayHeader(dateStr: string): string {
  const today = dayKey(new Date().toISOString())
  const yest = new Date(); yest.setDate(yest.getDate() - 1)
  if (dateStr === today) return 'Vandaag'
  if (dateStr === dayKey(yest.toISOString())) return 'Gisteren'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}u ${m}m` : `${m}m`
}
function formatDist(type: string, meters: number): string {
  return /swim/i.test(type) ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
}

// ─── list item types ───────────────────────────────────────────────────────

type ListItem =
  | { _k: string; _t: 'day'; label: string }
  | { _k: string; _t: 'act'; act: Activity }

interface ListSection {
  key: string
  title: string
  isTotal: boolean        // true = Total mode section (month), false = day section
  monthStart?: Date
  monthActivities?: Activity[]
  data: ListItem[]
}

// ─── summary ───────────────────────────────────────────────────────────────

function SummaryCard({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) return null
  const byType: Record<string, { n: number; sec: number; distM: number; elevM: number }> = {}
  for (const a of activities) {
    if (!byType[a.type]) byType[a.type] = { n: 0, sec: 0, distM: 0, elevM: 0 }
    byType[a.type].n++
    byType[a.type].sec += a.duration_sec
    byType[a.type].distM += a.distance_m ?? 0
    byType[a.type].elevM += a.elevation_gain_m ?? 0
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sumSt.row}>
      {Object.entries(byType).map(([type, s]) => (
        <View key={type} style={sumSt.card}>
          <Text style={sumSt.type}>{type}</Text>
          <Text style={sumSt.line}>{s.n}×  {formatDuration(s.sec)}</Text>
          {s.distM > 0 && <Text style={sumSt.line}>{formatDist(type, s.distM)}</Text>}
          {s.elevM > 0 && !/swim/i.test(type) && <Text style={sumSt.line}>+{Math.round(s.elevM)} m</Text>}
        </View>
      ))}
    </ScrollView>
  )
}
const sumSt = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
  card: { backgroundColor: '#f8f8f8', borderRadius: 10, padding: 12, minWidth: 110 },
  type: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  line: { fontSize: 12, color: '#666', marginTop: 1 },
})

// ─── month calendar ────────────────────────────────────────────────────────

function MonthCalendar({ monthStart, activities }: { monthStart: Date; activities: Activity[] }) {
  const activeDays = new Set(activities.map(a => dayKey(a.date)))
  const dim = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate()
  const firstDow = (monthStart.getDay() + 6) % 7
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  const y = monthStart.getFullYear(), m = String(monthStart.getMonth() + 1).padStart(2, '0')
  return (
    <View style={calSt.cal}>
      <View style={calSt.labels}>
        {['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].map(d => <Text key={d} style={calSt.label}>{d}</Text>)}
      </View>
      <View style={calSt.grid}>
        {cells.map((day, i) => {
          if (!day) return <View key={`e${i}`} style={calSt.cell} />
          const dateStr = `${y}-${m}-${String(day).padStart(2, '0')}`
          return (
            <View key={day} style={calSt.cell}>
              <Text style={calSt.num}>{day}</Text>
              {activeDays.has(dateStr) && <View style={calSt.dot} />}
            </View>
          )
        })}
      </View>
    </View>
  )
}
const calSt = StyleSheet.create({
  cal: { paddingHorizontal: 16, paddingBottom: 8 },
  labels: { flexDirection: 'row', marginBottom: 2 },
  label: { flex: 1, textAlign: 'center', fontSize: 10, color: '#bbb', fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.285714%', alignItems: 'center', paddingVertical: 3 },
  num: { fontSize: 12, color: '#444' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#FC4C02', marginTop: 2 },
})

// ─── grouping ──────────────────────────────────────────────────────────────

function buildDaySections(acts: Activity[]): ListSection[] {
  const byDay = new Map<string, Activity[]>()
  for (const a of acts) {
    const k = dayKey(a.date)
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k)!.push(a)
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([k, as]) => ({
      key: k, title: formatDayHeader(k), isTotal: false,
      data: as.map(a => ({ _k: a.id, _t: 'act' as const, act: a })),
    }))
}

function buildMonthSections(acts: Activity[]): ListSection[] {
  const byMonth = new Map<string, Activity[]>()
  for (const a of acts) {
    const k = monthKey(a.date)
    if (!byMonth.has(k)) byMonth.set(k, [])
    byMonth.get(k)!.push(a)
  }
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([mk, as]) => {
      const [y, mo] = mk.split('-').map(Number)
      const monthStart = new Date(y, mo - 1, 1)
      const byDay = new Map<string, Activity[]>()
      for (const a of as) {
        const k = dayKey(a.date)
        if (!byDay.has(k)) byDay.set(k, [])
        byDay.get(k)!.push(a)
      }
      const items: ListItem[] = []
      for (const [dk, das] of Array.from(byDay.entries()).sort(([a], [b]) => b.localeCompare(a))) {
        items.push({ _k: `d-${dk}`, _t: 'day', label: formatDayHeader(dk) })
        for (const a of das) items.push({ _k: a.id, _t: 'act', act: a })
      }
      return {
        key: mk, isTotal: true, monthStart, monthActivities: as,
        title: monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        data: items,
      }
    })
}

// ─── screen ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter()
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [period, setPeriod] = useState<Period>('total')
  const [anchor, setAnchor] = useState(new Date())
  const [monthsBack, setMonthsBack] = useState(5)
  const [expandedCals, setExpandedCals] = useState<Set<string>>(new Set())
  const [fixedCalVisible, setFixedCalVisible] = useState(false)

  const fetchActivities = useCallback(async (p: Period, a: Date, mb: number) => {
    let q = supabase.from('activities').select('*').order('date', { ascending: false })
    if (p === 'total') {
      const start = new Date(); start.setMonth(start.getMonth() - mb); start.setDate(1); start.setHours(0, 0, 0, 0)
      q = q.gte('date', start.toISOString())
    } else {
      const s = startOf(p as Exclude<Period, 'total'>, a)
      const e = endOf(p as Exclude<Period, 'total'>, s)
      q = q.gte('date', s.toISOString()).lte('date', e.toISOString())
    }
    const { data } = await q
    setActivities(data ?? [])
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchActivities(period, anchor, monthsBack).finally(() => setLoading(false))
  }, [period, anchor, monthsBack, fetchActivities])

  const syncStrava = useCallback(async () => {
    setSyncing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not signed in')
      const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-recent`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json()
      if (!res.ok) {
        if (json.error === 'strava_not_connected') {
          Alert.alert('Strava niet gekoppeld', 'Koppel je Strava account via het Profiel tab.')
          return
        }
        throw new Error(json.error ?? String(res.status))
      }
      await fetchActivities(period, anchor, monthsBack)
    } catch (err: any) {
      Alert.alert('Sync mislukt', err.message ?? 'Er is iets misgegaan')
    } finally { setSyncing(false) }
  }, [period, anchor, monthsBack, fetchActivities])

  function toggleCal(mk: string) {
    setExpandedCals(prev => {
      const next = new Set(prev)
      next.has(mk) ? next.delete(mk) : next.add(mk)
      return next
    })
  }

  function switchPeriod(p: Period) {
    setPeriod(p); setAnchor(new Date()); setMonthsBack(5)
    setExpandedCals(new Set()); setFixedCalVisible(false)
  }

  const isTotal = period === 'total'
  const sections = isTotal ? buildMonthSections(activities) : buildDaySections(activities)

  const listHeader = (
    <View>
      {/* Period tabs */}
      <View style={st.periodRow}>
        {PERIODS.map(p => (
          <Pressable key={p.value}
            style={[st.periodBtn, period === p.value && st.periodBtnActive]}
            onPress={() => switchPeriod(p.value)}>
            <Text style={[st.periodText, period === p.value && st.periodTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Navigation (fixed periods only) */}
      {!isTotal && (
        <View style={st.navRow}>
          <Pressable onPress={() => setAnchor(a => advance(period as Exclude<Period, 'total'>, a, -1))} style={st.navBtn}>
            <Text style={st.navArrow}>‹</Text>
          </Pressable>
          <Text style={st.navLabel}>{formatNavLabel(period as Exclude<Period, 'total'>, anchor)}</Text>
          <Pressable onPress={() => setAnchor(a => advance(period as Exclude<Period, 'total'>, a, 1))} style={st.navBtn}>
            <Text style={st.navArrow}>›</Text>
          </Pressable>
        </View>
      )}

      {/* Calendar toggle (month mode only) */}
      {period === 'month' && (
        <View>
          <Pressable style={st.calToggleBtn} onPress={() => setFixedCalVisible(v => !v)}>
            <Text style={st.calToggleText}>{fixedCalVisible ? 'Verberg kalender ▲' : 'Toon kalender ▼'}</Text>
          </Pressable>
          {fixedCalVisible && (
            <MonthCalendar monthStart={startOf('month', anchor)} activities={activities} />
          )}
        </View>
      )}

      <View style={st.divider} />

      {/* Summary */}
      <SummaryCard activities={activities} />
      {activities.length > 0 && <View style={st.divider} />}
    </View>
  )

  if (loading) {
    return (
      <SafeAreaView style={st.container}>
        {listHeader}
        <ActivityIndicator style={{ flex: 1 }} size="large" color="#FC4C02" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={st.container}>
      <SectionList
        sections={sections}
        keyExtractor={item => item._k}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={listHeader}
        contentContainerStyle={sections.length === 0 ? st.emptyContainer : { paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={syncStrava} tintColor="#FC4C02" />}
        renderSectionHeader={({ section: s }) => {
          if (s.isTotal) {
            const expanded = expandedCals.has(s.key)
            return (
              <View style={st.monthHeader}>
                <View style={st.monthHeaderRow}>
                  <Text style={st.monthHeaderText}>{s.title}</Text>
                  <Pressable onPress={() => toggleCal(s.key)} style={st.calToggleBtn2}>
                    <Text style={st.calToggleText2}>{expanded ? '▲' : '▼'} Kalender</Text>
                  </Pressable>
                </View>
                {expanded && <MonthCalendar monthStart={s.monthStart!} activities={s.monthActivities!} />}
              </View>
            )
          }
          // Fixed period: day section header
          return (
            <View style={st.dayHeader}>
              <Text style={st.dayHeaderText}>{s.title}</Text>
            </View>
          )
        }}
        renderItem={({ item }) => {
          if (item._t === 'day') {
            return <View style={st.dayHeader}><Text style={st.dayHeaderText}>{item.label}</Text></View>
          }
          const a = item.act
          return (
            <Pressable style={st.card} onPress={() => router.push(`/activity/${a.id}`)}>
              <View style={st.cardLeft}>
                <Text style={st.actName} numberOfLines={1}>{a.name}</Text>
                <Text style={st.actMeta}>
                  {a.type}{a.distance_m ? ` · ${formatDist(a.type, a.distance_m)}` : ''} · {formatDuration(a.duration_sec)}
                </Text>
              </View>
              <View style={st.cardRight}>
                {a.total_kcal != null
                  ? <><Text style={st.kcal}>{Math.round(a.total_kcal)}</Text><Text style={st.kcalLbl}>kcal</Text></>
                  : <Text style={st.noData}>—</Text>}
              </View>
            </Pressable>
          )
        }}
        ListFooterComponent={isTotal ? (
          <Pressable style={st.loadMoreBtn} onPress={() => setMonthsBack(n => n + 3)}>
            <Text style={st.loadMoreText}>Meer maanden laden</Text>
          </Pressable>
        ) : null}
        ListEmptyComponent={
          <View style={st.empty}>
            <Text style={st.emptyTitle}>Geen activiteiten</Text>
            <Text style={st.emptySub}>Trek omlaag om te synchroniseren met Strava.</Text>
          </View>
        }
      />
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  periodRow: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, gap: 6 },
  periodBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center', backgroundColor: '#f0f0f0' },
  periodBtnActive: { backgroundColor: '#FC4C02' },
  periodText: { fontSize: 12, fontWeight: '600', color: '#555' },
  periodTextActive: { color: '#fff' },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 8 },
  navBtn: { padding: 8 },
  navArrow: { fontSize: 28, color: '#333', lineHeight: 32 },
  navLabel: { fontSize: 15, fontWeight: '700', color: '#333' },
  calToggleBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  calToggleText: { fontSize: 13, color: '#FC4C02', fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#f0f0f0' },
  monthHeader: { backgroundColor: '#fff', paddingTop: 16 },
  monthHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 6 },
  monthHeaderText: { fontSize: 16, fontWeight: '800', color: '#111' },
  calToggleBtn2: { paddingVertical: 4, paddingHorizontal: 8 },
  calToggleText2: { fontSize: 12, color: '#FC4C02', fontWeight: '600' },
  dayHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 5 },
  dayHeaderText: { fontSize: 12, fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.8 },
  card: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14, marginHorizontal: 16, marginBottom: 8, borderRadius: 12, backgroundColor: '#f8f8f8',
  },
  cardLeft: { flex: 1, marginRight: 12 },
  actName: { fontSize: 15, fontWeight: '700', marginBottom: 3 },
  actMeta: { fontSize: 13, color: '#888' },
  cardRight: { alignItems: 'flex-end' },
  kcal: { fontSize: 20, fontWeight: '800', color: '#FC4C02' },
  kcalLbl: { fontSize: 11, color: '#FC4C02', fontWeight: '600' },
  noData: { fontSize: 20, color: '#ccc', fontWeight: '300' },
  loadMoreBtn: { margin: 20, padding: 14, borderRadius: 10, backgroundColor: '#f0f0f0', alignItems: 'center' },
  loadMoreText: { fontSize: 14, color: '#666', fontWeight: '600' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  empty: { alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#999', textAlign: 'center' },
})
