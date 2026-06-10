import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView, Modal,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { generateZonesFromMaxHR } from '../../constants/zones'
import { addWorkoutToAppleCal, removeWorkoutFromAppleCal } from '../../lib/appleCalAuth'
import { W as C } from '../../lib/themeWarm'
import { AppDrawer, HamburgerBtn } from '../../components/DrawerNav'
import { getZoneAdjustment, SEVERITY_LABELS } from '../../lib/periodConfig'
import type {
  HeartRateZone, BurnSchemaPoint, SportEnergySetting, PlannedWorkout,
  TrainingProgram, TrainingProgramSession, ProgramType, PeriodSeverity,
} from '../../types'

// ─── helpers ───────────────────────────────────────────────────────────────

function localDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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
  return C.sport
}

function getSportIcon(type: string): string {
  if (/swim/i.test(type)) return 'swim'
  if (/run|jog/i.test(type)) return 'run'
  if (/walk/i.test(type)) return 'walk'
  if (/ride|bike|cycling|virtual/i.test(type)) return 'bike'
  return 'lightning-bolt'
}

const SPORT_ORDER: Record<string, number> = { Run: 0, Ride: 1, Swim: 2 }
function sortSports(sports: string[]): string[] {
  return [...sports].sort((a, b) => {
    const oa = SPORT_ORDER[a] ?? 99, ob = SPORT_ORDER[b] ?? 99
    if (oa !== ob) return oa - ob
    return a.localeCompare(b)
  })
}

function formatDuration(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatPace(secPerKm: number | null | undefined): string {
  if (!secPerKm) return ''
  const m = Math.floor(secPerKm / 60)
  const s = secPerKm % 60
  return `${m}:${String(s).padStart(2, '0')}/km`
}

function sessionDate(startDate: string, weekNum: number, dayNum: number): string {
  const d = new Date(startDate)
  d.setDate(d.getDate() + (weekNum - 1) * 7 + (dayNum - 1))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function currentProgramWeek(startDate: string): number {
  const start = new Date(startDate)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  return Math.max(1, Math.floor(diffDays / 7) + 1)
}

function interpolateKcalPerHour(hr: number, pts: BurnSchemaPoint[]): number {
  if (pts.length === 0) return 0
  const sorted = [...pts].sort((a, b) => a.hr_value - b.hr_value)
  const p0 = sorted[0], pN = sorted[sorted.length - 1]
  if (hr <= p0.hr_value) return p0.kcal_per_hour
  if (hr >= pN.hr_value) return pN.kcal_per_hour
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i], hi = sorted[i + 1]
    if (hr >= lo.hr_value && hr <= hi.hr_value) {
      const t = (hr - lo.hr_value) / (hi.hr_value - lo.hr_value)
      return lo.kcal_per_hour + t * (hi.kcal_per_hour - lo.kcal_per_hour)
    }
  }
  return 0
}

// ─── types ─────────────────────────────────────────────────────────────────

type PlannerMode = 'build' | 'ai' | 'programs'

interface WorkoutSegment {
  id: string
  inputType: 'distance' | 'time' | 'pace'
  value: string
  zoneId: string
  repeats: string
  paceMin: string
  paceSec: string
}

interface SegmentResult {
  totalKcal: number
  totalDurationMin: number
  segments: Array<{ label: string; kcal: number; durationMin: number; zoneNumber: number; repeats: number }>
}

interface AiResult {
  plan: string
  estimated_kcal: number | null
}

interface GeneratedSession {
  week: number
  day: number
  session_name: string
  description: string
  target_km: number | null
  target_pace_sec_km: number | null
  estimated_kcal: number | null
}

// ─── coach defaults ─────────────────────────────────────────────────────────

const DEFAULT_COACH_GUIDELINES = `- Reference zones by number and name (e.g. "Zone 2 — Aerobic Base")
- Give specific distances or durations for each segment
- Always include a warm-up and cool-down
- Estimate total kcal burned (write it as "X kcal" so it can be parsed)
- Be concise — use a numbered or bulleted list
- Respond in the same language the user writes in`

const COACH_PROMPT_KEY = 'coach_custom_guidelines'

// ─── program config ─────────────────────────────────────────────────────────

const PROGRAM_CONFIG: Record<ProgramType, { label: string; minWeeks: number; maxWeeks: number; emoji: string; color: string }> = {
  '5k':            { label: '5K',           minWeeks: 4,  maxWeeks: 12, emoji: '🏃', color: C.run },
  '10k':           { label: '10K',          minWeeks: 6,  maxWeeks: 14, emoji: '🏃', color: C.ride },
  'half_marathon': { label: 'Half Marathon', minWeeks: 8,  maxWeeks: 16, emoji: '🏅', color: C.gradB },
  'marathon':      { label: 'Marathon',      minWeeks: 16, maxWeeks: 32, emoji: '🏆', color: C.accent },
  'swim':          { label: 'Swimming',      minWeeks: 6,  maxWeeks: 20, emoji: '🏊', color: C.swim },
  'cycling':       { label: 'Cycling',       minWeeks: 8,  maxWeeks: 24, emoji: '🚴', color: C.ride },
  'strength':      { label: 'Strength',      minWeeks: 6,  maxWeeks: 16, emoji: '💪', color: C.sport },
}

const PROGRAM_TYPES: ProgramType[] = ['5k', '10k', 'half_marathon', 'marathon', 'swim', 'cycling', 'strength']

const STRENGTH_FOCUSES = [
  { key: 'strength',    label: 'Strength',    note: 'Heavy, 3–6 reps' },
  { key: 'hypertrophy', label: 'Hypertrophy', note: 'Moderate, 8–12 reps' },
  { key: 'stability',   label: 'Stability',   note: 'Functional & balance' },
  { key: 'endurance',   label: 'Endurance',   note: 'Light, 15–20 reps' },
] as const

const BODY_PARTS = ['Full Body', 'Chest', 'Back', 'Shoulders', 'Arms', 'Core', 'Legs'] as const

const SWIM_GOALS = [
  { key: '1500m',    label: '1500m', note: 'Sprint / Triathlon' },
  { key: '5k',       label: '5K',    note: 'Open water' },
  { key: '10k',      label: '10K',   note: 'Marathon swim' },
  { key: 'general',  label: 'General fitness', note: 'No specific race' },
] as const

const CYCLING_EVENTS = [
  { key: 'general',    label: 'General fitness', note: 'Base building' },
  { key: 'gran_fondo', label: 'Gran Fondo',       note: '100–200 km' },
  { key: 'century',    label: 'Century',          note: '160 km / 100 mi' },
  { key: 'triathlon',  label: 'Triathlon bike',   note: 'T2 preparation' },
] as const

type StrengthFocus = 'strength' | 'hypertrophy' | 'stability' | 'endurance'
type SwimGoal = '1500m' | '5k' | '10k' | 'general'
type CyclingEvent = 'general' | 'gran_fondo' | 'century' | 'triathlon'

const AI_GOALS = [
  { key: 'recovery',   label: 'Recovery',    note: 'Easy, low HR (Z1–Z2)' },
  { key: 'endurance',  label: 'Endurance',   note: 'Aerobic base (Z2)' },
  { key: 'tempo',      label: 'Tempo',       note: 'Comfortably hard (Z3)' },
  { key: 'threshold',  label: 'Threshold',   note: 'Lactate threshold (Z4)' },
  { key: 'vo2max',     label: 'VO₂ Max',     note: 'High intensity (Z5)' },
  { key: 'intervals',  label: 'Intervals',   note: 'Structured repeats' },
  { key: 'long',       label: 'Long',        note: 'Extended steady effort' },
  { key: 'race_pace',  label: 'Race Pace',   note: 'At target race effort' },
] as const

const AI_DURATION_PRESETS = ['20', '30', '45', '60', '75', '90', '120']

function zoneBarColor(n: number): string {
  return (['#94A3B8', '#29B6F6', '#66BB6A', '#FFCA28', '#EF5350'] as string[])[n - 1] ?? '#94A3B8'
}

// ─── screen ────────────────────────────────────────────────────────────────

export default function PlannerScreen() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [weightKg, setWeightKg] = useState<number | null>(null)
  const [ftpWatts, setFtpWatts] = useState<number | null>(null)
  const [preferredWorkoutTime, setPreferredWorkoutTime] = useState<string>('07:00')
  const onboardingApplied = useRef(false)

  const [sports, setSports] = useState<string[]>([])
  const [selectedSport, setSelectedSport] = useState<string>('')

  const [zones, setZones] = useState<HeartRateZone[]>([])
  const [burnSchema, setBurnSchema] = useState<BurnSchemaPoint[]>([])
  const [sportSettings, setSportSettings] = useState<SportEnergySetting[]>([])

  const activeZones = useMemo(() => {
    const sportSpecific = zones.filter(
      z => z.sport_type === selectedSport || normalizeType(z.sport_type ?? '') === selectedSport
    )
    if (sportSpecific.length > 0) return sportSpecific
    return zones.filter(z => !z.sport_type || z.sport_type === 'default')
  }, [zones, selectedSport])
  const [avgSpeedBySport, setAvgSpeedBySport] = useState<Record<string, number>>({})
  const [zonePaceMap, setZonePaceMap] = useState<Record<string, number>>({})

  const [todayPlans, setTodayPlans] = useState<PlannedWorkout[]>([])
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null)

  // Week overview
  const [weekActivities, setWeekActivities] = useState<{ type: string; date: string }[]>([])
  const [weekPlans, setWeekPlans] = useState<{ sport_type: string; planned_for: string; status: string | null; is_key: boolean }[]>([])

  const [mode, setMode] = useState<PlannerMode>('build')

  // build mode
  const [segments, setSegments] = useState<WorkoutSegment[]>([
    { id: '1', inputType: 'distance', value: '', zoneId: '', repeats: '1', paceMin: '', paceSec: '' },
  ])
  const [segResult, setSegResult] = useState<SegmentResult | null>(null)

  // ai mode
  const [aiGoal, setAiGoal] = useState('endurance')
  const [aiDuration, setAiDuration] = useState('60')
  const [aiNotes, setAiNotes] = useState('')
  const [aiResult, setAiResult] = useState<AiResult | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [coachPrompt, setCoachPrompt] = useState(DEFAULT_COACH_GUIDELINES)
  const [showPromptEditor, setShowPromptEditor] = useState(false)

  // programs mode — wizard
  const [programType, setProgramType] = useState<ProgramType>('5k')
  const [programWeeks, setProgramWeeks] = useState(8)
  const [startingKm, setStartingKm] = useState('')
  const [startingPaceMin, setStartingPaceMin] = useState('')
  const [startingPaceSec, setStartingPaceSec] = useState('')
  const [generatedSessions, setGeneratedSessions] = useState<GeneratedSession[]>([])
  const [programGenerating, setProgramGenerating] = useState(false)
  const [programSaving, setProgramSaving] = useState(false)

  // strength sub-config
  const [strengthFocus, setStrengthFocus] = useState<StrengthFocus>('hypertrophy')
  const [strengthBodyParts, setStrengthBodyParts] = useState<string[]>(['Full Body'])

  // swim sub-config
  const [swimGoal, setSwimGoal] = useState<SwimGoal>('1500m')
  const [swimPool, setSwimPool] = useState(true)

  // cycling sub-config
  const [cyclingEvent, setCyclingEvent] = useState<CyclingEvent>('general')

  // programs mode — active program
  const [activeProgram, setActiveProgram] = useState<TrainingProgram | null>(null)
  const [programSessions, setProgramSessions] = useState<TrainingProgramSession[]>([])
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set())
  const [togglingSession, setTogglingSession] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [sportDropdownOpen, setSportDropdownOpen] = useState(false)
  const [hasActivityData, setHasActivityData] = useState(false)

  // Period tracking
  const [onPeriod, setOnPeriod] = useState(false)
  const [periodSeverity, setPeriodSeverity] = useState<PeriodSeverity>('minor')

  useFocusEffect(useCallback(() => { load() }, []))
  useEffect(() => {
    AsyncStorage.getItem(COACH_PROMPT_KEY).then(v => { if (v) setCoachPrompt(v) })
  }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)

    const todayStr = localDate()

    const [profileRes, activitiesRes, zonesRes, burnRes, settingsRes, plansRes, userSportsRes, programRes] = await Promise.all([
      supabase.from('users').select('weight_kg, ftp_watts, on_period, period_severity, onboarding_data, preferred_workout_time, max_hr').eq('id', user.id).single(),
      supabase.from('activities').select('id, type, distance_m, duration_sec, avg_hr, date').eq('user_id', user.id),
      supabase.from('heart_rate_zones').select('*').eq('user_id', user.id).order('zone_number'),
      supabase.from('burn_schema_points').select('*').eq('user_id', user.id).order('hr_value'),
      supabase.from('sport_energy_settings').select('*').eq('user_id', user.id),
      supabase.from('planned_workouts').select('*').eq('user_id', user.id).eq('planned_for', todayStr).order('created_at'),
      supabase.from('user_sports').select('*').eq('user_id', user.id).order('sort_order'),
      supabase.from('training_programs').select('*').eq('user_id', user.id).eq('active', true).limit(1).maybeSingle(),
    ])

    setWeightKg(profileRes.data?.weight_kg ?? null)
    setFtpWatts(profileRes.data?.ftp_watts ?? null)
    setPreferredWorkoutTime((profileRes.data as any)?.preferred_workout_time ?? '07:00')
    setOnPeriod(profileRes.data?.on_period ?? false)
    setPeriodSeverity(profileRes.data?.period_severity ?? 'minor')
    let effectiveZones: HeartRateZone[] = zonesRes.data ?? []
    if (effectiveZones.length === 0 && profileRes.data?.max_hr) {
      const generated = generateZonesFromMaxHR(profileRes.data.max_hr).map(z => ({ ...z, user_id: user.id }))
      const { data: saved } = await supabase.from('heart_rate_zones')
        .upsert(generated, { onConflict: 'user_id,zone_number' })
        .select()
      effectiveZones = (saved ?? generated) as HeartRateZone[]
    }
    setZones(effectiveZones)
    setBurnSchema(burnRes.data ?? [])
    setSportSettings(settingsRes.data ?? [])
    setTodayPlans(plansRes.data ?? [])

    // Build per-zone pace map from last 3 months of activities only
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    const cutoff = threeMonthsAgo.toISOString().slice(0, 10)
    const zoneSpeedSums: Record<string, { sum: number; count: number }> = {}
    for (const act of (activitiesRes.data ?? [])) {
      if (!act.avg_hr || act.distance_m <= 0 || act.duration_sec <= 0) continue
      if (act.date < cutoff) continue
      const speedMs = act.distance_m / act.duration_sec
      const matched = effectiveZones.find(
        (z: HeartRateZone) => act.avg_hr >= z.min_bpm && act.avg_hr <= z.max_bpm
      )
      if (!matched) continue
      if (!zoneSpeedSums[matched.id]) zoneSpeedSums[matched.id] = { sum: 0, count: 0 }
      zoneSpeedSums[matched.id].sum += speedMs
      zoneSpeedSums[matched.id].count++
    }
    const paceMap: Record<string, number> = {}
    for (const [zId, { sum, count }] of Object.entries(zoneSpeedSums)) {
      paceMap[zId] = sum / count
    }
    setZonePaceMap(paceMap)

    const userSportNames: string[] = (userSportsRes.data ?? []).map((s: any) => s.sport_name)
    let sportList: string[]
    if (userSportNames.length > 0) {
      sportList = sortSports(userSportNames)
    } else {
      const normalized = (activitiesRes.data ?? [])
        .map((a: any) => normalizeType(a.type))
        .filter((t: string) => t.length > 0 && !t.startsWith('Virtual'))
      sportList = sortSports([...new Set<string>(normalized)])
    }
    setSports(sportList)
    setSelectedSport(prev => (sportList.includes(prev) ? prev : (sportList[0] ?? '')))

    // Apply onboarding Q1 preferences once on first load
    if (!onboardingApplied.current) {
      onboardingApplied.current = true
      const od = (profileRes.data as any)?.onboarding_data ?? {}
      const goalToProgramType: Record<string, ProgramType> = {
        running_5k: '5k', running_10k: '10k', running_half: 'half_marathon',
        running_marathon: 'marathon', cycling: 'cycling', swimming: 'swim',
        triathlon: 'marathon', strength: 'strength',
      }
      const goalToSport: Record<string, string> = {
        running_5k: 'Run', running_10k: 'Run', running_half: 'Run',
        running_marathon: 'Run', cycling: 'Ride', swimming: 'Swim',
        triathlon: 'Run', strength: 'Strength Training', fitness: 'Run',
      }
      const goal: string = od.training_goal ?? ''
      if (goal && goalToProgramType[goal]) {
        setProgramType(goalToProgramType[goal])
      }
      if (goal && goalToSport[goal]) {
        const mappedSport = goalToSport[goal]
        const match = sportList.find(s => s.toLowerCase() === mappedSport.toLowerCase())
          ?? sportList.find(s => s.toLowerCase().startsWith(mappedSport.toLowerCase().split(' ')[0]))
        if (match) setSelectedSport(match)
      }
    }

    const speedMap: Record<string, number> = {}
    for (const sport of sportList) {
      const acts = (activitiesRes.data ?? []).filter(
        (a: any) => normalizeType(a.type) === sport && a.distance_m > 0 && a.duration_sec > 0,
      )
      if (acts.length > 0) {
        const totalDist = acts.reduce((s: number, a: any) => s + a.distance_m, 0)
        const totalSec = acts.reduce((s: number, a: any) => s + a.duration_sec, 0)
        speedMap[sport] = totalDist / totalSec
      }
    }
    setAvgSpeedBySport(speedMap)
    setHasActivityData((activitiesRes.data ?? []).length > 0)

    // Week overview data
    const now = new Date()
    const daysFromMonday = (now.getDay() + 6) % 7
    const weekStart = new Date(now.getTime() - daysFromMonday * 86400000).toISOString().split('T')[0]
    const weekEnd = new Date(now.getTime() + (6 - daysFromMonday) * 86400000).toISOString().split('T')[0]
    const [weekActsRes, weekPlansRes] = await Promise.all([
      supabase.from('activities').select('type, date').eq('user_id', user.id).gte('date', weekStart).lte('date', weekEnd),
      supabase.from('planned_workouts').select('sport_type, planned_for, status, is_key').eq('user_id', user.id).gte('planned_for', weekStart).lte('planned_for', weekEnd),
    ])
    setWeekActivities(weekActsRes.data ?? [])
    setWeekPlans(weekPlansRes.data ?? [])

    const prog = programRes.data as TrainingProgram | null
    setActiveProgram(prog)
    if (prog) {
      const { data: sessions } = await supabase
        .from('training_program_sessions')
        .select('*')
        .eq('program_id', prog.id)
        .order('week_number')
        .order('day_number')
      setProgramSessions((sessions ?? []) as TrainingProgramSession[])
      const curWeek = currentProgramWeek(prog.start_date)
      setExpandedWeeks(new Set([curWeek]))
    }
  }

  function getKcalPerHour(zone: HeartRateZone): number {
    const setting = sportSettings.find(s => s.sport_type === selectedSport)
      ?? sportSettings.find(s => normalizeType(s.sport_type) === selectedSport)
    const method = setting?.method ?? 'standard'
    const effectiveSport = setting?.linked_sport_type ?? selectedSport
    const schemaPts = burnSchema.filter(p =>
      p.sport_type === effectiveSport || normalizeType(p.sport_type) === effectiveSport,
    )
    const useCustom = method === 'custom' && schemaPts.length >= 2
    const midHR = Math.round((zone.min_bpm + zone.max_bpm) / 2)
    return useCustom
      ? interpolateKcalPerHour(midHR, schemaPts)
      : zone.met_value * (weightKg ?? 70)
  }

  async function deletePlan(id: string) {
    const plan = todayPlans.find(p => p.id === id)
    Alert.alert('Delete plan?', `Remove the planned ${plan?.sport_type ?? 'workout'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setDeletingPlanId(id)
        supabase.functions.invoke('cal-push-workout', { body: { workout_id: id, action: 'delete' } }).catch(() => {})
        removeWorkoutFromAppleCal(id).catch(() => {})
        await supabase.from('planned_workouts').delete().eq('id', id)
        setTodayPlans(prev => prev.filter(p => p.id !== id))
        setDeletingPlanId(null)
      }},
    ])
  }

  // ─── build mode ─────────────────────────────────────────────────────────────

  function addSegment() {
    setSegments(prev => [...prev, { id: String(Date.now()), inputType: 'distance', value: '', zoneId: '', repeats: '1', paceMin: '', paceSec: '' }])
    setSegResult(null)
  }

  function removeSegment(id: string) {
    setSegments(prev => prev.filter(s => s.id !== id))
    setSegResult(null)
  }

  function updateSegment(id: string, patch: Partial<WorkoutSegment>) {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
    setSegResult(null)
  }

  function calculateSegments() {
    if (activeZones.length === 0) { Alert.alert('No zones', 'Set up your HR zones in Settings first.'); return }
    if (!weightKg) { Alert.alert('No weight', 'Add your weight in Settings → Personal Info first.'); return }

    const results: SegmentResult['segments'] = []
    let totalKcal = 0
    let totalDurationMin = 0

    for (const seg of segments) {
      const repeats = Math.max(1, parseInt(seg.repeats) || 1)
      let zone: HeartRateZone | undefined
      let kcalPerHour = 0
      let durationMin = 0
      let label = ''

      if (seg.inputType === 'pace') {
        const pMin = parseInt(seg.paceMin || '0')
        const pSec = parseInt(seg.paceSec || '0')
        const totalPaceSec = pMin * 60 + pSec
        const dist = parseFloat(seg.value)
        if (totalPaceSec <= 0 || isNaN(dist) || dist <= 0) {
          Alert.alert('Missing input', 'Enter both pace and distance for pace segments.')
          return
        }
        durationMin = (totalPaceSec * dist) / 60

        // Derive zone monotonically: faster pace = higher zone number.
        // "Closest speed" is wrong — a fast Z1 recovery run can be numerically
        // closer to 3:00/km than a Z3 long run, producing nonsense results.
        if (Object.keys(zonePaceMap).length > 0) {
          const enteredSpeedMs = 1000 / totalPaceSec
          // Only consider zones we have historical data for, ordered by zone number
          const sorted = activeZones
            .filter(z => zonePaceMap[z.id] !== undefined)
            .sort((a, b) => a.zone_number - b.zone_number)
          if (sorted.length > 0) {
            const slowest = sorted[0]
            const fastest = sorted[sorted.length - 1]
            if (enteredSpeedMs >= zonePaceMap[fastest.id]) {
              // Faster than any historical zone average → highest zone in map
              zone = fastest
            } else if (enteredSpeedMs <= zonePaceMap[slowest.id]) {
              // Slower than any historical zone average → lowest zone in map
              zone = slowest
            } else {
              // Within range → find the two adjacent zones by speed and pick the closer
              let bestDiff = Infinity
              for (const z of sorted) {
                const diff = Math.abs(zonePaceMap[z.id] - enteredSpeedMs)
                if (diff < bestDiff) { bestDiff = diff; zone = z }
              }
            }
          }
        }

        if (zone) {
          kcalPerHour = getKcalPerHour(zone)
          label = `${dist} km @ ${pMin}:${String(pSec).padStart(2, '0')}/km (${zone.name})`
        } else {
          label = `${dist} km @ ${pMin}:${String(pSec).padStart(2, '0')}/km`
        }
      } else {
        const val = parseFloat(seg.value)
        if (isNaN(val) || val <= 0) {
          Alert.alert('Invalid segment', 'All segments need a positive distance or time value.')
          return
        }
        zone = activeZones.find(z => z.id === seg.zoneId)
        if (!zone) { Alert.alert('Missing zone', 'Select a zone for every segment.'); return }
        kcalPerHour = getKcalPerHour(zone)

        if (seg.inputType === 'time') {
          durationMin = val
          label = `${val} min @ ${zone.name}`
        } else {
          const avgSpeed = avgSpeedBySport[selectedSport]
          if (!avgSpeed) {
            Alert.alert('No pace data', `No historical pace found for ${selectedSport}. Use time-based segments instead.`)
            return
          }
          const isSwim = /swim/i.test(selectedSport)
          const distM = isSwim ? val : val * 1000
          durationMin = distM / avgSpeed / 60
          label = isSwim ? `${val} m @ ${zone.name}` : `${val} km @ ${zone.name}`
        }
      }

      const segKcal = Math.round(kcalPerHour * (durationMin / 60)) * repeats
      const segDurationMin = durationMin * repeats
      results.push({
        label: repeats > 1 ? `${repeats}× (${label})` : label,
        kcal: segKcal,
        durationMin: Math.round(segDurationMin),
        zoneNumber: zone?.zone_number ?? 0,
        repeats,
      })
      totalKcal += segKcal
      totalDurationMin += segDurationMin
    }

    setSegResult({ totalKcal: Math.round(totalKcal), totalDurationMin: Math.round(totalDurationMin), segments: results })
  }

  async function planFromBuildMode() {
    if (!segResult || !userId) return
    const description = segResult.segments
      .map(s => `${s.label} (~${s.kcal} kcal, ${formatDuration(s.durationMin)})`)
      .join('\n')
    setSaving(true)
    const { data: newWorkout, error } = await supabase.from('planned_workouts').insert({
      user_id: userId,
      sport_type: selectedSport,
      target_kcal: segResult.totalKcal,
      target_duration_min: segResult.totalDurationMin,
      planned_for: localDate(),
      workout_description: description,
    }).select('id').single()
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    if (newWorkout?.id) {
      supabase.functions.invoke('cal-push-workout', { body: { workout_id: newWorkout.id, action: 'create' } }).catch(() => {})
      addWorkoutToAppleCal(newWorkout.id, `${selectedSport} workout`, localDate(), segResult.totalDurationMin, preferredWorkoutTime).catch(() => {})
    }
    Alert.alert('Planned!', `${selectedSport} workout (${segResult.totalKcal} kcal) added to today.`)
    load()
  }

  // ─── ai mode ───────────────────────────────────────────────────────────────

  async function askAI() {
    setAiLoading(true)
    setAiResult(null)
    try {
      const goalLabel = AI_GOALS.find(g => g.key === aiGoal)?.label ?? aiGoal
      const message = [
        `Create a ${goalLabel} ${selectedSport} workout, duration: ${aiDuration} minutes.`,
        aiNotes.trim() ? `Additional instructions: ${aiNotes.trim()}` : null,
      ].filter(Boolean).join('\n\n')
      const res = await supabase.functions.invoke('ai-coach', {
        body: {
          message,
          sport: selectedSport || undefined,
          period_severity: onPeriod ? periodSeverity : null,
          customGuidelines: coachPrompt !== DEFAULT_COACH_GUIDELINES ? coachPrompt : undefined,
        },
      })
      if (res.error) {
        const body = await res.error.context?.json?.().catch(() => null)
        throw new Error(body?.error ?? res.error.message)
      }
      setAiResult(res.data as AiResult)
    } catch (e: any) {
      const msg: string = e?.message ?? ''
      if (msg === 'no_credits') {
        Alert.alert(
          'No credits remaining',
          'Get more credits to keep using the Coach.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Get credits', onPress: () => router.push('/(tabs)/paywall') },
          ],
        )
      } else {
        Alert.alert('Coach error', msg || 'Could not reach Coach.')
      }
    } finally {
      setAiLoading(false)
    }
  }

  async function planFromAIMode() {
    if (!aiResult || !userId) return
    const kcal = aiResult.estimated_kcal
    if (!kcal) { Alert.alert('No estimate', 'The Coach response did not include a kcal estimate.'); return }
    setSaving(true)
    const { data: newWorkout, error } = await supabase.from('planned_workouts').insert({
      user_id: userId,
      sport_type: selectedSport || 'General',
      target_kcal: kcal,
      planned_for: localDate(),
      workout_description: aiResult.plan,
    }).select('id').single()
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    if (newWorkout?.id) {
      supabase.functions.invoke('cal-push-workout', { body: { workout_id: newWorkout.id, action: 'create' } }).catch(() => {})
      addWorkoutToAppleCal(newWorkout.id, `${selectedSport || 'Workout'} — Coach Plan`, localDate(), undefined, preferredWorkoutTime).catch(() => {})
    }
    Alert.alert('Planned!', "Coach workout added to today's plan.")
    load()
  }

  // ─── programs mode ─────────────────────────────────────────────────────────

  function adjustWeeks(delta: number) {
    const cfg = PROGRAM_CONFIG[programType]
    setProgramWeeks(prev => Math.min(cfg.maxWeeks, Math.max(cfg.minWeeks, prev + delta)))
  }

  function onProgramTypeChange(type: ProgramType) {
    const cfg = PROGRAM_CONFIG[type]
    setProgramType(type)
    setProgramWeeks(prev => Math.min(cfg.maxWeeks, Math.max(cfg.minWeeks, prev)))
    setGeneratedSessions([])
  }

  function buildSubtypeConfig(): Record<string, any> {
    if (programType === 'strength') {
      return { focus: strengthFocus, body_parts: strengthBodyParts }
    }
    if (programType === 'swim') {
      return { goal: swimGoal, pool: swimPool }
    }
    if (programType === 'cycling') {
      return { event: cyclingEvent, ftp_watts: ftpWatts ?? undefined }
    }
    return {}
  }

  async function generatePlan() {
    const isRunning = ['5k', '10k', 'half_marathon', 'marathon'].includes(programType)
    const isSwim = programType === 'swim'
    const isCycling = programType === 'cycling'
    const isStrength = programType === 'strength'

    let startingKmVal: number | null = null
    let paceSecTotal: number | null = null

    if (isRunning) {
      const km = parseFloat(startingKm)
      if (isNaN(km) || km <= 0) {
        Alert.alert('Invalid', 'Enter your current longest run in km.')
        return
      }
      startingKmVal = km
      const paceMin = parseInt(startingPaceMin || '0')
      const paceSec = parseInt(startingPaceSec || '0')
      if (paceMin <= 0 && paceSec <= 0) {
        Alert.alert('Invalid', 'Enter your current running pace.')
        return
      }
      paceSecTotal = paceMin * 60 + paceSec
    }

    if (isSwim) {
      const meters = parseFloat(startingKm)
      if (isNaN(meters) || meters <= 0) {
        Alert.alert('Invalid', 'Enter your current swim distance in meters.')
        return
      }
      startingKmVal = meters / 1000
      const paceMin = parseInt(startingPaceMin || '0')
      const paceSec = parseInt(startingPaceSec || '0')
      if (paceMin <= 0 && paceSec <= 0) {
        Alert.alert('Invalid', 'Enter your average pace per 100m.')
        return
      }
      // Convert /100m pace to /km equivalent for the API
      paceSecTotal = (paceMin * 60 + paceSec) * 10
    }

    if (isCycling) {
      if (!ftpWatts || ftpWatts <= 0) {
        Alert.alert('Invalid', 'Enter your FTP in watts.')
        return
      }
    }

    setProgramGenerating(true)
    setGeneratedSessions([])
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
      const res = await fetch(`${supaUrl}/functions/v1/generate-training-plan`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          program_type: programType,
          weeks: programWeeks,
          starting_km: startingKmVal ?? 0,
          starting_pace_sec_km: paceSecTotal ?? 0,
          subtype_config: buildSubtypeConfig(),
          period_severity: onPeriod ? periodSeverity : null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (json.error === 'no_credits') throw new Error('no_credits')
        throw new Error(json.error ?? 'Generation failed')
      }
      setGeneratedSessions(json.sessions as GeneratedSession[])
    } catch (e: any) {
      const msg: string = e?.message ?? ''
      if (msg === 'no_credits') {
        Alert.alert(
          'Not enough credits',
          `Generating a ${programWeeks}-week plan costs ${programWeeks} credits. Get more credits to continue.`,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Get credits', onPress: () => router.push('/(tabs)/paywall') },
          ],
        )
      } else {
        Alert.alert('Error', msg || 'Could not generate plan.')
      }
    } finally {
      setProgramGenerating(false)
    }
  }

  async function saveProgram() {
    if (!userId || generatedSessions.length === 0) return
    if (activeProgram) {
      await supabase.from('training_programs').update({ active: false }).eq('id', activeProgram.id)
    }
    setProgramSaving(true)
    const startDate = localDate()
    const { data: prog, error: progErr } = await supabase
      .from('training_programs')
      .insert({
        user_id: userId,
        program_type: programType,
        weeks: programWeeks,
        start_date: startDate,
        starting_km: parseFloat(startingKm) || 0,
        starting_pace_sec_km: parseInt(startingPaceMin || '0') * 60 + parseInt(startingPaceSec || '0'),
        subtype_config: Object.keys(buildSubtypeConfig()).length > 0 ? buildSubtypeConfig() : null,
        active: true,
      })
      .select()
      .single()

    if (progErr || !prog) {
      setProgramSaving(false)
      Alert.alert('Error', progErr?.message ?? 'Could not save program.')
      return
    }

    const rows = generatedSessions.map(s => ({
      program_id: prog.id,
      week_number: s.week,
      day_number: s.day,
      session_name: s.session_name,
      description: s.description,
      target_km: s.target_km,
      target_pace_sec_km: s.target_pace_sec_km,
      estimated_kcal: s.estimated_kcal,
      planned_for: sessionDate(startDate, s.week, s.day),
    }))

    const { error: sessErr } = await supabase.from('training_program_sessions').insert(rows)
    setProgramSaving(false)
    if (sessErr) { Alert.alert('Error', sessErr.message); return }

    Alert.alert('Program saved!', `Your ${PROGRAM_CONFIG[programType].label} program starts today.`)
    setGeneratedSessions([])
    setStartingKm('')
    setStartingPaceMin('')
    setStartingPaceSec('')
    load()
  }

  async function endProgram() {
    if (!activeProgram) return
    Alert.alert(
      'End program',
      `Stop the ${PROGRAM_CONFIG[activeProgram.program_type as ProgramType]?.label ?? activeProgram.program_type} program?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End program', style: 'destructive',
          onPress: async () => {
            await supabase.from('training_programs').update({ active: false }).eq('id', activeProgram.id)
            setActiveProgram(null)
            setProgramSessions([])
          },
        },
      ],
    )
  }

  async function toggleSession(session: TrainingProgramSession) {
    setTogglingSession(session.id)
    const now = new Date().toISOString()
    if (session.completed) {
      await supabase.from('training_program_sessions')
        .update({ completed: false, completed_at: null, strava_activity_id: null })
        .eq('id', session.id)
      setProgramSessions(prev => prev.map(s => s.id === session.id
        ? { ...s, completed: false, completed_at: null, strava_activity_id: null }
        : s))
    } else {
      await supabase.from('training_program_sessions')
        .update({ completed: true, completed_at: now })
        .eq('id', session.id)
      setProgramSessions(prev => prev.map(s => s.id === session.id
        ? { ...s, completed: true, completed_at: now }
        : s))
    }
    setTogglingSession(null)
  }

  function toggleWeek(w: number) {
    setExpandedWeeks(prev => {
      const next = new Set(prev)
      if (next.has(w)) next.delete(w)
      else next.add(w)
      return next
    })
  }

  // ─── derived ───────────────────────────────────────────────────────────────

  const sportColor = getSportColor(selectedSport)
  const cfg = PROGRAM_CONFIG[programType]

  const weekNumbers = [...new Set(programSessions.map(s => s.week_number))].sort((a, b) => a - b)
  const completedCount = programSessions.filter(s => s.completed).length
  const progress = programSessions.length > 0 ? completedCount / programSessions.length : 0

  const genWeekNumbers = [...new Set(generatedSessions.map(s => s.week))].sort((a, b) => a - b)

  return (
    <SafeAreaView style={st.container}>
      <AppDrawer>
        {openDrawer => (
      <View style={{ flex: 1 }}>
        <View style={st.topBar}>
          <HamburgerBtn onPress={openDrawer} />
          <Text style={st.topBarTitle}>Planner</Text>
          <View style={{ width: 34 }} />
        </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <WeekBar activities={weekActivities} plans={weekPlans} />
        <Text style={st.screenTitle}>Workout Planner</Text>

        {/* Today's plan */}
        {todayPlans.length > 0 && (
          <View style={st.todayCard}>
            <Text style={st.sectionLabel}>Today's plan</Text>
            {todayPlans.map((plan, i) => (
              <View key={plan.id} style={[st.planRow, i < todayPlans.length - 1 && st.planRowBorder]}>
                <View style={[st.planDot, { backgroundColor: getSportColor(plan.sport_type) }]} />
                <View style={st.planInfo}>
                  <Text style={st.planSport}>{plan.sport_type}</Text>
                  <Text style={st.planMeta}>
                    {plan.target_kcal} kcal
                    {plan.target_duration_min ? ` · ${formatDuration(plan.target_duration_min)}` : ''}
                  </Text>
                  {plan.workout_description ? (
                    <Text style={st.planDesc} numberOfLines={3}>{plan.workout_description}</Text>
                  ) : null}
                </View>
                <Pressable onPress={() => deletePlan(plan.id)} hitSlop={12} disabled={deletingPlanId === plan.id}>
                  {deletingPlanId === plan.id
                    ? <ActivityIndicator size="small" color={C.text3} />
                    : <Ionicons name="trash-outline" size={18} color={C.text3} />
                  }
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Mode selector */}
        <View style={st.modeGrid}>
          {([
            { key: 'build',    label: 'Build workout', icon: 'list-outline'       as const },
            { key: 'ai',       label: 'Coach',          icon: 'sparkles-outline'   as const },
            { key: 'programs', label: 'Programs',      icon: 'trophy-outline'     as const },
          ] as const).map(m => (
            <Pressable
              key={m.key}
              style={[st.modeBtn, mode === m.key && { backgroundColor: C.accent, borderColor: C.accent }]}
              onPress={() => setMode(m.key)}
            >
              <Ionicons name={m.icon} size={14} color={mode === m.key ? C.white : C.text3} />
              <Text style={[st.modeBtnText, mode === m.key && st.modeBtnTextActive]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Sport selector — shown for build/ai modes */}
        {mode !== 'programs' && (
          <>
            <Text style={st.label}>Sport</Text>
            <Pressable style={[st.sportDropBtn, { borderColor: sportColor }]} onPress={() => setSportDropdownOpen(true)}>
              <View style={st.sportDropLeft}>
                <MaterialCommunityIcons name={getSportIcon(selectedSport) as any} size={20} color={sportColor} />
                <Text style={st.sportDropText}>{selectedSport || 'Select sport…'}</Text>
              </View>
              <Ionicons name="chevron-down" size={18} color={C.text2} />
            </Pressable>
          </>
        )}

        {/* Sport dropdown modal */}
        <Modal visible={sportDropdownOpen} transparent animationType="fade">
          <Pressable style={st.modalOverlay} onPress={() => setSportDropdownOpen(false)}>
            <Pressable style={st.sportSheet} onPress={e => e.stopPropagation()}>
              <Text style={st.sportSheetTitle}>Select sport</Text>
              <ScrollView>
                {sports.map(sport => (
                  <Pressable
                    key={sport}
                    style={st.sportSheetRow}
                    onPress={() => {
                      setSelectedSport(sport)
                      setSportDropdownOpen(false)
                      setSegResult(null)
                      setSegments(prev => prev.map(s => ({ ...s, zoneId: '' })))
                    }}
                  >
                    <MaterialCommunityIcons name={getSportIcon(sport) as any} size={20} color={getSportColor(sport)} />
                    <Text style={[st.sportSheetRowText, selectedSport === sport && { color: C.accent, fontWeight: '700' }]}>{sport}</Text>
                    {selectedSport === sport && <Ionicons name="checkmark" size={16} color={C.accent} />}
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* ─── BUILD MODE ───────────────────────────────────────────────────── */}
        {mode === 'build' && (
          <>
            {activeZones.length === 0 ? (
              <Pressable style={st.noZonesBox} onPress={() => router.push('/(tabs)/settings')}>
                <Ionicons name="pulse-outline" size={22} color={C.text3} />
                <Text style={st.noZonesText}>No heart rate zones set up yet.</Text>
                <Text style={st.noZonesLink}>Go to Settings → Heart Rate Zones →</Text>
              </Pressable>
            ) : (
            <>
            {!hasActivityData && (
              <View style={st.noDataBanner}>
                <Ionicons name="information-circle-outline" size={16} color={C.text3} />
                <Text style={st.noDataBannerText}>
                  No Strava data yet — pace estimates won't be available. Connect Strava in Settings, or use Time segments.
                </Text>
              </View>
            )}
            <Text style={st.label}>Workout segments</Text>

            {segments.map((seg, idx) => {
              const selZone = activeZones.find(z => z.id === seg.zoneId)
              const isSwim = /swim/i.test(selectedSport)
              return (
                <View key={seg.id} style={st.segCard}>
                  <View style={st.segHeader}>
                    <Text style={st.segIndex}>Segment {idx + 1}</Text>
                    {segments.length > 1 && (
                      <Pressable onPress={() => removeSegment(seg.id)} hitSlop={10}>
                        <Ionicons name="close-circle-outline" size={20} color={C.text3} />
                      </Pressable>
                    )}
                  </View>

                  <View style={st.segToggleRow}>
                    <Pressable
                      style={[st.segToggleBtn, seg.inputType === 'distance' && { backgroundColor: C.accent, borderColor: C.accent }]}
                      onPress={() => updateSegment(seg.id, { inputType: 'distance', value: '' })}
                    >
                      <Text style={[st.segToggleText, seg.inputType === 'distance' && { color: C.white }]}>Distance</Text>
                    </Pressable>
                    <Pressable
                      style={[st.segToggleBtn, seg.inputType === 'time' && { backgroundColor: C.accent, borderColor: C.accent }]}
                      onPress={() => updateSegment(seg.id, { inputType: 'time', value: '' })}
                    >
                      <Text style={[st.segToggleText, seg.inputType === 'time' && { color: C.white }]}>Time</Text>
                    </Pressable>
                    {(/run|jog/i.test(selectedSport)) && (
                      <Pressable
                        style={[st.segToggleBtn, seg.inputType === 'pace' && { backgroundColor: C.accent, borderColor: C.accent }]}
                        onPress={() => updateSegment(seg.id, { inputType: 'pace', zoneId: '', ...(seg.inputType !== 'pace' ? { value: '' } : {}) })}
                      >
                        <Text style={[st.segToggleText, seg.inputType === 'pace' && { color: C.white }]}>Pace</Text>
                      </Pressable>
                    )}
                  </View>

                  {seg.inputType === 'pace' ? (
                    <View style={{ gap: 10, marginBottom: 10 }}>
                      <View style={st.segInputRow}>
                        <View style={st.segInputGroup}>
                          <View style={st.paceInputRow}>
                            <TextInput
                              style={[st.segInput, { width: 52 }]}
                              value={seg.paceMin}
                              onChangeText={v => updateSegment(seg.id, { paceMin: v })}
                              placeholder="5"
                              placeholderTextColor={C.text3}
                              keyboardType="number-pad"
                            />
                            <Text style={st.paceSep}>:</Text>
                            <TextInput
                              style={[st.segInput, { width: 52 }]}
                              value={seg.paceSec}
                              onChangeText={v => updateSegment(seg.id, { paceSec: v })}
                              placeholder="30"
                              placeholderTextColor={C.text3}
                              keyboardType="number-pad"
                            />
                          </View>
                          <Text style={st.segInputUnit}>/km</Text>
                        </View>
                        <View style={st.segInputGroup}>
                          <TextInput
                            style={st.segInput}
                            value={seg.value}
                            onChangeText={v => updateSegment(seg.id, { value: v })}
                            placeholder="e.g. 5"
                            placeholderTextColor={C.text3}
                            keyboardType="decimal-pad"
                          />
                          <Text style={st.segInputUnit}>km</Text>
                        </View>
                        <View style={st.segRepeatGroup}>
                          <TextInput
                            style={st.segInput}
                            value={seg.repeats}
                            onChangeText={v => updateSegment(seg.id, { repeats: v })}
                            placeholder="1"
                            placeholderTextColor={C.text3}
                            keyboardType="number-pad"
                          />
                          <Text style={st.segInputUnit}>repeats</Text>
                        </View>
                      </View>
                      {seg.paceMin && seg.value ? (() => {
                        const pMin = parseInt(seg.paceMin || '0')
                        const pSec = parseInt(seg.paceSec || '0')
                        const totalPaceSec = pMin * 60 + pSec
                        const dist = parseFloat(seg.value)
                        if (totalPaceSec > 0 && dist > 0) {
                          const durationMin = Math.round((totalPaceSec * dist) / 60)
                          return <Text style={st.segZoneDetail}>≈ {durationMin} min</Text>
                        }
                        return null
                      })() : null}
                    </View>
                  ) : (
                  <View style={st.segInputRow}>
                    <View style={st.segInputGroup}>
                      <TextInput
                        style={st.segInput}
                        value={seg.value}
                        onChangeText={v => updateSegment(seg.id, { value: v })}
                        placeholder={seg.inputType === 'distance' ? (isSwim ? 'e.g. 400' : 'e.g. 5') : 'e.g. 20'}
                        placeholderTextColor={C.text3}
                        keyboardType="decimal-pad"
                      />
                      <Text style={st.segInputUnit}>{seg.inputType === 'distance' ? (isSwim ? 'm' : 'km') : 'min'}</Text>
                    </View>
                    <View style={st.segRepeatGroup}>
                      <TextInput
                        style={st.segInput}
                        value={seg.repeats}
                        onChangeText={v => updateSegment(seg.id, { repeats: v })}
                        placeholder="1"
                        placeholderTextColor={C.text3}
                        keyboardType="number-pad"
                      />
                      <Text style={st.segInputUnit}>repeats</Text>
                    </View>
                  </View>
                  )}

                  {seg.inputType !== 'pace' && (
                    <>
                      <View style={st.segZoneRow}>
                        {activeZones.map(z => {
                          const zColor = zoneBarColor(z.zone_number)
                          const isSelected = seg.zoneId === z.id
                          return (
                            <Pressable
                              key={z.id}
                              style={[
                                st.segZoneBtn,
                                { borderColor: zColor },
                                isSelected && { backgroundColor: zColor },
                              ]}
                              onPress={() => updateSegment(seg.id, { zoneId: z.id })}
                            >
                              <Text style={[st.segZoneBtnNum, { color: isSelected ? '#fff' : zColor }]}>
                                Z{z.zone_number}
                              </Text>
                            </Pressable>
                          )
                        })}
                      </View>
                      {selZone && (
                        <Text style={st.segZoneDetail}>{selZone.name} · {selZone.min_bpm}–{selZone.max_bpm} bpm</Text>
                      )}
                    </>
                  )}
                </View>
              )
            })}

            <Pressable style={st.addSegBtn} onPress={addSegment}>
              <Ionicons name="add-circle-outline" size={18} color={C.accent} />
              <Text style={[st.addSegBtnText, { color: C.accent }]}>Add segment</Text>
            </Pressable>

            <Pressable style={[st.calcBtn, { backgroundColor: C.accent }]} onPress={calculateSegments}>
              <Ionicons name="stats-chart-outline" size={18} color={C.white} />
              <Text style={st.calcBtnText}>Calculate workout</Text>
            </Pressable>

            {segResult && (
              <View style={[st.segResultCard, { borderLeftColor: C.accent }]}>
                {/* Totals */}
                <View style={st.segResultTotals}>
                  <View style={st.segResultStat}>
                    <Text style={[st.segResultValue, { color: C.accent }]}>{segResult.totalKcal}</Text>
                    <Text style={st.segResultLabel}>kcal</Text>
                  </View>
                  <View style={st.divider} />
                  <View style={st.segResultStat}>
                    <Text style={[st.segResultValue, { color: C.accent }]}>{formatDuration(segResult.totalDurationMin)}</Text>
                    <Text style={st.segResultLabel}>total</Text>
                  </View>
                </View>

                {/* Workout diagram */}
                <Text style={st.diagramLabel}>Workout structure</Text>
                <View style={st.diagramBar}>
                  {segResult.segments.map((s, i) => {
                    const pct = segResult.totalDurationMin > 0
                      ? (s.durationMin / segResult.totalDurationMin) * 100
                      : 0
                    const color = zoneBarColor(s.zoneNumber)
                    return (
                      <View key={i} style={[st.diagramSegment, { flex: pct, backgroundColor: color }]}>
                        {pct > 12 && (
                          <Text style={st.diagramSegmentText} numberOfLines={1}>
                            {s.zoneNumber > 0 ? `Z${s.zoneNumber}` : '–'}
                          </Text>
                        )}
                      </View>
                    )
                  })}
                </View>

                {/* Zone legend */}
                <View style={st.diagramLegend}>
                  {[...new Set(segResult.segments.map(s => s.zoneNumber))].sort().map(zn => (
                    <View key={zn} style={st.diagramLegendItem}>
                      <View style={[st.diagramLegendDot, { backgroundColor: zoneBarColor(zn) }]} />
                      <Text style={st.diagramLegendText}>{zn > 0 ? `Z${zn}` : '–'}</Text>
                    </View>
                  ))}
                </View>

                {/* Per-segment breakdown */}
                {segResult.segments.map((s, i) => (
                  <View key={i} style={[st.segBreakRow, { borderLeftWidth: 3, borderLeftColor: zoneBarColor(s.zoneNumber), paddingLeft: 8 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.segBreakLabel}>{s.label}</Text>
                      <Text style={st.segBreakMeta}>{formatDuration(s.durationMin)} · {s.kcal} kcal</Text>
                    </View>
                    <View style={[st.segZoneTag, { backgroundColor: zoneBarColor(s.zoneNumber) + '22' }]}>
                      <Text style={[st.segZoneTagText, { color: zoneBarColor(s.zoneNumber) }]}>{s.zoneNumber > 0 ? `Z${s.zoneNumber}` : '–'}</Text>
                    </View>
                  </View>
                ))}

                <Pressable
                  style={[st.planBtn, { marginTop: 14 }, saving && st.planBtnDisabled]}
                  onPress={planFromBuildMode}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator size="small" color={C.accent} /> : <Text style={st.planBtnText}>Plan for today →</Text>}
                </Pressable>
              </View>
            )}
            </>
            )}
          </>
        )}

        {/* ─── AI COACH MODE ────────────────────────────────────────────────── */}
        {mode === 'ai' && (
          <>
            <View style={st.aiInfoBox}>
              <Ionicons name="sparkles-outline" size={14} color={C.accent2} />
              <Text style={st.aiInfoText}>
                Set your goal and duration — our coach will design a workout around your HR zones and historical pace.
              </Text>
            </View>

            {/* Duration */}
            <Text style={st.label}>Duration</Text>
            <View style={st.aiDurationRow}>
              {AI_DURATION_PRESETS.map(d => (
                <Pressable
                  key={d}
                  style={[st.aiDurationBtn, aiDuration === d && { backgroundColor: C.accent, borderColor: C.accent }]}
                  onPress={() => setAiDuration(d)}
                >
                  <Text style={[st.aiDurationBtnText, aiDuration === d && { color: C.white }]}>{d}'</Text>
                </Pressable>
              ))}
            </View>

            {/* Goal */}
            <Text style={st.label}>Workout goal</Text>
            <View style={st.aiGoalGrid}>
              {AI_GOALS.map(g => (
                <Pressable
                  key={g.key}
                  style={[st.aiGoalCard, aiGoal === g.key && { borderColor: C.accent, backgroundColor: C.accent + '22' }]}
                  onPress={() => setAiGoal(g.key)}
                >
                  <Text style={[st.aiGoalLabel, aiGoal === g.key && { color: C.accent, fontWeight: '800' }]}>{g.label}</Text>
                  <Text style={st.aiGoalNote}>{g.note}</Text>
                </Pressable>
              ))}
            </View>

            {/* Extra notes */}
            <Text style={st.label}>Additional instructions (optional)</Text>
            <TextInput
              style={st.aiInput}
              value={aiNotes}
              onChangeText={setAiNotes}
              placeholder={'e.g. include a long warm-up, avoid sprints, focus on cadence…'}
              placeholderTextColor={C.text3}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {/* Prompt editor */}
            <Pressable
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}
              onPress={() => setShowPromptEditor(v => !v)}
            >
              <Ionicons name={showPromptEditor ? 'chevron-up' : 'chevron-down'} size={14} color={C.text3} />
              <Text style={{ fontSize: 12, color: C.text3 }}>Coach prompt</Text>
              {coachPrompt !== DEFAULT_COACH_GUIDELINES && (
                <View style={{ backgroundColor: C.accent + '33', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
                  <Text style={{ fontSize: 10, color: C.accent, fontWeight: '700' }}>custom</Text>
                </View>
              )}
            </Pressable>
            {showPromptEditor && (
              <View style={{ gap: 8, marginBottom: 12 }}>
                <TextInput
                  style={[st.aiInput, { minHeight: 160, fontSize: 12, color: C.text2 }]}
                  value={coachPrompt}
                  onChangeText={v => { setCoachPrompt(v); AsyncStorage.setItem(COACH_PROMPT_KEY, v) }}
                  multiline
                  textAlignVertical="top"
                  autoCorrect={false}
                />
                {coachPrompt !== DEFAULT_COACH_GUIDELINES && (
                  <Pressable
                    style={{ alignSelf: 'flex-end' }}
                    onPress={() => { setCoachPrompt(DEFAULT_COACH_GUIDELINES); AsyncStorage.setItem(COACH_PROMPT_KEY, DEFAULT_COACH_GUIDELINES) }}
                  >
                    <Text style={{ fontSize: 12, color: C.text3 }}>Reset to default</Text>
                  </Pressable>
                )}
              </View>
            )}

            <Pressable
              style={[st.calcBtn, { backgroundColor: C.accent }, aiLoading && st.planBtnDisabled]}
              onPress={askAI}
              disabled={aiLoading}
            >
              {aiLoading
                ? <ActivityIndicator size="small" color={C.white} />
                : <>
                    <Ionicons name="sparkles-outline" size={18} color={C.white} />
                    <Text style={st.calcBtnText}>Generate workout</Text>
                  </>
              }
            </Pressable>

            {aiResult && (
              <View style={st.aiResultCard}>
                <View style={st.aiResultHeader}>
                  <Ionicons name="sparkles-outline" size={14} color={C.accent2} />
                  <Text style={st.aiResultTitle}>Coach plan</Text>
                  {aiResult.estimated_kcal && (
                    <View style={st.aiKcalBadge}>
                      <Text style={st.aiKcalBadgeText}>~{aiResult.estimated_kcal} kcal</Text>
                    </View>
                  )}
                </View>
                <Text style={st.aiResultText}>{aiResult.plan}</Text>
                <Pressable
                  style={[st.planBtn, { marginTop: 16 }, saving && st.planBtnDisabled]}
                  onPress={planFromAIMode}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator size="small" color={C.accent} />
                    : <Text style={st.planBtnText}>Save as today's plan →</Text>
                  }
                </Pressable>
              </View>
            )}
          </>
        )}

        {/* ─── PROGRAMS MODE ────────────────────────────────────────────────── */}
        {mode === 'programs' && (
          <>
            {/* Active program view */}
            {activeProgram && generatedSessions.length === 0 ? (
              <>
                {/* Header */}
                <View style={st.progHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.progTitle}>
                      {PROGRAM_CONFIG[activeProgram.program_type as ProgramType]?.label ?? activeProgram.program_type} Program
                    </Text>
                    <Text style={st.progSubtitle}>
                      {activeProgram.weeks} weeks · started {activeProgram.start_date}
                    </Text>
                  </View>
                  <Pressable onPress={endProgram} style={st.endProgBtn}>
                    <Text style={st.endProgBtnText}>End</Text>
                  </Pressable>
                </View>

                {/* Progress bar */}
                <View style={st.progProgressRow}>
                  <View style={st.progProgressTrack}>
                    <View style={[st.progProgressFill, { width: `${Math.round(progress * 100)}%` as any, backgroundColor: PROGRAM_CONFIG[activeProgram.program_type as ProgramType]?.color ?? C.accent }]} />
                  </View>
                  <Text style={st.progProgressLabel}>{completedCount}/{programSessions.length} done</Text>
                </View>

                {/* Sessions by week */}
                {weekNumbers.map(weekNum => {
                  const weekSessions = programSessions.filter(s => s.week_number === weekNum)
                  const weekDone = weekSessions.filter(s => s.completed).length
                  const isExpanded = expandedWeeks.has(weekNum)
                  const progColor = PROGRAM_CONFIG[activeProgram.program_type as ProgramType]?.color ?? C.accent

                  return (
                    <View key={weekNum} style={st.weekBlock}>
                      <Pressable style={st.weekHeader} onPress={() => toggleWeek(weekNum)}>
                        <View style={[st.weekBadge, { backgroundColor: progColor + '22' }]}>
                          <Text style={[st.weekBadgeText, { color: progColor }]}>W{weekNum}</Text>
                        </View>
                        <Text style={st.weekLabel}>Week {weekNum}</Text>
                        <Text style={st.weekProgress}>{weekDone}/{weekSessions.length}</Text>
                        <Ionicons
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={16} color={C.text3}
                        />
                      </Pressable>

                      {isExpanded && weekSessions.map(session => (
                        <View key={session.id} style={[st.sessionRow, session.completed && st.sessionRowDone]}>
                          <Pressable
                            style={[st.sessionCheck, session.completed && { backgroundColor: progColor, borderColor: progColor }]}
                            onPress={() => toggleSession(session)}
                            disabled={togglingSession === session.id}
                          >
                            {togglingSession === session.id
                              ? <ActivityIndicator size="small" color={C.white} />
                              : session.completed
                                ? <Ionicons name="checkmark" size={14} color={C.white} />
                                : null
                            }
                          </Pressable>
                          <View style={st.sessionInfo}>
                            <Text style={[st.sessionName, session.completed && st.sessionNameDone]}>
                              {session.session_name}
                            </Text>
                            <Text style={st.sessionDesc} numberOfLines={2}>{session.description}</Text>
                            <View style={st.sessionMeta}>
                              {session.target_km && (
                                <View style={st.metaItem}>
                                  <Ionicons name="navigate-outline" size={11} color={C.text3} />
                                  <Text style={st.sessionMetaText}>{session.target_km} km</Text>
                                </View>
                              )}
                              {session.target_pace_sec_km && (
                                <View style={st.metaItem}>
                                  <Ionicons name="speedometer-outline" size={11} color={C.text3} />
                                  <Text style={st.sessionMetaText}>{formatPace(session.target_pace_sec_km)}</Text>
                                </View>
                              )}
                              {session.estimated_kcal && (
                                <View style={st.metaItem}>
                                  <Ionicons name="flame-outline" size={11} color={C.text3} />
                                  <Text style={st.sessionMetaText}>~{session.estimated_kcal} kcal</Text>
                                </View>
                              )}
                              {session.strava_activity_id && (
                                <View style={st.metaItem}>
                                  <Ionicons name="link-outline" size={11} color={C.accent} />
                                  <Text style={[st.sessionMetaText, { color: C.accent }]}>Strava</Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </View>
                      ))}
                    </View>
                  )
                })}

                <Pressable
                  style={st.newProgramBtn}
                  onPress={() => {
                    Alert.alert(
                      'Start new program',
                      'This will end your current program. Continue?',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Start new', onPress: () => setActiveProgram(null) },
                      ],
                    )
                  }}
                >
                  <Ionicons name="add-circle-outline" size={16} color={C.text2} />
                  <Text style={st.newProgramBtnText}>Start a new program</Text>
                </Pressable>
              </>
            ) : generatedSessions.length > 0 ? (
              /* Generated plan preview */
              <>
                <View style={st.progHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.progTitle}>{cfg.label} Program — Preview</Text>
                    <Text style={st.progSubtitle}>{programWeeks} weeks · {generatedSessions.length} sessions</Text>
                  </View>
                  <Pressable onPress={() => setGeneratedSessions([])} style={st.endProgBtn}>
                    <Text style={st.endProgBtnText}>Back</Text>
                  </Pressable>
                </View>

                <View style={st.aiInfoBox}>
                  <Ionicons name="information-circle-outline" size={14} color={C.accent2} />
                  <Text style={st.aiInfoText}>
                    Review your plan below. When you save it, session names like "{cfg.label === '5K' ? '5k' : cfg.label} Program w1d1" will auto-match Strava activities with the same name.
                  </Text>
                </View>

                {genWeekNumbers.map(weekNum => {
                  const weekSessions = generatedSessions.filter(s => s.week === weekNum)
                  const isExpanded = expandedWeeks.has(weekNum)

                  return (
                    <View key={weekNum} style={st.weekBlock}>
                      <Pressable style={st.weekHeader} onPress={() => toggleWeek(weekNum)}>
                        <View style={[st.weekBadge, { backgroundColor: cfg.color + '22' }]}>
                          <Text style={[st.weekBadgeText, { color: cfg.color }]}>W{weekNum}</Text>
                        </View>
                        <Text style={st.weekLabel}>Week {weekNum}</Text>
                        <Text style={st.weekProgress}>{weekSessions.length} sessions</Text>
                        <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={C.text3} />
                      </Pressable>

                      {isExpanded && weekSessions.map((session, i) => (
                        <View key={i} style={st.sessionRow}>
                          <View style={[st.sessionCheck, { borderColor: C.border }]}>
                            <Ionicons name="ellipse-outline" size={14} color={C.text4} />
                          </View>
                          <View style={st.sessionInfo}>
                            <Text style={st.sessionName}>{session.session_name}</Text>
                            <Text style={st.sessionDesc} numberOfLines={2}>{session.description}</Text>
                            <View style={st.sessionMeta}>
                              {session.target_km && (
                                <View style={st.metaItem}>
                                  <Ionicons name="navigate-outline" size={11} color={C.text3} />
                                  <Text style={st.sessionMetaText}>{session.target_km} km</Text>
                                </View>
                              )}
                              {session.target_pace_sec_km && (
                                <View style={st.metaItem}>
                                  <Ionicons name="speedometer-outline" size={11} color={C.text3} />
                                  <Text style={st.sessionMetaText}>{formatPace(session.target_pace_sec_km)}</Text>
                                </View>
                              )}
                              {session.estimated_kcal && (
                                <View style={st.metaItem}>
                                  <Ionicons name="flame-outline" size={11} color={C.text3} />
                                  <Text style={st.sessionMetaText}>~{session.estimated_kcal} kcal</Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </View>
                      ))}
                    </View>
                  )
                })}

                <Pressable
                  style={[st.calcBtn, { backgroundColor: cfg.color, marginTop: 8 }, programSaving && st.planBtnDisabled]}
                  onPress={saveProgram}
                  disabled={programSaving}
                >
                  {programSaving
                    ? <ActivityIndicator size="small" color={C.white} />
                    : <>
                        <Ionicons name="save-outline" size={18} color={C.white} />
                        <Text style={st.calcBtnText}>Save program</Text>
                      </>
                  }
                </Pressable>
              </>
            ) : (
              /* Program creation wizard */
              <>
                {/* Step 1: Program type */}
                <Text style={st.label}>Goal</Text>
                <View style={st.programTypeGrid}>
                  {PROGRAM_TYPES.map(type => {
                    const c = PROGRAM_CONFIG[type]
                    return (
                      <Pressable
                        key={type}
                        style={[st.programTypeCard, programType === type && { borderColor: c.color, backgroundColor: c.color + '11' }]}
                        onPress={() => onProgramTypeChange(type)}
                      >
                        <Text style={st.programTypeEmoji}>{c.emoji}</Text>
                        <Text style={[st.programTypeLabel, programType === type && { color: c.color, fontWeight: '800' }]}>{c.label}</Text>
                        <Text style={st.programTypeRange}>{c.minWeeks}–{c.maxWeeks} wks</Text>
                      </Pressable>
                    )
                  })}
                </View>

                {/* Step 2: Weeks */}
                <Text style={st.label}>Program length</Text>
                <View style={st.weekStepperRow}>
                  <Pressable
                    style={[st.stepperBtn, programWeeks <= cfg.minWeeks && st.stepperBtnDisabled]}
                    onPress={() => adjustWeeks(-1)}
                    disabled={programWeeks <= cfg.minWeeks}
                  >
                    <Ionicons name="remove" size={20} color={programWeeks <= cfg.minWeeks ? C.text3 : C.text1} />
                  </Pressable>
                  <View style={st.stepperCenter}>
                    <Text style={[st.stepperValue, { color: cfg.color }]}>{programWeeks}</Text>
                    <Text style={st.stepperUnit}>weeks</Text>
                  </View>
                  <Pressable
                    style={[st.stepperBtn, programWeeks >= cfg.maxWeeks && st.stepperBtnDisabled]}
                    onPress={() => adjustWeeks(1)}
                    disabled={programWeeks >= cfg.maxWeeks}
                  >
                    <Ionicons name="add" size={20} color={programWeeks >= cfg.maxWeeks ? C.text3 : C.text1} />
                  </Pressable>
                </View>
                <Text style={st.stepperHint}>{cfg.minWeeks}–{cfg.maxWeeks} weeks for {cfg.label}</Text>

                {/* Strength sub-config */}
                {programType === 'strength' && (
                  <>
                    <Text style={st.label}>Training focus</Text>
                    <View style={st.subConfigRow}>
                      {STRENGTH_FOCUSES.map(f => (
                        <Pressable
                          key={f.key}
                          style={[st.subConfigCard, strengthFocus === f.key && { borderColor: cfg.color, backgroundColor: cfg.color + '11' }]}
                          onPress={() => setStrengthFocus(f.key as StrengthFocus)}
                        >
                          <Text style={[st.subConfigLabel, strengthFocus === f.key && { color: cfg.color, fontWeight: '800' }]}>{f.label}</Text>
                          <Text style={st.subConfigNote}>{f.note}</Text>
                        </Pressable>
                      ))}
                    </View>

                    <Text style={st.label}>Focus areas</Text>
                    <View style={st.bodyPartRow}>
                      {BODY_PARTS.map(bp => {
                        const selected = strengthBodyParts.includes(bp)
                        return (
                          <Pressable
                            key={bp}
                            style={[st.bodyPartChip, selected && { backgroundColor: cfg.color, borderColor: cfg.color }]}
                            onPress={() => {
                              if (bp === 'Full Body') {
                                setStrengthBodyParts(['Full Body'])
                              } else {
                                setStrengthBodyParts(prev => {
                                  const next = prev.filter(p => p !== 'Full Body')
                                  return selected ? next.filter(p => p !== bp) || ['Full Body'] : [...next, bp]
                                })
                              }
                            }}
                          >
                            <Text style={[st.bodyPartChipText, selected && { color: C.white }]}>{bp}</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  </>
                )}

                {/* Swim sub-config */}
                {programType === 'swim' && (
                  <>
                    <Text style={st.label}>Goal distance</Text>
                    <View style={st.subConfigRow}>
                      {SWIM_GOALS.map(g => (
                        <Pressable
                          key={g.key}
                          style={[st.subConfigCard, swimGoal === g.key && { borderColor: cfg.color, backgroundColor: cfg.color + '11' }]}
                          onPress={() => setSwimGoal(g.key as SwimGoal)}
                        >
                          <Text style={[st.subConfigLabel, swimGoal === g.key && { color: cfg.color, fontWeight: '800' }]}>{g.label}</Text>
                          <Text style={st.subConfigNote}>{g.note}</Text>
                        </Pressable>
                      ))}
                    </View>

                    <View style={st.swimToggleRow}>
                      <Text style={st.swimToggleLabel}>Pool training</Text>
                      <View style={st.swimToggleBtns}>
                        <Pressable
                          style={[st.swimToggleBtn, swimPool && { backgroundColor: cfg.color, borderColor: cfg.color }]}
                          onPress={() => setSwimPool(true)}
                        >
                          <Text style={[st.swimToggleBtnText, swimPool && { color: C.white }]}>Pool</Text>
                        </Pressable>
                        <Pressable
                          style={[st.swimToggleBtn, !swimPool && { backgroundColor: cfg.color, borderColor: cfg.color }]}
                          onPress={() => setSwimPool(false)}
                        >
                          <Text style={[st.swimToggleBtnText, !swimPool && { color: C.white }]}>Open Water</Text>
                        </Pressable>
                      </View>
                    </View>
                  </>
                )}

                {/* Cycling sub-config */}
                {programType === 'cycling' && (
                  <>
                    <Text style={st.label}>Target event</Text>
                    <View style={st.subConfigRow}>
                      {CYCLING_EVENTS.map(e => (
                        <Pressable
                          key={e.key}
                          style={[st.subConfigCard, cyclingEvent === e.key && { borderColor: cfg.color, backgroundColor: cfg.color + '11' }]}
                          onPress={() => setCyclingEvent(e.key as CyclingEvent)}
                        >
                          <Text style={[st.subConfigLabel, cyclingEvent === e.key && { color: cfg.color, fontWeight: '800' }]}>{e.label}</Text>
                          <Text style={st.subConfigNote}>{e.note}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {ftpWatts && (
                      <View style={st.ftpBadge}>
                        <Ionicons name="flash-outline" size={14} color={cfg.color} />
                        <Text style={[st.ftpBadgeText, { color: cfg.color }]}>FTP: {ftpWatts}W — power zones will be used</Text>
                      </View>
                    )}
                  </>
                )}

                {/* Step 3: Starting point — not shown for pure strength */}
                {programType !== 'strength' && (
                <Text style={st.label}>Starting point</Text>
                )}

                {/* Running */}
                {['5k', '10k', 'half_marathon', 'marathon'].includes(programType) && (
                <View style={st.startingPointCard}>
                  <Text style={st.startingPointHint}>Long run distance</Text>
                  <View style={st.startingPointRow}>
                    <TextInput
                      style={[st.startingInput, { flex: 2 }]}
                      value={startingKm}
                      onChangeText={setStartingKm}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 8"
                      placeholderTextColor={C.text3}
                    />
                    <Text style={st.startingUnit}>km</Text>
                    <Text style={st.startingPointHint}>at</Text>
                    <View style={st.paceInputRow}>
                      <TextInput
                        style={[st.startingInput, st.paceInput]}
                        value={startingPaceMin}
                        onChangeText={setStartingPaceMin}
                        keyboardType="number-pad"
                        placeholder="5"
                        placeholderTextColor={C.text3}
                        maxLength={2}
                      />
                      <Text style={st.paceSep}>:</Text>
                      <TextInput
                        style={[st.startingInput, st.paceInput]}
                        value={startingPaceSec}
                        onChangeText={v => setStartingPaceSec(v.replace(/\D/g, '').slice(0, 2))}
                        keyboardType="number-pad"
                        placeholder="30"
                        placeholderTextColor={C.text3}
                        maxLength={2}
                      />
                    </View>
                    <Text style={st.startingUnit}>/km</Text>
                  </View>
                </View>
                )}

                {/* Swimming */}
                {programType === 'swim' && (
                <View style={st.startingPointCard}>
                  <Text style={st.startingPointHint}>Longest swim distance</Text>
                  <View style={st.startingPointRow}>
                    <TextInput
                      style={[st.startingInput, { flex: 2 }]}
                      value={startingKm}
                      onChangeText={setStartingKm}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 1500"
                      placeholderTextColor={C.text3}
                    />
                    <Text style={st.startingUnit}>m</Text>
                    <Text style={st.startingPointHint}>at</Text>
                    <View style={st.paceInputRow}>
                      <TextInput
                        style={[st.startingInput, st.paceInput]}
                        value={startingPaceMin}
                        onChangeText={setStartingPaceMin}
                        keyboardType="number-pad"
                        placeholder="2"
                        placeholderTextColor={C.text3}
                        maxLength={2}
                      />
                      <Text style={st.paceSep}>:</Text>
                      <TextInput
                        style={[st.startingInput, st.paceInput]}
                        value={startingPaceSec}
                        onChangeText={v => setStartingPaceSec(v.replace(/\D/g, '').slice(0, 2))}
                        keyboardType="number-pad"
                        placeholder="00"
                        placeholderTextColor={C.text3}
                        maxLength={2}
                      />
                    </View>
                    <Text style={st.startingUnit}>/100m</Text>
                  </View>
                </View>
                )}

                {/* Cycling */}
                {programType === 'cycling' && (
                <View style={st.startingPointCard}>
                  <Text style={st.startingPointHint}>FTP</Text>
                  <View style={st.startingPointRow}>
                    <TextInput
                      style={[st.startingInput, { flex: 2 }]}
                      value={ftpWatts != null ? String(ftpWatts) : ''}
                      onChangeText={v => setFtpWatts(v ? parseInt(v) : null)}
                      keyboardType="number-pad"
                      placeholder="e.g. 200"
                      placeholderTextColor={C.text3}
                    />
                    <Text style={st.startingUnit}>watts</Text>
                  </View>
                </View>
                )}

                <Pressable
                  style={[st.calcBtn, { backgroundColor: cfg.color }, programGenerating && st.planBtnDisabled]}
                  onPress={generatePlan}
                  disabled={programGenerating}
                >
                  {programGenerating
                    ? <>
                        <ActivityIndicator size="small" color={C.white} />
                        <Text style={st.calcBtnText}>Generating plan…</Text>
                      </>
                    : <>
                        <Ionicons name="sparkles-outline" size={18} color={C.white} />
                        <Text style={st.calcBtnText}>Generate {cfg.label} plan · {programWeeks} credits</Text>
                      </>
                  }
                </Pressable>
              </>
            )}
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
      </View>
        )}
      </AppDrawer>
    </SafeAreaView>
  )
}

// ─── Week overview bar ─────────────────────────────────────────────────────

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function WeekBar({
  activities,
  plans,
}: {
  activities: { type: string; date: string }[]
  plans: { sport_type: string; planned_for: string; status: string | null; is_key: boolean }[]
}) {
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const daysFromMonday = (today.getDay() + 6) % 7

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getTime() + (i - daysFromMonday) * 86400000)
    const dateStr = d.toISOString().split('T')[0]
    return {
      label: DAY_LABELS[i],
      date: d.getDate(),
      dateStr,
      isToday: dateStr === todayStr,
      acts: activities.filter(a => a.date.slice(0, 10) === dateStr),
      plans: plans.filter(p => p.planned_for === dateStr),
    }
  })

  return (
    <View style={wb.container}>
      {days.map((day, i) => {
        const act = day.acts[0]
        const activePlan = day.plans.find(p => p.status !== 'skipped')
        const skipped = !act && !activePlan && day.plans.some(p => p.status === 'skipped')
        const sport = act?.type ?? activePlan?.sport_type ?? null
        const color = sport ? getSportColor(sport) : null

        return (
          <View key={i} style={wb.cell}>
            <Text style={[wb.dayLabel, day.isToday && { color: C.accent }]}>{day.label}</Text>
            <View style={[wb.dateCircle, day.isToday && { backgroundColor: C.accent }]}>
              <Text style={[wb.dateNum, day.isToday && wb.dateNumToday]}>{day.date}</Text>
            </View>
            {act && color ? (
              <View style={[wb.dot, { backgroundColor: color }]}>
                <Text style={wb.dotLetter}>{sport![0].toUpperCase()}</Text>
              </View>
            ) : activePlan && color ? (
              <View style={[wb.dotOutline, { borderColor: color }]}>
                <Text style={[wb.dotLetter, { color }]}>{sport![0].toUpperCase()}</Text>
              </View>
            ) : skipped ? (
              <Text style={wb.dotSkipped}>✗</Text>
            ) : (
              <View style={wb.dotEmpty} />
            )}
          </View>
        )
      })}
    </View>
  )
}

const wb = StyleSheet.create({
  container: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: C.surface2, borderRadius: 14, padding: 12,
    marginBottom: 20, borderWidth: 1, borderColor: C.border,
  },
  cell: { alignItems: 'center', gap: 3, flex: 1 },
  dayLabel: { fontSize: 10, fontWeight: '600', color: C.text3, textTransform: 'uppercase' },
  dateCircle: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dateNum: { fontSize: 12, fontWeight: '600', color: C.text2 },
  dateNumToday: { color: '#fff', fontWeight: '800' },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  dotOutline: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  dotEmpty: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.border, marginTop: 9 },
  dotLetter: { fontSize: 9, fontWeight: '800', color: '#fff' },
  dotSkipped: { fontSize: 12, color: '#EF5350', marginTop: 4 },
})

// ─── styles ────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, paddingBottom: 60 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  topBarTitle: { fontSize: 15, fontWeight: '700', color: C.text1 },
  screenTitle: { fontSize: 26, fontWeight: '800', marginBottom: 20, color: C.text1 },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: C.text3,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12,
  },
  label: { fontSize: 11, fontWeight: '700', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },

  // Today's plan card
  todayCard: {
    backgroundColor: C.surface2, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 24,
  },
  planRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, gap: 12 },
  planRowBorder: { borderBottomWidth: 1, borderBottomColor: C.divider },
  planDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  planInfo: { flex: 1 },
  planSport: { fontSize: 14, fontWeight: '700', color: C.text1, marginBottom: 2 },
  planMeta: { fontSize: 12, color: C.text2, marginBottom: 2 },
  planDesc: { fontSize: 12, color: C.text3, lineHeight: 17 },

  // Mode selector — 2×2 grid
  modeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  modeBtn: {
    flexBasis: '47%', flexGrow: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2,
  },
  modeBtnText: { fontSize: 12, fontWeight: '600', color: C.text3 },
  modeBtnTextActive: { color: C.white },

  // Sport dropdown
  sportDropBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 2, borderRadius: 12, padding: 14, backgroundColor: C.surface2, marginBottom: 24,
  },
  sportDropLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sportDropText: { fontSize: 16, fontWeight: '700', color: C.text1 },
  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  sportSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 8, paddingBottom: 40, maxHeight: '60%',
  },
  sportSheetTitle: {
    fontSize: 12, fontWeight: '700', color: C.text3, textTransform: 'uppercase',
    letterSpacing: 0.8, paddingHorizontal: 20, paddingVertical: 12,
  },
  sportSheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderTopColor: C.divider,
  },
  sportSheetRowText: { fontSize: 16, color: C.text1, flex: 1 },

  calcBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 15, borderRadius: 12, marginBottom: 24,
  },
  calcBtnText: { color: C.white, fontWeight: '700', fontSize: 16 },

  // Build mode empty state
  noZonesBox: {
    alignItems: 'center', gap: 8, paddingVertical: 40,
    backgroundColor: C.surface2, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, marginTop: 8,
  },
  noZonesText: { fontSize: 15, fontWeight: '600', color: C.text2 },
  noZonesLink: { fontSize: 13, color: C.accent, fontWeight: '600' },

  // Segment builder
  segCard: {
    backgroundColor: C.surface2, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 10,
  },
  segHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  segIndex: { fontSize: 11, fontWeight: '700', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5 },
  segToggleRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  segToggleBtn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface3,
  },
  segToggleText: { fontSize: 13, fontWeight: '600', color: C.text2 },
  segInputRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  segInputGroup: { flex: 2 },
  segRepeatGroup: { flex: 1 },
  segInput: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 8,
    padding: 10, fontSize: 15, backgroundColor: C.surface3, marginBottom: 2, color: C.text1,
  },
  segInputUnit: { fontSize: 11, color: C.text3, textAlign: 'center' },
  segZoneRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segZoneBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: '#fff',
  },
  segZoneBtnNum: { fontSize: 13, fontWeight: '800', color: C.text2 },
  segZoneDetail: { fontSize: 11, color: C.text3, marginTop: 7 },

  addSegBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    justifyContent: 'center', paddingVertical: 12, marginBottom: 16,
  },
  addSegBtnText: { fontSize: 14, fontWeight: '700' },

  segResultCard: { borderLeftWidth: 4, borderRadius: 12, backgroundColor: C.surface2, padding: 16, marginBottom: 12 },
  segResultTotals: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  segResultStat: { flex: 1, alignItems: 'center' },
  segResultValue: { fontSize: 26, fontWeight: '800' },
  segResultLabel: { fontSize: 11, color: C.text3, marginTop: 2 },
  divider: { width: 1, height: 36, backgroundColor: C.border },
  segBreakRow: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.divider },
  segBreakLabel: { fontSize: 13, fontWeight: '600', color: C.text1, marginBottom: 1 },
  segBreakMeta: { fontSize: 12, color: C.text3 },

  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: C.text2 },

  planBtn: { backgroundColor: C.surface3, borderWidth: 1.5, borderColor: C.accent, borderRadius: 8, padding: 10, alignItems: 'center' },
  planBtnDisabled: { opacity: 0.5 },
  planBtnText: { color: C.accent, fontWeight: '700', fontSize: 14 },

  // AI mode
  aiInfoBox: { flexDirection: 'row', gap: 8, backgroundColor: 'C.accent2Bg', borderRadius: 12, padding: 12, marginBottom: 20 },
  aiInfoText: { flex: 1, fontSize: 13, color: C.accent2, lineHeight: 18 },
  aiInput: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 12,
    padding: 14, fontSize: 15, backgroundColor: C.surface2, color: C.text1,
    minHeight: 100, marginBottom: 16,
  },
  aiResultCard: { backgroundColor: C.surface2, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: 'C.accent2Border' },
  aiResultHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  aiResultTitle: { fontSize: 14, fontWeight: '700', color: C.text1, flex: 1 },
  aiKcalBadge: { backgroundColor: C.accentBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  aiKcalBadgeText: { fontSize: 12, fontWeight: '700', color: C.accent2 },
  aiResultText: { fontSize: 14, color: C.text1, lineHeight: 21 },

  emptyBox: { padding: 24, alignItems: 'center' },
  emptyText: { fontSize: 14, color: C.text3, textAlign: 'center' },

  // Programs mode
  progHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14, gap: 12 },
  progTitle: { fontSize: 20, fontWeight: '800', color: C.text1, marginBottom: 2 },
  progSubtitle: { fontSize: 13, color: C.text3 },
  endProgBtn: {
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
  },
  endProgBtnText: { fontSize: 13, fontWeight: '700', color: C.text2 },

  progProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  progProgressTrack: {
    flex: 1, height: 8, backgroundColor: C.surface3, borderRadius: 4, overflow: 'hidden',
  },
  progProgressFill: { height: '100%', borderRadius: 4, minWidth: 4 },
  progProgressLabel: { fontSize: 13, fontWeight: '700', color: C.text2, minWidth: 60, textAlign: 'right' },

  weekBlock: {
    backgroundColor: C.surface2, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 10, overflow: 'hidden',
  },
  weekHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14,
  },
  weekBadge: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  weekBadgeText: { fontSize: 13, fontWeight: '800' },
  weekLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: C.text1 },
  weekProgress: { fontSize: 13, color: C.text3, fontWeight: '600' },

  sessionRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: C.divider,
  },
  sessionRowDone: { opacity: 0.6 },
  sessionCheck: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  sessionInfo: { flex: 1 },
  sessionName: { fontSize: 14, fontWeight: '700', color: C.text1, marginBottom: 3 },
  sessionNameDone: { textDecorationLine: 'line-through', color: C.text3 },
  sessionDesc: { fontSize: 13, color: C.text2, lineHeight: 18, marginBottom: 6 },
  sessionMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sessionMetaText: { fontSize: 11, color: C.text3 },

  newProgramBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, marginTop: 8,
  },
  newProgramBtnText: { fontSize: 14, color: C.text3, fontWeight: '600' },

  // Wizard — program type grid
  programTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  programTypeCard: {
    flexBasis: '47%', flexGrow: 1,
    backgroundColor: C.surface2, borderRadius: 14,
    borderWidth: 2, borderColor: C.border,
    padding: 14, alignItems: 'center', gap: 4,
  },
  programTypeEmoji: { fontSize: 26 },
  programTypeLabel: { fontSize: 15, fontWeight: '700', color: C.text1 },
  programTypeRange: { fontSize: 11, color: C.text3 },

  // Wizard — week stepper
  weekStepperRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 24, marginBottom: 6,
  },
  stepperBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  stepperBtnDisabled: { opacity: 0.3 },
  stepperCenter: { alignItems: 'center' },
  stepperValue: { fontSize: 40, fontWeight: '900', lineHeight: 44 },
  stepperUnit: { fontSize: 12, color: C.text3, fontWeight: '600' },
  stepperHint: { fontSize: 12, color: C.text3, textAlign: 'center', marginBottom: 24 },

  // Wizard — starting point
  startingPointCard: {
    backgroundColor: C.surface2, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 24, gap: 10,
  },
  startingPointHint: { fontSize: 13, color: C.text2 },
  startingPointRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  startingInput: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 8,
    padding: 10, fontSize: 16, backgroundColor: C.surface3, color: C.text1, textAlign: 'center',
  },
  startingUnit: { fontSize: 13, color: C.text2, fontWeight: '600' },
  paceInputRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  paceInput: { width: 44 },
  paceSep: { fontSize: 18, fontWeight: '700', color: C.text2 },

  // Wizard — calibration
  calibrationInput: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 12,
    padding: 14, fontSize: 14, backgroundColor: C.surface2, color: C.text1,
    minHeight: 110, marginBottom: 20,
  },

  // Sub-config (strength / swim / cycling)
  subConfigRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  subConfigCard: {
    flexBasis: '47%', flexGrow: 1,
    backgroundColor: C.surface2, borderRadius: 12,
    borderWidth: 2, borderColor: C.border,
    padding: 12, gap: 2,
  },
  subConfigLabel: { fontSize: 14, fontWeight: '700', color: C.text1 },
  subConfigNote: { fontSize: 11, color: C.text3 },

  bodyPartRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  bodyPartChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2,
  },
  bodyPartChipText: { fontSize: 13, fontWeight: '600', color: C.text2 },

  swimToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  swimToggleLabel: { fontSize: 14, fontWeight: '600', color: C.text1 },
  swimToggleBtns: { flexDirection: 'row', gap: 8 },
  swimToggleBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2,
  },
  swimToggleBtnText: { fontSize: 13, fontWeight: '600', color: C.text2 },

  ftpBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'C.successBg', borderRadius: 10, padding: 10, marginBottom: 20,
    borderWidth: 1, borderColor: C.border,
  },
  ftpBadgeText: { fontSize: 13, fontWeight: '600' },

  // Workout diagram
  diagramLabel: {
    fontSize: 10, fontWeight: '700', color: C.text3,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 4,
  },
  diagramBar: {
    flexDirection: 'row', height: 40, borderRadius: 8, overflow: 'hidden',
    marginBottom: 8,
  },
  diagramSegment: {
    justifyContent: 'center', alignItems: 'center', minWidth: 2,
  },
  diagramSegmentText: {
    fontSize: 11, fontWeight: '800', color: C.white,
    textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  diagramLegend: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  diagramLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  diagramLegendDot: { width: 8, height: 8, borderRadius: 4 },
  diagramLegendText: { fontSize: 11, color: C.text2, fontWeight: '600' },
  segZoneTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  segZoneTagText: { fontSize: 11, fontWeight: '800' },

  // AI mode — structured inputs
  aiDurationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  aiDurationBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2,
  },
  aiDurationBtnText: { fontSize: 14, fontWeight: '700', color: C.text2 },
  aiGoalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  aiGoalCard: {
    flexBasis: '47%', flexGrow: 1,
    backgroundColor: C.surface2, borderRadius: 12,
    borderWidth: 2, borderColor: C.border,
    padding: 12, gap: 2,
  },
  aiGoalLabel: { fontSize: 14, fontWeight: '700', color: C.text1 },
  aiGoalNote: { fontSize: 11, color: C.text3 },

  // No activity data banner
  noDataBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: C.surface2, borderRadius: 10, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: C.border,
  },
  noDataBannerText: { flex: 1, fontSize: 13, color: C.text3, lineHeight: 18 },

})
