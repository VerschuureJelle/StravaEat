import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, SectionList, ScrollView, Pressable, StyleSheet,
  RefreshControl, Alert, ActivityIndicator, Modal, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { notifyWorkoutSynced } from '../../lib/notifications'
import { W as C } from '../../lib/themeWarm'
import type { Activity } from '../../types'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!

type Period = 'total' | 'day' | 'week' | 'month' | 'year' | 'custom'

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: 'All activities', value: 'total' },
  { label: 'Day', value: 'day' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
  { label: 'Year', value: 'year' },
  { label: 'Custom range…', value: 'custom' },
]

// ─── sport helpers ─────────────────────────────────────────────────────────

function normalizeType(type: string): string {
  if (type === 'VirtualRide') return 'Ride'
  if (type === 'VirtualRun') return 'Run'
  return type
}

function getSportColor(type: string): string {
  if (/swim/i.test(type)) return C.swim
  if (/run|jog/i.test(type)) return C.run
  if (/walk/i.test(type)) return C.walk
  if (/ride|bike|cycling|virtual/i.test(type)) return C.ride
  return C.walk
}

function getSportIcon(type: string): string {
  if (/swim/i.test(type)) return 'swim'
  if (/run|jog/i.test(type)) return 'run'
  if (/walk/i.test(type)) return 'walk'
  if (/ride|bike|cycling|virtual/i.test(type)) return 'bike'
  return 'lightning-bolt'
}

const SPORT_ORDER: Record<string, number> = { Run: 0, Ride: 1, Swim: 2 }
function sortSportEntries<T>(entries: [string, T][]): [string, T][] {
  return [...entries].sort(([a], [b]) => {
    const oa = SPORT_ORDER[a] ?? 99, ob = SPORT_ORDER[b] ?? 99
    if (oa !== ob) return oa - ob
    return a.localeCompare(b)
  })
}

// ─── date helpers ──────────────────────────────────────────────────────────

function startOf(period: Exclude<Period, 'total' | 'custom'>, anchor: Date): Date {
  const d = new Date(anchor)
  switch (period) {
    case 'day': d.setHours(0, 0, 0, 0); return d
    case 'week': { const dow = d.getDay(); d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); d.setHours(0, 0, 0, 0); return d }
    case 'month': d.setDate(1); d.setHours(0, 0, 0, 0); return d
    case 'year': d.setMonth(0, 1); d.setHours(0, 0, 0, 0); return d
  }
}
function endOf(period: Exclude<Period, 'total' | 'custom'>, start: Date): Date {
  const d = new Date(start)
  switch (period) {
    case 'day': d.setHours(23, 59, 59, 999); return d
    case 'week': d.setDate(d.getDate() + 6); d.setHours(23, 59, 59, 999); return d
    case 'month': d.setMonth(d.getMonth() + 1, 0); d.setHours(23, 59, 59, 999); return d
    case 'year': d.setMonth(11, 31); d.setHours(23, 59, 59, 999); return d
  }
}
function advance(period: Exclude<Period, 'total' | 'custom'>, anchor: Date, delta: number): Date {
  const d = new Date(anchor)
  switch (period) {
    case 'day': d.setDate(d.getDate() + delta); break
    case 'week': d.setDate(d.getDate() + delta * 7); break
    case 'month': d.setMonth(d.getMonth() + delta); break
    case 'year': d.setFullYear(d.getFullYear() + delta); break
  }
  return d
}

function formatNavLabel(period: Exclude<Period, 'total' | 'custom'>, anchor: Date): string {
  const start = startOf(period, anchor), end = endOf(period, start)
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(undefined, o)
  switch (period) {
    case 'day': return fmt(start, { weekday: 'long', day: 'numeric', month: 'long' })
    case 'week': return `${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short', year: 'numeric' })}`
    case 'month': return fmt(start, { month: 'long', year: 'numeric' })
    case 'year': return String(start.getFullYear())
  }
}

function parseDDMMYYYY(s: string): string | null {
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d))
  if (isNaN(date.getTime())) return null
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function dayKey(iso: string) { return iso.slice(0, 10) }
function monthKey(iso: string) { return iso.slice(0, 7) }

function formatDayHeader(dateStr: string): string {
  const today = dayKey(new Date().toISOString())
  const yest = new Date(); yest.setDate(yest.getDate() - 1)
  if (dateStr === today) return 'Today'
  if (dateStr === dayKey(yest.toISOString())) return 'Yesterday'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
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
  isTotal: boolean
  monthStart?: Date
  monthActivities?: Activity[]
  data: ListItem[]
}

// ─── summary ───────────────────────────────────────────────────────────────

function SummaryCard({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) return null
  const byType: Record<string, { n: number; sec: number; distM: number; elevM: number }> = {}
  for (const a of activities) {
    const key = normalizeType(a.type)
    if (!byType[key]) byType[key] = { n: 0, sec: 0, distM: 0, elevM: 0 }
    byType[key].n++
    byType[key].sec += a.duration_sec
    byType[key].distM += a.distance_m ?? 0
    byType[key].elevM += a.elevation_gain_m ?? 0
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sumSt.row}>
      {sortSportEntries(Object.entries(byType)).map(([type, s]) => {
        const color = getSportColor(type)
        const icon = getSportIcon(type)
        return (
          <View key={type} style={[sumSt.card, { borderTopColor: color }]}>
            <View style={sumSt.typeRow}>
              <MaterialCommunityIcons name={icon as any} size={13} color={color} style={{ marginRight: 4 }} />
              <Text style={[sumSt.type, { color }]}>{type}</Text>
            </View>
            <Text style={sumSt.line}>{formatDuration(s.sec)}</Text>
            {s.distM > 0 && <Text style={sumSt.line}>{formatDist(type, s.distM)}</Text>}
            {s.elevM > 0 && !/swim/i.test(type) && <Text style={sumSt.line}>+{Math.round(s.elevM)} m</Text>}
          </View>
        )
      })}
    </ScrollView>
  )
}
const sumSt = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
  card: { backgroundColor: C.surface, borderRadius: 10, padding: 12, minWidth: 100, borderTopWidth: 3, borderWidth: 1, borderColor: C.border },
  typeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  type: { fontSize: 12, fontWeight: '700' },
  line: { fontSize: 12, color: C.text2, marginTop: 1 },
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
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => <Text key={d} style={calSt.label}>{d}</Text>)}
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
  label: { flex: 1, textAlign: 'center', fontSize: 10, color: C.text3, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.285714%', alignItems: 'center', paddingVertical: 3 },
  num: { fontSize: 12, color: C.text2 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.accent, marginTop: 2 },
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

export default function ActivitiesScreen() {
  const router = useRouter()
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncBanner, setSyncBanner] = useState<{ count: number } | null>(null)
  const [period, setPeriod] = useState<Period>('total')
  const [anchor, setAnchor] = useState(new Date())
  const [monthsBack, setMonthsBack] = useState(5)
  const [showCalendars, setShowCalendars] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [customStartText, setCustomStartText] = useState('')
  const [customEndText, setCustomEndText] = useState('')
  const [customStart, setCustomStart] = useState<string | null>(null)
  const [customEnd, setCustomEnd] = useState<string | null>(null)

  const isTotal = period === 'total'
  const isFixed = !isTotal && period !== 'custom'

  const fetchActivities = useCallback(async (
    p: Period, a: Date, mb: number, cStart: string | null, cEnd: string | null,
  ) => {
    let q = supabase.from('activities').select('*').order('date', { ascending: false })
    if (p === 'total') {
      const start = new Date(); start.setMonth(start.getMonth() - mb); start.setDate(1); start.setHours(0, 0, 0, 0)
      q = q.gte('date', start.toISOString())
    } else if (p === 'custom') {
      if (!cStart || !cEnd) { setActivities([]); return }
      q = q.gte('date', cStart).lte('date', cEnd + 'T23:59:59')
    } else {
      const s = startOf(p, a), e = endOf(p, s)
      q = q.gte('date', s.toISOString()).lte('date', e.toISOString())
    }
    const { data } = await q
    setActivities(data ?? [])
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchActivities(period, anchor, monthsBack, customStart, customEnd).finally(() => setLoading(false))
  }, [period, anchor, monthsBack, customStart, customEnd, fetchActivities])

  const syncStrava = useCallback(async () => {
    setSyncing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not signed in')
      const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-recent`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const text = await res.text()
      let json: any = {}
      try { json = JSON.parse(text) } catch { /* non-JSON body from CDN/gateway */ }
      if (!res.ok) {
        if (json.error === 'strava_not_connected') {
          Alert.alert('Strava not connected', 'Link your Strava account via the Settings tab.')
          return
        }
        if (res.status === 429 || String(json.error).startsWith('rate_limit:')) {
          const minutes = String(json.error).startsWith('rate_limit:')
            ? String(json.error).split(':')[1]
            : '15'
          Alert.alert(
            'Strava rate limit reached',
            `Strava only allows a limited number of syncs per 15-minute window. Try again in ${minutes} minute${minutes === '1' ? '' : 's'}.`,
          )
          return
        }
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      await fetchActivities(period, anchor, monthsBack, customStart, customEnd)

      const syncedCount: number = json.synced ?? 0
      setSyncBanner({ count: syncedCount })
      setTimeout(() => setSyncBanner(null), 4000)

      // Notify if any kcal were burned today
      const todayStr = new Date().toISOString().slice(0, 10)
      const [actsRes, profileRes] = await Promise.all([
        supabase.from('activities').select('total_kcal').eq('user_id', session.user.id)
          .gte('date', todayStr).not('total_kcal', 'is', null),
        supabase.from('users').select('daily_kcal_target').eq('id', session.user.id).single(),
      ])
      const burnedToday = (actsRes.data ?? []).reduce((s: number, a: any) => s + (a.total_kcal ?? 0), 0)
      if (burnedToday > 0) {
        const baseline = profileRes.data?.daily_kcal_target ?? null
        const newTarget = baseline != null ? baseline + Math.round(burnedToday) : null
        notifyWorkoutSynced(burnedToday, newTarget)
      }
    } catch (err: any) {
      Alert.alert('Sync failed', err.message ?? 'Something went wrong')
    } finally { setSyncing(false) }
  }, [period, anchor, monthsBack, customStart, customEnd, fetchActivities])

  function selectPeriod(p: Period) {
    setPeriod(p)
    setAnchor(new Date())
    setMonthsBack(5)
    if (p !== 'custom') { setCustomStart(null); setCustomEnd(null) }
    setDropdownOpen(false)
  }

  function applyCustomDates() {
    const s = parseDDMMYYYY(customStartText)
    const e = parseDDMMYYYY(customEndText)
    if (s && e && s <= e) { setCustomStart(s); setCustomEnd(e) }
  }

  function getPeriodButtonLabel(): string {
    if (period === 'total') return 'All activities'
    if (period === 'custom') {
      if (customStart && customEnd) {
        const fmt = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
        return `${fmt(customStart)} – ${fmt(customEnd)}`
      }
      return 'Custom range'
    }
    return formatNavLabel(period, anchor)
  }

  const sections = isTotal || period === 'custom'
    ? buildMonthSections(activities)
    : buildDaySections(activities)

  const listHeader = (
    <View>
      {/* Period selector */}
      <Pressable style={st.selectorBtn} onPress={() => setDropdownOpen(true)}>
        <Text style={st.selectorText} numberOfLines={1}>{getPeriodButtonLabel()}</Text>
        <Ionicons name="chevron-down" size={14} color={C.text2} style={{ marginLeft: 6 }} />
      </Pressable>

      {/* Custom date inputs */}
      {period === 'custom' && (
        <View style={st.customRange}>
          <View style={st.customField}>
            <Text style={st.customLabel}>FROM</Text>
            <TextInput
              style={st.customInput}
              placeholder="DD-MM-YYYY"
              placeholderTextColor={C.text3}
              value={customStartText}
              onChangeText={setCustomStartText}
              onBlur={applyCustomDates}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <Text style={st.customSep}>–</Text>
          <View style={st.customField}>
            <Text style={st.customLabel}>TO</Text>
            <TextInput
              style={st.customInput}
              placeholder="DD-MM-YYYY"
              placeholderTextColor={C.text3}
              value={customEndText}
              onChangeText={setCustomEndText}
              onBlur={applyCustomDates}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <Pressable style={st.applyBtn} onPress={applyCustomDates}>
            <Text style={st.applyBtnText}>Go</Text>
          </Pressable>
        </View>
      )}

      {/* Navigation for fixed periods */}
      {isFixed && (
        <View style={st.navRow}>
          <Pressable onPress={() => setAnchor(a => advance(period, a, -1))} style={st.navBtn}>
            <Text style={st.navArrow}>‹</Text>
          </Pressable>
          <Pressable onPress={() => setAnchor(a => advance(period, a, 1))} style={st.navBtn}>
            <Text style={st.navArrow}>›</Text>
          </Pressable>
        </View>
      )}

      {syncBanner && (
        <View style={[st.syncBanner, syncBanner.count === 0 && st.syncBannerNeutral]}>
          <Ionicons
            name={syncBanner.count === 0 ? 'checkmark-circle-outline' : 'cloud-download-outline'}
            size={16}
            color={syncBanner.count === 0 ? C.text2 : C.accent}
          />
          <Text style={[st.syncBannerText, syncBanner.count === 0 && st.syncBannerTextNeutral]}>
            {syncBanner.count === 0
              ? 'You are completely up to date'
              : `${syncBanner.count} new ${syncBanner.count === 1 ? 'activity' : 'activities'} synced`}
          </Text>
        </View>
      )}

      <View style={st.divider} />
      <SummaryCard activities={activities} />
      {activities.length > 0 && <View style={st.divider} />}
    </View>
  )

  if (loading) {
    return (
      <SafeAreaView style={st.container}>
        {listHeader}
        <ActivityIndicator style={{ flex: 1 }} size="large" color={C.accent} />
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
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={syncStrava} tintColor={C.accent} />}
        renderSectionHeader={({ section: s }) => {
          if (s.isTotal) {
            return (
              <View style={st.monthHeader}>
                <View style={st.monthHeaderRow}>
                  <Text style={st.monthHeaderText}>{s.title}</Text>
                </View>
                {showCalendars && <MonthCalendar monthStart={s.monthStart!} activities={s.monthActivities!} />}
              </View>
            )
          }
          return <View style={st.dayHeader}><Text style={st.dayHeaderText}>{s.title}</Text></View>
        }}
        renderItem={({ item }) => {
          if (item._t === 'day') {
            return <View style={st.dayHeader}><Text style={st.dayHeaderText}>{item.label}</Text></View>
          }
          const a = item.act
          const color = getSportColor(a.type)
          const icon = getSportIcon(a.type)
          return (
            <Pressable style={[st.card, { borderLeftColor: color }]} onPress={() => router.push(`/activity/${a.id}`)}>
              <View style={st.cardLeft}>
                <Text style={st.actName} numberOfLines={1}>{a.name}</Text>
                <View style={st.actMetaRow}>
                  <MaterialCommunityIcons name={icon as any} size={12} color={color} style={{ marginRight: 4 }} />
                  <Text style={st.actMeta}>
                    {normalizeType(a.type)}{a.distance_m ? ` · ${formatDist(a.type, a.distance_m)}` : ''} · {formatDuration(a.duration_sec)}
                  </Text>
                </View>
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
            <Text style={st.loadMoreText}>Load more months</Text>
          </Pressable>
        ) : null}
        ListEmptyComponent={
          <View style={st.emptyBox}>
            <Text style={st.emptyTitle}>No activities</Text>
            <Text style={st.emptySub}>
              {period === 'custom' && (!customStart || !customEnd)
                ? 'Enter a date range above.'
                : 'Pull down to sync with Strava.'}
            </Text>
          </View>
        }
      />

      {/* Period dropdown modal */}
      <Modal visible={dropdownOpen} transparent animationType="fade">
        <Pressable style={st.modalOverlay} onPress={() => setDropdownOpen(false)}>
          <Pressable style={st.dropdownSheet} onPress={e => e.stopPropagation()}>
            <Text style={st.dropdownTitle}>View period</Text>
            {PERIOD_OPTIONS.map(opt => (
              <Pressable key={opt.value} style={st.dropdownRow} onPress={() => selectPeriod(opt.value)}>
                <Text style={[st.dropdownRowText, period === opt.value && st.dropdownRowActive]}>
                  {opt.label}
                </Text>
                {period === opt.value && <Ionicons name="checkmark" size={16} color={C.accent} />}
              </Pressable>
            ))}
            <View style={st.dropdownDivider} />
            <Pressable style={st.dropdownRow} onPress={() => setShowCalendars(v => !v)}>
              <Text style={st.dropdownRowText}>Show calendars</Text>
              <Ionicons name={showCalendars ? 'toggle' : 'toggle-outline'} size={26} color={showCalendars ? C.accent : C.text3} />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  selectorBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, marginTop: 12, marginBottom: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: C.surface2, borderRadius: 10,
  },
  selectorText: { fontSize: 15, fontWeight: '700', color: C.text1, flex: 1 },

  customRange: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 16, paddingBottom: 10,
  },
  customField: { flex: 1 },
  customLabel: { fontSize: 10, fontWeight: '700', color: C.text3, marginBottom: 4, textTransform: 'uppercase' },
  customInput: {
    borderWidth: 1, borderColor: C.border, borderRadius: 8,
    padding: 9, fontSize: 13, backgroundColor: C.surface2, color: C.text1,
  },
  customSep: { fontSize: 18, color: C.text3, marginBottom: 10 },
  applyBtn: { backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 1 },
  applyBtnText: { color: C.white, fontWeight: '700', fontSize: 13 },

  navRow: { flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 6, gap: 4 },
  navBtn: { padding: 6 },
  navArrow: { fontSize: 26, color: C.text2, lineHeight: 30 },

  calToggleBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  calToggleText: { fontSize: 13, color: C.accent, fontWeight: '600' },
  divider: { height: 1, backgroundColor: C.divider },

  monthHeader: { backgroundColor: C.bg, paddingTop: 16 },
  monthHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 6 },
  monthHeaderText: { fontSize: 16, fontWeight: '800', color: C.text1 },
  calToggleBtn2: { paddingVertical: 4, paddingHorizontal: 8 },
  calToggleText2: { fontSize: 12, color: C.accent, fontWeight: '600' },

  dayHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 5 },
  dayHeaderText: { fontSize: 12, fontWeight: '700', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8 },

  card: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14, marginHorizontal: 16, marginBottom: 8,
    borderRadius: 12, backgroundColor: C.surface,
    borderLeftWidth: 4,
  },
  cardLeft: { flex: 1, marginRight: 12 },
  actName: { fontSize: 15, fontWeight: '700', marginBottom: 4, color: C.text1 },
  actMetaRow: { flexDirection: 'row', alignItems: 'center' },
  actMeta: { fontSize: 13, color: C.text2 },
  cardRight: { alignItems: 'flex-end' },
  kcal: { fontSize: 20, fontWeight: '800', color: C.accent },
  kcalLbl: { fontSize: 11, color: C.accent, fontWeight: '600' },
  noData: { fontSize: 20, color: C.text4, fontWeight: '300' },

  loadMoreBtn: { margin: 20, padding: 14, borderRadius: 10, backgroundColor: C.surface2, alignItems: 'center' },
  loadMoreText: { fontSize: 14, color: C.text2, fontWeight: '600' },

  emptyBox: { paddingHorizontal: 24, paddingVertical: 32, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6, color: C.text1 },
  emptySub: { fontSize: 13, color: C.text2, textAlign: 'center', lineHeight: 19 },

  // Dropdown modal
  modalOverlay: {
    flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end',
  },
  dropdownSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderTopColor: C.border,
    paddingTop: 8, paddingBottom: 40,
  },
  dropdownTitle: {
    fontSize: 12, fontWeight: '700', color: C.text3, textTransform: 'uppercase',
    letterSpacing: 0.8, paddingHorizontal: 20, paddingVertical: 12,
  },
  dropdownRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 15, borderTopWidth: 1, borderTopColor: C.divider,
  },
  dropdownRowText: { fontSize: 16, color: C.text1 },
  dropdownRowActive: { color: C.accent, fontWeight: '700' },
  dropdownDivider: { height: 1, backgroundColor: C.surface2, marginVertical: 4 },
  syncBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.accentBg, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    marginHorizontal: 16, marginTop: 10,
    borderWidth: 1, borderColor: C.accent + '44',
  },
  syncBannerNeutral: { backgroundColor: C.surface2, borderColor: C.border },
  syncBannerText: { fontSize: 13, fontWeight: '600', color: C.accent },
  syncBannerTextNeutral: { color: C.text2 },
})
