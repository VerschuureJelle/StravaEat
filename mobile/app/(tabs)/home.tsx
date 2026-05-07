import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, Pressable,
  ActivityIndicator, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'

// ─── theme ─────────────────────────────────────────────────────────────────

const T = {
  bg:       '#F4F4F8',
  surface:  '#FFFFFF',
  surface2: '#F0F0F5',
  border:   '#E8E8F0',
  divider:  '#F0F0F5',
  gradA:    '#FF4500',
  gradB:    '#FF8C00',
  accent:   '#FF4500',
  purple:   '#6C5CE7',
  text1:    '#1A1A2E',
  text2:    '#74748A',
  text3:    '#A0A0B0',
} as const

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

interface HourlyPoint { time: string; temp: number; code: number; rainPct: number }
interface DailyPoint { dayLabel: string; code: number; tempMax: number; tempMin: number; rainPct: number }
interface Weather {
  city: string; temp: number; tempMax: number; tempMin: number
  wind: number; code: number; hourly: HourlyPoint[]; daily: DailyPoint[]
}
interface TodayActivity { id: string; name: string; type: string; total_kcal: number }
interface PlannedWorkoutItem {
  id: string; sport_type: string; target_kcal: number
  target_duration_min: number | null; target_hr: number | null; workout_description: string | null
}
type TrainingApp = 'trainingpeaks' | 'runna' | null
type WeatherView = 'today' | 'week'

// ─── weather parsing ───────────────────────────────────────────────────────

function parseHourly(data: any): HourlyPoint[] {
  const todayStr = new Date().toISOString().slice(0, 10)
  const currentHour = new Date().getHours()
  const result: HourlyPoint[] = []
  for (let i = 0; i < (data.hourly?.time?.length ?? 0); i++) {
    const timeStr: string = data.hourly.time[i]
    if (!timeStr.startsWith(todayStr)) continue
    const hour = parseInt(timeStr.split('T')[1])
    if (hour < currentHour) continue
    result.push({
      time: `${String(hour).padStart(2, '0')}:00`,
      temp: Math.round(data.hourly.temperature_2m[i]),
      code: data.hourly.weathercode[i],
      rainPct: data.hourly.precipitation_probability[i] ?? 0,
    })
  }
  return result.slice(0, 12)
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

// ─── screen ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
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

  const burnedToday = todayActivities.reduce((s, a) => s + a.total_kcal, 0)
  const plannedKcalToday = plannedWorkouts.reduce((s, p) => s + p.target_kcal, 0)
  const totalTarget = dailyTarget != null ? dailyTarget + Math.round(burnedToday) : null
  const projectedTotal = totalTarget != null ? totalTarget + plannedKcalToday : null

  useEffect(() => { loadWeather() }, [])
  useFocusEffect(useCallback(() => { loadProfileAndActivities() }, []))

  async function loadProfileAndActivities() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const todayDate = localDate()
    const todayISOStart = `${todayDate}T00:00:00`
    const [profileRes, actsRes, plannedRes] = await Promise.all([
      supabase.from('users').select('name, daily_kcal_target').eq('id', user.id).single(),
      supabase.from('activities').select('id, name, type, total_kcal').eq('user_id', user.id)
        .gte('date', todayISOStart).not('total_kcal', 'is', null),
      supabase.from('planned_workouts')
        .select('id, sport_type, target_kcal, target_duration_min, target_hr, workout_description')
        .eq('user_id', user.id).eq('planned_for', todayDate),
    ])
    setUserName(profileRes.data?.name ?? null)
    setDailyTarget(profileRes.data?.daily_kcal_target ?? null)
    setTodayActivities(actsRes.data ?? [])
    setPlannedWorkouts(plannedRes.data ?? [])
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

  const displayKcal = projectedTotal ?? totalTarget
  const burned = Math.round(burnedToday)
  const planned = plannedKcalToday

  return (
    <SafeAreaView style={st.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={st.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Gradient hero ─────────────────────────────────── */}
        <LinearGradient
          colors={[T.gradA, T.gradB]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={st.hero}
        >
          <View style={st.heroTop}>
            <View>
              <Text style={st.greetText}>{greeting(userName)}</Text>
              <Text style={st.dateText}>{formatDate()}</Text>
            </View>
            {weather && (
              <View style={st.heroWeatherBadge}>
                <Ionicons name={wmo(weather.code).icon} size={16} color="rgba(255,255,255,0.9)" />
                <Text style={st.heroWeatherTemp}>{weather.temp}°</Text>
              </View>
            )}
          </View>

          {/* Big kcal number */}
          <Pressable onPress={() => setCalorieModalOpen(true)} style={st.heroKcalBlock}>
            {displayKcal != null ? (
              <>
                <Text style={st.heroKcalNum}>{displayKcal.toLocaleString()}</Text>
                <Text style={st.heroKcalLabel}>kcal today</Text>
              </>
            ) : (
              <Text style={st.heroKcalEmpty}>Set a calorie target in Settings</Text>
            )}
          </Pressable>

          {/* Stat chips */}
          {dailyTarget != null && (
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

            {weatherLoading && <ActivityIndicator color={T.accent} style={{ marginVertical: 16 }} />}

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

          {/* Today's workout card */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Today's workout</Text>
            {plannedWorkouts.length > 0 ? (
              <PlannedWorkoutList workouts={plannedWorkouts} />
            ) : connectedApp === null ? (
              <>
                <Text style={st.connectNote}>
                  Plan a workout in the Planner tab, or connect a training app.
                </Text>
                <View style={st.appRow}>
                  <Pressable style={st.appBtn} onPress={() => setConnectedApp('trainingpeaks')}>
                    <Ionicons name="barbell-outline" size={20} color="#4A90D9" />
                    <Text style={st.appBtnText}>TrainingPeaks</Text>
                  </Pressable>
                  <Pressable style={st.appBtn} onPress={() => setConnectedApp('runna')}>
                    <Ionicons name="walk-outline" size={20} color="#00C853" />
                    <Text style={st.appBtnText}>Runna</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <WorkoutPlaceholder app={connectedApp} onDisconnect={() => setConnectedApp(null)} />
            )}
          </View>

        </View>
      </ScrollView>

      <CalorieModal
        visible={calorieModalOpen}
        baseline={dailyTarget}
        activities={todayActivities}
        planned={plannedWorkouts}
        totalTarget={projectedTotal ?? totalTarget}
        onClose={() => setCalorieModalOpen(false)}
      />
    </SafeAreaView>
  )
}

// ─── Today weather ─────────────────────────────────────────────────────────

function TodayWeather({ weather }: { weather: Weather }) {
  const rec = getRecommendation(weather)
  const recColors = {
    good: { bg: 'rgba(76,175,80,0.1)',   text: '#388E3C', icon: 'checkmark-circle-outline' as IoniconsName },
    ok:   { bg: 'rgba(255,152,0,0.1)',   text: '#E65100', icon: 'alert-circle-outline' as IoniconsName },
    bad:  { bg: 'rgba(239,83,80,0.1)',   text: '#C62828', icon: 'close-circle-outline' as IoniconsName },
  }[rec.level]

  return (
    <>
      <View style={st.weatherMain}>
        <Ionicons name={wmo(weather.code).icon} size={48} color={T.accent} />
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
          {weather.hourly.map(h => (
            <View key={h.time} style={st.hourlyItem}>
              <Text style={st.hourlyTime}>{h.time}</Text>
              <Ionicons name={wmo(h.code).icon} size={16} color={T.text3} style={{ marginVertical: 4 }} />
              <Text style={st.hourlyTemp}>{h.temp}°</Text>
              {h.rainPct > 0 && (
                <Text style={[st.hourlyRain, h.rainPct > 50 && { color: '#1565C0', fontWeight: '700' }]}>
                  {h.rainPct}%
                </Text>
              )}
            </View>
          ))}
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
      <Ionicons name={icon} size={12} color={T.text3} />
      <Text style={st.weatherMetaText}>{label}</Text>
    </View>
  )
}

// ─── Week forecast ──────────────────────────────────────────────────────────

function WeekForecast({ daily }: { daily: DailyPoint[] }) {
  return (
    <View>
      {daily.map((d, i) => (
        <View key={i} style={[st.weekRow, i < daily.length - 1 && { borderBottomWidth: 1, borderBottomColor: T.divider }]}>
          <Text style={[st.weekDay, i === 0 && { fontWeight: '700', color: T.text1 }]}>{d.dayLabel}</Text>
          <Ionicons name={wmo(d.code).icon} size={20} color={i === 0 ? T.accent : T.text3} />
          <View style={{ flexDirection: 'row', gap: 6, marginLeft: 'auto' }}>
            <Text style={st.weekTempHigh}>{d.tempMax}°</Text>
            <Text style={st.weekTempLow}>{d.tempMin}°</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, width: 44, marginLeft: 10 }}>
            {d.rainPct > 0 && (
              <>
                <Ionicons name="water-outline" size={11} color={d.rainPct > 50 ? '#1565C0' : T.text3} />
                <Text style={[st.weekRain, d.rainPct > 50 && { color: '#1565C0', fontWeight: '700' }]}>
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

function PlannedWorkoutList({ workouts }: { workouts: PlannedWorkoutItem[] }) {
  return (
    <View style={{ gap: 10, marginTop: 10 }}>
      {workouts.map(w => {
        const color = getSportColor(w.sport_type)
        const icon = getSportIcon(w.sport_type)
        const isAI = Boolean(w.workout_description)
        return (
          <View key={w.id} style={[pw.card, { borderLeftColor: isAI ? T.purple : color }]}>
            <View style={pw.row}>
              {isAI
                ? <Ionicons name="sparkles-outline" size={15} color={T.purple} />
                : <MaterialCommunityIcons name={icon as any} size={17} color={color} />
              }
              <Text style={[pw.sport, { color: isAI ? T.purple : T.text1 }]}>{w.sport_type}</Text>
              {isAI && (
                <View style={[pw.aiBadge, { backgroundColor: `${T.purple}18` }]}>
                  <Text style={[pw.aiBadgeText, { color: T.purple }]}>AI Coach</Text>
                </View>
              )}
            </View>
            {w.workout_description ? (
              <Text style={pw.description} numberOfLines={4}>{w.workout_description}</Text>
            ) : (
              <View style={pw.chips}>
                <View style={[pw.chip, { backgroundColor: color + '18' }]}>
                  <Ionicons name="flame-outline" size={11} color={color} />
                  <Text style={[pw.chipText, { color }]}>{w.target_kcal} kcal</Text>
                </View>
                {w.target_duration_min !== null && (
                  <View style={[pw.chip, { backgroundColor: T.surface2 }]}>
                    <Ionicons name="time-outline" size={11} color={T.text2} />
                    <Text style={[pw.chipText, { color: T.text2 }]}>{w.target_duration_min} min</Text>
                  </View>
                )}
                {w.target_hr !== null && (
                  <View style={[pw.chip, { backgroundColor: T.surface2 }]}>
                    <Ionicons name="heart-outline" size={11} color={T.text2} />
                    <Text style={[pw.chipText, { color: T.text2 }]}>{w.target_hr} bpm</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )
      })}
    </View>
  )
}

// ─── Calorie modal ─────────────────────────────────────────────────────────

function CalorieModal({ visible, baseline, activities, planned, totalTarget, onClose }: {
  visible: boolean; baseline: number | null; activities: TodayActivity[]
  planned: PlannedWorkoutItem[]; totalTarget: number | null; onClose: () => void
}) {
  const burned = activities.reduce((s, a) => s + a.total_kcal, 0)
  const plannedKcal = planned.reduce((s, p) => s + p.target_kcal, 0)
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
                  <Ionicons name="body-outline" size={16} color={T.text2} />
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
                  <Text style={[mo.rowValue, { color: T.accent }]}>+ {Math.round(a.total_kcal).toLocaleString()} kcal</Text>
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
              {burned > 0 && (
                <View style={mo.infoBox}>
                  <Ionicons name="flame-outline" size={15} color={T.accent} style={{ marginTop: 1 }} />
                  <Text style={mo.infoText}>
                    Eat an extra {Math.round(burned).toLocaleString()} kcal to compensate for your {activities.length === 1 ? 'workout' : 'workouts'}.
                  </Text>
                </View>
              )}
              {planned.length > 0 && (
                <View style={[mo.infoBox, { backgroundColor: `${T.purple}12` }]}>
                  <Ionicons name="calendar-outline" size={15} color={T.purple} style={{ marginTop: 1 }} />
                  <Text style={[mo.infoText, { color: T.purple }]}>
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

// ─── Training placeholder ──────────────────────────────────────────────────

function WorkoutPlaceholder({ app, onDisconnect }: { app: TrainingApp; onDisconnect: () => void }) {
  const isTP = app === 'trainingpeaks'
  const color = isTP ? '#4A90D9' : '#00C853'
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
  safeArea: { flex: 1, backgroundColor: T.gradA },
  scroll: { backgroundColor: T.bg, paddingBottom: 48 },

  // Hero
  hero: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  greetText: { fontSize: 22, fontWeight: '800', color: '#fff' },
  dateText: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  heroWeatherBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  heroWeatherTemp: { fontSize: 14, fontWeight: '700', color: '#fff' },
  heroKcalBlock: { marginBottom: 20 },
  heroKcalNum: { fontSize: 52, fontWeight: '800', color: '#fff', lineHeight: 54 },
  heroKcalLabel: { fontSize: 15, color: 'rgba(255,255,255,0.8)', fontWeight: '500', marginTop: 2 },
  heroKcalEmpty: { fontSize: 15, color: 'rgba(255,255,255,0.7)', fontStyle: 'italic' },
  heroChips: { flexDirection: 'row', gap: 10 },
  heroChip: {
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  heroChipNum: { fontSize: 15, fontWeight: '800', color: '#fff' },
  heroChipLabel: { fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 1 },

  // Cards area
  cardsArea: { padding: 16, gap: 14, marginTop: -20 },
  card: {
    backgroundColor: T.surface, borderRadius: 20, padding: 20,
    shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: T.text2, textTransform: 'uppercase', letterSpacing: 0.6 },

  // Toggle
  toggle: { flexDirection: 'row', backgroundColor: T.surface2, borderRadius: 8, padding: 2 },
  toggleBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  toggleBtnActive: { backgroundColor: T.surface },
  toggleText: { fontSize: 12, fontWeight: '600', color: T.text3 },
  toggleTextActive: { color: T.text1 },

  // Weather
  weatherMain: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 12 },
  tempBig: { fontSize: 42, fontWeight: '800', color: T.text1, lineHeight: 44 },
  tempRange: { fontSize: 14, color: T.text2, marginTop: 2 },
  weatherMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  weatherMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  weatherMetaText: { fontSize: 13, color: T.text2 },
  hourlyItem: {
    alignItems: 'center', minWidth: 50, paddingHorizontal: 8, paddingVertical: 8,
    backgroundColor: T.surface2, borderRadius: 12, marginRight: 6,
  },
  hourlyTime: { fontSize: 10, color: T.text3, fontWeight: '600' },
  hourlyTemp: { fontSize: 13, fontWeight: '700', color: T.text1 },
  hourlyRain: { fontSize: 10, color: T.text3, marginTop: 2 },
  recBox: { flexDirection: 'row', gap: 8, borderRadius: 12, padding: 12 },
  recText: { flex: 1, fontSize: 13, lineHeight: 19 },

  // Week
  weekRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  weekDay: { fontSize: 14, color: T.text2, width: 84 },
  weekTempHigh: { fontSize: 14, fontWeight: '700', color: T.text1, width: 32, textAlign: 'right' },
  weekTempLow: { fontSize: 14, color: T.text3, width: 32, textAlign: 'right' },
  weekRain: { fontSize: 12, color: T.text3 },

  // Training plan
  connectNote: { fontSize: 14, color: T.text2, lineHeight: 20, marginBottom: 14 },
  appRow: { flexDirection: 'row', gap: 12 },
  appBtn: {
    flex: 1, borderWidth: 1.5, borderColor: T.border, borderRadius: 14,
    padding: 16, alignItems: 'center', gap: 8, backgroundColor: T.surface2,
  },
  appBtnText: { fontSize: 13, fontWeight: '700', color: T.text1 },

  // Error
  weatherError: { alignItems: 'center', paddingVertical: 8 },
  weatherErrorText: { fontSize: 13, color: T.text2, marginBottom: 10 },
  retryBtn: { backgroundColor: T.accent, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
})

const mo = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(26,26,46,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: T.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingBottom: 40, paddingTop: 12,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: -4 },
  },
  handle: { width: 36, height: 4, backgroundColor: T.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: '800', color: T.text1, marginBottom: 6 },
  subtitle: { fontSize: 13, color: T.text2, lineHeight: 18, marginBottom: 24 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.divider,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rowLabel: { fontSize: 15, color: T.text1, flex: 1 },
  rowValue: { fontSize: 15, fontWeight: '600', color: T.text1 },
  noActivity: { fontSize: 13, color: T.text3, fontStyle: 'italic' },
  noTarget: { backgroundColor: T.surface2, borderRadius: 12, padding: 16, marginBottom: 8 },
  noTargetText: { fontSize: 14, color: T.text2, lineHeight: 20 },
  divider: { height: 1, backgroundColor: T.divider, marginVertical: 14 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  totalLabel: { fontSize: 16, fontWeight: '700', color: T.text1 },
  totalValue: { fontSize: 24, fontWeight: '800', color: T.text1 },
  infoBox: {
    flexDirection: 'row', gap: 8, backgroundColor: `${T.accent}12`,
    borderRadius: 12, padding: 12, marginBottom: 10,
  },
  infoText: { flex: 1, fontSize: 13, color: T.accent, lineHeight: 19 },
  closeBtn: { backgroundColor: T.accent, borderRadius: 14, padding: 16, alignItems: 'center' },
  closeBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
})

const pw = StyleSheet.create({
  card: {
    borderLeftWidth: 4, borderRadius: 12, backgroundColor: T.surface2,
    padding: 14, borderWidth: 1, borderColor: T.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sport: { fontSize: 15, fontWeight: '700', textTransform: 'capitalize', flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  chipText: { fontSize: 12, fontWeight: '700' },
  description: { fontSize: 13, color: T.text2, lineHeight: 19 },
  aiBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  aiBadgeText: { fontSize: 10, fontWeight: '700' },
})

const wst = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', marginBottom: 12,
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  previewLabel: { fontSize: 10, color: T.text3, marginLeft: 4 },
  workoutCard: { backgroundColor: T.surface2, borderRadius: 14, padding: 14, marginBottom: 10 },
  workoutType: { fontSize: 11, fontWeight: '700', color: T.text3, textTransform: 'uppercase', marginBottom: 4 },
  workoutTitle: { fontSize: 17, fontWeight: '800', color: T.text1, marginBottom: 4 },
  workoutMeta: { fontSize: 13, color: T.text2, marginBottom: 8 },
  workoutDesc: { fontSize: 13, color: T.text2, lineHeight: 18 },
  disconnectBtn: { paddingVertical: 8, alignItems: 'center' },
  disconnectText: { fontSize: 13, color: T.text3 },
})
