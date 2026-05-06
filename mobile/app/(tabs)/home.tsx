import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, Pressable,
  ActivityIndicator, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'

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

interface HourlyPoint {
  time: string      // "14:00"
  temp: number
  code: number
  rainPct: number
}

interface DailyPoint {
  dayLabel: string  // "Today", "Tomorrow", "Mon" …
  code: number
  tempMax: number
  tempMin: number
  rainPct: number
}

interface Weather {
  city: string
  temp: number
  tempMax: number
  tempMin: number
  wind: number
  code: number
  hourly: HourlyPoint[]
  daily: DailyPoint[]
}

interface TodayActivity {
  id: string
  name: string
  type: string
  total_kcal: number
}

interface PlannedWorkoutItem {
  id: string
  sport_type: string
  target_kcal: number
  target_duration_min: number | null
  target_hr: number | null
  workout_description: string | null
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
      return { level: 'ok', text: `Rain expected but a drier window around ${clearWindow[0].time}–${clearWindow[clearWindow.length - 1].time}. Good time for your workout.` }
    }
    return { level: 'bad', text: 'Rain throughout the day — consider an indoor session.' }
  }

  const upcomingRain = hourly.find(h => h.rainPct > 50)
  if (upcomingRain) {
    return { level: 'ok', text: `Clear now but rain likely around ${upcomingRain.time}. Aim to finish your workout before then.` }
  }

  if (wind > 35) return { level: 'bad', text: `Strong winds (${wind} km/h) — tough for cycling and running. Consider going indoors.` }
  if (wind > 22) return { level: 'ok', text: `Moderate winds (${wind} km/h) — running into the wind on the way back makes for good training.` }

  if (temp > 28) return { level: 'ok', text: `Hot at ${temp}°C — train in the early morning or evening and drink plenty of fluids.` }
  if (temp < 3)  return { level: 'ok', text: `Cold at ${temp}°C — layer up, allow extra warm-up time, and watch for icy surfaces.` }

  if (temp >= 10 && temp <= 22 && code <= 2 && wind < 20) {
    return { level: 'good', text: 'Perfect conditions for an outdoor workout today. Go for it!' }
  }

  return { level: 'ok', text: 'Conditions are acceptable for outdoor training today.' }
}

// ─── greeting ──────────────────────────────────────────────────────────────

function greeting(name: string | null): string {
  const h = new Date().getHours()
  const time = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  return `Good ${time}${name ? `, ${name.split(' ')[0]}` : ''}!`
}

function formatDate(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
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

  // Weather only loads once — GPS is slow and battery-intensive
  useEffect(() => { loadWeather() }, [])

  // Reload calorie data + planned workouts whenever this tab comes into focus
  useFocusEffect(useCallback(() => { loadProfileAndActivities() }, []))

  async function loadProfileAndActivities() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const todayDate = localDate()                         // YYYY-MM-DD in device local time
    const todayISOStart = `${todayDate}T00:00:00`        // local midnight, no TZ suffix
    const [profileRes, actsRes, plannedRes] = await Promise.all([
      supabase.from('users').select('name, daily_kcal_target').eq('id', user.id).single(),
      supabase.from('activities')
        .select('id, name, type, total_kcal')
        .eq('user_id', user.id)
        .gte('date', todayISOStart)
        .not('total_kcal', 'is', null),
      supabase.from('planned_workouts')
        .select('id, sport_type, target_kcal, target_duration_min, target_hr, workout_description')
        .eq('user_id', user.id)
        .eq('planned_for', todayDate),
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
        city,
        temp: Math.round(w.current.temperature_2m),
        tempMax: Math.round(w.daily.temperature_2m_max[0]),
        tempMin: Math.round(w.daily.temperature_2m_min[0]),
        wind: Math.round(w.current.windspeed_10m),
        code: w.current.weathercode,
        hourly: parseHourly(w),
        daily: parseDaily(w),
      })
    } catch {
      setWeatherError('Could not load weather.')
    } finally {
      setWeatherLoading(false)
    }
  }

  function handleConnectApp(app: TrainingApp) {
    setConnectedApp(app)
  }

  return (
    <SafeAreaView style={st.container}>
      <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>

        {/* Greeting */}
        <View style={st.greetCard}>
          <Text style={st.greetText}>{greeting(userName)}</Text>
          <Text style={st.dateText}>{formatDate()}</Text>
        </View>

        {/* Calorie target */}
        <CalorieWidget
          baseline={dailyTarget}
          activities={todayActivities}
          planned={plannedWorkouts}
          totalTarget={projectedTotal ?? totalTarget}
          onPress={() => setCalorieModalOpen(true)}
        />

        {/* Weather */}
        <View style={st.card}>
          {/* Header row: title + toggle */}
          <View style={st.weatherHeaderRow}>
            <Text style={st.cardTitle}>Weather</Text>
            {weather && (
              <View style={st.weatherToggle}>
                <Pressable
                  style={[st.weatherToggleBtn, weatherView === 'today' && st.weatherToggleBtnActive]}
                  onPress={() => setWeatherView('today')}
                >
                  <Text style={[st.weatherToggleText, weatherView === 'today' && st.weatherToggleTextActive]}>
                    Today
                  </Text>
                </Pressable>
                <Pressable
                  style={[st.weatherToggleBtn, weatherView === 'week' && st.weatherToggleBtnActive]}
                  onPress={() => setWeatherView('week')}
                >
                  <Text style={[st.weatherToggleText, weatherView === 'week' && st.weatherToggleTextActive]}>
                    This week
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {weatherLoading && <ActivityIndicator color="#FC4C02" style={{ marginVertical: 16 }} />}

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

        {/* Today's planned workouts */}
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

// ─── Today weather view ────────────────────────────────────────────────────

function TodayWeather({ weather }: { weather: Weather }) {
  const rec = getRecommendation(weather)
  const recColors = {
    good: { bg: '#E8F5E9', text: '#2E7D32', icon: 'checkmark-circle-outline' as IoniconsName },
    ok:   { bg: '#FFF8E1', text: '#F57F17', icon: 'alert-circle-outline' as IoniconsName },
    bad:  { bg: '#FFEBEE', text: '#C62828', icon: 'close-circle-outline' as IoniconsName },
  }[rec.level]

  return (
    <>
      {/* Current conditions */}
      <View style={st.weatherMain}>
        <Ionicons name={wmo(weather.code).icon} size={52} color="#FC4C02" />
        <View>
          <Text style={st.tempBig}>{weather.temp}°C</Text>
          <Text style={st.tempRange}>{weather.tempMax}° / {weather.tempMin}°</Text>
        </View>
      </View>
      <View style={st.weatherMeta}>
        <WeatherMetaChip icon="location-outline" label={weather.city} />
        <WeatherMetaChip icon="leaf-outline" label={wmo(weather.code).label} />
        <WeatherMetaChip icon="speedometer-outline" label={`${weather.wind} km/h`} />
      </View>

      {/* Hourly scroll */}
      {weather.hourly.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.hourlyScroll} contentContainerStyle={st.hourlyContent}>
          {weather.hourly.map(h => (
            <View key={h.time} style={st.hourlyItem}>
              <Text style={st.hourlyTime}>{h.time}</Text>
              <Ionicons name={wmo(h.code).icon} size={18} color="#888" style={{ marginVertical: 4 }} />
              <Text style={st.hourlyTemp}>{h.temp}°</Text>
              {h.rainPct > 0 && (
                <Text style={[st.hourlyRain, h.rainPct > 50 && st.hourlyRainHigh]}>{h.rainPct}%</Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {/* Workout recommendation */}
      <View style={[st.recBox, { backgroundColor: recColors.bg }]}>
        <Ionicons name={recColors.icon} size={16} color={recColors.text} style={{ marginTop: 1 }} />
        <Text style={[st.recText, { color: recColors.text }]}>{rec.text}</Text>
      </View>
    </>
  )
}

function WeatherMetaChip({ icon, label }: { icon: IoniconsName; label: string }) {
  return (
    <View style={st.weatherMetaItem}>
      <Ionicons name={icon} size={13} color="#aaa" />
      <Text style={st.weatherMetaText}>{label}</Text>
    </View>
  )
}

// ─── Week forecast view ────────────────────────────────────────────────────

function WeekForecast({ daily }: { daily: DailyPoint[] }) {
  return (
    <View style={st.weekList}>
      {daily.map((d, i) => (
        <View key={i} style={[st.weekRow, i < daily.length - 1 && st.weekRowBorder]}>
          <Text style={[st.weekDay, i === 0 && st.weekDayToday]}>{d.dayLabel}</Text>
          <Ionicons name={wmo(d.code).icon} size={20} color={i === 0 ? '#FC4C02' : '#888'} />
          <View style={st.weekTemps}>
            <Text style={st.weekTempHigh}>{d.tempMax}°</Text>
            <Text style={st.weekTempLow}>{d.tempMin}°</Text>
          </View>
          <View style={st.weekRainWrap}>
            {d.rainPct > 0 && (
              <>
                <Ionicons name="water-outline" size={11} color={d.rainPct > 50 ? '#1565C0' : '#aaa'} />
                <Text style={[st.weekRain, d.rainPct > 50 && st.weekRainHigh]}>{d.rainPct}%</Text>
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
          <View key={w.id} style={[pw.card, { borderLeftColor: isAI ? '#7C83FD' : color }]}>
            <View style={pw.row}>
              {isAI
                ? <Ionicons name="sparkles-outline" size={16} color="#7C83FD" />
                : <MaterialCommunityIcons name={icon as any} size={18} color={color} />
              }
              <Text style={[pw.sport, { color: isAI ? '#7C83FD' : '#111' }]}>{w.sport_type}</Text>
              {isAI && <View style={pw.aiBadge}><Text style={pw.aiBadgeText}>AI Coach</Text></View>}
            </View>
            {w.workout_description ? (
              <Text style={pw.description} numberOfLines={4}>{w.workout_description}</Text>
            ) : (
              <View style={pw.chips}>
                <View style={[pw.chip, { backgroundColor: color + '18' }]}>
                  <Ionicons name="flame-outline" size={12} color={color} />
                  <Text style={[pw.chipText, { color }]}>{w.target_kcal} kcal</Text>
                </View>
                {w.target_duration_min !== null && (
                  <View style={[pw.chip, { backgroundColor: '#f0f0f0' }]}>
                    <Ionicons name="time-outline" size={12} color="#666" />
                    <Text style={[pw.chipText, { color: '#666' }]}>{w.target_duration_min} min</Text>
                  </View>
                )}
                {w.target_hr !== null && (
                  <View style={[pw.chip, { backgroundColor: '#f0f0f0' }]}>
                    <Ionicons name="heart-outline" size={12} color="#666" />
                    <Text style={[pw.chipText, { color: '#666' }]}>{w.target_hr} bpm</Text>
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

// ─── Calorie widget ────────────────────────────────────────────────────────

function CalorieWidget({ baseline, activities, planned, totalTarget, onPress }: {
  baseline: number | null; activities: TodayActivity[]; planned: PlannedWorkoutItem[]; totalTarget: number | null; onPress: () => void
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
  const plannedKcal = planned.reduce((s, p) => s + p.target_kcal, 0)

  return (
    <Pressable style={st.card} onPress={onPress}>
      <View style={st.calorieTitleRow}>
        <Text style={st.cardTitle}>Today's calorie target</Text>
        <Ionicons name="chevron-forward" size={14} color="#ccc" />
      </View>
      <Text style={st.calorieTotal}>{(totalTarget ?? 0).toLocaleString()} kcal</Text>
      <View style={st.calorieBreakdownRow}>
        <Text style={st.calorieBase}>{baseline.toLocaleString()} baseline</Text>
        {burned > 0 && <Text style={st.calorieBurned}>+ {Math.round(burned).toLocaleString()} burned</Text>}
        {plannedKcal > 0 && <Text style={st.caloriePlanned}>+ {plannedKcal.toLocaleString()} projected</Text>}
      </View>
      {(activities.length > 0 || planned.length > 0) && (
        <View style={st.caloriePillRow}>
          {activities.map(a => (
            <View key={a.id} style={[st.caloriePill, { backgroundColor: getSportColor(a.type) + '22' }]}>
              <MaterialCommunityIcons name={getSportIcon(a.type) as any} size={11} color={getSportColor(a.type)} />
              <Text style={[st.caloriePillText, { color: getSportColor(a.type) }]}>+{Math.round(a.total_kcal)} kcal</Text>
            </View>
          ))}
          {planned.map(p => (
            <View key={p.id} style={[st.caloriePill, { backgroundColor: '#7C83FD22' }]}>
              <Ionicons name="calendar-outline" size={11} color="#7C83FD" />
              <Text style={[st.caloriePillText, { color: '#7C83FD' }]}>{p.target_kcal} kcal planned</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  )
}

// ─── Calorie modal ─────────────────────────────────────────────────────────

function CalorieModal({ visible, baseline, activities, planned, totalTarget, onClose }: {
  visible: boolean; baseline: number | null; activities: TodayActivity[];
  planned: PlannedWorkoutItem[]; totalTarget: number | null; onClose: () => void
}) {
  const burned = burnedSum(activities)
  const plannedKcal = planned.reduce((s, p) => s + p.target_kcal, 0)
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={mo.overlay} onPress={onClose}>
        <Pressable style={mo.sheet} onPress={e => e.stopPropagation()}>
          <View style={mo.handle} />
          <Text style={mo.title}>Today's calorie target</Text>
          <Text style={mo.subtitle}>Your baseline increases with every workout completed today.</Text>

          {baseline === null ? (
            <View style={mo.noTarget}>
              <Text style={mo.noTargetText}>No baseline set. Go to Settings → Personal Info to add your daily calorie target.</Text>
            </View>
          ) : (
            <>
              <View style={mo.row}>
                <View style={mo.rowLeft}>
                  <Ionicons name="body-outline" size={16} color="#888" />
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
                  <Text style={[mo.rowValue, mo.rowValueBurned]}>+ {Math.round(a.total_kcal).toLocaleString()} kcal</Text>
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
                <View style={mo.tipBox}>
                  <Ionicons name="information-circle-outline" size={15} color="#FC4C02" style={{ marginTop: 1 }} />
                  <Text style={mo.tipText}>
                    Eat an extra {Math.round(burned).toLocaleString()} kcal today to compensate for your {activities.length === 1 ? 'workout' : 'workouts'}.
                  </Text>
                </View>
              )}
              {planned.length > 0 && (
                <View style={mo.plannedBox}>
                  <Ionicons name="calendar-outline" size={15} color="#7C83FD" style={{ marginTop: 1 }} />
                  <Text style={mo.plannedText}>
                    You have {planned.length === 1 ? 'a planned workout' : `${planned.length} planned workouts`} today targeting {plannedKcal.toLocaleString()} kcal. Consider fuelling for those as well.
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

function burnedSum(acts: TodayActivity[]) { return acts.reduce((s, a) => s + a.total_kcal, 0) }

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
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  content: { padding: 16, paddingBottom: 48, gap: 14 },

  greetCard: { backgroundColor: '#FF5C00', borderRadius: 18, padding: 22 },
  greetText: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 4 },
  dateText: { fontSize: 14, color: 'rgba(255,255,255,0.7)' },

  card: {
    backgroundColor: '#141414', borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: '#1E1E1E',
  },
  cardTitle: { fontSize: 11, fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 0 },

  // Weather
  weatherHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  weatherToggle: { flexDirection: 'row', backgroundColor: '#1E1E1E', borderRadius: 8, padding: 2 },
  weatherToggleBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  weatherToggleBtnActive: { backgroundColor: '#252525' },
  weatherToggleText: { fontSize: 12, fontWeight: '600', color: '#555' },
  weatherToggleTextActive: { color: '#F5F5F5' },

  weatherMain: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 12 },
  tempBig: { fontSize: 44, fontWeight: '800', color: '#F5F5F5', lineHeight: 46 },
  tempRange: { fontSize: 14, color: '#8A8A8A', marginTop: 2 },
  weatherMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  weatherMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  weatherMetaText: { fontSize: 13, color: '#8A8A8A' },

  hourlyScroll: { marginBottom: 14 },
  hourlyContent: { gap: 4, paddingRight: 4 },
  hourlyItem: { alignItems: 'center', minWidth: 52, paddingHorizontal: 6, paddingVertical: 8, backgroundColor: '#1E1E1E', borderRadius: 10, marginRight: 6 },
  hourlyTime: { fontSize: 10, color: '#555', fontWeight: '600' },
  hourlyTemp: { fontSize: 13, fontWeight: '700', color: '#D0D0D0' },
  hourlyRain: { fontSize: 10, color: '#555', marginTop: 2 },
  hourlyRainHigh: { color: '#64B5F6', fontWeight: '700' },

  recBox: { flexDirection: 'row', gap: 8, borderRadius: 12, padding: 12 },
  recText: { flex: 1, fontSize: 13, lineHeight: 19 },

  weekList: { gap: 0 },
  weekRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  weekRowBorder: { borderBottomWidth: 1, borderBottomColor: '#1E1E1E' },
  weekDay: { fontSize: 14, color: '#8A8A8A', width: 84 },
  weekDayToday: { fontWeight: '700', color: '#F5F5F5' },
  weekTemps: { flexDirection: 'row', gap: 6, marginLeft: 'auto' },
  weekTempHigh: { fontSize: 14, fontWeight: '700', color: '#F5F5F5', width: 32, textAlign: 'right' },
  weekTempLow: { fontSize: 14, color: '#555', width: 32, textAlign: 'right' },
  weekRainWrap: { flexDirection: 'row', alignItems: 'center', gap: 3, width: 44, marginLeft: 10 },
  weekRain: { fontSize: 12, color: '#555' },
  weekRainHigh: { color: '#64B5F6', fontWeight: '700' },

  weatherError: { alignItems: 'center', paddingVertical: 8 },
  weatherErrorText: { fontSize: 13, color: '#555', marginBottom: 10 },
  retryBtn: { backgroundColor: '#FF5C00', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Calorie widget
  calorieCardEmpty: { flexDirection: 'row', alignItems: 'center' },
  calorieEmptyTitle: { fontSize: 14, fontWeight: '700', color: '#8A8A8A' },
  calorieEmptyNote: { fontSize: 12, color: '#555', marginTop: 2 },
  calorieTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  calorieTotal: { fontSize: 36, fontWeight: '800', color: '#F5F5F5', marginBottom: 4 },
  calorieBreakdownRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  calorieBase: { fontSize: 13, color: '#8A8A8A' },
  calorieBurned: { fontSize: 13, color: '#FF5C00', fontWeight: '600' },
  caloriePlanned: { fontSize: 13, color: '#7C83FD', fontWeight: '600' },
  caloriePillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  caloriePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  caloriePillText: { fontSize: 12, fontWeight: '700' },

  // Training plan
  connectNote: { fontSize: 14, color: '#8A8A8A', lineHeight: 20, marginBottom: 16 },
  appRow: { flexDirection: 'row', gap: 12 },
  appBtn: { flex: 1, borderWidth: 1, borderColor: '#252525', borderRadius: 12, padding: 16, alignItems: 'center', gap: 8, backgroundColor: '#1E1E1E' },
  appBtnText: { fontSize: 13, fontWeight: '700', color: '#D0D0D0' },
})

const mo = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#141414', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingBottom: 40, paddingTop: 12, borderTopWidth: 1, borderColor: '#252525' },
  handle: { width: 36, height: 4, backgroundColor: '#252525', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: '800', color: '#F5F5F5', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#8A8A8A', lineHeight: 18, marginBottom: 24 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E1E1E' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rowLabel: { fontSize: 15, color: '#D0D0D0', flex: 1 },
  rowValue: { fontSize: 15, fontWeight: '600', color: '#D0D0D0' },
  rowValueBurned: { color: '#FF5C00' },
  noActivity: { fontSize: 13, color: '#3A3A3A', fontStyle: 'italic' },
  noTarget: { backgroundColor: '#1E1E1E', borderRadius: 12, padding: 16, marginBottom: 8 },
  noTargetText: { fontSize: 14, color: '#8A8A8A', lineHeight: 20 },
  divider: { height: 1, backgroundColor: '#252525', marginVertical: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  totalLabel: { fontSize: 16, fontWeight: '700', color: '#F5F5F5' },
  totalValue: { fontSize: 22, fontWeight: '800', color: '#F5F5F5' },
  tipBox: { flexDirection: 'row', gap: 8, backgroundColor: 'rgba(255,92,0,0.1)', borderRadius: 12, padding: 12, marginBottom: 10 },
  tipText: { flex: 1, fontSize: 13, color: '#FF5C00', lineHeight: 19 },
  plannedBox: { flexDirection: 'row', gap: 8, backgroundColor: 'rgba(124,131,253,0.1)', borderRadius: 12, padding: 12, marginBottom: 20 },
  plannedText: { flex: 1, fontSize: 13, color: '#7C83FD', lineHeight: 19 },
  closeBtn: { backgroundColor: '#FF5C00', borderRadius: 12, padding: 15, alignItems: 'center' },
  closeBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})

const pw = StyleSheet.create({
  card: { borderLeftWidth: 4, borderRadius: 10, backgroundColor: '#1E1E1E', padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sport: { fontSize: 15, fontWeight: '700', textTransform: 'capitalize', flex: 1, color: '#F5F5F5' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  chipText: { fontSize: 12, fontWeight: '700' },
  description: { fontSize: 13, color: '#8A8A8A', lineHeight: 19 },
  aiBadge: { backgroundColor: 'rgba(124,131,253,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  aiBadgeText: { fontSize: 10, fontWeight: '700', color: '#7C83FD' },
})

const wst = StyleSheet.create({
  appBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', marginBottom: 14 },
  appBadgeText: { fontSize: 12, fontWeight: '700' },
  previewLabel: { fontSize: 10, color: '#555', marginLeft: 4 },
  workoutCard: { backgroundColor: '#1E1E1E', borderRadius: 12, padding: 14, marginBottom: 12 },
  workoutType: { fontSize: 11, fontWeight: '700', color: '#555', textTransform: 'uppercase', marginBottom: 4 },
  workoutTitle: { fontSize: 17, fontWeight: '800', color: '#F5F5F5', marginBottom: 4 },
  workoutMeta: { fontSize: 13, color: '#8A8A8A', marginBottom: 8 },
  workoutDesc: { fontSize: 13, color: '#8A8A8A', lineHeight: 18 },
  disconnectBtn: { paddingVertical: 8, alignItems: 'center' },
  disconnectText: { fontSize: 13, color: '#3A3A3A' },
})
