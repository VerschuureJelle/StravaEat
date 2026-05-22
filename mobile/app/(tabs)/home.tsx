import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, Pressable,
  ActivityIndicator, Modal, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { W as C } from '../../lib/themeWarm'
import {
  bayesianUpdate, calibrationLabel, calibrationConfidencePct,
  PERIOD_DEFAULTS, FEEDBACK_LABELS,
  type PeriodCalibration, type PeriodSeverityCalib,
} from '../../lib/periodCalibration'

// ─── WMO weather code helpers ──────────────────────────────────────────────

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
  73: { label: 'Snow',           icon: 'snow-outline' },
  75: { label: 'Heavy snow',     icon: 'snow-outline' },
  80: { label: 'Rain showers',   icon: 'rainy-outline' },
  81: { label: 'Showers',        icon: 'rainy-outline' },
  95: { label: 'Thunderstorm',   icon: 'thunderstorm-outline' },
  99: { label: 'Thunderstorm',   icon: 'thunderstorm-outline' },
}

function wmo(code: number): { label: string; icon: IoniconsName } {
  const keys = Object.keys(WMO).map(Number).sort((a, b) => b - a)
  const match = keys.find(k => k <= code)
  return WMO[match ?? 0] ?? { label: 'Unknown', icon: 'cloud-outline' }
}

// ─── types ─────────────────────────────────────────────────────────────────

interface HourlyPoint { time: string; temp: number; code: number; rainPct: number; nextDay?: boolean }
interface DailyPoint { dayLabel: string; code: number; tempMax: number; tempMin: number; rainPct: number }
interface Weather {
  city: string; temp: number; tempMax: number; tempMin: number
  wind: number; code: number; hourly: HourlyPoint[]; daily: DailyPoint[]
}
interface TodayActivity { id: string; name: string; type: string; total_kcal: number }
interface PlannedWorkoutItem {
  id: string; sport_type: string; target_kcal: number
  target_duration_min: number | null; target_hr: number | null; workout_description: string | null
  zone_number?: number | null
}
interface FuelingSetting {
  sport_type: string; threshold_min: number; carbs_per_interval_g: number; interval_min: number
}
type TrainingApp = 'trainingpeaks' | 'runna' | null
type WeatherView = 'today' | 'week'

// Vetpercentage per hartslagzone (sport science schatting)
const ZONE_FUEL: Record<number, { fatPct: number; carbPct: number }> = {
  1: { fatPct: 0.80, carbPct: 0.20 },
  2: { fatPct: 0.65, carbPct: 0.35 },
  3: { fatPct: 0.45, carbPct: 0.55 },
  4: { fatPct: 0.25, carbPct: 0.75 },
  5: { fatPct: 0.10, carbPct: 0.90 },
}

function calcWorkoutFuel(kcal: number, zoneNum: number | null | undefined) {
  const split = ZONE_FUEL[zoneNum ?? 3] ?? ZONE_FUEL[3]
  return {
    fatG: Math.round((kcal * split.fatPct) / 9),
    carbG: Math.round((kcal * split.carbPct) / 4),
  }
}

function calcFuelingRec(durationMin: number | null, setting: FuelingSetting | undefined) {
  if (!durationMin || !setting) return null
  if (durationMin <= setting.threshold_min) return null
  const extraMin = durationMin - setting.threshold_min
  const intervals = Math.ceil(extraMin / setting.interval_min)
  return {
    totalCarbs: intervals * setting.carbs_per_interval_g,
    carbs_per_interval_g: setting.carbs_per_interval_g,
    interval_min: setting.interval_min,
    intervals,
  }
}

// ─── weather parsing ───────────────────────────────────────────────────────

function parseHourly(data: any): HourlyPoint[] {
  const now = new Date()
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  const todayStr = now.toISOString().slice(0, 10)
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)
  const result: HourlyPoint[] = []
  for (let i = 0; i < (data.hourly?.time?.length ?? 0); i++) {
    const timeStr: string = data.hourly.time[i]
    const isToday = timeStr.startsWith(todayStr)
    const isTomorrow = timeStr.startsWith(tomorrowStr)
    if (!isToday && !isTomorrow) continue
    const hour = parseInt(timeStr.split('T')[1])
    if (isToday && (hour < currentHour || (hour === currentHour && currentMinute >= 30))) continue
    result.push({
      time: `${String(hour).padStart(2, '0')}:00`,
      temp: Math.round(data.hourly.temperature_2m[i]),
      code: data.hourly.weathercode[i],
      rainPct: data.hourly.precipitation_probability[i] ?? 0,
      nextDay: isTomorrow,
    })
    if (result.length >= 24) break
  }
  return result
}

function parseDaily(data: any): DailyPoint[] {
  const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return (data.daily?.time ?? []).map((dateStr: string, i: number) => ({
    dayLabel: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : SHORT_DAYS[new Date(dateStr + 'T12:00:00').getDay()],
    code: data.daily.weathercode[i],
    tempMax: Math.round(data.daily.temperature_2m_max[i]),
    tempMin: Math.round(data.daily.temperature_2m_min[i]),
    rainPct: data.daily.precipitation_probability_max[i] ?? 0,
  }))
}

// ─── workout recommendation ────────────────────────────────────────────────

type RecommendationLevel = 'good' | 'ok' | 'bad'

function getRecommendation(w: Weather): { text: string; level: RecommendationLevel } {
  const { temp, wind, code, hourly } = w
  if (code >= 95) return { level: 'bad', text: 'Thunderstorm — avoid outdoor training today.' }
  if (code >= 61 && code <= 82) {
    const clearWindow = hourly.filter(h => h.rainPct < 25 && h.code < 60)
    if (clearWindow.length >= 2) {
      return { level: 'ok', text: `Rain expected but a drier window around ${clearWindow[0].time}–${clearWindow[clearWindow.length - 1].time}.` }
    }
    return { level: 'bad', text: 'Rain throughout the day — consider an indoor session.' }
  }
  const upcomingRain = hourly.find(h => h.rainPct > 50)
  if (upcomingRain) return { level: 'ok', text: `Clear now but rain likely around ${upcomingRain.time}.` }
  if (wind > 35) return { level: 'bad', text: `Strong winds (${wind} km/h) — tough for cycling and running.` }
  if (wind > 22) return { level: 'ok', text: `Moderate winds (${wind} km/h) — good for threshold work.` }
  if (temp > 28) return { level: 'ok', text: `Hot at ${temp}°C — train early or late, stay hydrated.` }
  if (temp < 3)  return { level: 'ok', text: `Cold at ${temp}°C — layer up and warm up well.` }
  if (temp >= 10 && temp <= 22 && code <= 2 && wind < 20) {
    return { level: 'good', text: 'Perfect conditions for an outdoor workout today. Go for it!' }
  }
  return { level: 'ok', text: 'Conditions are acceptable for outdoor training today.' }
}

// ─── helpers ───────────────────────────────────────────────────────────────

function greeting(name: string | null): string {
  const h = new Date().getHours()
  const time = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'
  return name ? `${time}, ${name.split(' ')[0]}` : `Good ${time.toLowerCase()}!`
}

function formatDate(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long' })
}

function localDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getSportColor(type: string): string {
  if (/swim/i.test(type)) return C.swim
  if (/run|jog/i.test(type)) return C.run
  if (/walk/i.test(type)) return C.walk
  if (/ride|bike|cycling|virtual/i.test(type)) return C.ride
  return C.sport
}

function getSportIcon(type: string): string {
  if (/swim/i.test(type)) return 'swim'
  if (/run|jog/i.test(type)) return 'run'
  if (/walk/i.test(type)) return 'walk'
  if (/ride|bike|cycling|virtual/i.test(type)) return 'bike'
  return 'lightning-bolt'
}

function getSportGradient(type: string): [string, string] {
  if (/swim/i.test(type))                      return ['#7DD3F8', '#0284C7']
  if (/run|jog/i.test(type))                   return ['#FCA5A5', '#DC2626']
  if (/walk/i.test(type))                       return ['#FED7AA', '#EA580C']
  if (/ride|bike|cycling|virtual/i.test(type)) return ['#86EFAC', '#16A34A']
  return ['#CBD5E1', '#64748B']
}

// ─── training load helpers ────────────────────────────────────────────────

function computeTSS(duration_sec: number, avg_hr: number, max_hr: number): number {
  const threshold_hr = max_hr * 0.88
  const if_value = Math.min(avg_hr / threshold_hr, 1.2)
  return Math.min((duration_sec / 3600) * if_value * if_value * 100, 300)
}

function computeTrainingLoad(
  activities: { date: string; tss: number }[]
): { ctl: number; atl: number; tsb: number } {
  const tssMap: Record<string, number> = {}
  for (const a of activities) {
    const d = (a.date as string).slice(0, 10)
    tssMap[d] = (tssMap[d] ?? 0) + a.tss
  }
  let ctl = 0, atl = 0
  const today = new Date()
  for (let i = 60; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const tss = tssMap[`${y}-${m}-${day}`] ?? 0
    ctl += (tss - ctl) / 42
    atl += (tss - atl) / 7
  }
  return { ctl: Math.round(ctl), atl: Math.round(atl), tsb: Math.round(ctl - atl) }
}

// ─── screen ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter()
  const [userName, setUserName] = useState<string | null>(null)
  const [dailyTarget, setDailyTarget] = useState<number | null>(null)
  const [todayActivities, setTodayActivities] = useState<TodayActivity[]>([])
  const [plannedWorkouts, setPlannedWorkouts] = useState<PlannedWorkoutItem[]>([])
  const [calorieModalOpen, setCalorieModalOpen] = useState(false)
  const [weather, setWeather] = useState<Weather | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(true)
  const [weatherError, setWeatherError] = useState<string | null>(null)
  const [weatherView, setWeatherView] = useState<WeatherView>('today')
  const [connectedApp, setConnectedApp] = useState<TrainingApp>(null)
  const [fuelingSettings, setFuelingSettings] = useState<FuelingSetting[]>([])
  const [zoneMap, setZoneMap] = useState<Record<string, number>>({})
  const [hideCalories, setHideCalories] = useState(false)
  const [maxKcalTarget, setMaxKcalTarget] = useState<number | null>(null)
  const [consumedKcal, setConsumedKcal] = useState(0)
  const [userSex, setUserSex] = useState<string | null>(null)
  const [onPeriod, setOnPeriod] = useState(false)
  const [periodSeverity, setPeriodSeverity] = useState<'minor' | 'medium' | 'severe' | null>(null)
  const [periodCalib, setPeriodCalib] = useState<PeriodCalibration | null>(null)
  const [showPeriodFeedback, setShowPeriodFeedback] = useState(false)
  const [trainingLoad, setTrainingLoad] = useState<{ ctl: number; atl: number; tsb: number } | null>(null)
  const [userMaxHr, setUserMaxHr] = useState<number | null>(null)

  const burnedToday = todayActivities.reduce((s, a) => s + a.total_kcal, 0)
  const plannedKcalToday = plannedWorkouts.reduce((s, p) => s + p.target_kcal, 0)
  const totalTarget = dailyTarget != null ? Math.round(dailyTarget + burnedToday) : null
  const projectedTotal = totalTarget != null ? Math.round(totalTarget + plannedKcalToday) : null
  const displayMaxKcal = maxKcalTarget != null ? Math.round(maxKcalTarget + burnedToday + plannedKcalToday) : null

  useEffect(() => { loadWeather() }, [])
  useFocusEffect(useCallback(() => { loadProfileAndActivities() }, []))

  async function loadProfileAndActivities() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const todayDate = localDate()
    const todayISOStart = `${todayDate}T00:00:00`
    const sixtyDaysAgo = new Date()
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)
    const sixtyDaysAgoStr = `${sixtyDaysAgo.getFullYear()}-${String(sixtyDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(sixtyDaysAgo.getDate()).padStart(2, '0')}`

    const [profileRes, actsRes, plannedRes, zonesRes, fuelingRes, foodRes, histActsRes, calibRes] = await Promise.all([
      supabase.from('users').select('name, daily_kcal_target, max_kcal_target, hide_calories, on_period, period_severity, max_hr, sex').eq('id', user.id).single(),
      supabase.from('activities').select('id, name, type, total_kcal').eq('user_id', user.id)
        .gte('date', todayISOStart).not('total_kcal', 'is', null),
      supabase.from('planned_workouts')
        .select('id, sport_type, target_kcal, target_duration_min, target_hr, workout_description, zone_id')
        .eq('user_id', user.id).eq('planned_for', todayDate),
      supabase.from('heart_rate_zones').select('id, zone_number').eq('user_id', user.id),
      supabase.from('fueling_settings').select('sport_type, threshold_min, carbs_per_interval_g, interval_min').eq('user_id', user.id),
      supabase.from('food_logs').select('kcal').eq('user_id', user.id).eq('date', todayDate),
      supabase.from('activities').select('date, duration_sec, avg_hr').eq('user_id', user.id)
        .gte('date', `${sixtyDaysAgoStr}T00:00:00`).not('avg_hr', 'is', null),
      supabase.from('period_calibration').select('*').eq('user_id', user.id),
    ])
    setUserName(profileRes.data?.name ?? null)
    setDailyTarget(profileRes.data?.daily_kcal_target ?? null)
    setMaxKcalTarget(profileRes.data?.max_kcal_target ?? null)
    setHideCalories(profileRes.data?.hide_calories ?? false)
    setUserSex(profileRes.data?.sex ?? null)
    setOnPeriod(profileRes.data?.on_period ?? false)
    const severity = profileRes.data?.period_severity ?? null
    setPeriodSeverity(severity)
    if (severity && severity !== 'severe') {
      const row = (calibRes.data ?? []).find((r: any) => r.severity === severity) ?? null
      setPeriodCalib(row ? {
        severity: row.severity, mu: row.mu, sigma_sq: row.sigma_sq,
        n_obs: row.n_obs, last_feedback_date: row.last_feedback_date ?? null,
      } : null)
    } else {
      setPeriodCalib(null)
    }
    setConsumedKcal((foodRes.data ?? []).reduce((s: number, l: any) => s + (l.kcal ?? 0), 0))
    setTodayActivities(actsRes.data ?? [])

    // Bouw zone_id → zone_number map
    const zm: Record<string, number> = {}
    for (const z of (zonesRes.data ?? [])) zm[z.id] = z.zone_number
    setZoneMap(zm)

    // Koppel zone_number aan planned workouts
    const planned = (plannedRes.data ?? []).map((w: any) => ({
      ...w,
      zone_number: w.zone_id ? zm[w.zone_id] ?? null : null,
    }))
    setPlannedWorkouts(planned)
    setFuelingSettings(fuelingRes.data ?? [])

    const maxHr = profileRes.data?.max_hr ?? 180
    setUserMaxHr(maxHr)
    const tssActivities = (histActsRes.data ?? []).map((a: any) => ({
      date: a.date as string,
      tss: a.avg_hr ? computeTSS(a.duration_sec ?? 0, a.avg_hr, maxHr) : 0,
    }))
    setTrainingLoad(computeTrainingLoad(tssActivities))
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
          `https://api.open-meteo.com/v1/forecast` +
          `?latitude=${latitude}&longitude=${longitude}` +
          `&current=temperature_2m,weathercode,windspeed_10m` +
          `&hourly=temperature_2m,weathercode,precipitation_probability` +
          `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
          `&timezone=auto&forecast_days=7`,
        ),
      ])
      const city = geoRes[0]?.city ?? geoRes[0]?.district ?? geoRes[0]?.region ?? 'Your location'
      const w = await weatherRes.json()
      setWeather({
        city, temp: Math.round(w.current.temperature_2m),
        tempMax: Math.round(w.daily.temperature_2m_max[0]),
        tempMin: Math.round(w.daily.temperature_2m_min[0]),
        wind: Math.round(w.current.windspeed_10m),
        code: w.current.weathercode,
        hourly: parseHourly(w), daily: parseDaily(w),
      })
    } catch {
      setWeatherError('Could not load weather.')
    } finally {
      setWeatherLoading(false)
    }
  }

  async function submitPeriodFeedback(rating: 1 | 2 | 3 | 4) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || userSex !== 'female' || !periodSeverity || periodSeverity === 'severe') return
    const severity = periodSeverity as PeriodSeverityCalib
    const defaults = PERIOD_DEFAULTS[severity]
    const current = periodCalib ?? { mu: defaults.mu, sigma_sq: defaults.sigma_sq, n_obs: 0 }
    const updated = bayesianUpdate(current.mu, current.sigma_sq, current.mu, rating)
    const todayDate = localDate()
    await supabase.from('period_calibration').upsert({
      user_id: user.id, severity,
      mu: updated.mu, sigma_sq: updated.sigma_sq,
      n_obs: (current.n_obs ?? 0) + 1,
      last_feedback_date: todayDate,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,severity' })
    setPeriodCalib({
      severity, mu: updated.mu, sigma_sq: updated.sigma_sq,
      n_obs: (current.n_obs ?? 0) + 1, last_feedback_date: todayDate,
    })
    setShowPeriodFeedback(false)
  }

  async function deletePlannedWorkout(id: string) {
    const workout = plannedWorkouts.find(w => w.id === id)
    Alert.alert('Delete workout?', `Remove the planned ${workout?.sport_type ?? 'workout'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setPlannedWorkouts(prev => prev.filter(w => w.id !== id))
        await supabase.from('planned_workouts').delete().eq('id', id)
      }},
    ])
  }

  const periodActive = userSex === 'female' && onPeriod

  const burned = Math.round(burnedToday)
  const planned = plannedKcalToday
  const displayKcal = projectedTotal ?? totalTarget

  return (
    <SafeAreaView style={st.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={st.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Gradient hero ─────────────────────────────────── */}
        <LinearGradient
          colors={[C.gradA, C.gradB]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={st.hero}
        >
          <View style={st.heroTop}>
            <View>
              <Text style={st.greetText}>{greeting(userName)}</Text>
              <Text style={st.dateText}>{formatDate()}</Text>
            </View>
            <View style={st.heroTopRight}>
              {weather && (
                <Pressable style={st.heroWeatherBadge} onPress={() => setWeatherView('today')}>
                  <Ionicons name={wmo(weather.code).icon} size={16} color="rgba(255,255,255,0.9)" />
                  <Text style={st.heroWeatherTemp}>{weather.temp}°</Text>
                </Pressable>
              )}
              <Pressable style={st.heroSettingsBtn} onPress={() => router.push('/settings')}>
                <Ionicons name="settings-outline" size={18} color="rgba(255,255,255,0.9)" />
              </Pressable>
            </View>
          </View>

          {/* Big kcal number or progress bar */}
          {hideCalories ? (
            <View style={st.heroKcalBlock}>
              {displayKcal != null ? (
                (() => {
                  const pct = Math.min(consumedKcal / Math.max(displayKcal, 1), 1)
                  const isOver = consumedKcal >= displayKcal
                  const isExceeded = displayMaxKcal != null && consumedKcal > displayMaxKcal
                  const barLabel = isExceeded ? 'Daily maximum exceeded' : isOver ? 'Daily minimum reached' : 'kcal today'
                  return (
                    <>
                      <View style={st.heroProgressTrack}>
                        <LinearGradient
                          colors={['#EF5350', '#FFA726', '#66BB6A']}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={StyleSheet.absoluteFillObject}
                        />
                        <View style={[st.heroProgressMask, { width: `${Math.round((1 - pct) * 100)}%` as any }]} />
                      </View>
                      <Text style={[st.heroKcalLabel, { marginTop: 10 }, isExceeded && { color: '#FF8A80' }]}>
                        {barLabel}
                      </Text>
                    </>
                  )
                })()
              ) : (
                <Text style={st.heroKcalEmpty}>Set a calorie target in Settings</Text>
              )}
            </View>
          ) : (
            <Pressable onPress={() => setCalorieModalOpen(true)} style={st.heroKcalBlock}>
              {displayKcal != null ? (
                (() => {
                  const remaining = displayKcal - consumedKcal
                  const isOver = remaining <= 0
                  const isExceeded = displayMaxKcal != null && consumedKcal > displayMaxKcal
                  return (
                    <>
                      <Text style={[st.heroKcalNum, isExceeded && { color: '#FF8A80' }]}>
                        {isOver ? (isExceeded ? '!' : '✓') : remaining.toLocaleString()}
                      </Text>
                      <Text style={st.heroKcalLabel}>
                        {isExceeded ? 'Daily maximum exceeded' : isOver ? 'Daily minimum reached' : 'kcal remaining today'}
                      </Text>
                      <View style={st.heroKcalSubRow}>
                        <Text style={st.heroKcalSub}>{consumedKcal.toLocaleString()} eaten</Text>
                        <Text style={st.heroKcalSubDot}>·</Text>
                        <Text style={st.heroKcalSub}>{displayKcal.toLocaleString()} target</Text>
                      </View>
                    </>
                  )
                })()
              ) : (
                <Text style={st.heroKcalEmpty}>Set a calorie target in Settings</Text>
              )}
            </Pressable>
          )}

          {/* Stat chips — hidden when hiding calories */}
          {!hideCalories && dailyTarget != null && (
            <View style={st.heroChips}>
              <View style={st.heroChip}>
                <Text style={st.heroChipNum}>{dailyTarget.toLocaleString()}</Text>
                <Text style={st.heroChipLabel}>baseline</Text>
              </View>
              {burned > 0 && (
                <View style={st.heroChip}>
                  <Text style={st.heroChipNum}>+{burned.toLocaleString()}</Text>
                  <Text style={st.heroChipLabel}>burned</Text>
                </View>
              )}
              {planned > 0 && (
                <View style={st.heroChip}>
                  <Text style={st.heroChipNum}>+{planned.toLocaleString()}</Text>
                  <Text style={st.heroChipLabel}>projected</Text>
                </View>
              )}
            </View>
          )}
        </LinearGradient>

        {/* ── Cards that sit below the hero ─────────────────── */}
        <View style={st.cardsArea}>

          {/* Training load card */}
          {trainingLoad != null && trainingLoad.ctl > 0 && (
            <TrainingLoadCard load={trainingLoad} />
          )}

          {/* Today's workout card */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Today's workout</Text>
            {plannedWorkouts.length > 0 ? (
              <PlannedWorkoutList
                workouts={plannedWorkouts}
                fuelingSettings={fuelingSettings}
                onPeriod={periodActive}
                periodSeverity={periodSeverity}
                periodCalib={periodCalib}
                onDelete={deletePlannedWorkout}
              />
            ) : connectedApp === null ? (
              <>
                <Text style={st.connectNote}>
                  Plan a workout in the Planner tab, or connect a training app.
                </Text>
                <View style={st.appRow}>
                  <Pressable style={st.appBtn} onPress={() => setConnectedApp('trainingpeaks')}>
                    <Ionicons name="barbell-outline" size={20} color={C.accent2} />
                    <Text style={st.appBtnText}>TrainingPeaks</Text>
                  </Pressable>
                  <Pressable style={st.appBtn} onPress={() => setConnectedApp('runna')}>
                    <Ionicons name="walk-outline" size={20} color={C.success} />
                    <Text style={st.appBtnText}>Runna</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <WorkoutPlaceholder app={connectedApp} onDisconnect={() => setConnectedApp(null)} />
            )}
          </View>

          {/* Weather card */}
          <View style={st.card}>
            <View style={st.cardHeaderRow}>
              <Text style={st.cardTitle}>Weather</Text>
              {weather && (
                <View style={st.toggle}>
                  {(['today', 'week'] as WeatherView[]).map(v => (
                    <Pressable
                      key={v}
                      style={[st.toggleBtn, weatherView === v && st.toggleBtnActive]}
                      onPress={() => setWeatherView(v)}
                    >
                      <Text style={[st.toggleText, weatherView === v && st.toggleTextActive]}>
                        {v === 'today' ? 'Today' : 'Week'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {weatherLoading && <ActivityIndicator color={C.accent} style={{ marginVertical: 16 }} />}

            {weatherError && (
              <View style={st.weatherError}>
                <Text style={st.weatherErrorText}>{weatherError}</Text>
                <Pressable onPress={loadWeather} style={st.retryBtn}>
                  <Text style={st.retryBtnText}>Retry</Text>
                </Pressable>
              </View>
            )}

            {weather && !weatherLoading && weatherView === 'today' && (
              <TodayWeather weather={weather} />
            )}
            {weather && !weatherLoading && weatherView === 'week' && (
              <WeekForecast daily={weather.daily} />
            )}
          </View>

          {/* Period feedback prompt — shown after workout days */}
          {periodActive && periodSeverity && periodSeverity !== 'severe' &&
            todayActivities.length > 0 &&
            periodCalib?.last_feedback_date !== localDate() && (
            <Pressable style={pf.promptCard} onPress={() => setShowPeriodFeedback(true)}>
              <View style={pf.promptRow}>
                <Ionicons name="rose-outline" size={15} color={C.run} />
                <Text style={pf.promptText}>How did today's adjusted training feel?</Text>
                <Ionicons name="chevron-forward" size={14} color={C.text3} />
              </View>
            </Pressable>
          )}

        </View>
      </ScrollView>

      <CalorieModal
        visible={calorieModalOpen}
        baseline={dailyTarget}
        activities={todayActivities}
        planned={plannedWorkouts}
        totalTarget={projectedTotal ?? totalTarget}
        consumedKcal={consumedKcal}
        onClose={() => setCalorieModalOpen(false)}
      />
      <PeriodFeedbackModal
        visible={showPeriodFeedback}
        severity={periodSeverity}
        periodCalib={periodCalib}
        onSubmit={submitPeriodFeedback}
        onClose={() => setShowPeriodFeedback(false)}
      />
    </SafeAreaView>
  )
}

// ─── Training load card ────────────────────────────────────────────────────

function tsbStatus(tsb: number): { label: string; color: string; icon: string } {
  if (tsb > 15)  return { label: 'Peaking — good time for a race or hard effort', color: '#66BB6A', icon: 'trending-up-outline' }
  if (tsb > 5)   return { label: 'Fresh — ready for quality training', color: '#29B6F6', icon: 'checkmark-circle-outline' }
  if (tsb > -5)  return { label: 'Neutral — balanced load', color: '#90A4AE', icon: 'remove-circle-outline' }
  if (tsb > -15) return { label: 'Building — productive training load', color: '#7E57C2', icon: 'barbell-outline' }
  return { label: 'Fatigued — consider an easier session', color: '#EF5350', icon: 'alert-circle-outline' }
}

function TrainingLoadCard({ load }: { load: { ctl: number; atl: number; tsb: number } }) {
  const status = tsbStatus(load.tsb)
  const tsbPositive = load.tsb >= 0
  return (
    <View style={tl.card}>
      <Text style={tl.title}>Training Load</Text>
      <View style={tl.metrics}>
        <View style={tl.metric}>
          <Text style={tl.metricNum}>{load.ctl}</Text>
          <Text style={tl.metricLabel}>Fitness</Text>
          <Text style={tl.metricSub}>CTL</Text>
        </View>
        <View style={tl.divider} />
        <View style={tl.metric}>
          <Text style={tl.metricNum}>{load.atl}</Text>
          <Text style={tl.metricLabel}>Fatigue</Text>
          <Text style={tl.metricSub}>ATL</Text>
        </View>
        <View style={tl.divider} />
        <View style={tl.metric}>
          <Text style={tl.metricNum}>
            {tsbPositive ? '+' : ''}{load.tsb}
          </Text>
          <Text style={tl.metricLabel}>Form</Text>
          <Text style={tl.metricSub}>TSB</Text>
        </View>
      </View>
      <View style={[tl.statusRow, { backgroundColor: status.color + '18' }]}>
        <Ionicons name={status.icon as any} size={14} color={status.color} style={{ marginTop: 1 }} />
        <Text style={[tl.statusText, { color: status.color }]}>{status.label}</Text>
      </View>
    </View>
  )
}

// ─── Today weather ─────────────────────────────────────────────────────────

function TodayWeather({ weather }: { weather: Weather }) {
  const rec = getRecommendation(weather)
  const recColors = {
    good: { bg: C.successBg,  text: C.success,  icon: 'checkmark-circle-outline' as IoniconsName },
    ok:   { bg: C.warningBg,  text: C.warning,  icon: 'alert-circle-outline' as IoniconsName },
    bad:  { bg: C.dangerBg,   text: C.danger,   icon: 'close-circle-outline' as IoniconsName },
  }[rec.level]

  return (
    <>
      <View style={st.weatherMain}>
        <Ionicons name={wmo(weather.code).icon} size={48} color={C.accent} />
        <View>
          <Text style={st.tempBig}>{weather.temp}°C</Text>
          <Text style={st.tempRange}>{weather.tempMax}° / {weather.tempMin}°</Text>
        </View>
      </View>
      <View style={st.weatherMeta}>
        <WeatherChip icon="location-outline" label={weather.city} />
        <WeatherChip icon="leaf-outline" label={wmo(weather.code).label} />
        <WeatherChip icon="speedometer-outline" label={`${weather.wind} km/h`} />
      </View>

      {weather.hourly.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}
          contentContainerStyle={{ gap: 6, paddingRight: 4 }}>
          {weather.hourly.flatMap((h, i) => {
            const items = []
            if (h.nextDay && !weather.hourly[i - 1]?.nextDay) {
              items.push(
                <View key={`div-${i}`} style={st.dayDivider}>
                  <Text style={st.dayDividerText}>tmr</Text>
                </View>
              )
            }
            items.push(
              <View key={`${h.nextDay ? 'tmr' : 'td'}-${h.time}`} style={st.hourlyItem}>
                <Text style={st.hourlyTime}>{h.time}</Text>
                <Ionicons name={wmo(h.code).icon} size={16} color={C.text3} style={{ marginVertical: 4 }} />
                <Text style={st.hourlyTemp}>{h.temp}°</Text>
                {h.rainPct > 0 && (
                  <Text style={[st.hourlyRain, h.rainPct > 50 && { color: C.rain, fontWeight: '700' }]}>
                    {h.rainPct}%
                  </Text>
                )}
              </View>
            )
            return items
          })}
        </ScrollView>
      )}

      <View style={[st.recBox, { backgroundColor: recColors.bg }]}>
        <Ionicons name={recColors.icon} size={15} color={recColors.text} style={{ marginTop: 1 }} />
        <Text style={[st.recText, { color: recColors.text }]}>{rec.text}</Text>
      </View>
    </>
  )
}

function WeatherChip({ icon, label }: { icon: IoniconsName; label: string }) {
  return (
    <View style={st.weatherMetaItem}>
      <Ionicons name={icon} size={12} color={C.text3} />
      <Text style={st.weatherMetaText}>{label}</Text>
    </View>
  )
}

// ─── Week forecast ──────────────────────────────────────────────────────────

function WeekForecast({ daily }: { daily: DailyPoint[] }) {
  return (
    <View>
      {daily.map((d, i) => (
        <View key={i} style={[st.weekRow, i < daily.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.divider }]}>
          <Text style={[st.weekDay, i === 0 && { fontWeight: '700', color: C.text1 }]}>{d.dayLabel}</Text>
          <Ionicons name={wmo(d.code).icon} size={20} color={i === 0 ? C.accent : C.text3} />
          <View style={{ flexDirection: 'row', gap: 6, marginLeft: 'auto' }}>
            <Text style={st.weekTempHigh}>{d.tempMax}°</Text>
            <Text style={st.weekTempLow}>{d.tempMin}°</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, width: 44, marginLeft: 10 }}>
            {true && (
              <>
                <Ionicons name="water-outline" size={11} color={d.rainPct > 50 ? C.rain : C.text3} />
                <Text style={[st.weekRain, d.rainPct > 50 && { color: C.rain, fontWeight: '700' }]}>
                  {d.rainPct}%
                </Text>
              </>
            )}
          </View>
        </View>
      ))}
    </View>
  )
}

// ─── Planned workout list ──────────────────────────────────────────────────

const PERIOD_ADVICE: Record<string, { intensityReduction: number; restRecommended: boolean; note: string }> = {
  minor: {
    intensityReduction: 0.20, restRecommended: false,
    note: 'Minor symptoms: Z2 −20%, Z3 −30%, Z4 −40%. Keep the structure, lower the load.',
  },
  medium: {
    intensityReduction: 0.40, restRecommended: false,
    note: 'Moderate symptoms: Z2 −40%, Z3 −50%, replace all Z4/Z5 with Z3. No intervals or threshold work.',
  },
  severe: {
    intensityReduction: 1.0, restRecommended: true,
    note: 'Severe symptoms: rest or gentle movement only — stretching, walking, yoga. Skip today\'s training.',
  },
}

function PlannedWorkoutList({ workouts, fuelingSettings, onPeriod, periodSeverity, periodCalib, onDelete }: {
  workouts: PlannedWorkoutItem[]
  fuelingSettings: FuelingSetting[]
  onPeriod: boolean
  periodSeverity: 'minor' | 'medium' | 'severe' | null
  periodCalib?: PeriodCalibration | null
  onDelete: (id: string) => void
}) {
  const baseAdj = onPeriod && periodSeverity ? PERIOD_ADVICE[periodSeverity] : null
  const effectiveReduction = baseAdj && periodSeverity !== 'severe' && periodCalib?.mu != null
    ? periodCalib.mu
    : baseAdj?.intensityReduction ?? 0
  const periodAdj = baseAdj ? { ...baseAdj, intensityReduction: effectiveReduction } : null

  return (
    <View style={{ gap: 10, marginTop: 10 }}>
      {periodAdj && (
        <View style={pw.periodBanner}>
          <Ionicons name="rose-outline" size={15} color={C.run} style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={pw.periodBannerTitle}>
              Period adjustment active — −{Math.round(periodAdj.intensityReduction * 100)}% load
            </Text>
            <Text style={pw.periodBannerNote}>{periodAdj.note}</Text>
            {periodCalib != null && (
              <Text style={pw.periodCalibNote}>
                {calibrationLabel(periodCalib.n_obs)} · {calibrationConfidencePct(
                  periodCalib.sigma_sq,
                  PERIOD_DEFAULTS[periodSeverity as PeriodSeverityCalib]?.sigma_sq ?? periodCalib.sigma_sq,
                )}% personalised
              </Text>
            )}
          </View>
        </View>
      )}
      {workouts.map(w => {
        const color = getSportColor(w.sport_type)
        const icon = getSportIcon(w.sport_type)
        const isAI = Boolean(w.workout_description)
        const restRecommended = periodAdj?.restRecommended ?? false
        const adjustedKcal = periodAdj && !restRecommended ? Math.round(w.target_kcal * (1 - periodAdj.intensityReduction)) : w.target_kcal
        const adjustedDuration = periodAdj && !restRecommended && w.target_duration_min
          ? Math.round(w.target_duration_min * (1 - periodAdj.intensityReduction))
          : w.target_duration_min
        const fuel = w.zone_number != null && !restRecommended ? calcWorkoutFuel(adjustedKcal, w.zone_number) : null
        const fuelSetting = fuelingSettings.find(f => f.sport_type.toLowerCase() === w.sport_type.toLowerCase())
        const rec = calcFuelingRec(adjustedDuration, fuelSetting)

        const gradient = getSportGradient(w.sport_type)
        return (
          <View key={w.id} style={pw.card}>
            <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={pw.cardBar} />
            <View style={pw.cardBody}>
            <View style={pw.row}>
              {isAI
                ? <Ionicons name="sparkles-outline" size={15} color={C.accent2} />
                : <MaterialCommunityIcons name={icon as any} size={17} color={C.text3} />
              }
              <Text style={pw.sport}>{w.sport_type}</Text>
              {isAI && (
                <View style={[pw.aiBadge, { backgroundColor: C.accent2Bg }]}>
                  <Text style={[pw.aiBadgeText, { color: C.accent2 }]}>AI Coach</Text>
                </View>
              )}
              {periodAdj && (
                <View style={pw.periodBadge}>
                  <Ionicons name="rose-outline" size={10} color={C.run} />
                  <Text style={pw.periodBadgeText}>Adjusted</Text>
                </View>
              )}
              <Pressable onPress={() => onDelete(w.id)} style={pw.deleteBtn} hitSlop={8}>
                <Ionicons name="trash-outline" size={15} color={C.text3} />
              </Pressable>
            </View>

            {restRecommended ? (
              <View style={pw.restBox}>
                <Ionicons name="bed-outline" size={15} color={C.run} style={{ marginTop: 1 }} />
                <Text style={pw.restText}>
                  Rest recommended — gentle stretching, walking or yoga only. Original plan: {w.target_kcal} kcal
                  {w.target_duration_min ? `, ${w.target_duration_min} min` : ''}.
                </Text>
              </View>
            ) : w.workout_description ? (
              <>
                <Text style={pw.description} numberOfLines={4}>{w.workout_description}</Text>
                {periodAdj && (
                  <Text style={pw.periodDescNote}>
                    ↓ Z2 −{Math.round(periodAdj.intensityReduction * 100)}%, Z3 −{Math.round(periodAdj.intensityReduction * 100 + 10)}%, Z4 −{Math.round(periodAdj.intensityReduction * 100 + 20)}% for today
                  </Text>
                )}
              </>
            ) : (
              <View style={pw.chips}>
                <View style={[pw.chip, { backgroundColor: color + '18' }]}>
                  <Ionicons name="flame-outline" size={11} color={color} />
                  <Text style={[pw.chipText, { color }]}>
                    {adjustedKcal} kcal
                    {periodAdj ? ` (was ${w.target_kcal})` : ''}
                  </Text>
                </View>
                {adjustedDuration !== null && (
                  <View style={[pw.chip, { backgroundColor: C.surface2 }]}>
                    <Ionicons name="time-outline" size={11} color={C.text2} />
                    <Text style={[pw.chipText, { color: C.text2 }]}>
                      {adjustedDuration} min
                      {periodAdj && w.target_duration_min ? ` (was ${w.target_duration_min})` : ''}
                    </Text>
                  </View>
                )}
                {w.target_hr !== null && (
                  <View style={[pw.chip, { backgroundColor: C.surface2 }]}>
                    <Ionicons name="heart-outline" size={11} color={C.text2} />
                    <Text style={[pw.chipText, { color: C.text2 }]}>{w.target_hr} bpm</Text>
                  </View>
                )}
              </View>
            )}

            {/* Verwachte brandstofverbranding */}
            {fuel && (
              <View style={pw.fuelRow}>
                <View style={pw.fuelItem}>
                  <Ionicons name="water-outline" size={12} color={C.accent2} />
                  <Text style={pw.fuelLabel}>Koolhydraten</Text>
                  <Text style={[pw.fuelValue, { color: C.accent2 }]}>{fuel.carbG}g</Text>
                </View>
                <View style={pw.fuelDivider} />
                <View style={pw.fuelItem}>
                  <Ionicons name="ellipse-outline" size={12} color={C.warning} />
                  <Text style={pw.fuelLabel}>Vet</Text>
                  <Text style={[pw.fuelValue, { color: C.warning }]}>{fuel.fatG}g</Text>
                </View>
              </View>
            )}

            {/* Voedingsaanbeveling tijdens training */}
            {rec && (
              <View style={pw.recBox}>
                <Ionicons name="nutrition-outline" size={14} color={C.text3} style={{ marginTop: 1 }} />
                <Text style={[pw.recText, { color: C.text1 }]}>
                  <Text style={{ fontWeight: '700' }}>Eet tijdens training: </Text>
                  {rec.totalCarbs}g koolhydraten ({rec.carbs_per_interval_g}g per {rec.interval_min} min)
                </Text>
              </View>
            )}
            </View>
          </View>
        )
      })}
    </View>
  )
}

// ─── Calorie modal ─────────────────────────────────────────────────────────

function CalorieModal({ visible, baseline, activities, planned, totalTarget, consumedKcal, onClose }: {
  visible: boolean; baseline: number | null; activities: TodayActivity[]
  planned: PlannedWorkoutItem[]; totalTarget: number | null; consumedKcal: number; onClose: () => void
}) {
  const burned = activities.reduce((s, a) => s + a.total_kcal, 0)
  const plannedKcal = planned.reduce((s, p) => s + p.target_kcal, 0)
  const remaining = totalTarget != null ? totalTarget - consumedKcal : null
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={mo.overlay} onPress={onClose}>
        <Pressable style={mo.sheet} onPress={e => e.stopPropagation()}>
          <View style={mo.handle} />
          <Text style={mo.title}>Today's calorie target</Text>
          <Text style={mo.subtitle}>Your target grows with every completed workout.</Text>

          {baseline === null ? (
            <View style={mo.noTarget}>
              <Text style={mo.noTargetText}>No baseline set. Go to Settings → Personal Info to add your daily calorie target.</Text>
            </View>
          ) : (
            <>
              <View style={mo.row}>
                <View style={mo.rowLeft}>
                  <Ionicons name="body-outline" size={16} color={C.text2} />
                  <Text style={mo.rowLabel}>Baseline</Text>
                </View>
                <Text style={mo.rowValue}>{baseline.toLocaleString()} kcal</Text>
              </View>
              {activities.map(a => (
                <View key={a.id} style={mo.row}>
                  <View style={mo.rowLeft}>
                    <MaterialCommunityIcons name={getSportIcon(a.type) as any} size={16} color={getSportColor(a.type)} />
                    <Text style={mo.rowLabel} numberOfLines={1}>{a.name}</Text>
                  </View>
                  <Text style={[mo.rowValue, { color: C.accent }]}>+ {Math.round(a.total_kcal).toLocaleString()} kcal</Text>
                </View>
              ))}
              {activities.length === 0 && (
                <View style={mo.row}>
                  <Text style={mo.noActivity}>No workouts recorded today yet.</Text>
                </View>
              )}
              <View style={mo.divider} />
              <View style={mo.totalRow}>
                <Text style={mo.totalLabel}>Total target</Text>
                <Text style={mo.totalValue}>{(totalTarget ?? 0).toLocaleString()} kcal</Text>
              </View>

              {/* Consumed + remaining row */}
              <View style={mo.consumedRow}>
                <View style={mo.consumedItem}>
                  <Text style={mo.consumedLabel}>Eaten so far</Text>
                  <Text style={mo.consumedValue}>{consumedKcal.toLocaleString()} kcal</Text>
                </View>
                <View style={mo.consumedDivider} />
                <View style={mo.consumedItem}>
                  <Text style={mo.consumedLabel}>
                    {remaining != null && remaining < 0 ? 'Over target' : 'Still to eat'}
                  </Text>
                  <Text style={[mo.consumedValue, remaining != null && remaining < 0 && { color: C.danger }]}>
                    {remaining != null
                      ? `${Math.abs(remaining).toLocaleString()} kcal`
                      : '—'}
                  </Text>
                </View>
              </View>

              {burned > 0 && (
                <View style={mo.infoBox}>
                  <Ionicons name="flame-outline" size={15} color={C.accent} style={{ marginTop: 1 }} />
                  <Text style={mo.infoText}>
                    Eat an extra {Math.round(burned).toLocaleString()} kcal to compensate for your {activities.length === 1 ? 'workout' : 'workouts'}.
                  </Text>
                </View>
              )}
              {planned.length > 0 && (
                <View style={[mo.infoBox, { backgroundColor: C.accent2Bg }]}>
                  <Ionicons name="calendar-outline" size={15} color={C.accent2} style={{ marginTop: 1 }} />
                  <Text style={[mo.infoText, { color: C.accent2 }]}>
                    {planned.length === 1 ? 'A planned workout' : `${planned.length} planned workouts`} targeting {plannedKcal.toLocaleString()} kcal.
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

// ─── Period feedback modal ─────────────────────────────────────────────────

function PeriodFeedbackModal({ visible, severity, periodCalib, onSubmit, onClose }: {
  visible: boolean
  severity: 'minor' | 'medium' | 'severe' | null
  periodCalib: PeriodCalibration | null
  onSubmit: (rating: 1 | 2 | 3 | 4) => void
  onClose: () => void
}) {
  if (!severity || severity === 'severe') return null
  const sev = severity as PeriodSeverityCalib
  const defaults = PERIOD_DEFAULTS[sev]
  const n_obs = periodCalib?.n_obs ?? 0
  const label = calibrationLabel(n_obs)
  const confPct = calibrationConfidencePct(
    periodCalib?.sigma_sq ?? defaults.sigma_sq,
    defaults.sigma_sq,
  )
  const effectivePct = Math.round((periodCalib?.mu ?? defaults.mu) * 100)
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={pf.overlay} onPress={onClose}>
        <Pressable style={pf.sheet} onPress={e => e.stopPropagation()}>
          <View style={pf.handle} />
          <View style={pf.headerRow}>
            <Ionicons name="rose-outline" size={18} color={C.run} />
            <Text style={pf.title}>Period training feedback</Text>
          </View>
          <Text style={pf.subtitle}>
            Today your load was reduced by ~{effectivePct}%. How did that feel?
          </Text>
          <View style={pf.ratingGrid}>
            {([1, 2, 3, 4] as const).map(r => (
              <Pressable key={r} style={pf.ratingBtn} onPress={() => onSubmit(r)}>
                <Text style={pf.ratingText}>{FEEDBACK_LABELS[r]}</Text>
              </Pressable>
            ))}
          </View>
          <View style={pf.calibInfo}>
            <Text style={pf.calibLabel}>{label}</Text>
            {n_obs > 0 && (
              <>
                <View style={pf.calibTrack}>
                  <View style={[pf.calibFill, { width: `${confPct}%` as any }]} />
                </View>
                <Text style={pf.calibSub}>{confPct}% personalised · {n_obs} session{n_obs !== 1 ? 's' : ''}</Text>
              </>
            )}
          </View>
          <Pressable style={pf.skipBtn} onPress={onClose}>
            <Text style={pf.skipText}>Skip for now</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

// ─── Training placeholder ──────────────────────────────────────────────────

function WorkoutPlaceholder({ app, onDisconnect }: { app: TrainingApp; onDisconnect: () => void }) {
  const isTP = app === 'trainingpeaks'
  const color = isTP ? C.accent2 : C.success
  const name = isTP ? 'TrainingPeaks' : 'Runna'
  const workout = isTP
    ? { type: 'Run', title: 'Easy recovery run', duration: '45 min', tss: 38, description: 'Keep HR in zone 2.' }
    : { type: 'Run', title: 'Threshold intervals', duration: '55 min', tss: 72, description: '4 × 8 min at threshold pace.' }
  return (
    <View>
      <View style={[wst.badge, { backgroundColor: color + '18' }]}>
        <Ionicons name={isTP ? 'barbell-outline' : 'walk-outline'} size={12} color={color} />
        <Text style={[wst.badgeText, { color }]}>{name}</Text>
        <Text style={wst.previewLabel}>Preview</Text>
      </View>
      <View style={wst.workoutCard}>
        <Text style={wst.workoutType}>{workout.type}</Text>
        <Text style={wst.workoutTitle}>{workout.title}</Text>
        <Text style={wst.workoutMeta}>{workout.duration} · TSS {workout.tss}</Text>
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
  safeArea: { flex: 1, backgroundColor: C.gradA },
  scroll: { backgroundColor: C.bg, paddingBottom: 48, flexGrow: 1 },

  // Hero
  hero: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  heroTopRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroSettingsBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20,
    padding: 7,
  },
  greetText: { fontSize: 22, fontWeight: '800', color: C.white },
  dateText: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  heroWeatherBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  heroWeatherTemp: { fontSize: 14, fontWeight: '700', color: C.white },
  heroKcalBlock: { marginBottom: 20, width: '100%' },
  heroProgressTrack: {
    height: 12, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 6, overflow: 'hidden',
  },
  heroProgressFill: { height: 12, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 6 },
  heroProgressMask: { position: 'absolute', right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.25)', borderTopRightRadius: 6, borderBottomRightRadius: 6 },
  heroKcalNum: { fontSize: 52, fontWeight: '800', color: C.white, lineHeight: 54 },
  heroKcalLabel: { fontSize: 15, color: 'rgba(255,255,255,0.8)', fontWeight: '500', marginTop: 2 },
  heroKcalEmpty: { fontSize: 15, color: 'rgba(255,255,255,0.7)', fontStyle: 'italic' },
  heroKcalSubRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  heroKcalSub: { fontSize: 13, color: 'rgba(255,255,255,0.75)', fontWeight: '500' },
  heroKcalSubDot: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  heroKcalSubOver: { color: '#FF8A80', fontWeight: '700' },
  heroChips: { flexDirection: 'row', gap: 10 },
  heroChip: {
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  heroChipNum: { fontSize: 15, fontWeight: '800', color: C.white },
  heroChipLabel: { fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 1 },

  // Cards area
  cardsArea: { padding: 16, gap: 14, marginTop: -20 },
  card: {
    backgroundColor: C.surface, borderRadius: 20, padding: 20,
    borderWidth: 1, borderColor: C.border,
    shadowColor: C.accent, shadowOpacity: 0.08, shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: C.text2, textTransform: 'uppercase', letterSpacing: 0.6 },

  // Toggle
  toggle: { flexDirection: 'row', backgroundColor: C.surface2, borderRadius: 8, padding: 2 },
  toggleBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  toggleBtnActive: { backgroundColor: C.surface },
  toggleText: { fontSize: 12, fontWeight: '600', color: C.text3 },
  toggleTextActive: { color: C.text1 },

  // Weather
  weatherMain: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 12 },
  tempBig: { fontSize: 42, fontWeight: '800', color: C.text1, lineHeight: 44 },
  tempRange: { fontSize: 14, color: C.text2, marginTop: 2 },
  weatherMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  weatherMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  weatherMetaText: { fontSize: 13, color: C.text2 },
  hourlyItem: {
    alignItems: 'center', minWidth: 50, paddingHorizontal: 8, paddingVertical: 8,
    backgroundColor: C.surface2, borderRadius: 12, marginRight: 6,
  },
  hourlyTime: { fontSize: 10, color: C.text3, fontWeight: '600' },
  hourlyTemp: { fontSize: 13, fontWeight: '700', color: C.text1 },
  hourlyRain: { fontSize: 10, color: C.text3, marginTop: 2 },
  dayDivider: {
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6, marginRight: 6,
    borderLeftWidth: 1, borderLeftColor: C.border,
  },
  dayDividerText: { fontSize: 9, fontWeight: '700', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5 },
  recBox: { flexDirection: 'row', gap: 8, borderRadius: 12, padding: 12 },
  recText: { flex: 1, fontSize: 13, lineHeight: 19 },

  // Week
  weekRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  weekDay: { fontSize: 14, color: C.text2, width: 84 },
  weekTempHigh: { fontSize: 14, fontWeight: '700', color: C.text1, width: 32, textAlign: 'right' },
  weekTempLow: { fontSize: 14, color: C.text3, width: 32, textAlign: 'right' },
  weekRain: { fontSize: 12, color: C.text3 },

  // Training plan
  connectNote: { fontSize: 14, color: C.text2, lineHeight: 20, marginBottom: 14 },
  appRow: { flexDirection: 'row', gap: 12 },
  appBtn: {
    flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    padding: 16, alignItems: 'center', gap: 8, backgroundColor: C.surface2,
  },
  appBtnText: { fontSize: 13, fontWeight: '700', color: C.text1 },

  // Error
  weatherError: { alignItems: 'center', paddingVertical: 8 },
  weatherErrorText: { fontSize: 13, color: C.text2, marginBottom: 10 },
  retryBtn: { backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  retryBtnText: { color: C.white, fontWeight: '700', fontSize: 13 },
})

const mo = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'C.overlay', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingBottom: 40, paddingTop: 12,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: -4 },
  },
  handle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: '800', color: C.text1, marginBottom: 6 },
  subtitle: { fontSize: 13, color: C.text2, lineHeight: 18, marginBottom: 24 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rowLabel: { fontSize: 15, color: C.text1, flex: 1 },
  rowValue: { fontSize: 15, fontWeight: '600', color: C.text1 },
  noActivity: { fontSize: 13, color: C.text3, fontStyle: 'italic' },
  noTarget: { backgroundColor: C.surface2, borderRadius: 12, padding: 16, marginBottom: 8 },
  noTargetText: { fontSize: 14, color: C.text2, lineHeight: 20 },
  divider: { height: 1, backgroundColor: C.divider, marginVertical: 14 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  totalLabel: { fontSize: 16, fontWeight: '700', color: C.text1 },
  totalValue: { fontSize: 24, fontWeight: '800', color: C.text1 },
  consumedRow: {
    flexDirection: 'row', backgroundColor: C.surface2, borderRadius: 12,
    padding: 14, marginBottom: 12, borderWidth: 1, borderColor: C.border,
  },
  consumedItem: { flex: 1, alignItems: 'center' },
  consumedDivider: { width: 1, backgroundColor: C.border, marginHorizontal: 8 },
  consumedLabel: { fontSize: 11, fontWeight: '700', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  consumedValue: { fontSize: 17, fontWeight: '800', color: C.text1 },
  infoBox: {
    flexDirection: 'row', gap: 8, backgroundColor: C.accentBg,
    borderRadius: 12, padding: 12, marginBottom: 10,
  },
  infoText: { flex: 1, fontSize: 13, color: C.accent, lineHeight: 19 },
  closeBtn: { backgroundColor: C.accent, borderRadius: 14, padding: 16, alignItems: 'center' },
  closeBtnText: { color: C.white, fontWeight: '800', fontSize: 16 },
})

const pw = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'stretch',
    borderRadius: 12, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  cardBar: { width: 5 },
  cardBody: { flex: 1, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sport: { fontSize: 15, fontWeight: '700', textTransform: 'capitalize', flex: 1, color: C.text1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  chipText: { fontSize: 12, fontWeight: '700' },
  description: { fontSize: 13, color: C.text2, lineHeight: 19 },
  aiBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  aiBadgeText: { fontSize: 10, fontWeight: '700' },
  fuelRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface2, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, marginTop: 10, gap: 0,
  },
  fuelItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  fuelDivider: { width: 1, height: 14, backgroundColor: C.border, marginHorizontal: 8 },
  fuelLabel: { fontSize: 11, color: C.text2, flex: 1 },
  fuelValue: { fontSize: 13, fontWeight: '800' },
  recBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    backgroundColor: C.surface2, borderRadius: 10,
    padding: 10, marginTop: 8,
  },
  recText: { flex: 1, fontSize: 12, lineHeight: 17 },

  // Period adjustments
  periodBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(239,83,80,0.08)', borderRadius: 12,
    padding: 12, borderWidth: 1, borderColor: 'rgba(239,83,80,0.2)',
  },
  periodBannerTitle: { fontSize: 12, fontWeight: '800', color: C.run, marginBottom: 2 },
  periodBannerNote: { fontSize: 12, color: C.run, lineHeight: 17, opacity: 0.85 },
  periodBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(239,83,80,0.1)', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  periodBadgeText: { fontSize: 10, fontWeight: '700', color: C.run },
  deleteBtn: { padding: 4, marginLeft: 4 },
  periodDescNote: { fontSize: 11, color: C.run, fontStyle: 'italic', marginTop: 6, opacity: 0.85 },
  periodCalibNote: { fontSize: 10, color: C.run, marginTop: 4, opacity: 0.70 },
  restBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    backgroundColor: 'rgba(239,83,80,0.08)', borderRadius: 10,
    padding: 10, marginTop: 4,
  },
  restText: { flex: 1, fontSize: 12, color: C.run, lineHeight: 18 },
})

const wst = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', marginBottom: 12,
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  previewLabel: { fontSize: 10, color: C.text3, marginLeft: 4 },
  workoutCard: { backgroundColor: C.surface2, borderRadius: 14, padding: 14, marginBottom: 10 },
  workoutType: { fontSize: 11, fontWeight: '700', color: C.text3, textTransform: 'uppercase', marginBottom: 4 },
  workoutTitle: { fontSize: 17, fontWeight: '800', color: C.text1, marginBottom: 4 },
  workoutMeta: { fontSize: 13, color: C.text2, marginBottom: 8 },
  workoutDesc: { fontSize: 13, color: C.text2, lineHeight: 18 },
  disconnectBtn: { paddingVertical: 8, alignItems: 'center' },
  disconnectText: { fontSize: 13, color: C.text3 },
})

const tl = StyleSheet.create({
  card: {
    backgroundColor: C.surface, borderRadius: 20, padding: 20,
    borderWidth: 1, borderColor: C.border,
    shadowColor: C.accent, shadowOpacity: 0.08, shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  title: { fontSize: 13, fontWeight: '700', color: C.text2, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 16 },
  metrics: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  metric: { flex: 1, alignItems: 'center' },
  metricNum: { fontSize: 32, fontWeight: '800', lineHeight: 34, color: C.accent },
  metricLabel: { fontSize: 12, fontWeight: '600', color: C.text2, marginTop: 2 },
  metricSub: { fontSize: 10, color: C.text3, marginTop: 1 },
  divider: { width: 1, height: 44, backgroundColor: C.border, marginHorizontal: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, borderRadius: 10, padding: 10 },
  statusText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
})

const pf = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingBottom: 40, paddingTop: 12,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: -4 },
  },
  handle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  title: { fontSize: 20, fontWeight: '800', color: C.text1 },
  subtitle: { fontSize: 14, color: C.text2, lineHeight: 20, marginBottom: 22 },
  ratingGrid: { gap: 10, marginBottom: 20 },
  ratingBtn: {
    backgroundColor: C.surface2, borderRadius: 14, padding: 16,
    alignItems: 'center', borderWidth: 1, borderColor: C.border,
  },
  ratingText: { fontSize: 15, fontWeight: '700', color: C.text1 },
  calibInfo: {
    backgroundColor: C.surface2, borderRadius: 12, padding: 14,
    marginBottom: 16, gap: 6,
  },
  calibLabel: { fontSize: 12, fontWeight: '700', color: C.text2, textTransform: 'uppercase', letterSpacing: 0.5 },
  calibTrack: { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  calibFill: { height: 6, backgroundColor: C.accent, borderRadius: 3 },
  calibSub: { fontSize: 11, color: C.text3 },
  skipBtn: { paddingVertical: 10, alignItems: 'center' },
  skipText: { fontSize: 14, color: C.text3 },
  promptCard: {
    backgroundColor: C.surface, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: 'rgba(239,83,80,0.25)',
  },
  promptRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  promptText: { flex: 1, fontSize: 14, fontWeight: '600', color: C.text1 },
})
