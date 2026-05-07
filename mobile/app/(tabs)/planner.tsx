import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView, Modal,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { C } from '../../lib/theme'
import type {
  HeartRateZone, BurnSchemaPoint, SportEnergySetting, PlannedWorkout,
  TrainingProgram, TrainingProgramSession, ProgramType,
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

type PlannerMode = 'kcal' | 'build' | 'ai' | 'programs'

interface ZoneSuggestion {
  zone: HeartRateZone
  midHR: number
  kcalPerHour: number
  durationMin: number
  distanceFormatted: string | null
  paceFormatted: string | null
}

interface WorkoutSegment {
  id: string
  inputType: 'distance' | 'time'
  value: string
  zoneId: string
  repeats: string
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

// ─── program config ─────────────────────────────────────────────────────────

const PROGRAM_CONFIG: Record<ProgramType, { label: string; minWeeks: number; maxWeeks: number; emoji: string; color: string }> = {
  '5k':            { label: '5K',           minWeeks: 4,  maxWeeks: 12, emoji: '🏃', color: '#EF5350' },
  '10k':           { label: '10K',          minWeeks: 6,  maxWeeks: 14, emoji: '🏃', color: '#FF8A65' },
  'half_marathon': { label: 'Half Marathon', minWeeks: 8,  maxWeeks: 16, emoji: '🏅', color: '#AB47BC' },
  'marathon':      { label: 'Marathon',      minWeeks: 16, maxWeeks: 32, emoji: '🏆', color: '#5C6BC0' },
  'swim':          { label: 'Swimming',      minWeeks: 6,  maxWeeks: 20, emoji: '🏊', color: '#29B6F6' },
  'cycling':       { label: 'Cycling',       minWeeks: 8,  maxWeeks: 24, emoji: '🚴', color: '#66BB6A' },
  'strength':      { label: 'Strength',      minWeeks: 6,  maxWeeks: 16, emoji: '💪', color: '#7E57C2' },
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
  return ['#64B5F6', '#66BB6A', '#FFCA28', '#FF7043', '#EF5350'][n - 1] ?? '#90A4AE'
}

// ─── screen ────────────────────────────────────────────────────────────────

export default function PlannerScreen() {
  const [userId, setUserId] = useState<string | null>(null)
  const [weightKg, setWeightKg] = useState<number | null>(null)
  const [ftpWatts, setFtpWatts] = useState<number | null>(null)

  const [sports, setSports] = useState<string[]>([])
  const [selectedSport, setSelectedSport] = useState<string>('')

  const [zones, setZones] = useState<HeartRateZone[]>([])
  const [burnSchema, setBurnSchema] = useState<BurnSchemaPoint[]>([])
  const [sportSettings, setSportSettings] = useState<SportEnergySetting[]>([])
  const [avgSpeedBySport, setAvgSpeedBySport] = useState<Record<string, number>>({})

  const [todayPlans, setTodayPlans] = useState<PlannedWorkout[]>([])
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null)

  const [mode, setMode] = useState<PlannerMode>('kcal')

  // kcal mode
  const [targetKcal, setTargetKcal] = useState('500')
  const [suggestions, setSuggestions] = useState<ZoneSuggestion[]>([])
  const [calculated, setCalculated] = useState(false)

  // build mode
  const [segments, setSegments] = useState<WorkoutSegment[]>([
    { id: '1', inputType: 'distance', value: '', zoneId: '', repeats: '1' },
  ])
  const [segResult, setSegResult] = useState<SegmentResult | null>(null)

  // ai mode
  const [aiGoal, setAiGoal] = useState('endurance')
  const [aiDuration, setAiDuration] = useState('60')
  const [aiNotes, setAiNotes] = useState('')
  const [aiResult, setAiResult] = useState<AiResult | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  // programs mode — wizard
  const [programType, setProgramType] = useState<ProgramType>('5k')
  const [programWeeks, setProgramWeeks] = useState(8)
  const [startingKm, setStartingKm] = useState('')
  const [startingPaceMin, setStartingPaceMin] = useState('')
  const [startingPaceSec, setStartingPaceSec] = useState('')
  const [calibrationNotes, setCalibrationNotes] = useState('')
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

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)

    const todayStr = localDate()

    const [profileRes, activitiesRes, zonesRes, burnRes, settingsRes, plansRes, userSportsRes, programRes] = await Promise.all([
      supabase.from('users').select('weight_kg, ftp_watts').eq('id', user.id).single(),
      supabase.from('activities').select('type, distance_m, duration_sec').eq('user_id', user.id),
      supabase.from('heart_rate_zones').select('*').eq('user_id', user.id).order('zone_number'),
      supabase.from('burn_schema_points').select('*').eq('user_id', user.id).order('hr_value'),
      supabase.from('sport_energy_settings').select('*').eq('user_id', user.id),
      supabase.from('planned_workouts').select('*').eq('user_id', user.id).eq('planned_for', todayStr).order('created_at'),
      supabase.from('user_sports').select('*').eq('user_id', user.id).order('sort_order'),
      supabase.from('training_programs').select('*').eq('user_id', user.id).eq('active', true).limit(1).maybeSingle(),
    ])

    setWeightKg(profileRes.data?.weight_kg ?? null)
    setFtpWatts(profileRes.data?.ftp_watts ?? null)
    setZones(zonesRes.data ?? [])
    setBurnSchema(burnRes.data ?? [])
    setSportSettings(settingsRes.data ?? [])
    setTodayPlans(plansRes.data ?? [])

    const userSportNames: string[] = (userSportsRes.data ?? []).map((s: any) => s.sport_name)
    let sportList: string[]
    if (userSportNames.length > 0) {
      sportList = userSportNames
    } else {
      const normalized = (activitiesRes.data ?? [])
        .map((a: any) => normalizeType(a.type))
        .filter((t: string) => t.length > 0 && !t.startsWith('Virtual'))
      sportList = [...new Set<string>(normalized)].sort()
    }
    setSports(sportList)
    setSelectedSport(prev => (sportList.includes(prev) ? prev : (sportList[0] ?? '')))

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
    setDeletingPlanId(id)
    await supabase.from('planned_workouts').delete().eq('id', id)
    setTodayPlans(prev => prev.filter(p => p.id !== id))
    setDeletingPlanId(null)
  }

  // ─── kcal mode ─────────────────────────────────────────────────────────────

  const calculate = useCallback(() => {
    const kcal = parseFloat(targetKcal)
    if (isNaN(kcal) || kcal <= 0) { Alert.alert('Invalid', 'Enter a positive calorie target.'); return }
    if (zones.length === 0) { Alert.alert('No zones', 'Set up your heart rate zones in Settings first.'); return }
    if (!weightKg) { Alert.alert('No weight', 'Add your weight in Settings → Personal Info first.'); return }

    const avgSpeed = avgSpeedBySport[selectedSport] ?? null
    const results: ZoneSuggestion[] = zones.map(zone => {
      const midHR = Math.round((zone.min_bpm + zone.max_bpm) / 2)
      const kcalPerHour = getKcalPerHour(zone)
      const durationHours = kcal / kcalPerHour
      const durationMin = Math.round(durationHours * 60)
      const durationSec = durationHours * 3600

      let distanceFormatted: string | null = null
      let paceFormatted: string | null = null

      if (avgSpeed && avgSpeed > 0) {
        const distM = avgSpeed * durationSec
        if (/swim/i.test(selectedSport)) {
          distanceFormatted = `${Math.round(distM)} m`
          const s = 100 / avgSpeed
          paceFormatted = `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} /100m`
        } else if (/run|jog|walk/i.test(selectedSport)) {
          distanceFormatted = `${(distM / 1000).toFixed(1)} km`
          const s = 1000 / avgSpeed
          paceFormatted = `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} /km`
        } else {
          distanceFormatted = `${(distM / 1000).toFixed(1)} km`
          paceFormatted = `${(avgSpeed * 3.6).toFixed(1)} km/h`
        }
      }

      return { zone, midHR, kcalPerHour: Math.round(kcalPerHour), durationMin, distanceFormatted, paceFormatted }
    })

    setSuggestions(results)
    setCalculated(true)
  }, [targetKcal, selectedSport, zones, burnSchema, sportSettings, weightKg, avgSpeedBySport])

  async function planFromKcalMode(suggestion: ZoneSuggestion) {
    if (!userId) return
    setSaving(true)
    const { error } = await supabase.from('planned_workouts').insert({
      user_id: userId,
      sport_type: selectedSport,
      target_kcal: Math.round(parseFloat(targetKcal)),
      zone_id: suggestion.zone.id,
      target_duration_min: suggestion.durationMin,
      target_hr: suggestion.midHR,
      planned_for: localDate(),
    })
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    Alert.alert('Planned!', `${selectedSport} in ${suggestion.zone.name} added to today.`)
    load()
  }

  // ─── build mode ─────────────────────────────────────────────────────────────

  function addSegment() {
    setSegments(prev => [...prev, { id: String(Date.now()), inputType: 'distance', value: '', zoneId: '', repeats: '1' }])
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
    if (zones.length === 0) { Alert.alert('No zones', 'Set up your HR zones in Settings first.'); return }
    if (!weightKg) { Alert.alert('No weight', 'Add your weight in Settings → Personal Info first.'); return }

    const results: SegmentResult['segments'] = []
    let totalKcal = 0
    let totalDurationMin = 0

    for (const seg of segments) {
      const val = parseFloat(seg.value)
      if (isNaN(val) || val <= 0) {
        Alert.alert('Invalid segment', 'All segments need a positive distance or time value.')
        return
      }
      const repeats = Math.max(1, parseInt(seg.repeats) || 1)
      const zone = zones.find(z => z.id === seg.zoneId)
      if (!zone) { Alert.alert('Missing zone', 'Select a zone for every segment.'); return }

      const kcalPerHour = getKcalPerHour(zone)
      let durationMin: number
      let label: string

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

      const segKcal = Math.round(kcalPerHour * (durationMin / 60)) * repeats
      const segDurationMin = durationMin * repeats
      results.push({
        label: repeats > 1 ? `${repeats}× (${label})` : label,
        kcal: segKcal,
        durationMin: Math.round(segDurationMin),
        zoneNumber: zone.zone_number,
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
    const { error } = await supabase.from('planned_workouts').insert({
      user_id: userId,
      sport_type: selectedSport,
      target_kcal: segResult.totalKcal,
      target_duration_min: segResult.totalDurationMin,
      planned_for: localDate(),
      workout_description: description,
    })
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
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
        body: { message, sport: selectedSport || undefined },
      })
      if (res.error) {
        const body = await res.error.context?.json?.().catch(() => null)
        throw new Error(body?.error ?? res.error.message)
      }
      setAiResult(res.data as AiResult)
    } catch (e: any) {
      Alert.alert('AI Coach error', e?.message ?? 'Could not reach AI Coach.')
    } finally {
      setAiLoading(false)
    }
  }

  async function planFromAIMode() {
    if (!aiResult || !userId) return
    const kcal = aiResult.estimated_kcal
    if (!kcal) { Alert.alert('No estimate', 'The AI response did not include a kcal estimate.'); return }
    setSaving(true)
    const { error } = await supabase.from('planned_workouts').insert({
      user_id: userId,
      sport_type: selectedSport || 'General',
      target_kcal: kcal,
      planned_for: localDate(),
      workout_description: aiResult.plan,
    })
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    Alert.alert('Planned!', "AI workout added to today's plan.")
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

    if (isRunning || isSwim || isCycling) {
      const km = parseFloat(startingKm)
      if (!isStrength && (isNaN(km) || km <= 0)) {
        Alert.alert('Invalid', `Enter your current ${isSwim ? 'swim distance (m→km)' : isRunning ? 'longest run' : 'ride distance'} in km.`)
        return
      }
      startingKmVal = km
      const paceMin = parseInt(startingPaceMin || '0')
      const paceSec = parseInt(startingPaceSec || '0')
      if (!isStrength && paceMin <= 0 && paceSec <= 0) {
        Alert.alert('Invalid', `Enter your current ${isSwim ? 'swim' : isRunning ? 'running' : 'cycling'} pace.`)
        return
      }
      paceSecTotal = paceMin * 60 + paceSec
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
          calibration_notes: calibrationNotes.trim() || null,
          subtype_config: buildSubtypeConfig(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Generation failed')
      setGeneratedSessions(json.sessions as GeneratedSession[])
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not generate plan.')
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
        calibration_notes: calibrationNotes.trim() || null,
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
    setCalibrationNotes('')
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
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
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

        {/* Mode selector — 2×2 grid */}
        <View style={st.modeGrid}>
          {([
            { key: 'kcal',     label: 'Target kcal',  icon: 'flame-outline'      as const },
            { key: 'build',    label: 'Build workout', icon: 'list-outline'       as const },
            { key: 'ai',       label: 'AI Coach',      icon: 'sparkles-outline'   as const },
            { key: 'programs', label: 'Programs',      icon: 'trophy-outline'     as const },
          ] as const).map(m => (
            <Pressable
              key={m.key}
              style={[st.modeBtn, mode === m.key && { backgroundColor: sportColor, borderColor: sportColor }]}
              onPress={() => setMode(m.key)}
            >
              <Ionicons name={m.icon} size={14} color={mode === m.key ? '#fff' : C.text3} />
              <Text style={[st.modeBtnText, mode === m.key && st.modeBtnTextActive]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Sport selector — shown for kcal/build/ai modes */}
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
                      setCalculated(false)
                      setSegResult(null)
                    }}
                  >
                    <MaterialCommunityIcons name={getSportIcon(sport) as any} size={20} color={getSportColor(sport)} />
                    <Text style={[st.sportSheetRowText, selectedSport === sport && { color: '#FC4C02', fontWeight: '700' }]}>{sport}</Text>
                    {selectedSport === sport && <Ionicons name="checkmark" size={16} color="#FC4C02" />}
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* ─── KCAL MODE ────────────────────────────────────────────────────── */}
        {mode === 'kcal' && (
          <>
            <Text style={st.label}>Target (kcal)</Text>
            <View style={st.kcalRow}>
              {[300, 400, 500, 600, 750, 1000].map(v => (
                <Pressable
                  key={v}
                  style={[st.kcalPreset, targetKcal === String(v) && { backgroundColor: sportColor, borderColor: sportColor }]}
                  onPress={() => { setTargetKcal(String(v)); setCalculated(false) }}
                >
                  <Text style={[st.kcalPresetText, targetKcal === String(v) && st.kcalPresetTextActive]}>{v}</Text>
                </Pressable>
              ))}
            </View>
            <View style={st.kcalInputRow}>
              <TextInput
                style={st.kcalInput}
                value={targetKcal}
                onChangeText={v => { setTargetKcal(v); setCalculated(false) }}
                keyboardType="numeric"
                placeholder="Other amount"
                placeholderTextColor={C.text3}
              />
              <Text style={st.kcalUnit}>kcal</Text>
            </View>

            <Pressable style={[st.calcBtn, { backgroundColor: sportColor }]} onPress={calculate}>
              <Ionicons name="calculator-outline" size={18} color="#fff" />
              <Text style={st.calcBtnText}>Calculate</Text>
            </Pressable>

            {calculated && suggestions.map(s => (
              <View key={s.zone.id} style={[st.suggestionCard, { borderLeftColor: sportColor }]}>
                <View style={st.suggestionTop}>
                  <View>
                    <Text style={st.zoneName}>{s.zone.name}</Text>
                    <Text style={st.zoneHR}>{s.zone.min_bpm}–{s.zone.max_bpm} bpm · ~{s.midHR} bpm avg</Text>
                  </View>
                  <Text style={[st.duration, { color: sportColor }]}>{formatDuration(s.durationMin)}</Text>
                </View>
                <View style={st.suggestionMeta}>
                  <View style={st.metaItem}>
                    <Ionicons name="flame-outline" size={13} color={C.text3} />
                    <Text style={st.metaText}>{s.kcalPerHour} kcal/hr</Text>
                  </View>
                  {s.distanceFormatted && (
                    <View style={st.metaItem}>
                      <Ionicons name="navigate-outline" size={13} color={C.text3} />
                      <Text style={st.metaText}>{s.distanceFormatted}</Text>
                    </View>
                  )}
                  {s.paceFormatted && (
                    <View style={st.metaItem}>
                      <Ionicons name="speedometer-outline" size={13} color={C.text3} />
                      <Text style={st.metaText}>{s.paceFormatted}</Text>
                    </View>
                  )}
                </View>
                <Pressable
                  style={[st.planBtn, saving && st.planBtnDisabled]}
                  onPress={() => planFromKcalMode(s)}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator size="small" color="#FC4C02" /> : <Text style={st.planBtnText}>Plan for today →</Text>}
                </Pressable>
              </View>
            ))}

            {calculated && suggestions.length === 0 && (
              <View style={st.emptyBox}>
                <Text style={st.emptyText}>No zones configured. Add HR zones in Settings first.</Text>
              </View>
            )}
          </>
        )}

        {/* ─── BUILD MODE ───────────────────────────────────────────────────── */}
        {mode === 'build' && (
          <>
            <Text style={st.label}>Workout segments</Text>

            {segments.map((seg, idx) => {
              const selZone = zones.find(z => z.id === seg.zoneId)
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
                      style={[st.segToggleBtn, seg.inputType === 'distance' && { backgroundColor: sportColor, borderColor: sportColor }]}
                      onPress={() => updateSegment(seg.id, { inputType: 'distance', value: '' })}
                    >
                      <Text style={[st.segToggleText, seg.inputType === 'distance' && { color: '#fff' }]}>Distance</Text>
                    </Pressable>
                    <Pressable
                      style={[st.segToggleBtn, seg.inputType === 'time' && { backgroundColor: sportColor, borderColor: sportColor }]}
                      onPress={() => updateSegment(seg.id, { inputType: 'time', value: '' })}
                    >
                      <Text style={[st.segToggleText, seg.inputType === 'time' && { color: '#fff' }]}>Time</Text>
                    </Pressable>
                  </View>

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

                  <View style={st.segZoneRow}>
                    {zones.map(z => (
                      <Pressable
                        key={z.id}
                        style={[st.segZoneBtn, seg.zoneId === z.id && { backgroundColor: sportColor, borderColor: sportColor }]}
                        onPress={() => updateSegment(seg.id, { zoneId: z.id })}
                      >
                        <Text style={[st.segZoneBtnNum, seg.zoneId === z.id && { color: '#fff' }]}>Z{z.zone_number}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {selZone && (
                    <Text style={st.segZoneDetail}>{selZone.name} · {selZone.min_bpm}–{selZone.max_bpm} bpm</Text>
                  )}
                </View>
              )
            })}

            <Pressable style={st.addSegBtn} onPress={addSegment}>
              <Ionicons name="add-circle-outline" size={18} color={sportColor} />
              <Text style={[st.addSegBtnText, { color: sportColor }]}>Add segment</Text>
            </Pressable>

            <Pressable style={[st.calcBtn, { backgroundColor: sportColor }]} onPress={calculateSegments}>
              <Ionicons name="stats-chart-outline" size={18} color="#fff" />
              <Text style={st.calcBtnText}>Calculate workout</Text>
            </Pressable>

            {segResult && (
              <View style={[st.segResultCard, { borderLeftColor: sportColor }]}>
                {/* Totals */}
                <View style={st.segResultTotals}>
                  <View style={st.segResultStat}>
                    <Text style={[st.segResultValue, { color: sportColor }]}>{segResult.totalKcal}</Text>
                    <Text style={st.segResultLabel}>kcal</Text>
                  </View>
                  <View style={st.divider} />
                  <View style={st.segResultStat}>
                    <Text style={[st.segResultValue, { color: sportColor }]}>{formatDuration(segResult.totalDurationMin)}</Text>
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
                            Z{s.zoneNumber}
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
                      <Text style={st.diagramLegendText}>Z{zn}</Text>
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
                      <Text style={[st.segZoneTagText, { color: zoneBarColor(s.zoneNumber) }]}>Z{s.zoneNumber}</Text>
                    </View>
                  </View>
                ))}

                <Pressable
                  style={[st.planBtn, { marginTop: 14 }, saving && st.planBtnDisabled]}
                  onPress={planFromBuildMode}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator size="small" color="#FC4C02" /> : <Text style={st.planBtnText}>Plan for today →</Text>}
                </Pressable>
              </View>
            )}
          </>
        )}

        {/* ─── AI COACH MODE ────────────────────────────────────────────────── */}
        {mode === 'ai' && (
          <>
            <View style={st.aiInfoBox}>
              <Ionicons name="sparkles-outline" size={14} color={C.accent2} />
              <Text style={st.aiInfoText}>
                Set your goal and duration — the AI Coach will design a workout around your HR zones and historical pace.
              </Text>
            </View>

            {/* Duration */}
            <Text style={st.label}>Duration</Text>
            <View style={st.aiDurationRow}>
              {AI_DURATION_PRESETS.map(d => (
                <Pressable
                  key={d}
                  style={[st.aiDurationBtn, aiDuration === d && { backgroundColor: C.accent2, borderColor: C.accent2 }]}
                  onPress={() => setAiDuration(d)}
                >
                  <Text style={[st.aiDurationBtnText, aiDuration === d && { color: '#fff' }]}>{d}'</Text>
                </Pressable>
              ))}
            </View>

            {/* Goal */}
            <Text style={st.label}>Workout goal</Text>
            <View style={st.aiGoalGrid}>
              {AI_GOALS.map(g => (
                <Pressable
                  key={g.key}
                  style={[st.aiGoalCard, aiGoal === g.key && { borderColor: C.accent2, backgroundColor: 'rgba(124,131,253,0.12)' }]}
                  onPress={() => setAiGoal(g.key)}
                >
                  <Text style={[st.aiGoalLabel, aiGoal === g.key && { color: C.accent2, fontWeight: '800' }]}>{g.label}</Text>
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

            <Pressable
              style={[st.calcBtn, { backgroundColor: C.accent2 }, aiLoading && st.planBtnDisabled]}
              onPress={askAI}
              disabled={aiLoading}
            >
              {aiLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <>
                    <Ionicons name="sparkles-outline" size={18} color="#fff" />
                    <Text style={st.calcBtnText}>Generate workout</Text>
                  </>
              }
            </Pressable>

            {aiResult && (
              <View style={st.aiResultCard}>
                <View style={st.aiResultHeader}>
                  <Ionicons name="sparkles-outline" size={14} color={C.accent2} />
                  <Text style={st.aiResultTitle}>AI Coach plan</Text>
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
                    ? <ActivityIndicator size="small" color="#FC4C02" />
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
                    <View style={[st.progProgressFill, { width: `${Math.round(progress * 100)}%` as any, backgroundColor: PROGRAM_CONFIG[activeProgram.program_type as ProgramType]?.color ?? '#FC4C02' }]} />
                  </View>
                  <Text style={st.progProgressLabel}>{completedCount}/{programSessions.length} done</Text>
                </View>

                {/* Sessions by week */}
                {weekNumbers.map(weekNum => {
                  const weekSessions = programSessions.filter(s => s.week_number === weekNum)
                  const weekDone = weekSessions.filter(s => s.completed).length
                  const isExpanded = expandedWeeks.has(weekNum)
                  const progColor = PROGRAM_CONFIG[activeProgram.program_type as ProgramType]?.color ?? '#FC4C02'

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
                              ? <ActivityIndicator size="small" color="#fff" />
                              : session.completed
                                ? <Ionicons name="checkmark" size={14} color="#fff" />
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
                                  <Ionicons name="link-outline" size={11} color="#FC4C02" />
                                  <Text style={[st.sessionMetaText, { color: '#FC4C02' }]}>Strava</Text>
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
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <>
                        <Ionicons name="save-outline" size={18} color="#fff" />
                        <Text style={st.calcBtnText}>Save program</Text>
                      </>
                  }
                </Pressable>
              </>
            ) : (
              /* Program creation wizard */
              <>
                <View style={st.aiInfoBox}>
                  <Ionicons name="trophy-outline" size={14} color={C.accent2} />
                  <Text style={st.aiInfoText}>
                    Build a structured multi-week training plan tailored to your goal race and current fitness.
                  </Text>
                </View>

                {/* Step 1: Program type */}
                <Text style={st.label}>Goal race</Text>
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

                    <Text style={st.label}>Body parts to emphasise</Text>
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
                            <Text style={[st.bodyPartChipText, selected && { color: '#fff' }]}>{bp}</Text>
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
                          <Text style={[st.swimToggleBtnText, swimPool && { color: '#fff' }]}>Pool</Text>
                        </Pressable>
                        <Pressable
                          style={[st.swimToggleBtn, !swimPool && { backgroundColor: cfg.color, borderColor: cfg.color }]}
                          onPress={() => setSwimPool(false)}
                        >
                          <Text style={[st.swimToggleBtnText, !swimPool && { color: '#fff' }]}>Open Water</Text>
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
                <Text style={st.label}>Your current fitness</Text>
                )}
                {programType !== 'strength' && (
                <View style={st.startingPointCard}>
                  <Text style={st.startingPointHint}>I can currently run</Text>
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

                {/* Step 4: Calibration notes */}
                <Text style={st.label}>Coaching instructions (optional)</Text>
                <TextInput
                  style={st.calibrationInput}
                  value={calibrationNotes}
                  onChangeText={setCalibrationNotes}
                  placeholder="e.g. I prefer morning runs, no more than 4 sessions per week, avoid back-to-back hard days, focus on aerobic base first..."
                  placeholderTextColor={C.text3}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />

                <Pressable
                  style={[st.calcBtn, { backgroundColor: cfg.color }, programGenerating && st.planBtnDisabled]}
                  onPress={generatePlan}
                  disabled={programGenerating}
                >
                  {programGenerating
                    ? <>
                        <ActivityIndicator size="small" color="#fff" />
                        <Text style={st.calcBtnText}>Generating plan…</Text>
                      </>
                    : <>
                        <Ionicons name="sparkles-outline" size={18} color="#fff" />
                        <Text style={st.calcBtnText}>Generate {cfg.label} plan</Text>
                      </>
                  }
                </Pressable>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── styles ────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, paddingBottom: 60 },

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
  modeBtnTextActive: { color: '#fff' },

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

  kcalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  kcalPreset: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2,
  },
  kcalPresetText: { fontSize: 14, fontWeight: '600', color: C.text2 },
  kcalPresetTextActive: { color: '#fff' },
  kcalInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 24 },
  kcalInput: {
    flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 10,
    padding: 12, fontSize: 16, backgroundColor: C.surface2, color: C.text1,
  },
  kcalUnit: { fontSize: 14, color: C.text3, fontWeight: '600' },

  calcBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 15, borderRadius: 12, marginBottom: 24,
  },
  calcBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

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
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface3,
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

  // Suggestions (kcal mode)
  suggestionCard: {
    borderLeftWidth: 4, borderRadius: 12, backgroundColor: C.surface2,
    padding: 16, marginBottom: 12,
  },
  suggestionTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  zoneName: { fontSize: 16, fontWeight: '700', color: C.text1, marginBottom: 2 },
  zoneHR: { fontSize: 12, color: C.text3 },
  duration: { fontSize: 26, fontWeight: '800' },
  suggestionMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: C.text2 },

  planBtn: { backgroundColor: C.surface3, borderWidth: 1.5, borderColor: '#FC4C02', borderRadius: 8, padding: 10, alignItems: 'center' },
  planBtnDisabled: { opacity: 0.5 },
  planBtnText: { color: '#FC4C02', fontWeight: '700', fontSize: 14 },

  // AI mode
  aiInfoBox: { flexDirection: 'row', gap: 8, backgroundColor: 'rgba(124,131,253,0.12)', borderRadius: 12, padding: 12, marginBottom: 20 },
  aiInfoText: { flex: 1, fontSize: 13, color: C.accent2, lineHeight: 18 },
  aiInput: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 12,
    padding: 14, fontSize: 15, backgroundColor: C.surface2, color: C.text1,
    minHeight: 100, marginBottom: 16,
  },
  aiResultCard: { backgroundColor: C.surface2, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: 'rgba(124,131,253,0.25)' },
  aiResultHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  aiResultTitle: { fontSize: 14, fontWeight: '700', color: C.text1, flex: 1 },
  aiKcalBadge: { backgroundColor: '#7C83FD22', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
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
    backgroundColor: 'rgba(76,175,80,0.12)', borderRadius: 10, padding: 10, marginBottom: 20,
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
    fontSize: 11, fontWeight: '800', color: '#fff',
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
})
