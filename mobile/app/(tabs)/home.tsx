import { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, Pressable,
  ActivityIndicator, Alert, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'

// ─── WMO weather code mapping ──────────────────────────────────────────────

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']

const WMO: Record<number, { label: string; icon: IoniconsName }> = {
  0:  { label: 'Clear sky',      icon: 'sunny-outline' },
  1:  { label: 'Mainly clear',   icon: 'sunny-outline' },
  2:  { label: 'Partly cloudy',  icon: 'partly-sunny-outline' },
  3:  { label: 'Overcast',       icon: 'cloudy-outline' },
  45: { label: 'Foggy',          icon: 'cloud-outline' },
  48: { label: 'Icy fog',        icon: 'cloud-outline' },
  51: { label: 'Light drizzle',  icon: 'rainy-outline' },
  53: { label: 'Drizzle',        icon: 'rainy-outline' },
  55: { label: 'Heavy drizzle',  icon: 'rainy-outline' },
  61: { label: 'Light rain',     icon: 'rainy-outline' },
  63: { label: 'Moderate rain',  icon: 'rainy-outline' },
  65: { label: 'Heavy rain',     icon: 'rainy-outline' },
  71: { label: 'Light snow',     icon: 'snow-outline' },
  73: { label: 'Moderate snow',  icon: 'snow-outline' },
  75: { label: 'Heavy snow',     icon: 'snow-outline' },
  80: { label: 'Rain showers',   icon: 'rainy-outline' },
  81: { label: 'Showers',        icon: 'rainy-outline' },
  95: { label: 'Thunderstorm',   icon: 'thunderstorm-outline' },
  99: { label: 'Thunderstorm',   icon: 'thunderstorm-outline' },
}

function wmo(code: number) {
  const keys = Object.keys(WMO).map(Number).sort((a, b) => b - a)
  const match = keys.find(k => k <= code)
  return WMO[match ?? 0] ?? { label: 'Unknown', icon: 'cloud-outline' as IoniconsName }
}

function greeting(name: string | null): string {
  const h = new Date().getHours()
  const time = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  return `Good ${time}${name ? `, ${name.split(' ')[0]}` : ''}!`
}

function formatDate(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function getSportColor(type: string): string {
  if (/swim/i.test(type)) return '#29B6F6'
  if (/run|jog/i.test(type)) return '#EF5350'
  if (/walk/i.test(type)) return '#FF8A65'
  if (/ride|bike|cycling|virtual/i.test(type)) return '#66BB6A'
  return '#90A4AE'
}

function getSportIcon(type: string): string {
  if (/swim/i.test(type)) return 'swim'
  if (/run|jog/i.test(type)) return 'run'
  if (/walk/i.test(type)) return 'walk'
  if (/ride|bike|cycling|virtual/i.test(type)) return 'bike'
  return 'lightning-bolt'
}

// ─── types ─────────────────────────────────────────────────────────────────

interface Weather {
  city: string
  temp: number
  tempMax: number
  tempMin: number
  wind: number
  code: number
}

interface TodayActivity {
  id: string
  name: string
  type: string
  total_kcal: number
}

type TrainingApp = 'trainingpeaks' | 'runna' | null

// ─── screen ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const [userName, setUserName] = useState<string | null>(null)
  const [dailyTarget, setDailyTarget] = useState<number | null>(null)
  const [todayActivities, setTodayActivities] = useState<TodayActivity[]>([])
  const [calorieModalOpen, setCalorieModalOpen] = useState(false)

  const [weather, setWeather] = useState<Weather | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(true)
  const [weatherError, setWeatherError] = useState<string | null>(null)

  const [connectedApp, setConnectedApp] = useState<TrainingApp>(null)

  const burnedToday = todayActivities.reduce((s, a) => s + a.total_kcal, 0)
  const totalTarget = dailyTarget != null ? dailyTarget + Math.round(burnedToday) : null

  useEffect(() => {
    loadProfileAndActivities()
    loadWeather()
  }, [])

  async function loadProfileAndActivities() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [profileRes, actsRes] = await Promise.all([
      supabase.from('users').select('name, daily_kcal_target').eq('id', user.id).single(),
      supabase.from('activities')
        .select('id, name, type, total_kcal')
        .eq('user_id', user.id)
        .gte('date', todayStart.toISOString())
        .not('total_kcal', 'is', null),
    ])

    setUserName(profileRes.data?.name ?? null)
    setDailyTarget(profileRes.data?.daily_kcal_target ?? null)
    setTodayActivities(actsRes.data ?? [])
  }

  async function loadWeather() {
    setWeatherLoading(true)
    setWeatherError(null)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') { setWeatherError('Location permission denied.'); return }

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const { latitude, longitude } = loc.coords

      const [geoRes, weatherRes] = await Promise.all([
        Location.reverseGeocodeAsync({ latitude, longitude }),
        fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
          `&current=temperature_2m,weathercode,windspeed_10m` +
          `&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`,
        ),
      ])

      const city = geoRes[0]?.city ?? geoRes[0]?.district ?? geoRes[0]?.region ?? 'Your location'
      const w = await weatherRes.json()

      setWeather({
        city,
        temp: Math.round(w.current.temperature_2m),
        tempMax: Math.round(w.daily.temperature_2m_max[0]),
        tempMin: Math.round(w.daily.temperature_2m_min[0]),
        wind: Math.round(w.current.windspeed_10m),
        code: w.current.weathercode,
      })
    } catch {
      setWeatherError('Could not load weather.')
    } finally {
      setWeatherLoading(false)
    }
  }

  function handleConnectApp(app: TrainingApp) {
    Alert.alert(
      `Connect ${app === 'trainingpeaks' ? 'TrainingPeaks' : 'Runna'}`,
      "This integration is coming soon. Tap Preview to see what it'll look like.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Preview', onPress: () => setConnectedApp(app) },
      ],
    )
  }

  return (
    <SafeAreaView style={st.container}>
      <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>

        {/* ── Greeting ──────────────────────────────────── */}
        <View style={st.greetCard}>
          <Text style={st.greetText}>{greeting(userName)}</Text>
          <Text style={st.dateText}>{formatDate()}</Text>
        </View>

        {/* ── Calorie target ────────────────────────────── */}
        <CalorieWidget
          baseline={dailyTarget}
          activities={todayActivities}
          totalTarget={totalTarget}
          onPress={() => setCalorieModalOpen(true)}
        />

        {/* ── Weather ───────────────────────────────────── */}
        <View style={st.card}>
          <Text style={st.cardTitle}>Weather</Text>
          {weatherLoading && <ActivityIndicator color="#FC4C02" style={{ marginVertical: 12 }} />}
          {weatherError && (
            <View style={st.weatherError}>
              <Text style={st.weatherErrorText}>{weatherError}</Text>
              <Pressable onPress={loadWeather} style={st.retryBtn}>
                <Text style={st.retryBtnText}>Retry</Text>
              </Pressable>
            </View>
          )}
          {weather && !weatherLoading && (
            <>
              <View style={st.weatherMain}>
                <Ionicons name={wmo(weather.code).icon} size={48} color="#FC4C02" />
                <View style={st.weatherTemps}>
                  <Text style={st.tempBig}>{weather.temp}°C</Text>
                  <Text style={st.tempRange}>{weather.tempMax}° / {weather.tempMin}°</Text>
                </View>
              </View>
              <View style={st.weatherMeta}>
                <View style={st.weatherMetaItem}>
                  <Ionicons name="location-outline" size={13} color="#aaa" />
                  <Text style={st.weatherMetaText}>{weather.city}</Text>
                </View>
                <View style={st.weatherMetaItem}>
                  <Ionicons name="leaf-outline" size={13} color="#aaa" />
                  <Text style={st.weatherMetaText}>{wmo(weather.code).label}</Text>
                </View>
                <View style={st.weatherMetaItem}>
                  <Ionicons name="speedometer-outline" size={13} color="#aaa" />
                  <Text style={st.weatherMetaText}>{weather.wind} km/h wind</Text>
                </View>
              </View>
            </>
          )}
        </View>

        {/* ── Today's planned workout ───────────────────── */}
        <View style={st.card}>
          <Text style={st.cardTitle}>Today's workout</Text>
          {connectedApp === null ? (
            <>
              <Text style={st.connectNote}>
                Connect a training app to see your planned workout for today.
              </Text>
              <View style={st.appRow}>
                <Pressable style={st.appBtn} onPress={() => handleConnectApp('trainingpeaks')}>
                  <Ionicons name="barbell-outline" size={22} color="#4A90D9" />
                  <Text style={st.appBtnText}>TrainingPeaks</Text>
                </Pressable>
                <Pressable style={st.appBtn} onPress={() => handleConnectApp('runna')}>
                  <Ionicons name="walk-outline" size={22} color="#00C853" />
                  <Text style={st.appBtnText}>Runna</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <WorkoutPlaceholder app={connectedApp} onDisconnect={() => setConnectedApp(null)} />
          )}
        </View>

      </ScrollView>

      {/* ── Calorie breakdown modal ───────────────────── */}
      <CalorieModal
        visible={calorieModalOpen}
        baseline={dailyTarget}
        activities={todayActivities}
        totalTarget={totalTarget}
        onClose={() => setCalorieModalOpen(false)}
      />
    </SafeAreaView>
  )
}

// ─── Calorie widget ────────────────────────────────────────────────────────

function CalorieWidget({
  baseline, activities, totalTarget, onPress,
}: {
  baseline: number | null
  activities: TodayActivity[]
  totalTarget: number | null
  onPress: () => void
}) {
  if (baseline === null) {
    return (
      <Pressable style={[st.card, st.calorieCardEmpty]} onPress={onPress}>
        <Ionicons name="flame-outline" size={22} color="#aaa" />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={st.calorieEmptyTitle}>Set a daily calorie target</Text>
          <Text style={st.calorieEmptyNote}>Add your baseline in Settings → Personal Info</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#ccc" />
      </Pressable>
    )
  }

  const burned = activities.reduce((s, a) => s + a.total_kcal, 0)

  return (
    <Pressable style={st.card} onPress={onPress}>
      <View style={st.calorieTitleRow}>
        <Text style={st.cardTitle}>Today's calorie target</Text>
        <Ionicons name="chevron-forward" size={14} color="#ccc" />
      </View>
      <Text style={st.calorieTotal}>{(totalTarget ?? 0).toLocaleString()} kcal</Text>
      <View style={st.calorieBreakdownRow}>
        <Text style={st.calorieBase}>{baseline.toLocaleString()} baseline</Text>
        {burned > 0 && (
          <Text style={st.calorieBurned}>+ {Math.round(burned).toLocaleString()} burned</Text>
        )}
      </View>
      {activities.length > 0 && (
        <View style={st.caloriePillRow}>
          {activities.map(a => (
            <View key={a.id} style={[st.caloriePill, { backgroundColor: getSportColor(a.type) + '22' }]}>
              <MaterialCommunityIcons name={getSportIcon(a.type) as any} size={11} color={getSportColor(a.type)} />
              <Text style={[st.caloriePillText, { color: getSportColor(a.type) }]}>
                +{Math.round(a.total_kcal)} kcal
              </Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  )
}

// ─── Calorie breakdown modal ───────────────────────────────────────────────

function CalorieModal({
  visible, baseline, activities, totalTarget, onClose,
}: {
  visible: boolean
  baseline: number | null
  activities: TodayActivity[]
  totalTarget: number | null
  onClose: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={mo.overlay} onPress={onClose}>
        <Pressable style={mo.sheet} onPress={e => e.stopPropagation()}>
          <View style={mo.handle} />
          <Text style={mo.title}>Today's calorie target</Text>
          <Text style={mo.subtitle}>
            Your baseline increases with every workout you complete today.
          </Text>

          {baseline === null ? (
            <View style={mo.noTarget}>
              <Text style={mo.noTargetText}>
                No baseline set. Go to Settings → Personal Info to add your daily calorie target.
              </Text>
            </View>
          ) : (
            <>
              {/* Baseline row */}
              <View style={mo.row}>
                <View style={mo.rowLeft}>
                  <Ionicons name="body-outline" size={16} color="#888" />
                  <Text style={mo.rowLabel}>Baseline</Text>
                </View>
                <Text style={mo.rowValue}>{baseline.toLocaleString()} kcal</Text>
              </View>

              {/* Activity rows */}
              {activities.map(a => (
                <View key={a.id} style={mo.row}>
                  <View style={mo.rowLeft}>
                    <MaterialCommunityIcons name={getSportIcon(a.type) as any} size={16} color={getSportColor(a.type)} />
                    <Text style={mo.rowLabel} numberOfLines={1}>{a.name}</Text>
                  </View>
                  <Text style={[mo.rowValue, mo.rowValueBurned]}>
                    + {Math.round(a.total_kcal).toLocaleString()} kcal
                  </Text>
                </View>
              ))}

              {activities.length === 0 && (
                <View style={mo.row}>
                  <Text style={mo.noActivity}>No workouts recorded today yet.</Text>
                </View>
              )}

              {/* Divider + total */}
              <View style={mo.divider} />
              <View style={mo.totalRow}>
                <Text style={mo.totalLabel}>Total target</Text>
                <Text style={mo.totalValue}>{(totalTarget ?? 0).toLocaleString()} kcal</Text>
              </View>

              {activities.length > 0 && (
                <View style={mo.tipBox}>
                  <Ionicons name="information-circle-outline" size={15} color="#FC4C02" style={{ marginTop: 1 }} />
                  <Text style={mo.tipText}>
                    Eat an extra {Math.round(activities.reduce((s, a) => s + a.total_kcal, 0)).toLocaleString()} kcal
                    today to compensate for your {activities.length === 1 ? 'workout' : 'workouts'}.
                  </Text>
                </View>
              )}
            </>
          )}

          <Pressable style={mo.closeBtn} onPress={onClose}>
            <Text style={mo.closeBtnText}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

// ─── Training plan placeholder ─────────────────────────────────────────────

function WorkoutPlaceholder({ app, onDisconnect }: { app: TrainingApp; onDisconnect: () => void }) {
  const isTP = app === 'trainingpeaks'
  const color = isTP ? '#4A90D9' : '#00C853'
  const name = isTP ? 'TrainingPeaks' : 'Runna'
  const workout = isTP
    ? { type: 'Run', title: 'Easy recovery run', duration: '45 min', tss: 38, description: 'Keep HR in zone 2. Focus on easy effort.' }
    : { type: 'Run', title: 'Threshold intervals', duration: '55 min', tss: 72, description: '4 × 8 min at threshold pace with 3 min recovery.' }

  return (
    <View>
      <View style={[wst.appBadge, { backgroundColor: color + '18' }]}>
        <Ionicons name={isTP ? 'barbell-outline' : 'walk-outline'} size={13} color={color} />
        <Text style={[wst.appBadgeText, { color }]}>{name}</Text>
        <Text style={wst.previewLabel}>Preview</Text>
      </View>
      <View style={wst.workoutCard}>
        <Text style={wst.workoutType}>{workout.type}</Text>
        <Text style={wst.workoutTitle}>{workout.title}</Text>
        <Text style={wst.workoutMeta}>{workout.duration}  ·  TSS {workout.tss}</Text>
        <Text style={wst.workoutDesc}>{workout.description}</Text>
      </View>
      <Pressable onPress={onDisconnect} style={wst.disconnectBtn}>
        <Text style={wst.disconnectText}>Disconnect {name}</Text>
      </Pressable>
    </View>
  )
}

// ─── styles ────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f9' },
  content: { padding: 16, paddingBottom: 48, gap: 14 },

  greetCard: { backgroundColor: '#FC4C02', borderRadius: 18, padding: 22 },
  greetText: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 4 },
  dateText: { fontSize: 14, color: 'rgba(255,255,255,0.75)' },

  card: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardTitle: { fontSize: 11, fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 12 },

  // Calorie widget
  calorieCardEmpty: { flexDirection: 'row', alignItems: 'center' },
  calorieEmptyTitle: { fontSize: 14, fontWeight: '700', color: '#555' },
  calorieEmptyNote: { fontSize: 12, color: '#aaa', marginTop: 2 },
  calorieTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  calorieTotal: { fontSize: 36, fontWeight: '800', color: '#111', marginBottom: 4 },
  calorieBreakdownRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  calorieBase: { fontSize: 13, color: '#888' },
  calorieBurned: { fontSize: 13, color: '#FC4C02', fontWeight: '600' },
  caloriePillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  caloriePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  caloriePillText: { fontSize: 12, fontWeight: '700' },

  // Weather
  weatherMain: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 14 },
  weatherTemps: {},
  tempBig: { fontSize: 42, fontWeight: '800', color: '#111', lineHeight: 44 },
  tempRange: { fontSize: 14, color: '#888', marginTop: 2 },
  weatherMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  weatherMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  weatherMetaText: { fontSize: 13, color: '#666' },
  weatherError: { alignItems: 'center', paddingVertical: 8 },
  weatherErrorText: { fontSize: 13, color: '#aaa', marginBottom: 10 },
  retryBtn: { backgroundColor: '#FC4C02', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Training plan
  connectNote: { fontSize: 14, color: '#888', lineHeight: 20, marginBottom: 16 },
  appRow: { flexDirection: 'row', gap: 12 },
  appBtn: {
    flex: 1, borderWidth: 1, borderColor: '#eee', borderRadius: 12,
    padding: 16, alignItems: 'center', gap: 8, backgroundColor: '#fafafa',
  },
  appBtnText: { fontSize: 13, fontWeight: '700', color: '#333' },
})

const mo = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingBottom: 40, paddingTop: 12,
  },
  handle: { width: 36, height: 4, backgroundColor: '#e0e0e0', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: '800', color: '#111', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 24 },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rowLabel: { fontSize: 15, color: '#333', flex: 1 },
  rowValue: { fontSize: 15, fontWeight: '600', color: '#333' },
  rowValueBurned: { color: '#FC4C02' },

  noActivity: { fontSize: 13, color: '#bbb', fontStyle: 'italic' },
  noTarget: { backgroundColor: '#f8f8f8', borderRadius: 12, padding: 16, marginBottom: 8 },
  noTargetText: { fontSize: 14, color: '#888', lineHeight: 20 },

  divider: { height: 2, backgroundColor: '#111', marginVertical: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  totalLabel: { fontSize: 16, fontWeight: '700', color: '#111' },
  totalValue: { fontSize: 22, fontWeight: '800', color: '#111' },

  tipBox: { flexDirection: 'row', gap: 8, backgroundColor: '#FFF0EB', borderRadius: 12, padding: 12, marginBottom: 20 },
  tipText: { flex: 1, fontSize: 13, color: '#FC4C02', lineHeight: 19 },

  closeBtn: { backgroundColor: '#111', borderRadius: 12, padding: 15, alignItems: 'center' },
  closeBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})

const wst = StyleSheet.create({
  appBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', marginBottom: 14 },
  appBadgeText: { fontSize: 12, fontWeight: '700' },
  previewLabel: { fontSize: 10, color: '#aaa', marginLeft: 4 },
  workoutCard: { backgroundColor: '#f8f8f8', borderRadius: 12, padding: 14, marginBottom: 12 },
  workoutType: { fontSize: 11, fontWeight: '700', color: '#aaa', textTransform: 'uppercase', marginBottom: 4 },
  workoutTitle: { fontSize: 17, fontWeight: '800', color: '#111', marginBottom: 4 },
  workoutMeta: { fontSize: 13, color: '#888', marginBottom: 8 },
  workoutDesc: { fontSize: 13, color: '#555', lineHeight: 18 },
  disconnectBtn: { paddingVertical: 8, alignItems: 'center' },
  disconnectText: { fontSize: 13, color: '#ccc' },
})
