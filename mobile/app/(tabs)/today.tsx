import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import {
  View, Text, ScrollView, StyleSheet, Pressable, TextInput,
  Modal, Alert, Platform, KeyboardAvoidingView, ActivityIndicator, Image,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { supabase } from '../../lib/supabase'
import { callSyncRecent, onSyncComplete } from '../../lib/stravaSync'
import { cancelMealNotification, scheduleMealNotifications } from '../../lib/notifications'
import { W as C } from '../../lib/themeWarm'
import { AppDrawer, HamburgerBtn } from '../../components/DrawerNav'
import { COMMON_FOOD_CATEGORIES } from '../../lib/commonFoods'
import type { CommonFood } from '../../lib/commonFoods'
import type { FoodLog, MealTemplate, MealPreset, MealPresetItem } from '../../types'
import { analyzeSkip } from '../../lib/progressionEngine'
import type { ProgressionAnalysis, ProgressionLevel } from '../../lib/progressionEngine'

// ─── Local types ──────────────────────────────────────────────────────────────

interface TodayActivity { id: string; name: string; type: string; total_kcal: number; source?: string; duration_sec?: number }
interface PlannedWorkout { id: string; sport_type: string; target_kcal: number; workout_description: string | null; status: 'completed' | 'skipped' | null; is_key: boolean }
interface PastUnresolved { id: string; sport_type: string; target_kcal: number; workout_description: string | null; planned_for: string; is_key: boolean; distance_m: number | null; target_duration_min: number | null }
interface MealItem {
  meal_index: number; name: string; scheduled_time: string; checked: boolean
  kcal: number | null; protein_g: number | null; fat_g: number | null; carb_g: number | null
  notify_enabled: boolean
}
interface ServingOption { label: string; kcal: number; protein_g: number | null; fat_g: number | null; carb_g: number | null }
interface CustomFood { id: string; name: string; kcal: number; protein_g: number | null; fat_g: number | null; carb_g: number | null; amount_label: string | null; category: string | null; serving_options: ServingOption[] | null; kcal_per_100g: number | null; protein_per_100g: number | null; fat_per_100g: number | null; carb_per_100g: number | null }

// ─── Sport colours ────────────────────────────────────────────────────────────

function sportColor(type: string) {
  const t = type.toLowerCase()
  if (t.includes('swim')) return C.swim
  if (t.includes('run') || t.includes('jog')) return C.run
  if (t.includes('walk')) return C.walk
  if (t.includes('ride') || t.includes('bike') || t.includes('cycling') || t.includes('virtual')) return C.ride
  return C.sport
}

// Session-lifetime cache for barcode lookups — same EAN never hits OpenFoodFacts twice
const _barcodeCache = new Map<string, {
  name: string; kcalPer100g: number
  proteinPer100g: number | null; fatPer100g: number | null; carbPer100g: number | null
}>()

// ─── Manual workout constants ─────────────────────────────────────────────────

const PORTION_OPTIONS = [
  { label: '¼', value: 0.25 },
  { label: '⅓', value: 1 / 3 },
  { label: '½', value: 0.5 },
  { label: '⅔', value: 2 / 3 },
  { label: '¾', value: 0.75 },
  { label: '1',  value: 1 },
  { label: '1½', value: 1.5 },
  { label: '2',  value: 2 },
  { label: '3',  value: 3 },
]

const MANUAL_SPORT_OPTIONS = [
  { type: 'WeightTraining', label: 'Gym',      mets: [3.5, 5.0, 6.0, 8.0] },
  { type: 'Cycling',        label: 'Cycling',   mets: [4.0, 6.8, 10.0, 12.0] },
  { type: 'Run',            label: 'Running',   mets: [6.0, 8.3, 11.0, 14.0] },
  { type: 'Walk',           label: 'Walking',   mets: [2.5, 3.5, 4.5, 6.0] },
  { type: 'Swim',           label: 'Swimming',  mets: [5.0, 7.0, 9.0, 11.0] },
  { type: 'Yoga',           label: 'Yoga',      mets: [2.0, 3.0, 4.0, 5.0] },
  { type: 'Workout',        label: 'HIIT',      mets: [6.0, 8.0, 10.0, 12.0] },
  { type: 'Other',          label: 'Other',     mets: [3.5, 5.0, 7.0, 9.0] },
]
const INTENSITY_OPTIONS = [
  { label: 'Light',    description: 'Machines, lots of rest' },
  { label: 'Moderate', description: 'Compound lifts, mixed' },
  { label: 'Intense',  description: 'Supersets, little rest' },
  { label: 'Circuit',  description: 'Circuit training / CrossFit' },
]

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function TodayScreen() {
  const router = useRouter()

  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [sex, setSex] = useState<string | null>(null)

  // Targets
  const [dailyTarget, setDailyTarget] = useState<number | null>(null)
  const [mealNotifDelayMin, setMealNotifDelayMin] = useState(60)
  const [maxKcalTarget, setMaxKcalTarget] = useState<number | null>(null)
  const [hideCalories, setHideCalories] = useState(false)

  // Period
  const [onPeriod, setOnPeriod] = useState(false)
  const [periodSeverity, setPeriodSeverity] = useState<'minor' | 'medium' | 'severe' | null>(null)

  // Cycle tracking
  const [cycleLength, setCycleLength] = useState(28)
  const [periodLength, setPeriodLength] = useState(5)
  const [follicularLength, setFollicularLength] = useState(8)
  const [lutealLength, setLutealLength] = useState(12)
  const [cycleType, setCycleType] = useState<'regular' | 'irregular'>('regular')
  const [lastPeriodStart, setLastPeriodStart] = useState<string | null>(null)
  const [showCycleModal, setShowCycleModal] = useState(false)
  const [cycleLengthDraft, setCycleLengthDraft] = useState('28')
  const [periodLengthDraft, setPeriodLengthDraft] = useState('5')
  const [follicularLengthDraft, setFollicularLengthDraft] = useState('8')
  const [lutealLengthDraft, setLutealLengthDraft] = useState('12')
  const [cycleTypeDraft, setCycleTypeDraft] = useState<'regular' | 'irregular'>('regular')
  // Date fields — DD / MM / YYYY as separate inputs
  const [dateDd, setDateDd] = useState('')
  const [dateMm, setDateMm] = useState('')
  const [dateYyyy, setDateYyyy] = useState('')
  const dateInputMm = useRef<any>(null)
  const dateInputYyyy = useRef<any>(null)

  // Calories
  const [burnedKcal, setBurnedKcal] = useState(0)
  const [plannedKcal, setPlannedKcal] = useState(0)
  const [consumedKcal, setConsumedKcal] = useState(0)

  // Activities
  const [todayActivities, setTodayActivities] = useState<TodayActivity[]>([])
  const [plannedWorkouts, setPlannedWorkouts] = useState<PlannedWorkout[]>([])
  const [pastUnresolved, setPastUnresolved] = useState<PastUnresolved[]>([])
  const [skipAnalysis, setSkipAnalysis] = useState<Record<string, ProgressionAnalysis | 'loading'>>({})
  const [aiAdvice, setAiAdvice] = useState<Record<string, string | 'loading'>>({})
  const [syncing, setSyncing] = useState(false)
  const [weightKg, setWeightKg] = useState(70)
  const [showLogWorkout, setShowLogWorkout] = useState(false)

  // Meals
  const [meals, setMeals] = useState<MealItem[]>([])
  const [presetsMap, setPresetsMap] = useState<Record<number, MealPreset[]>>({})
  const [pickerMeal, setPickerMeal] = useState<MealItem | null>(null)

  // Food log
  const [logs, setLogs] = useState<FoodLog[]>([])
  const [loading, setLoading] = useState(true)

  const [customFoods, setCustomFoods] = useState<CustomFood[]>([])

  // Unified food logger
  const [showFoodLogger, setShowFoodLogger] = useState(false)
  const [foodLoggerMealIndex, setFoodLoggerMealIndex] = useState<number | null>(null)

  // Coach inbox
  const [coachNotes, setCoachNotes] = useState<{ id: string; content: string; note_type: string; created_at: string; coach_name: string | null }[]>([])

  // Calorie modal
  const [calorieModalOpen, setCalorieModalOpen] = useState(false)

  // My meals
  const [allPresets, setAllPresets] = useState<MealPreset[]>([])
  const [editingPreset, setEditingPreset] = useState<MealPreset | null>(null)
  const [myMealsExpanded, setMyMealsExpanded] = useState(false)

  const lastLoadRef = useRef<number>(0)

  // ── Derived ────────────────────────────────────────────────────────────────

  const todayStr = new Date().toISOString().split('T')[0]
  const totalTarget = dailyTarget != null ? Math.round(dailyTarget + burnedKcal) : null
  const projectedTotal = totalTarget != null ? Math.round(totalTarget + plannedKcal) : null
  const displayKcal = projectedTotal ?? totalTarget
  const displayMaxKcal = maxKcalTarget != null ? Math.round(maxKcalTarget + burnedKcal + plannedKcal) : null

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  })()
  const dateLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const firstName = userName?.split(' ')[0] ?? null

  // ── Load ───────────────────────────────────────────────────────────────────

  useFocusEffect(useCallback(() => { if (Date.now() - lastLoadRef.current > 60_000) load() }, []))
  // Re-load when a background sync (e.g. startup) completes so new activities appear immediately
  useEffect(() => onSyncComplete(() => load()), [])

  // Always re-fetch profile fields on focus so settings changes are reflected immediately
  useFocusEffect(useCallback(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('users')
        .select('hide_calories, daily_kcal_target, max_kcal_target, meal_notif_delay_min, cycle_length, period_length, follicular_length, luteal_length, cycle_type, last_period_start, on_period, period_severity')
        .eq('id', user.id).single()
        .then(({ data }) => {
          if (!data) return
          setHideCalories(data.hide_calories ?? false)
          setDailyTarget(data.daily_kcal_target)
          setMaxKcalTarget(data.max_kcal_target)
          setMealNotifDelayMin(data.meal_notif_delay_min ?? 60)
          setCycleLength(data.cycle_length ?? 28)
          setPeriodLength(data.period_length ?? 5)
          setFollicularLength(data.follicular_length ?? 8)
          setLutealLength(data.luteal_length ?? 12)
          setCycleType(data.cycle_type ?? 'regular')
          setLastPeriodStart(data.last_period_start ?? null)
          setOnPeriod(data.on_period ?? false)
          setPeriodSeverity(data.period_severity ?? null)
        })
    })
  }, []))

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    setLoading(true)

    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

    const [profileRes, activitiesRes, plannedRes, logsRes, templatesRes, checksRes, presetsRes, customRes, allPresetsRes] = await Promise.all([
      supabase.from('users').select('name, avatar_url, sex, daily_kcal_target, max_kcal_target, hide_calories, weight_kg, on_period, period_severity, meal_notif_delay_min, cycle_length, period_length, follicular_length, luteal_length, cycle_type, last_period_start').eq('id', user.id).single(),
      supabase.from('activities').select('id, name, type, total_kcal, source, duration_sec').eq('user_id', user.id).gte('date', todayStr).lt('date', tomorrow).not('total_kcal', 'is', null),
      supabase.from('planned_workouts').select('id, sport_type, target_kcal, workout_description, status, is_key').eq('user_id', user.id).eq('planned_for', todayStr),
      supabase.from('food_logs').select('id, user_id, date, name, kcal, protein_g, fat_g, carb_g, meal_name, meal_index, logged_at').eq('user_id', user.id).eq('date', todayStr).order('logged_at'),
      supabase.from('meal_templates').select('id, meal_index, name, scheduled_time, kcal, protein_g, fat_g, carb_g, notify_enabled').eq('user_id', user.id).order('meal_index'),
      supabase.from('meal_checks').select('meal_index').eq('user_id', user.id).eq('date', todayStr),
      supabase.from('meal_slot_presets').select('meal_index, sort_order, preset:meal_presets(*, items:meal_preset_items(*))').eq('user_id', user.id).order('sort_order'),
      supabase.from('custom_foods').select('id, name, kcal, protein_g, fat_g, carb_g, amount_label, category, serving_options, kcal_per_100g, protein_per_100g, fat_per_100g, carb_per_100g').eq('user_id', user.id).order('name'),
      supabase.from('meal_presets').select('id, name, sort_order, items:meal_preset_items(id, preset_id, name, kcal, protein_g, fat_g, carb_g, amount_label, sort_order)').eq('user_id', user.id).order('name'),
    ])

    if (profileRes.data) {
      setUserName(profileRes.data.name)
      setAvatarUrl(profileRes.data.avatar_url ?? null)
      setSex(profileRes.data.sex ?? null)
      setDailyTarget(profileRes.data.daily_kcal_target)
      setMaxKcalTarget(profileRes.data.max_kcal_target)
      setHideCalories(profileRes.data.hide_calories ?? false)
      setWeightKg(profileRes.data.weight_kg ?? 70)
      setOnPeriod(profileRes.data.on_period ?? false)
      setPeriodSeverity(profileRes.data.period_severity ?? null)
      setMealNotifDelayMin(profileRes.data.meal_notif_delay_min ?? 60)
      const cl = profileRes.data.cycle_length ?? 28
      const pl = profileRes.data.period_length ?? 5
      const fl = profileRes.data.follicular_length ?? 8
      const ll = profileRes.data.luteal_length ?? 12
      const ct: 'regular' | 'irregular' = profileRes.data.cycle_type ?? 'regular'
      const lps: string | null = profileRes.data.last_period_start ?? null
      setCycleLength(cl)
      setPeriodLength(pl)
      setFollicularLength(fl)
      setLutealLength(ll)
      setCycleType(ct)
      setLastPeriodStart(lps)
      // Auto-clear on_period if we're past menstrual phase
      const day = lps ? (() => {
        const start = new Date(lps)
        const today = new Date(); today.setHours(0,0,0,0); start.setHours(0,0,0,0)
        const diff = Math.floor((today.getTime() - start.getTime()) / 86400000)
        if (diff < 0) return null
        return ct === 'regular' ? (diff % cl) + 1 : diff + 1
      })() : null
      if (day !== null && day > pl && profileRes.data.on_period) {
        setOnPeriod(false)
        setPeriodSeverity(null)
        supabase.from('users').update({ on_period: false, period_severity: null }).eq('id', user.id)
      }
    }

    const acts = (activitiesRes.data ?? []) as TodayActivity[]
    setTodayActivities(acts)
    setBurnedKcal(Math.round(acts.reduce((s, a) => s + (a.total_kcal ?? 0), 0)))

    const planned = (plannedRes.data ?? []) as PlannedWorkout[]
    setPlannedWorkouts(planned)
    setPlannedKcal(Math.round(planned.reduce((s, p) => s + p.target_kcal, 0)))

    // Past unresolved workouts: last 7 days, status not yet set
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
    const [pastPlannedRes, pastActivitiesRes] = await Promise.all([
      supabase.from('planned_workouts')
        .select('id, sport_type, target_kcal, workout_description, planned_for, is_key, distance_m, target_duration_min')
        .eq('user_id', user.id).is('status', null)
        .gte('planned_for', sevenDaysAgo).lt('planned_for', todayStr),
      supabase.from('activities')
        .select('date, type').eq('user_id', user.id)
        .gte('date', sevenDaysAgo).lt('date', todayStr),
    ])
    const pastActs: { date: string; type: string }[] = pastActivitiesRes.data ?? []
    const unresolved = ((pastPlannedRes.data ?? []) as PastUnresolved[]).filter(pw => {
      const sport = pw.sport_type.toLowerCase()
      return !pastActs.some(a => a.date === pw.planned_for && a.type.toLowerCase() === sport)
    })
    setPastUnresolved(unresolved)

    const logData = (logsRes.data ?? []) as FoodLog[]
    setLogs(logData)
    setConsumedKcal(Math.round(logData.reduce((s, l) => s + l.kcal, 0)))

    const templates = (templatesRes.data ?? []) as MealTemplate[]
    const checkedSet = new Set<number>((checksRes.data ?? []).map((c: any) => c.meal_index as number))
    setMeals(templates.map(t => ({
      meal_index: t.meal_index, name: t.name, scheduled_time: t.scheduled_time,
      checked: checkedSet.has(t.meal_index),
      kcal: t.kcal ?? null, protein_g: t.protein_g ?? null, fat_g: t.fat_g ?? null, carb_g: t.carb_g ?? null,
      notify_enabled: t.notify_enabled ?? true,
    })).sort((a, b) => (a.scheduled_time ?? '').localeCompare(b.scheduled_time ?? '')))

    const pMap: Record<number, MealPreset[]> = {}
    for (const row of (presetsRes.data ?? []) as any[]) {
      if (!row.preset) continue
      if (!pMap[row.meal_index]) pMap[row.meal_index] = []
      pMap[row.meal_index].push(row.preset as MealPreset)
    }
    setPresetsMap(pMap)

    setCustomFoods((customRes.data ?? []) as CustomFood[])
    setAllPresets((allPresetsRes.data ?? []) as MealPreset[])

    // Coach inbox — fetch recent notes sent to this athlete
    const { data: notesData } = await supabase
      .from('coach_notes')
      .select('id, content, note_type, created_at, coach:coach_id(name)')
      .eq('athlete_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)
    if (notesData) {
      setCoachNotes(notesData.map((n: any) => ({
        id: n.id, content: n.content, note_type: n.note_type,
        created_at: n.created_at, coach_name: n.coach?.name ?? null,
      })))
    }

    lastLoadRef.current = Date.now()
    setLoading(false)
  }

  // ── Sync Strava ────────────────────────────────────────────────────────────

  async function markWorkoutStatus(id: string, status: 'completed' | 'skipped') {
    await supabase.from('planned_workouts').update({ status }).eq('id', id)
    setPastUnresolved(prev => prev.filter(w => w.id !== id))
    setSkipAnalysis(prev => { const next = { ...prev }; delete next[id]; return next })
    setAiAdvice(prev => { const next = { ...prev }; delete next[id]; return next })
  }

  async function fetchSkipAdvice(id: string, sport: string, analysis: ProgressionAnalysis) {
    if (aiAdvice[id]) return
    setAiAdvice(prev => ({ ...prev, [id]: 'loading' }))
    const unit = analysis.metric === 'km' ? 'km' : 'min'
    const fmt = (v: number) => analysis.metric === 'km' ? v.toFixed(1) : String(Math.round(v))
    const parts: string[] = [`I skipped my ${sport} workout.`]
    if (analysis.lastLoad != null) parts.push(`My last ${sport} was ${fmt(analysis.lastLoad)} ${unit}.`)
    if (analysis.skippedLoad > 0) parts.push(`This workout was ${fmt(analysis.skippedLoad)} ${unit}.`)
    if (analysis.nextLoad != null && analysis.jumpIfSkipped != null)
      parts.push(`My next ${sport} is planned at ${fmt(analysis.nextLoad)} ${unit} — a ${analysis.jumpIfSkipped}% jump.`)
    const message = parts.join(' ')
    const { data } = await supabase.functions.invoke('ai-coach', {
      body: {
        message,
        sport,
        customGuidelines: 'Respond in exactly 1 short sentence (max 20 words). Be warm and direct. No bullet points, no kcal.',
      },
    })
    setAiAdvice(prev => ({ ...prev, [id]: data?.plan ?? '' }))
  }

  async function requestSkip(pw: PastUnresolved) {
    if (skipAnalysis[pw.id]) return
    setSkipAnalysis(prev => ({ ...prev, [pw.id]: 'loading' }))
    const analysis = await analyzeSkip(userId!, pw.sport_type, pw.planned_for, pw.distance_m, pw.target_duration_min)
    setSkipAnalysis(prev => ({ ...prev, [pw.id]: analysis }))
  }

  async function handlePostpone(pw: PastUnresolved) {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    await Promise.all([
      supabase.from('planned_workouts').update({ status: 'skipped' }).eq('id', pw.id),
      supabase.from('planned_workouts').insert({
        user_id: userId,
        sport_type: pw.sport_type,
        target_kcal: pw.target_kcal,
        target_duration_min: pw.target_duration_min,
        distance_m: pw.distance_m,
        workout_description: pw.workout_description,
        is_key: pw.is_key,
        planned_for: tomorrow,
        status: null,
      }),
    ])
    setPastUnresolved(prev => prev.filter(w => w.id !== pw.id))
    setSkipAnalysis(prev => { const next = { ...prev }; delete next[pw.id]; return next })
  }

  async function handleScaleDown(pw: PastUnresolved, analysis: ProgressionAnalysis) {
    if (!analysis.nextPlanId || analysis.safeLoad == null) return
    const metric = analysis.metric
    const safeKcal = analysis.nextLoad && analysis.nextLoad > 0
      ? Math.round(analysis.nextPlanKcal * (analysis.safeLoad / analysis.nextLoad))
      : analysis.nextPlanKcal
    const update: Record<string, unknown> = { target_kcal: safeKcal }
    if (metric === 'km') update.distance_m = Math.round(analysis.safeLoad * 1000)
    else update.target_duration_min = Math.round(analysis.safeLoad)
    await Promise.all([
      supabase.from('planned_workouts').update({ status: 'skipped' }).eq('id', pw.id),
      supabase.from('planned_workouts').update(update).eq('id', analysis.nextPlanId),
    ])
    setPastUnresolved(prev => prev.filter(w => w.id !== pw.id))
    setSkipAnalysis(prev => { const next = { ...prev }; delete next[pw.id]; return next })
  }

  async function syncStrava() {
    if (!userId || syncing) return
    setSyncing(true)
    try {
      const result = await callSyncRecent()
      if (!result.ok) {
        if ('skipped' in result) return
        if (result.error === 'strava_not_connected') {
          Alert.alert('Strava not connected', 'Link your Strava account in Settings.')
          return
        }
        if (result.error === 'rate_limit') {
          const mins = result.rateLimitMinutes ?? 15
          Alert.alert('Strava rate limit', `Too many syncs. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`)
          return
        }
        Alert.alert('Sync failed', result.error ?? 'Could not connect to Strava. Try again.')
        return
      }
      await load()
    } finally {
      setSyncing(false)
    }
  }

  // ── Manual workout logging ─────────────────────────────────────────────────

  async function logManualActivity(type: string, name: string, durationMin: number, kcal: number) {
    if (!userId) return
    const { data, error } = await supabase.from('activities').insert({
      user_id: userId,
      name,
      type,
      date: new Date().toISOString(),
      duration_sec: durationMin * 60,
      total_kcal: kcal,
      source: 'manual',
    }).select('id, name, type, total_kcal, source, duration_sec').single()
    if (error) { Alert.alert('Error', error.message); return }
    if (data) {
      setTodayActivities(prev => [...prev, data as TodayActivity])
      setBurnedKcal(prev => prev + Math.round(kcal))
    }
    setShowLogWorkout(false)
  }

  async function deleteManualActivity(id: string) {
    const kcal = todayActivities.find(a => a.id === id)?.total_kcal ?? 0
    Alert.alert('Delete workout', 'Remove this manually logged workout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('activities').delete().eq('id', id)
        setTodayActivities(prev => prev.filter(a => a.id !== id))
        setBurnedKcal(prev => Math.max(0, prev - Math.round(kcal)))
      }},
    ])
  }

  // ── Food log actions ───────────────────────────────────────────────────────

  async function addFood(name: string, kcal: number, protein: number | null, fat: number | null, carb: number | null, mealIndex: number | null = null, qty: number = 1, date: string = todayStr) {
    if (!userId) return

    if (date === todayStr) {
      // Stack duplicate entries: query DB directly to avoid stale-closure issues with logs state.
      const { data: existingRows } = await supabase
        .from('food_logs')
        .select('id, name, kcal, protein_g, fat_g, carb_g, meal_index')
        .eq('user_id', userId)
        .eq('date', date)

      const existing = (existingRows ?? []).find(l => {
        if (l.meal_index !== mealIndex) return false
        const m = l.name.match(/^(\d+)× (.+)$/)
        return (m ? m[2] : l.name) === name
      })

      if (existing) {
        const prevCount = existing.name.match(/^(\d+)× /)
        const count = prevCount ? parseInt(prevCount[1]) : 1
        const addCount = Math.round(qty) || 1
        const newName = `${count + addCount}× ${name}`
        const newKcal = Number(existing.kcal) + kcal
        const newProtein = (protein != null || existing.protein_g != null)
          ? Math.round(((existing.protein_g ?? 0) + (protein ?? 0)) * 10) / 10 : null
        const newFat = (fat != null || existing.fat_g != null)
          ? Math.round(((existing.fat_g ?? 0) + (fat ?? 0)) * 10) / 10 : null
        const newCarb = (carb != null || existing.carb_g != null)
          ? Math.round(((existing.carb_g ?? 0) + (carb ?? 0)) * 10) / 10 : null
        const { data: updated } = await supabase.from('food_logs')
          .update({ name: newName, kcal: newKcal, protein_g: newProtein, fat_g: newFat, carb_g: newCarb })
          .eq('id', existing.id)
          .select('id, user_id, date, name, kcal, protein_g, fat_g, carb_g, meal_name, meal_index, logged_at')
          .single()
        if (updated) {
          setLogs(prev => prev.map(l => l.id === existing.id ? updated as FoodLog : l))
          setConsumedKcal(prev => prev + kcal)
        }
        return
      }

      const meal = mealIndex != null ? meals.find(m => m.meal_index === mealIndex) : null
      // Check before insert: is this the first item going into this meal slot?
      const mealWasEmpty = mealIndex != null && !logs.some(l => l.meal_index === mealIndex)
      const { data: inserted, error } = await supabase.from('food_logs').insert({
        user_id: userId, date, name, kcal,
        protein_g: protein, fat_g: fat, carb_g: carb,
        meal_index: mealIndex, meal_name: meal?.name ?? null,
      }).select('id, user_id, date, name, kcal, protein_g, fat_g, carb_g, meal_name, meal_index, logged_at').single()
      if (error) { Alert.alert('Error', error.message); return }
      if (inserted) {
        setLogs(prev => [...prev, inserted as FoodLog])
        setConsumedKcal(prev => prev + inserted.kcal)
        // Auto-check the meal when the very first item is added to it
        if (mealWasEmpty) {
          setMeals(prev => prev.map(m => m.meal_index === mealIndex ? { ...m, checked: true } : m))
          await Promise.all([
            supabase.from('meal_checks').upsert(
              { user_id: userId, meal_index: mealIndex, date },
              { onConflict: 'user_id,meal_index,date' }
            ),
            cancelMealNotification(mealIndex!),
          ])
        }
      }
    } else {
      // Backfill — plain insert, no state update
      const meal = mealIndex != null ? meals.find(m => m.meal_index === mealIndex) : null
      await supabase.from('food_logs').insert({
        user_id: userId, date, name, kcal,
        protein_g: protein, fat_g: fat, carb_g: carb,
        meal_index: mealIndex, meal_name: meal?.name ?? null,
      })
    }
  }

  async function deleteLog(id: string) {
    const entry = logs.find(l => l.id === id)
    Alert.alert('Remove entry?', `Remove "${entry?.name ?? 'this entry'}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        setLogs(prev => prev.filter(l => l.id !== id))
        setConsumedKcal(prev => prev - (entry?.kcal ?? 0))
        await supabase.from('food_logs').delete().eq('id', id)
      }},
    ])
  }

  async function logPreset(preset: MealPreset, meal: MealItem, qty: number = 1, inputGrams?: number) {
    if (!userId) return
    const items = preset.items ?? []

    // Gram mode: scale all items proportionally based on entered grams vs their base grams
    let scaleFactor = qty
    let buildName: (item: typeof items[0]) => string
    if (inputGrams != null) {
      const totalBase = items.reduce((s, it) => {
        const m = (it.amount_label ?? '').match(/^(\d+(?:\.\d+)?)\s*g$/i)
        return s + (m ? parseFloat(m[1]) : 0)
      }, 0)
      scaleFactor = totalBase > 0 ? inputGrams / totalBase : 1
      buildName = (item) => {
        const m = (item.amount_label ?? '').match(/^(\d+(?:\.\d+)?)\s*g$/i)
        if (m) {
          const actualG = Math.round(parseFloat(m[1]) * scaleFactor)
          return `${actualG}g ${item.name}`
        }
        return item.amount_label ? `${item.amount_label} ${item.name}` : item.name
      }
    } else {
      buildName = (item) => {
        const itemName = item.amount_label ? `${item.amount_label} ${item.name}` : item.name
        return qty > 1 ? `${qty}x ${itemName}` : itemName
      }
    }

    const totalKcal = items.reduce((acc, it) => acc + Math.round(it.kcal * scaleFactor), 0)
    const rows = items.map(item => ({
      user_id: userId!, date: todayStr,
      name: buildName(item),
      kcal: Math.round(item.kcal * scaleFactor),
      protein_g: item.protein_g ? Math.round(item.protein_g * scaleFactor * 10) / 10 : null,
      fat_g: item.fat_g ? Math.round(item.fat_g * scaleFactor * 10) / 10 : null,
      carb_g: item.carb_g ? Math.round(item.carb_g * scaleFactor * 10) / 10 : null,
      meal_index: meal.meal_index, meal_name: meal.name,
    }))
    const [logRes] = await Promise.all([
      supabase.from('food_logs').insert(rows).select('id, user_id, date, name, kcal, protein_g, fat_g, carb_g, meal_name, meal_index, logged_at'),
      supabase.from('meal_checks').upsert({ user_id: userId, meal_index: meal.meal_index, date: todayStr }, { onConflict: 'user_id,meal_index,date' }),
    ])
    if (logRes.data) {
      setLogs(prev => [...prev, ...(logRes.data as FoodLog[])])
      setConsumedKcal(prev => prev + totalKcal)
    }
    setMeals(prev => prev.map(m => m.meal_index === meal.meal_index ? { ...m, checked: true } : m))
    setPickerMeal(null)
  }

  async function toggleMealCheck(meal: MealItem) {
    if (!userId) return
    const nowChecking = !meal.checked
    // Optimistic update — flip immediately so the UI responds instantly
    setMeals(prev => prev.map(m =>
      m.meal_index === meal.meal_index ? { ...m, checked: nowChecking } : m
    ))
    try {
      if (meal.checked) {
        // Unchecking — reschedule notification if time hasn't passed yet
        await supabase.from('meal_checks').delete().eq('user_id', userId).eq('meal_index', meal.meal_index).eq('date', todayStr)
        if (meal.notify_enabled !== false && meal.scheduled_time) {
          await scheduleMealNotifications([{ meal_index: meal.meal_index, name: meal.name, scheduled_time: meal.scheduled_time, date: todayStr, checked: false }], mealNotifDelayMin)
        }
      } else {
        // Checking — cancel any pending notification immediately
        await cancelMealNotification(meal.meal_index)
        await supabase.from('meal_checks').upsert({ user_id: userId, meal_index: meal.meal_index, date: todayStr }, { onConflict: 'user_id,meal_index,date' })
      }
    } catch {
      // Revert on failure
      setMeals(prev => prev.map(m =>
        m.meal_index === meal.meal_index ? { ...m, checked: meal.checked } : m
      ))
    }
  }

  async function logMealBundle(preset: MealPreset, mealIndex: number | null = null) {
    if (!userId) return
    const items = preset.items ?? []
    if (!items.length) return
    const meal = mealIndex != null ? meals.find(m => m.meal_index === mealIndex) : null
    const totalKcal = items.reduce((acc, it) => acc + it.kcal, 0)
    const rows = items.map(item => ({
      user_id: userId!, date: todayStr,
      name: item.amount_label ? `${item.amount_label} ${item.name}` : item.name,
      kcal: item.kcal,
      protein_g: item.protein_g ?? null,
      fat_g: item.fat_g ?? null,
      carb_g: item.carb_g ?? null,
      meal_index: mealIndex,
      meal_name: meal?.name ?? null,
    }))
    const { data: insertedRows, error } = await supabase.from('food_logs').insert(rows).select('id, user_id, date, name, kcal, protein_g, fat_g, carb_g, meal_name, meal_index, logged_at')
    if (error) { Alert.alert('Error', error.message); return }
    if (insertedRows) {
      setLogs(prev => [...prev, ...(insertedRows as FoodLog[])])
      setConsumedKcal(prev => prev + totalKcal)
    }
  }

  async function saveCustomFood(name: string, kcal: number, protein: number | null, fat: number | null, carb: number | null, servingOptions: ServingOption[] = [], kcal_per_100g: number | null = null, protein_per_100g: number | null = null, fat_per_100g: number | null = null, carb_per_100g: number | null = null) {
    if (!userId) return
    const { data } = await supabase.from('custom_foods').insert({
      user_id: userId, name, kcal, protein_g: protein, fat_g: fat, carb_g: carb,
      serving_options: servingOptions,
      kcal_per_100g, protein_per_100g, fat_per_100g, carb_per_100g,
    }).select('id, name, kcal, protein_g, fat_g, carb_g, amount_label, category, serving_options, kcal_per_100g, protein_per_100g, fat_per_100g, carb_per_100g').single()
    if (data) setCustomFoods(prev => [...prev, data as CustomFood].sort((a, b) => a.name.localeCompare(b.name)))
  }

  async function savePresetFromFood(name: string, kcal: number, protein: number | null, fat: number | null, carb: number | null) {
    if (!userId) return
    const { data: preset } = await supabase.from('meal_presets').insert({
      user_id: userId, name, sort_order: 0,
    }).select('id').single()
    if (!preset) return
    await supabase.from('meal_preset_items').insert({
      preset_id: preset.id, name, kcal, protein_g: protein, fat_g: fat, carb_g: carb, sort_order: 0,
    })
    await refreshPresets(userId)
  }

  async function deleteMealPreset(preset: MealPreset) {
    Alert.alert('Delete meal?', `Remove "${preset.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setAllPresets(prev => prev.filter(p => p.id !== preset.id))
        await supabase.from('meal_presets').delete().eq('id', preset.id)
      }},
    ])
  }

  async function refreshPresets(uid: string) {
    const [presetsRes, allPresetsRes] = await Promise.all([
      supabase.from('meal_slot_presets').select('meal_index, sort_order, preset:meal_presets(*, items:meal_preset_items(*))').eq('user_id', uid).order('sort_order'),
      supabase.from('meal_presets').select('id, name, sort_order, items:meal_preset_items(id, preset_id, name, kcal, protein_g, fat_g, carb_g, amount_label, sort_order)').eq('user_id', uid).order('name'),
    ])
    const pMap: Record<number, MealPreset[]> = {}
    for (const row of (presetsRes.data ?? []) as any[]) {
      if (!row.preset) continue
      if (!pMap[row.meal_index]) pMap[row.meal_index] = []
      pMap[row.meal_index].push(row.preset as MealPreset)
    }
    setPresetsMap(pMap)
    setAllPresets((allPresetsRes.data ?? []) as MealPreset[])
  }

  // ── Cycle helpers ──────────────────────────────────────────────────────────

  function getCycleDay(): number | null {
    if (!lastPeriodStart) return null
    const start = new Date(lastPeriodStart)
    const today = new Date()
    today.setHours(0,0,0,0); start.setHours(0,0,0,0)
    const diff = Math.floor((today.getTime() - start.getTime()) / 86400000)
    if (diff < 0) return null
    if (cycleType === 'irregular') return diff + 1
    return (diff % cycleLength) + 1
  }

  function getCyclePhase(day: number): { label: string; color: string; description: string } {
    if (day <= periodLength) return { label: 'Menstrual',  color: '#E91E8C', description: 'Period phase' }
    if (cycleType === 'irregular') {
      const ovStart = periodLength + follicularLength
      const ovEnd   = ovStart + 2
      if (day <= ovStart) return { label: 'Follicular', color: '#66BB6A', description: 'Energy rising' }
      if (day <= ovEnd)   return { label: 'Ovulation',  color: '#FFCA28', description: 'Peak energy' }
      return                     { label: 'Luteal',      color: '#9C27B0', description: 'Wind-down phase' }
    }
    const ovStart = Math.round(cycleLength * 0.46)  // ~day 13 for 28-day
    const ovEnd   = ovStart + 2
    if (day <= ovStart) return { label: 'Follicular', color: '#66BB6A', description: 'Energy rising' }
    if (day <= ovEnd)   return { label: 'Ovulation',  color: '#FFCA28', description: 'Peak energy' }
    return                     { label: 'Luteal',      color: '#9C27B0', description: 'Wind-down phase' }
  }

  function getCycleCoaching(day: number, phaseLabel: string, severity: 'minor' | 'medium' | 'severe' | null): {
    message: string; training: string; nutrition: string
  } {
    if (phaseLabel === 'Menstrual') {
      const msg = severity === 'severe'
        ? "Your body is working hard right now. Rest isn't giving up — it's the smartest training decision you can make today."
        : severity === 'medium'
        ? "Your body is working. That deserves respect, not guilt. Move gently if it feels good, rest if it doesn't. Either way, you're not losing progress."
        : "Move if it feels good — rest if it doesn't. Skipping intensity today won't cost you fitness."
      const train = severity === 'severe'
        ? "Rest or gentle yoga — skip all structured training today"
        : severity === 'medium'
        ? "Light walking or stretching only — hold off on intensity"
        : "Easy to moderate movement is fine — skip intervals or heavy lifting"
      return { message: msg, training: train, nutrition: "Iron-rich foods + extra carbs can help ease symptoms" }
    }
    if (phaseLabel === 'Follicular') {
      return {
        message: "Energy is building. Your body responds well to hard training right now — good time to push.",
        training: "High-intensity and strength work land well in this phase",
        nutrition: "Standard intake — prioritise protein to support adaptation",
      }
    }
    if (phaseLabel === 'Ovulation') {
      return {
        message: "You're at your peak. Use it.",
        training: "Best days for your hardest sessions, long efforts, or racing",
        nutrition: "Keep carbs up to match your high energy output",
      }
    }
    // Luteal
    const estimatedEnd = cycleType === 'regular'
      ? cycleLength
      : periodLength + follicularLength + 2 + lutealLength
    const isLateLuteal = day >= estimatedEnd - 6
    return {
      message: isLateLuteal
        ? "Lower energy is normal here — not failure. Your body needs more fuel and more sleep. Let it."
        : "Your body is shifting gears. Steady efforts work better than all-out intensity right now.",
      training: isLateLuteal
        ? "Light to moderate movement — prioritise recovery and sleep"
        : "Steady-state cardio and moderate training — dial back the high-intensity",
      nutrition: isLateLuteal
        ? "100–300 kcal extra is normal physiologically — don't fight it"
        : "Slightly more carbs and healthy fats help with energy and mood",
    }
  }

  // ── Calorie helpers ────────────────────────────────────────────────────────

  function calorieStatusLabel() {
    if (displayKcal == null) return null
    const isOver = consumedKcal >= displayKcal
    const isExceeded = displayMaxKcal != null && consumedKcal > displayMaxKcal
    if (isExceeded) return { text: 'Daily maximum exceeded', color: C.danger }
    if (isOver) return { text: 'Daily minimum reached', color: C.success }
    return { text: `${(displayKcal - consumedKcal).toLocaleString()} kcal remaining`, color: C.text1 }
  }

  const status = calorieStatusLabel()
  const barPct = displayKcal ? Math.min(consumedKcal / Math.max(displayKcal, 1), 1) : 0

  const presetSlotMap = useMemo(() => {
    const map: Record<string, Set<number>> = {}
    for (const [mealIndex, presets] of Object.entries(presetsMap)) {
      for (const preset of presets) {
        if (!map[preset.id]) map[preset.id] = new Set()
        map[preset.id].add(Number(mealIndex))
      }
    }
    return map
  }, [presetsMap])

  // ── UI ─────────────────────────────────────────────────────────────────────

  const cycleDay = getCycleDay()
  const phase = cycleDay != null ? getCyclePhase(cycleDay) : null

  return (
    <SafeAreaView style={st.container} edges={['top']}>
      <AppDrawer>
        {openDrawer => (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">

          {/* ── Top bar ── */}
          <View style={st.topBar}>
            <HamburgerBtn onPress={openDrawer} />
            <Text style={st.topDate}>{dateLabel}</Text>
            <Pressable onPress={() => router.push('/(tabs)/settings')} hitSlop={8}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={st.avatar} />
              ) : (
                <View style={st.avatarPlaceholder}>
                  <Ionicons name="person" size={20} color={C.text3} />
                </View>
              )}
            </Pressable>
          </View>

          {/* ── Greeting ── */}
          <View style={st.greetingBlock}>
            <Text style={st.greetingLine1}>{greeting}{firstName ? ',' : '.'}</Text>
            {firstName && <Text style={st.greetingLine2}>{firstName}.</Text>}
          </View>

          {/* ── Cycle tracker card ── */}
          {sex === 'female' && (
            <Pressable style={[st.cycleCard, { marginHorizontal: 16 }]} onPress={() => {
              setCycleLengthDraft(String(cycleLength))
              setPeriodLengthDraft(String(periodLength))
              setFollicularLengthDraft(String(follicularLength))
              setLutealLengthDraft(String(lutealLength))
              setCycleTypeDraft(cycleType)
              if (lastPeriodStart) {
                const [y, mo, d] = lastPeriodStart.split('-')
                setDateDd(d)
                setDateMm(mo)
                setDateYyyy(y)
              } else {
                setDateDd(''); setDateMm(''); setDateYyyy('')
              }
              setShowCycleModal(true)
            }}>
              {cycleDay != null && phase != null ? (() => {
                const coaching = getCycleCoaching(cycleDay, phase.label, periodSeverity)
                return (
                <>
                  <View style={st.cycleHeaderRow}>
                    <View style={[st.cyclePhaseDot, { backgroundColor: phase.color }]} />
                    <Text style={st.cyclePhaseLabel}>{phase.label}</Text>
                    <Text style={st.cycleDayText}>{phase.description}</Text>
                    <Ionicons name="chevron-forward" size={14} color={C.text3} style={{ marginLeft: 'auto' }} />
                  </View>
                  {(() => {
                    const isReg   = cycleType === 'regular'
                    const ovStart = isReg
                      ? Math.round(cycleLength * 0.46)
                      : periodLength + follicularLength
                    const ovEnd   = ovStart + 2
                    const total   = isReg ? cycleLength : periodLength + follicularLength + 2 + lutealLength
                    const markerPct = Math.min(Math.max(((cycleDay - 0.5) / total) * 100, 1), 99)
                    return (
                      <View style={st.cycleBarWrapper}>
                        <View style={st.cycleSegBar}>
                          <View style={{ flex: periodLength,                         backgroundColor: '#E91E8C', opacity: 0.35, height: '100%' }} />
                          <View style={{ flex: Math.max(ovStart - periodLength, 1), backgroundColor: '#66BB6A', opacity: 0.35, height: '100%' }} />
                          <View style={{ flex: ovEnd - ovStart + 1,                 backgroundColor: '#FFCA28', opacity: 0.35, height: '100%' }} />
                          <View style={{ flex: Math.max(total - ovEnd, 1),          backgroundColor: '#9C27B0', opacity: 0.35, height: '100%' }} />
                        </View>
                        <View style={[st.cycleMarkerWrap, { left: `${markerPct}%` as any }]}>
                          <View style={[st.cycleMarkerDot, { borderColor: phase.color }]} />
                          <Text style={st.cycleMarkerLabel}>Day {cycleDay}</Text>
                        </View>
                      </View>
                    )
                  })()}

                  {/* Supportive message */}
                  <Text style={[st.cycleMessage, { color: phase.color }]}>{coaching.message}</Text>

                  {/* Training + nutrition chips */}
                  <View style={st.cycleCoachRow}>
                    <View style={st.cycleCoachChip}>
                      <Ionicons name="barbell-outline" size={12} color={C.text3} />
                      <Text style={st.cycleCoachChipText}>{coaching.training}</Text>
                    </View>
                    <View style={st.cycleCoachChip}>
                      <Ionicons name="nutrition-outline" size={12} color={C.text3} />
                      <Text style={st.cycleCoachChipText}>{coaching.nutrition}</Text>
                    </View>
                  </View>

                  {cycleDay <= periodLength && (
                    <View style={st.cycleSeverityRow}>
                      {(['minor', 'medium', 'severe'] as const).map(level => (
                        <Pressable
                          key={level}
                          style={[st.cycleSeverityBtn, periodSeverity === level && { borderColor: '#E91E8C', backgroundColor: 'rgba(233,30,140,0.08)' }]}
                          onPress={async () => {
                            setPeriodSeverity(level)
                            setOnPeriod(true)
                            if (userId) await supabase.from('users').update({ on_period: true, period_severity: level }).eq('id', userId)
                          }}
                        >
                          <Text style={[st.cycleSeverityText, periodSeverity === level && { color: '#E91E8C' }]}>
                            {level === 'minor' ? 'Light' : level === 'medium' ? 'Moderate' : 'Severe'}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </>
                )
              })() : (
                <View style={st.cycleEmpty}>
                  <Ionicons name="rose-outline" size={16} color={C.text3} />
                  <Text style={st.cycleEmptyText}>Track your cycle — tap to set up</Text>
                </View>
              )}
            </Pressable>
          )}

          {/* ── Calorie card ── */}
          <Pressable onPress={() => !hideCalories && setCalorieModalOpen(true)}>
            <LinearGradient
              colors={[C.gradA, C.gradB]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={st.calorieCard}
            >
              {displayKcal != null ? (
                <>
                  {hideCalories ? (
                    <View style={st.progressTrack}>
                      <View style={[st.progressFill, { width: `${Math.round(barPct * 100)}%` as any }]} />
                    </View>
                  ) : (
                    <>
                      <Text style={st.calorieNum}>
                        {consumedKcal >= displayKcal
                          ? (consumedKcal > (displayMaxKcal ?? Infinity) ? '!' : '✓')
                          : (displayKcal - consumedKcal).toLocaleString()}
                      </Text>
                      <Text style={st.calorieLabelDark}>{status?.text ?? ''}</Text>
                      <View style={[st.progressTrack, { marginTop: 14, marginBottom: 0 }]}>
                        <View style={[st.progressFill, { width: `${Math.round(barPct * 100)}%` as any }]} />
                      </View>
                      <View style={st.calorieChips}>
                        {dailyTarget != null && (
                          <View style={st.chip}><Text style={st.chipText}>{dailyTarget.toLocaleString()} baseline</Text></View>
                        )}
                        {burnedKcal > 0 && (
                          <View style={st.chip}><Text style={st.chipText}>+{burnedKcal.toLocaleString()} burned</Text></View>
                        )}
                        {plannedKcal > 0 && (
                          <View style={st.chip}><Text style={st.chipText}>+{plannedKcal.toLocaleString()} planned</Text></View>
                        )}
                        <View style={[st.chip, st.chipEaten]}>
                          <Text style={[st.chipText, st.chipEatenText]}>{consumedKcal.toLocaleString()} eaten</Text>
                        </View>
                      </View>
                    </>
                  )}
                </>
              ) : (
                <Text style={st.calorieEmpty}>Set a calorie target in Settings →</Text>
              )}
            </LinearGradient>
          </Pressable>

          {/* ── Coach inbox ── */}
          {coachNotes.length > 0 && (
            <View style={st.card}>
              <Text style={st.cardTitle}>
                {coachNotes[0].coach_name ? `From ${coachNotes[0].coach_name}` : 'From your coach'}
              </Text>
              {coachNotes.map(n => {
                const isWorkout = n.note_type === 'workout'
                const isNutrition = n.note_type === 'nutrition'
                const color = isWorkout ? C.accent : isNutrition ? C.success : C.ride
                const icon: any = isWorkout ? 'flash' : isNutrition ? 'restaurant' : 'chatbubble-ellipses'
                const label = isWorkout ? 'Workout' : isNutrition ? 'Nutrition' : 'Note'
                const dateStr = new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                return (
                  <View key={n.id} style={[st.coachNoteRow, { borderLeftColor: color }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                      <Ionicons name={icon} size={12} color={color} />
                      <Text style={[st.coachNoteTag, { color }]}>{label}</Text>
                      <Text style={st.coachNoteDate}>{dateStr}</Text>
                    </View>
                    <Text style={st.coachNoteContent}>{n.content}</Text>
                  </View>
                )
              })}
            </View>
          )}

          {/* ── Today's workouts ── */}
          <View style={st.card}>
            <View style={st.cardHeader}>
              <Text style={st.cardTitle}>Workouts today</Text>
              <Pressable style={st.syncBtn} onPress={syncStrava} disabled={syncing}>
                {syncing
                  ? <ActivityIndicator size="small" color={C.accent2} />
                  : <><Ionicons name="sync-outline" size={14} color={C.accent2} /><Text style={st.syncBtnText}>Sync Strava</Text></>
                }
              </Pressable>
            </View>

            {todayActivities.length === 0 && plannedWorkouts.length === 0 && pastUnresolved.length === 0 && (
              <Text style={st.emptyNote}>No activities today yet.</Text>
            )}

            {pastUnresolved.map(pw => {
              const dayLabel = (() => {
                const d = new Date(pw.planned_for + 'T12:00:00')
                const diff = Math.round((new Date().setHours(12,0,0,0) - d.getTime()) / 86400000)
                if (diff === 1) return 'Yesterday'
                if (diff <= 6) return d.toLocaleDateString('en-GB', { weekday: 'long' })
                return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
              })()
              const analysis = skipAnalysis[pw.id]
              return (
                <View key={pw.id} style={st.unresolvedCard}>
                  <View style={st.unresolvedRow}>
                    {pw.is_key && <Ionicons name="star" size={12} color={C.accent} style={{ marginRight: 4 }} />}
                    <Text style={st.unresolvedTitle} numberOfLines={1}>
                      {pw.workout_description ?? pw.sport_type}
                    </Text>
                  </View>
                  <Text style={st.unresolvedDate}>{dayLabel} · Did you complete this?</Text>

                  {analysis && analysis !== 'loading' && (
                    <SkipImpactPanel
                      analysis={analysis}
                      coachAdvice={typeof aiAdvice[pw.id] === 'string' ? aiAdvice[pw.id] as string : undefined}
                      coachLoading={aiAdvice[pw.id] === 'loading'}
                      onAskCoach={analysis.level !== 'low' ? () => fetchSkipAdvice(pw.id, pw.sport_type, analysis) : undefined}
                    />
                  )}

                  <View style={st.unresolvedBtns}>
                    <Pressable style={st.unresolvedYes} onPress={() => markWorkoutStatus(pw.id, 'completed')}>
                      <Ionicons name="checkmark" size={13} color="#fff" />
                      <Text style={st.unresolvedYesText}>Yes, I did it</Text>
                    </Pressable>
                    {analysis === 'loading'
                      ? <View style={st.unresolvedSkip}><ActivityIndicator size="small" color={C.text3} /></View>
                      : !analysis
                        ? <Pressable style={st.unresolvedSkip} onPress={() => requestSkip(pw)}>
                            <Text style={st.unresolvedSkipText}>I skipped it</Text>
                          </Pressable>
                        : null
                    }
                  </View>

                  {analysis && analysis !== 'loading' && (
                    <SkipOptionsPanel
                      analysis={analysis}
                      onPostpone={() => handlePostpone(pw)}
                      onScaleDown={() => handleScaleDown(pw, analysis)}
                      onAccept={() => markWorkoutStatus(pw.id, 'skipped')}
                    />
                  )}
                </View>
              )
            })}

            {todayActivities.map(a => (
              <View key={a.id} style={[st.activityRow, { borderLeftColor: sportColor(a.type) }]}>
                <View style={{ flex: 1 }}>
                  <Text style={st.activityName}>{a.name}</Text>
                  <Text style={st.activityType}>
                    {a.source === 'manual' && a.duration_sec
                      ? `${Math.round(a.duration_sec / 60)} min · `
                      : ''
                    }{a.type}{a.source === 'manual' ? ' · Manual' : ''}
                  </Text>
                </View>
                {!hideCalories && <Text style={st.activityKcal}>+{Math.round(a.total_kcal).toLocaleString()} kcal</Text>}
                {a.source === 'manual' && (
                  <Pressable onPress={() => deleteManualActivity(a.id)} hitSlop={10} style={{ marginLeft: 10 }}>
                    <Ionicons name="trash-outline" size={15} color={C.danger} />
                  </Pressable>
                )}
              </View>
            ))}

            {plannedWorkouts.map(p => (
              <View key={p.id} style={[st.activityRow, { borderLeftColor: C.accent2, borderStyle: 'dashed' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={st.activityName}>{p.workout_description ?? p.sport_type}</Text>
                  <Text style={st.activityType}>Planned · {p.sport_type}</Text>
                </View>
                {!hideCalories && <Text style={[st.activityKcal, { color: C.accent2 }]}>~{p.target_kcal.toLocaleString()} kcal</Text>}
              </View>
            ))}

            <Pressable style={st.planBtn} onPress={() => setShowLogWorkout(true)}>
              <Ionicons name="pencil-outline" size={15} color={C.accent} />
              <Text style={[st.planBtnText, { color: C.accent }]}>Log workout manually</Text>
            </Pressable>
            <Pressable style={st.planBtn} onPress={() => router.push('/(tabs)/planner')}>
              <Ionicons name="add-circle-outline" size={15} color={C.accent2} />
              <Text style={st.planBtnText}>Plan a workout</Text>
            </Pressable>
          </View>

          {/* ── Meal slots ── */}
          {meals.length > 0 && (
            <View style={st.card}>
              <Text style={st.cardTitle}>Food log</Text>
              {(() => {
                const remainingKcal = (totalTarget != null && consumedKcal != null) ? totalTarget - consumedKcal : null
                const uncheckedMeals = meals.filter(m => !m.checked)
                const suggestedPerMeal = (!hideCalories && remainingKcal != null && remainingKcal > 0 && uncheckedMeals.length > 0)
                  ? Math.round(remainingKcal / uncheckedMeals.length)
                  : null
                return (
                  <>
                    {suggestedPerMeal != null && (
                      <View style={st.mealSuggestionBanner}>
                        <Text style={st.mealSuggestionText}>
                          <Text style={{ fontWeight: '700' }}>{Math.round(remainingKcal!)} kcal</Text>
                          {` remaining across ${uncheckedMeals.length} meal${uncheckedMeals.length !== 1 ? 's' : ''} — ~${suggestedPerMeal} per meal`}
                        </Text>
                      </View>
                    )}
                    {meals.map(meal => {
                      const presets = presetsMap[meal.meal_index] ?? []
                      const mealLogs = logs.filter(l => l.meal_index === meal.meal_index)
                      const mealKcal = mealLogs.reduce((s, l) => s + l.kcal, 0)
                      const kcalDisplay = !hideCalories
                        ? !meal.checked && suggestedPerMeal != null
                          ? meal.kcal
                            ? ` · ${meal.kcal} kcal  (~${suggestedPerMeal} today)`
                            : ` · ~${suggestedPerMeal} kcal`
                          : meal.kcal ? ` · ${meal.kcal} kcal` : ''
                        : ''
                      return (
                        <View key={meal.meal_index} style={[st.mealCard, meal.checked && st.mealCardChecked]}>
                          <Pressable style={st.mealCardHeader} onPress={() => toggleMealCheck(meal)}>
                            <View>
                              <Text style={st.mealName}>{meal.name}</Text>
                              <Text style={st.mealTime}>{meal.scheduled_time}{kcalDisplay}</Text>
                            </View>
                            <View style={st.mealHeaderRight}>
                              {mealKcal > 0 && !hideCalories && <Text style={st.mealKcalBadge}>{mealKcal} kcal</Text>}
                              <View style={[st.checkCircle, meal.checked && st.checkCircleActive]}>
                                {meal.checked && <Ionicons name="checkmark" size={14} color="#fff" />}
                              </View>
                            </View>
                          </Pressable>

                          {mealLogs.map(log => (
                            <View key={log.id} style={st.mealLogRow}>
                              <Text style={st.mealLogName} numberOfLines={1}>{log.name}</Text>
                              {!hideCalories && <Text style={st.mealLogKcal}>{log.kcal} kcal</Text>}
                              <Pressable onPress={() => deleteLog(log.id)} hitSlop={8}>
                                <Ionicons name="close-outline" size={16} color={C.text3} />
                              </Pressable>
                            </View>
                          ))}

                          <View style={st.mealActions}>
                            {presets.length > 0 && (
                              <Pressable style={st.mealActionBtn} onPress={() => setPickerMeal(meal)}>
                                <Ionicons name="bookmark-outline" size={13} color={C.accent} />
                                <Text style={st.mealActionText}>Preset</Text>
                              </Pressable>
                            )}
                            <Pressable style={[st.mealActionBtn, st.mealActionBtnCoral]} onPress={() => { setFoodLoggerMealIndex(meal.meal_index); setShowFoodLogger(true) }}>
                              <Ionicons name="add-outline" size={13} color={C.accent2} />
                              <Text style={[st.mealActionText, { color: C.accent2 }]}>Add food</Text>
                            </Pressable>
                          </View>
                        </View>
                      )
                    })}
                    {!hideCalories && (() => {
                      const target = totalTarget
                      const totalLogged = logs.filter(l => l.meal_index != null).reduce((s, l) => s + l.kcal, 0)
                      if (target == null && totalLogged === 0) return null
                      return (
                        <View style={st.mealSummaryRow}>
                          <Text style={st.mealSummaryLabel}>Total</Text>
                          <Text style={st.mealSummaryValue}>
                            {totalLogged > 0 ? `${totalLogged} / ` : ''}{target != null ? `${target} kcal` : `${totalLogged} kcal`}
                          </Text>
                        </View>
                      )
                    })()}
                  </>
                )
              })()}
            </View>
          )}

          {/* ── My Meals ── */}
          <View style={st.card}>
            <Pressable style={st.cardHeader} onPress={() => setMyMealsExpanded(v => !v)}>
              <Text style={st.cardTitle}>My Meals</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pressable onPress={e => { e.stopPropagation?.(); router.push('/(tabs)/settings') }} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Text style={{ fontSize: 12, color: C.text3 }}>Manage</Text>
                  <Ionicons name="arrow-forward" size={12} color={C.text3} />
                </Pressable>
                <Ionicons
                  name={myMealsExpanded ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={C.text3}
                />
              </View>
            </Pressable>
            {myMealsExpanded && (
              <>
                {allPresets.length === 0 && (
                  <Text style={st.emptyNote}>No meal templates yet — create them in Settings.</Text>
                )}
                {allPresets.map(preset => {
                  const total = (preset.items ?? []).reduce((s, it) => s + it.kcal, 0)
                  return (
                    <View key={preset.id} style={st.mealPresetRow}>
                      <Pressable style={{ flex: 1 }} onPress={() => logMealBundle(preset)}>
                        <Text style={st.mealPresetName}>{preset.name}</Text>
                        <Text style={st.mealPresetMeta}>
                          {(preset.items ?? []).length} items{!hideCalories ? ` · ${total} kcal` : ''}
                        </Text>
                      </Pressable>
                      <Pressable onPress={() => setEditingPreset(preset)} hitSlop={10} style={{ padding: 6 }}>
                        <Ionicons name="pencil-outline" size={16} color={C.text3} />
                      </Pressable>
                      <Pressable onPress={() => deleteMealPreset(preset)} hitSlop={10} style={{ padding: 6 }}>
                        <Ionicons name="trash-outline" size={16} color={C.danger} />
                      </Pressable>
                      <Pressable onPress={() => logMealBundle(preset)} hitSlop={10} style={{ paddingLeft: 2 }}>
                        <Ionicons name="add-circle-outline" size={20} color={C.accent2} />
                      </Pressable>
                    </View>
                  )
                })}
              </>
            )}
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
        )}
      </AppDrawer>

      {/* ── Modals ── */}

      <LogWorkoutModal
        visible={showLogWorkout}
        weightKg={weightKg}
        hideCalories={hideCalories}
        onClose={() => setShowLogWorkout(false)}
        onSave={logManualActivity}
      />

      <CalorieBreakdownModal
        visible={calorieModalOpen}
        dailyTarget={dailyTarget}
        burned={burnedKcal}
        planned={plannedKcal}
        consumed={consumedKcal}
        displayMax={displayMaxKcal}
        hideCalories={hideCalories}
        logs={logs}
        userId={userId}
        onDeleteLog={deleteLog}
        onEditLog={async (id, name, kcal, protein, fat, carb) => {
          const { data: updated } = await supabase.from('food_logs')
            .update({ name, kcal, protein_g: protein, fat_g: fat, carb_g: carb })
            .eq('id', id)
            .select('id, user_id, date, name, kcal, protein_g, fat_g, carb_g, meal_name, meal_index, logged_at')
            .single()
          if (updated) {
            const diff = (updated as FoodLog).kcal - (logs.find(l => l.id === id)?.kcal ?? 0)
            setLogs(prev => prev.map(l => l.id === id ? updated as FoodLog : l))
            setConsumedKcal(prev => prev + diff)
          }
        }}
        onClose={() => setCalorieModalOpen(false)}
      />

      {pickerMeal && (
        <MealPresetPickerModal
          meal={pickerMeal}
          presets={presetsMap[pickerMeal.meal_index] ?? []}
          onSelect={(preset, qty, grams) => logPreset(preset, pickerMeal, qty, grams)}
          onManage={() => { setPickerMeal(null); router.push('/(tabs)/settings') }}
          onClose={() => setPickerMeal(null)}
        />
      )}

      <UnifiedFoodLogger
        visible={showFoodLogger}
        mealIndex={foodLoggerMealIndex}
        meals={meals}
        allPresets={allPresets}
        customFoods={customFoods}
        hideCalories={hideCalories}
        onAdd={async (name, kcal, protein, fat, carb, mealIdx, qty, date) => {
          await addFood(name, kcal, protein, fat, carb, mealIdx, qty ?? 1, date ?? todayStr)
        }}
        onLogPreset={(preset) => logMealBundle(preset, foodLoggerMealIndex)}
        onSaveToMyFoods={(name, kcal, protein, fat, carb, servings, k100, p100, f100, c100) =>
          saveCustomFood(name, kcal, protein, fat, carb, servings, k100, p100, f100, c100)
        }
        onSaveAsPreset={savePresetFromFood}
        onClose={() => { setShowFoodLogger(false); setFoodLoggerMealIndex(null) }}
      />

      {userId && (
        <MealBuilderModal
          visible={editingPreset != null}
          userId={userId}
          customFoods={customFoods}
          mealSlots={meals}
          editPreset={editingPreset ?? undefined}
          initialSlots={editingPreset ? presetSlotMap[editingPreset.id] : undefined}
          onSave={async () => { await refreshPresets(userId) }}
          onClose={() => { setEditingPreset(null) }}
        />
      )}

      {/* ── Cycle setup modal ── */}
      <Modal visible={showCycleModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCycleModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
          <View style={st.cycleModalHeader}>
            <Text style={st.cycleModalTitle}>Cycle tracking</Text>
            <Pressable onPress={() => setShowCycleModal(false)} hitSlop={12}>
              <Ionicons name="close" size={22} color={C.text2} />
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, gap: 24 }}>

            {/* Regular / Irregular toggle */}
            <View>
              <Text style={st.cycleModalLabel}>Cycle type</Text>
              <View style={st.cycleTypeRow}>
                {(['regular', 'irregular'] as const).map(t => (
                  <Pressable
                    key={t}
                    style={[st.cycleTypeBtn, cycleTypeDraft === t && st.cycleTypeBtnActive]}
                    onPress={() => setCycleTypeDraft(t)}
                  >
                    <Text style={[st.cycleTypeBtnText, cycleTypeDraft === t && st.cycleTypeBtnTextActive]}>
                      {t === 'regular' ? 'Regular' : 'Irregular'}
                    </Text>
                    <Text style={[st.cycleTypeBtnSub, cycleTypeDraft === t && { color: '#E91E8C' }]}>
                      {t === 'regular' ? 'Predictable length' : 'Varies each cycle'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* First day of last period — 3-field date input */}
            <View>
              <Text style={st.cycleModalLabel}>First day of last period</Text>
              <View style={st.cycleDateRow}>
                <TextInput
                  style={[st.cycleDateField, { flex: 1 }]}
                  value={dateDd}
                  placeholder="DD"
                  placeholderTextColor={C.text3}
                  keyboardType="number-pad"
                  maxLength={2}
                  returnKeyType="next"
                  onChangeText={v => {
                    const n = v.replace(/\D/g, '').slice(0, 2)
                    setDateDd(n)
                    if (n.length === 2) dateInputMm.current?.focus()
                  }}
                />
                <Text style={st.cycleDateSep}>/</Text>
                <TextInput
                  ref={dateInputMm}
                  style={[st.cycleDateField, { flex: 1 }]}
                  value={dateMm}
                  placeholder="MM"
                  placeholderTextColor={C.text3}
                  keyboardType="number-pad"
                  maxLength={2}
                  returnKeyType="next"
                  onChangeText={v => {
                    const n = v.replace(/\D/g, '').slice(0, 2)
                    setDateMm(n)
                    if (n.length === 2) dateInputYyyy.current?.focus()
                  }}
                />
                <Text style={st.cycleDateSep}>/</Text>
                <TextInput
                  ref={dateInputYyyy}
                  style={[st.cycleDateField, { flex: 2 }]}
                  value={dateYyyy}
                  placeholder="YYYY"
                  placeholderTextColor={C.text3}
                  keyboardType="number-pad"
                  maxLength={4}
                  returnKeyType="done"
                  onChangeText={v => setDateYyyy(v.replace(/\D/g, '').slice(0, 4))}
                />
              </View>
            </View>

            {/* Period duration */}
            <View>
              <Text style={st.cycleModalLabel}>Period duration (days)</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {[3, 4, 5, 6, 7, 8].map(n => (
                  <Pressable
                    key={n}
                    style={[st.cycleLenBtn, periodLengthDraft === String(n) && st.cycleLenBtnActive]}
                    onPress={() => setPeriodLengthDraft(String(n))}
                  >
                    <Text style={[st.cycleLenBtnText, periodLengthDraft === String(n) && st.cycleLenBtnTextActive]}>{n}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Phase lengths — only for irregular cycles */}
            {cycleTypeDraft === 'irregular' && (
              <View>
                <Text style={st.cycleModalLabel}>Typical follicular phase (days)</Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {[5, 6, 7, 8, 9, 10, 12, 14].map(n => (
                    <Pressable
                      key={n}
                      style={[st.cycleLenBtn, follicularLengthDraft === String(n) && st.cycleLenBtnActive]}
                      onPress={() => setFollicularLengthDraft(String(n))}
                    >
                      <Text style={[st.cycleLenBtnText, follicularLengthDraft === String(n) && st.cycleLenBtnTextActive]}>{n}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[st.cycleModalLabel, { marginTop: 16 }]}>Typical luteal phase (days)</Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {[8, 9, 10, 11, 12, 13, 14, 16].map(n => (
                    <Pressable
                      key={n}
                      style={[st.cycleLenBtn, lutealLengthDraft === String(n) && st.cycleLenBtnActive]}
                      onPress={() => setLutealLengthDraft(String(n))}
                    >
                      <Text style={[st.cycleLenBtnText, lutealLengthDraft === String(n) && st.cycleLenBtnTextActive]}>{n}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={st.cycleModalHint}>
                  Ovulation is always estimated at 2 days.{'\n'}
                  Estimated cycle: {(parseInt(periodLengthDraft) || 5) + (parseInt(follicularLengthDraft) || 8) + 2 + (parseInt(lutealLengthDraft) || 12)} days total.
                </Text>
              </View>
            )}

            {/* Cycle length — only for regular cycles */}
            {cycleTypeDraft === 'regular' && (
              <View>
                <Text style={st.cycleModalLabel}>Cycle length (days)</Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {[21, 24, 26, 28, 30, 32, 35].map(n => (
                    <Pressable
                      key={n}
                      style={[st.cycleLenBtn, cycleLengthDraft === String(n) && st.cycleLenBtnActive]}
                      onPress={() => setCycleLengthDraft(String(n))}
                    >
                      <Text style={[st.cycleLenBtnText, cycleLengthDraft === String(n) && st.cycleLenBtnTextActive]}>{n}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  style={[st.cycleModalInput, { marginTop: 8 }]}
                  value={cycleLengthDraft}
                  placeholder="Custom (days)"
                  placeholderTextColor={C.text3}
                  keyboardType="number-pad"
                  onChangeText={v => setCycleLengthDraft(v)}
                />
              </View>
            )}
          </ScrollView>
          <View style={{ padding: 24 }}>
            <Pressable
              style={st.cycleModalSave}
              onPress={async () => {
                // Build ISO date from 3 separate fields
                let isoDate: string | null = null
                const dd = dateDd.padStart(2, '0')
                const mm = dateMm.padStart(2, '0')
                const yyyy = dateYyyy
                if (dd && mm && yyyy.length === 4) {
                  const candidate = `${yyyy}-${mm}-${dd}`
                  const parsed = new Date(candidate)
                  if (!isNaN(parsed.getTime()) && parsed.getFullYear() === parseInt(yyyy)) {
                    isoDate = candidate
                  }
                }
                const len   = parseInt(cycleLengthDraft) || 28
                const pLen  = parseInt(periodLengthDraft) || 5
                const fLen  = parseInt(follicularLengthDraft) || 8
                const lLen  = parseInt(lutealLengthDraft) || 12
                setCycleLength(len)
                setPeriodLength(pLen)
                setFollicularLength(fLen)
                setLutealLength(lLen)
                setCycleType(cycleTypeDraft)
                setLastPeriodStart(isoDate)
                if (userId) {
                  await supabase.from('users').update({
                    cycle_length: len,
                    period_length: pLen,
                    follicular_length: fLen,
                    luteal_length: lLen,
                    cycle_type: cycleTypeDraft,
                    last_period_start: isoDate,
                  }).eq('id', userId)
                }
                setShowCycleModal(false)
              }}
            >
              <Text style={st.cycleModalSaveText}>Save</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

// ─── Skip impact panel ────────────────────────────────────────────────────────

const LEVEL_CONFIG: Record<string, { color: string; label: string; bg: string }> = {
  low:      { color: '#4CAF50', bg: '#4CAF5018', label: 'Low impact' },
  moderate: { color: '#FF9800', bg: '#FF980018', label: 'Moderate impact' },
  high:     { color: '#EF5350', bg: '#EF535018', label: 'High impact' },
}

function SkipImpactPanel({ analysis, coachAdvice, coachLoading, onAskCoach }: {
  analysis: ProgressionAnalysis
  coachAdvice?: string
  coachLoading?: boolean
  onAskCoach?: () => void
}) {
  const cfg = LEVEL_CONFIG[analysis.level]
  const { metric } = analysis
  const unit = metric === 'km' ? 'km' : 'min'
  const fmt = (v: number) => metric === 'km' ? v.toFixed(1) : String(Math.round(v))

  const bodyLines: string[] = []
  if (analysis.lastLoad != null) {
    bodyLines.push(`Last completed: ${fmt(analysis.lastLoad)} ${unit}`)
  }
  if (analysis.skippedLoad > 0) {
    bodyLines.push(`This workout: ${fmt(analysis.skippedLoad)} ${unit}`)
  }
  if (analysis.nextLoad != null && analysis.jumpIfSkipped != null) {
    const sign = analysis.jumpIfSkipped >= 0 ? '+' : ''
    bodyLines.push(`Next planned: ${fmt(analysis.nextLoad)} ${unit}  (${sign}${analysis.jumpIfSkipped}% gap if you skip)`)
  } else if (analysis.nextLoad == null) {
    bodyLines.push('No next workout scheduled yet')
  }

  return (
    <View style={[ip.container, { backgroundColor: cfg.bg, borderColor: cfg.color + '44' }]}>
      <View style={[ip.badge, { backgroundColor: cfg.color, alignSelf: 'flex-start', marginBottom: 6 }]}>
        <Text style={ip.badgeText}>{cfg.label}</Text>
      </View>
      {bodyLines.map((line, i) => (
        <Text key={i} style={ip.line}>{line}</Text>
      ))}
      {onAskCoach && !coachAdvice && !coachLoading && (
        <Pressable onPress={onAskCoach} style={ip.askCoachBtn}>
          <Ionicons name="sparkles-outline" size={12} color={cfg.color} />
          <Text style={[ip.askCoachText, { color: cfg.color }]}>Ask coach</Text>
        </Pressable>
      )}
      {coachLoading && <ActivityIndicator size="small" color={cfg.color} style={{ marginTop: 4 }} />}
      {coachAdvice && <Text style={ip.coachAdvice}>{coachAdvice}</Text>}
    </View>
  )
}

function SkipOptionsPanel({ analysis, onPostpone, onScaleDown, onAccept }: {
  analysis: ProgressionAnalysis
  onPostpone: () => void
  onScaleDown: () => void
  onAccept: () => void
}) {
  const { metric, safeLoad, nextPlanId, level } = analysis
  const unit = metric === 'km' ? 'km' : 'min'
  const fmt = (v: number) => metric === 'km' ? v.toFixed(1) : String(Math.round(v))

  const showOptions = level === 'moderate' || level === 'high'

  if (!showOptions) {
    return (
      <Pressable style={ip.acceptBtn} onPress={onAccept}>
        <Text style={ip.acceptBtnText}>Confirm skip</Text>
      </Pressable>
    )
  }

  const tomorrow = new Date(Date.now() + 86400000)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <View style={ip.optionsContainer}>
      <Text style={ip.optionsLabel}>How do you want to handle this?</Text>

      <Pressable style={ip.optionRow} onPress={onPostpone}>
        <View style={[ip.optionIcon, { backgroundColor: '#4CAF5018' }]}>
          <Ionicons name="calendar-outline" size={16} color="#4CAF50" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={ip.optionTitle}>Reschedule to tomorrow</Text>
          <Text style={ip.optionDesc}>Adds this workout to {tomorrow}</Text>
        </View>
        <Ionicons name="chevron-forward" size={14} color="#aaa" />
      </Pressable>

      {nextPlanId != null && safeLoad != null && (
        <Pressable style={ip.optionRow} onPress={onScaleDown}>
          <View style={[ip.optionIcon, { backgroundColor: '#FF980018' }]}>
            <Ionicons name="trending-down-outline" size={16} color="#FF9800" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={ip.optionTitle}>Scale down next workout</Text>
            <Text style={ip.optionDesc}>Reduce to {fmt(safeLoad)} {unit} — safe +10% step</Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color="#aaa" />
        </Pressable>
      )}

      <Pressable style={[ip.optionRow, { borderBottomWidth: 0 }]} onPress={onAccept}>
        <View style={[ip.optionIcon, { backgroundColor: '#EF535018' }]}>
          <Ionicons name="close-outline" size={16} color="#EF5350" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[ip.optionTitle, { color: '#EF5350' }]}>Skip anyway</Text>
          {analysis.jumpIfSkipped != null
            ? <Text style={ip.optionDesc}>Accept the +{analysis.jumpIfSkipped}% gap to next workout</Text>
            : <Text style={ip.optionDesc}>Mark as skipped without changes</Text>
          }
        </View>
        <Ionicons name="chevron-forward" size={14} color="#aaa" />
      </Pressable>
    </View>
  )
}

const ip = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 },
  badge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 },
  line: { fontSize: 12, color: '#666', marginBottom: 2 },
  acceptBtn: { paddingVertical: 8, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ddd', marginTop: 4 },
  acceptBtnText: { fontSize: 13, color: '#999' },
  optionsContainer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ddd', marginTop: 4, paddingTop: 8 },
  optionsLabel: { fontSize: 11, fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
  optionIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 1 },
  optionDesc: { fontSize: 11, color: '#999' },
  askCoachBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  askCoachText: { fontSize: 12, fontWeight: '600' },
  coachAdvice: { fontSize: 12, color: '#555', fontStyle: 'italic', marginTop: 6, lineHeight: 17 },
})

// ─── Quick add category (collapsible) ─────────────────────────────────────────

function QuickAddCategory({ cat, hideCalories, onSelect }: {
  cat: { category: string; items: CommonFood[] }
  hideCalories: boolean
  onSelect: (food: CommonFood) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <View style={st.catSection}>
      <Pressable style={st.catHeader} onPress={() => setOpen(v => !v)}>
        <Text style={st.catLabel}>{cat.category}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={C.text3} />
      </Pressable>
      {open && cat.items.map((food, i) => (
        <Pressable key={food.name + i} style={[st.foodRow, i < cat.items.length - 1 && st.foodRowBorder]}
          onPress={() => onSelect(food)}>
          <Text style={st.foodName}>{food.name}</Text>
          {!hideCalories && <Text style={st.foodKcal}>{food.kcal} kcal</Text>}
        </Pressable>
      ))}
    </View>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseGrams(label: string): number | null {
  const m = label.trim().match(/^(\d+(?:\.\d+)?)\s*(g|ml|kg|l)?$/i)
  return m ? parseFloat(m[1]) : null
}

// Returns a fraction prefix like "¼ ", "1½ ", or "" for whole numbers.
// Whole integers ≥ 2 return "" (stacking handles those).
function fmtFraction(qty: number): string {
  const FRACS: [number, string][] = [
    [1/4, '¼'], [1/3, '⅓'], [1/2, '½'], [2/3, '⅔'], [3/4, '¾'],
  ]
  const EPS = 0.025
  const whole = Math.floor(qty)
  const frac = qty - whole
  if (Math.abs(frac) < EPS) return ''
  const match = FRACS.find(([v]) => Math.abs(frac - v) < EPS)
  const fracStr = match ? match[1] : qty.toFixed(2)
  return whole === 0 ? `${fracStr} ` : `${whole}${fracStr} `
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => Array(n + 1).fill(0).map((_, j) => i === 0 ? j : j === 0 ? i : 0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}

function fuzzyFoodMatch(name: string, query: string): boolean {
  const n = name.toLowerCase()
  const q = query.trim().toLowerCase()
  if (!q) return false
  if (n.includes(q)) return true
  // Multi-word: every token must appear somewhere in the name
  const tokens = q.split(/\s+/).filter(Boolean)
  if (tokens.length > 1) return tokens.every(t => n.includes(t))
  // Single word: check edit distance against each word in the food name
  const nameWords = n.split(/[\s,\/()]+/).filter(Boolean)
  const threshold = Math.floor(Math.max(q.length, 3) * 0.35)
  return nameWords.some(w => levenshtein(w, q) <= threshold)
}

function defaultServingLabel(food: { name: string; amount_label?: string | null }): string {
  if (food.amount_label) return food.amount_label
  const n = food.name
  // Find a gram/ml measure anywhere inside "(…)": "(100g)", "(50g uncooked)", "(banana & oat, 300ml)"
  const gramMatch = n.match(/\([^)]*?(\d+(?:\.\d+)?\s*(?:ml|l|g|kg))[^)]*\)/i)
  if (gramMatch) return gramMatch[1].trim()
  // "(half)" → unicode fraction
  if (/\(half\)/i.test(n)) return '½'
  // "(medium)" / "(medium, boiled)" / "(large)" etc.
  const sizeMatch = n.match(/\((small|medium|large|xl|extra large)[^)]*\)/i)
  if (sizeMatch) return `1 ${sizeMatch[1].toLowerCase()}`
  // "(1 piece)" / "(1 clove)" / "(2 rashers)" / "(1 tbsp)" — starts with digit
  const countMatch = n.match(/\((\d+[^)]+)\)/i)
  if (countMatch) return countMatch[1].trim()
  return '100g'
}

// ─── Unified food logger ───────────────────────────────────────────────────────

function UnifiedFoodLogger({ visible, mealIndex, meals, allPresets, customFoods, hideCalories, onAdd, onLogPreset, onSaveToMyFoods, onSaveAsPreset, onClose }: {
  visible: boolean
  mealIndex: number | null
  meals: MealItem[]
  allPresets: MealPreset[]
  customFoods: CustomFood[]
  hideCalories: boolean
  onAdd: (name: string, kcal: number, protein: number | null, fat: number | null, carb: number | null, mealIdx: number | null, qty?: number, date?: string) => Promise<void>
  onLogPreset: (preset: MealPreset) => Promise<void>
  onSaveToMyFoods: (name: string, kcal: number, protein: number | null, fat: number | null, carb: number | null, servingOptions?: ServingOption[], kcal_per_100g?: number | null, protein_per_100g?: number | null, fat_per_100g?: number | null, carb_per_100g?: number | null) => Promise<void>
  onSaveAsPreset: (name: string, kcal: number, protein: number | null, fat: number | null, carb: number | null) => Promise<void>
  onClose: () => void
}) {
  const todayDateStr = new Date().toISOString().split('T')[0]
  const [logDate, setLogDate] = useState(todayDateStr)
  const [tab, setTab] = useState<'search' | 'scan' | 'manual'>('search')
  const [search, setSearch] = useState('')
  const [pendingFood, setPendingFood] = useState<(CommonFood & { amount_label?: string | null }) | null>(null)
  const [servingLabel, setServingLabel] = useState('')
  const [servingQty, setServingQty] = useState('1')
  const [pendingGrams, setPendingGrams] = useState('')
  const [scannedProduct, setScannedProduct] = useState<{
    name: string; kcalPer100g: number
    proteinPer100g: number | null; fatPer100g: number | null; carbPer100g: number | null
  } | null>(null)
  const [scanAmount, setScanAmount] = useState('100')
  const [scanServings, setScanServings] = useState('1')
  const [scanName, setScanName] = useState('')
  const [scanLoading, setScanLoading] = useState(false)
  const lastScannedRef = useRef<string | null>(null)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [manualName, setManualName] = useState('')
  const [manualKcal, setManualKcal] = useState('')
  const [manualProtein, setManualProtein] = useState('')
  const [manualFat, setManualFat] = useState('')
  const [manualCarb, setManualCarb] = useState('')
  const [manualMode, setManualMode] = useState<'total' | 'gram' | 'unit'>('total')
  const [manualGrams, setManualGrams] = useState('')
  const [manualUnitCount, setManualUnitCount] = useState('1')
  const [adding, setAdding] = useState(false)
  const [saveToMyFoods, setSaveToMyFoods] = useState(false)
  const [saveAsPreset, setSaveAsPreset] = useState(false)
  const [recentFoods, setRecentFoods] = useState<Array<{ name: string; kcal: number; protein_g: number | null; fat_g: number | null; carb_g: number | null }>>([])
  const [pendingQtyMode, setPendingQtyMode] = useState<'fraction' | 'gram'>('fraction')
  const [portionsOpen, setPortionsOpen] = useState(false)
  const [saveMyFoodsMode, setSaveMyFoodsMode] = useState<'gram' | 'unit'>('unit')
  const [saveMyFoodsKcal100g, setSaveMyFoodsKcal100g] = useState('')
  // Serving options for manual tab
  const [manualServings, setManualServings] = useState<ServingOption[]>([])
  const [newServingLabel, setNewServingLabel] = useState('')
  const [newServingKcal, setNewServingKcal] = useState('')
  const [newServingProtein, setNewServingProtein] = useState('')
  const [newServingFat, setNewServingFat] = useState('')
  const [newServingCarb, setNewServingCarb] = useState('')
  // Selected serving option for custom food pending view
  const [selectedServingOption, setSelectedServingOption] = useState<ServingOption | null>(null)
  const insets = useSafeAreaInsets()

  function shiftLogDate(delta: number) {
    const d = new Date(logDate + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    const next = d.toISOString().split('T')[0]
    if (next <= todayDateStr) setLogDate(next)
  }
  const logDateLabel = logDate === todayDateStr
    ? 'Today'
    : new Date(logDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

  useEffect(() => {
    if (!visible) {
      setLogDate(todayDateStr)
      setTab('search'); setSearch(''); setPendingFood(null)
      setScannedProduct(null); setScanName(''); lastScannedRef.current = null
      setManualName(''); setManualKcal(''); setManualGrams(''); setManualUnitCount('1')
      setManualProtein(''); setManualFat(''); setManualCarb('')
      setManualMode('total')
      setSaveToMyFoods(false); setSaveAsPreset(false)
      setSaveMyFoodsMode('unit'); setSaveMyFoodsKcal100g('')
      setPendingQtyMode('fraction'); setPortionsOpen(false)
      setManualServings([]); setNewServingLabel(''); setNewServingKcal('')
      setNewServingProtein(''); setNewServingFat(''); setNewServingCarb('')
      setSelectedServingOption(null)
      setPendingGrams('')
    }
  }, [visible])

  useEffect(() => {
    if (!visible) return
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const since = new Date(); since.setDate(since.getDate() - 7)
      const { data } = await supabase
        .from('food_logs')
        .select('name, kcal, protein_g, fat_g, carb_g')
        .eq('user_id', user.id)
        .gte('date', since.toISOString().split('T')[0])
        .order('logged_at', { ascending: false })
        .limit(100)
      if (!data) return
      const seen = new Set<string>()
      const unique = data.filter(r => { if (seen.has(r.name)) return false; seen.add(r.name); return true })
      setRecentFoods(unique.slice(0, 10))
    })
  }, [visible])

  const searchResults = useMemo(() => {
    const q = search.trim()
    if (!q) return []
    const recentHits = recentFoods.filter(f => fuzzyFoodMatch(f.name, q))
    const customHits = customFoods.filter(f => fuzzyFoodMatch(f.name, q))
    const commonHits = COMMON_FOOD_CATEGORIES.flatMap(c => c.items).filter(f => fuzzyFoodMatch(f.name, q))
    const seen = new Set<string>()
    const all = [...recentHits, ...customHits, ...commonHits].filter(f => {
      const key = f.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return all.slice(0, 20) as (CommonFood & { amount_label?: string | null })[]
  }, [search, customFoods, recentFoods])

  const presetSearchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return allPresets.filter(p => p.name.toLowerCase().includes(q))
  }, [search, allPresets])

  function selectFood(food: CommonFood & { amount_label?: string | null }) {
    setPendingFood(food)
    setServingLabel(defaultServingLabel(food))
    setServingQty('1')
    setSelectedServingOption(null)
    setPendingGrams('')
    setPendingQtyMode('fraction')
    setSearch('')
  }

  async function confirmPending() {
    if (!pendingFood) return
    const isCustomFood = !!(pendingFood as any).id
    const cf = pendingFood as CustomFood

    // Per-100g path for custom foods that have kcal_per_100g set
    if (isCustomFood && cf.kcal_per_100g != null) {
      const grams = parseFloat(pendingGrams)
      if (isNaN(grams) || grams <= 0) return
      const kcal = Math.round(cf.kcal_per_100g * grams / 100)
      const protein = cf.protein_per_100g != null ? Math.round(cf.protein_per_100g * grams / 100 * 10) / 10 : null
      const fat = cf.fat_per_100g != null ? Math.round(cf.fat_per_100g * grams / 100 * 10) / 10 : null
      const carb = cf.carb_per_100g != null ? Math.round(cf.carb_per_100g * grams / 100 * 10) / 10 : null
      const gLabel = grams % 1 === 0 ? String(grams) : grams.toFixed(1)
      setAdding(true)
      await onAdd(`${gLabel}g ${pendingFood.name}`, kcal, protein, fat, carb, mealIndex, 1, logDate)
      setAdding(false)
      setPendingFood(null)
      setPendingGrams('')
      onClose()
      return
    }

    // Gram path for non-custom foods when user switched to gram mode
    if (!isCustomFood && pendingQtyMode === 'gram') {
      const grams = parseFloat(pendingGrams)
      if (isNaN(grams) || grams <= 0) return
      const baseG = parseGrams(defaultServingLabel(pendingFood))
      const scale = baseG ? grams / baseG : 1
      const kcal = Math.round(pendingFood.kcal * scale)
      const protein = pendingFood.protein_g != null ? Math.round(pendingFood.protein_g * scale * 10) / 10 : null
      const fat = pendingFood.fat_g != null ? Math.round(pendingFood.fat_g * scale * 10) / 10 : null
      const carb = pendingFood.carb_g != null ? Math.round(pendingFood.carb_g * scale * 10) / 10 : null
      const gLabel = grams % 1 === 0 ? String(grams) : grams.toFixed(1)
      setAdding(true)
      await onAdd(`${gLabel}g ${pendingFood.name}`, kcal, protein, fat, carb, mealIndex, 1, logDate)
      if (saveToMyFoods) {
        const k100 = baseG ? Math.round(pendingFood.kcal / baseG * 100) : null
        const p100 = k100 && pendingFood.protein_g != null && pendingFood.kcal > 0 ? Math.round(pendingFood.protein_g / pendingFood.kcal * k100 * 100) / 100 : null
        const f100 = k100 && pendingFood.fat_g != null && pendingFood.kcal > 0 ? Math.round(pendingFood.fat_g / pendingFood.kcal * k100 * 100) / 100 : null
        const c100 = k100 && pendingFood.carb_g != null && pendingFood.kcal > 0 ? Math.round(pendingFood.carb_g / pendingFood.kcal * k100 * 100) / 100 : null
        await onSaveToMyFoods(pendingFood.name, kcal, protein, fat, carb, [], k100, p100, f100, c100)
      }
      setAdding(false)
      setSaveToMyFoods(false); setPendingQtyMode('fraction')
      setPendingFood(null); setPendingGrams('')
      onClose()
      return
    }

    const qty = parseFloat(servingQty) || 0
    if (qty <= 0) return
    let kcal: number
    let protein: number | null
    let fat: number | null
    let carb: number | null
    if (isCustomFood && selectedServingOption) {
      kcal = Math.round(selectedServingOption.kcal * qty)
      protein = selectedServingOption.protein_g != null ? Math.round(selectedServingOption.protein_g * qty * 10) / 10 : null
      fat = selectedServingOption.fat_g != null ? Math.round(selectedServingOption.fat_g * qty * 10) / 10 : null
      carb = selectedServingOption.carb_g != null ? Math.round(selectedServingOption.carb_g * qty * 10) / 10 : null
    } else {
      const origGrams = parseGrams(defaultServingLabel(pendingFood))
      const curGrams = parseGrams(servingLabel)
      const scale = isCustomFood ? 1 : (origGrams && curGrams ? curGrams / origGrams : 1)
      kcal = Math.round(pendingFood.kcal * qty * scale)
      protein = pendingFood.protein_g != null ? Math.round(pendingFood.protein_g * qty * scale * 10) / 10 : null
      fat = pendingFood.fat_g != null ? Math.round(pendingFood.fat_g * qty * scale * 10) / 10 : null
      carb = pendingFood.carb_g != null ? Math.round(pendingFood.carb_g * qty * scale * 10) / 10 : null
    }
    setAdding(true)
    const fracPrefix = fmtFraction(qty)
    const entryName = fracPrefix ? `${fracPrefix}${pendingFood.name}` : pendingFood.name
    const entryQty = fracPrefix ? 1 : qty
    await onAdd(entryName, kcal, protein, fat, carb, mealIndex, entryQty, logDate)
    if (!isCustomFood && saveToMyFoods) {
      const k100 = saveMyFoodsMode === 'gram' ? (parseFloat(saveMyFoodsKcal100g) || null) : null
      const p100 = saveMyFoodsMode === 'gram' && pendingFood.protein_g != null && pendingFood.kcal > 0
        ? Math.round(pendingFood.protein_g / pendingFood.kcal * (k100 ?? pendingFood.kcal) * 100) / 100
        : null
      const f100 = saveMyFoodsMode === 'gram' && pendingFood.fat_g != null && pendingFood.kcal > 0
        ? Math.round(pendingFood.fat_g / pendingFood.kcal * (k100 ?? pendingFood.kcal) * 100) / 100
        : null
      const c100 = saveMyFoodsMode === 'gram' && pendingFood.carb_g != null && pendingFood.kcal > 0
        ? Math.round(pendingFood.carb_g / pendingFood.kcal * (k100 ?? pendingFood.kcal) * 100) / 100
        : null
      await onSaveToMyFoods(pendingFood.name, kcal, protein, fat, carb, [], k100, p100, f100, c100)
    }
    setAdding(false)
    setSaveToMyFoods(false)
    setSaveMyFoodsMode('unit')
    setSaveMyFoodsKcal100g('')
    setPendingFood(null)
    setSelectedServingOption(null)
    onClose()
  }

  async function handleBarcodeScan({ data }: { data: string }) {
    if (lastScannedRef.current === data || scanLoading) return
    lastScannedRef.current = data

    const cached = _barcodeCache.get(data)
    if (cached) {
      setScannedProduct(cached)
      setScanName(cached.name)
      setScanAmount('100'); setScanServings('1')
      return
    }

    setScanLoading(true)
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${data}.json`)
      const json = await res.json()
      if (json.status === 1 && json.product) {
        const p = json.product
        const name = p.product_name || p.abbreviated_product_name || 'Unknown product'
        const n = p.nutriments ?? {}
        const product = {
          name,
          kcalPer100g: Math.round(n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0),
          proteinPer100g: n['proteins_100g'] ?? null,
          fatPer100g: n['fat_100g'] ?? null,
          carbPer100g: n['carbohydrates_100g'] ?? null,
        }
        _barcodeCache.set(data, product)
        setScannedProduct(product)
        setScanName(name)
        setScanAmount('100'); setScanServings('1')
      } else {
        Alert.alert('Not found', 'Product not found in the database.')
        lastScannedRef.current = null
      }
    } catch {
      Alert.alert('Error', 'Could not look up barcode.')
      lastScannedRef.current = null
    }
    setScanLoading(false)
  }

  async function confirmScan() {
    if (!scannedProduct) return
    const g = parseFloat(scanAmount) || 0
    const servings = parseFloat(scanServings) || 1
    if (g <= 0) return
    const r = (g * servings) / 100
    const name = scanName.trim() || scannedProduct.name
    const kcal = Math.round(scannedProduct.kcalPer100g * r)
    const protein = scannedProduct.proteinPer100g != null ? Math.round(scannedProduct.proteinPer100g * r * 10) / 10 : null
    const fat = scannedProduct.fatPer100g != null ? Math.round(scannedProduct.fatPer100g * r * 10) / 10 : null
    const carb = scannedProduct.carbPer100g != null ? Math.round(scannedProduct.carbPer100g * r * 10) / 10 : null
    setAdding(true)
    await onAdd(name, kcal, protein, fat, carb, mealIndex, servings, logDate)
    if (saveToMyFoods) await onSaveToMyFoods(
      name, kcal, protein, fat, carb, [],
      scannedProduct.kcalPer100g,
      scannedProduct.proteinPer100g,
      scannedProduct.fatPer100g,
      scannedProduct.carbPer100g,
    )
    setAdding(false)
    setSaveToMyFoods(false)
    setScannedProduct(null); setScanName(''); lastScannedRef.current = null
    onClose()
  }

  async function submitManual() {
    if (!manualName.trim()) { Alert.alert('Invalid', 'Enter a name.'); return }

    let finalName: string
    let finalKcal: number
    let finalProtein: number | null
    let finalFat: number | null
    let finalCarb: number | null
    let k100: number | null = null
    let p100: number | null = null
    let f100: number | null = null
    let c100: number | null = null

    if (manualMode === 'gram') {
      const kcalPer100 = parseInt(manualKcal)
      const grams = parseFloat(manualGrams.replace(',', '.'))
      if (isNaN(kcalPer100) || kcalPer100 <= 0 || isNaN(grams) || grams <= 0) {
        Alert.alert('Invalid', 'Enter kcal per 100g and amount in grams.'); return
      }
      finalName = `${grams % 1 === 0 ? String(grams) : grams.toFixed(1)}g ${manualName.trim()}`
      finalKcal = Math.round(kcalPer100 * grams / 100)
      const p = manualProtein ? parseFloat(manualProtein.replace(',', '.')) : null
      const f = manualFat ? parseFloat(manualFat.replace(',', '.')) : null
      const c = manualCarb ? parseFloat(manualCarb.replace(',', '.')) : null
      finalProtein = p != null ? Math.round(p * grams / 100 * 10) / 10 : null
      finalFat     = f != null ? Math.round(f * grams / 100 * 10) / 10 : null
      finalCarb    = c != null ? Math.round(c * grams / 100 * 10) / 10 : null
      k100 = kcalPer100; p100 = p; f100 = f; c100 = c
    } else if (manualMode === 'unit') {
      const kcalPerUnit = parseInt(manualKcal)
      const count = parseFloat(manualUnitCount.replace(',', '.'))
      if (isNaN(kcalPerUnit) || kcalPerUnit <= 0 || isNaN(count) || count <= 0) {
        Alert.alert('Invalid', 'Enter kcal per unit and number of units.'); return
      }
      finalName = count === 1 ? manualName.trim() : `${count % 1 === 0 ? String(count) : count.toFixed(1)}× ${manualName.trim()}`
      finalKcal = Math.round(kcalPerUnit * count)
      const p = manualProtein ? parseFloat(manualProtein.replace(',', '.')) : null
      const f = manualFat ? parseFloat(manualFat.replace(',', '.')) : null
      const c = manualCarb ? parseFloat(manualCarb.replace(',', '.')) : null
      finalProtein = p != null ? Math.round(p * count * 10) / 10 : null
      finalFat     = f != null ? Math.round(f * count * 10) / 10 : null
      finalCarb    = c != null ? Math.round(c * count * 10) / 10 : null
    } else {
      const k = parseInt(manualKcal)
      if (isNaN(k) || k <= 0) { Alert.alert('Invalid', 'Enter a name and calories.'); return }
      finalName = manualName.trim()
      finalKcal = k
      finalProtein = manualProtein ? parseFloat(manualProtein.replace(',', '.')) : null
      finalFat     = manualFat     ? parseFloat(manualFat.replace(',', '.'))     : null
      finalCarb    = manualCarb    ? parseFloat(manualCarb.replace(',', '.'))    : null
    }

    setAdding(true)
    await onAdd(finalName, finalKcal, finalProtein, finalFat, finalCarb, mealIndex, undefined, logDate)
    // For My Foods: gram mode saves kcal_per_100g; unit mode saves kcal per unit (no per-100g)
    const myFoodsKcal = manualMode === 'gram' ? parseInt(manualKcal) : manualMode === 'unit' ? parseInt(manualKcal) : finalKcal
    const myFoodsProtein = manualMode === 'gram' ? (manualProtein ? parseFloat(manualProtein) : null) : manualMode === 'unit' ? (manualProtein ? parseFloat(manualProtein) : null) : finalProtein
    const myFoodsFat     = manualMode === 'gram' ? (manualFat     ? parseFloat(manualFat)     : null) : manualMode === 'unit' ? (manualFat     ? parseFloat(manualFat)     : null) : finalFat
    const myFoodsCarb    = manualMode === 'gram' ? (manualCarb    ? parseFloat(manualCarb)    : null) : manualMode === 'unit' ? (manualCarb    ? parseFloat(manualCarb)    : null) : finalCarb
    await Promise.all([
      saveToMyFoods ? onSaveToMyFoods(manualName.trim(), myFoodsKcal, myFoodsProtein, myFoodsFat, myFoodsCarb, manualServings, k100, p100, f100, c100) : Promise.resolve(),
      saveAsPreset  ? onSaveAsPreset(finalName, finalKcal, finalProtein, finalFat, finalCarb) : Promise.resolve(),
    ])
    setAdding(false)
    setManualName(''); setManualKcal(''); setManualGrams(''); setManualUnitCount('1')
    setManualProtein(''); setManualFat(''); setManualCarb('')
    setManualMode('total')
    setSaveToMyFoods(false); setSaveAsPreset(false)
    setManualServings([]); setNewServingLabel(''); setNewServingKcal('')
    setNewServingProtein(''); setNewServingFat(''); setNewServingCarb('')
    onClose()
  }

  const isScanningActive = tab === 'scan' && !scannedProduct
  const mealName = mealIndex != null ? meals.find(m => m.meal_index === mealIndex)?.name ?? 'meal' : null

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={() => {
        if (tab === 'scan' && scannedProduct) { setScannedProduct(null); lastScannedRef.current = null }
        else if (tab === 'scan') setTab('search')
        else onClose()
      }}
    >
      {isScanningActive ? (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {!cameraPermission?.granted ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 32 }}>
              <Ionicons name="camera-outline" size={48} color={C.text3} />
              <Text style={{ fontSize: 14, color: C.text2, textAlign: 'center' }}>Camera access is needed to scan barcodes</Text>
              <Pressable style={[st.addFormBtn, { paddingHorizontal: 24 }]} onPress={requestCameraPermission}>
                <Text style={st.addFormBtnText}>Allow camera</Text>
              </Pressable>
              <Pressable onPress={() => setTab('search')} style={{ marginTop: 8 }}>
                <Text style={{ color: C.text3, fontSize: 14 }}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                onBarcodeScanned={scanLoading ? undefined : handleBarcodeScan}
                barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
              />
              <View style={{ flex: 1 }}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} />
                <View style={{ flexDirection: 'row', height: 180 }}>
                  <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} />
                  <View style={{ width: 260 }}>
                    <View style={{ position: 'absolute', top: 0, left: 0, width: 28, height: 28, borderTopWidth: 3, borderLeftWidth: 3, borderColor: '#fff' }} />
                    <View style={{ position: 'absolute', top: 0, right: 0, width: 28, height: 28, borderTopWidth: 3, borderRightWidth: 3, borderColor: '#fff' }} />
                    <View style={{ position: 'absolute', bottom: 0, left: 0, width: 28, height: 28, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: '#fff' }} />
                    <View style={{ position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderBottomWidth: 3, borderRightWidth: 3, borderColor: '#fff' }} />
                  </View>
                  <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} />
                </View>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} />
              </View>
              <View style={{ position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 14, marginBottom: 20 }}>Point at a barcode</Text>
                <Pressable onPress={() => setTab('search')} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10 }}>
                  <Text style={{ color: '#fff', fontSize: 14 }}>Cancel</Text>
                </Pressable>
              </View>
              {scanLoading && (
                <View style={{ ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}>
                  <ActivityIndicator size="large" color="#fff" />
                  <Text style={{ color: '#fff', marginTop: 12, fontSize: 14 }}>Looking up product…</Text>
                </View>
              )}
            </View>
          )}
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: C.surface }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={{ flex: 1, paddingTop: insets.top }}>
            <View style={[loggerSt.header, { paddingHorizontal: 20, paddingVertical: 16 }]}>
              <Text style={loggerSt.title}>{mealName ? `Add to ${mealName}` : 'Log food'}</Text>
              <Pressable onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={22} color={C.text3} />
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <Pressable onPress={() => shiftLogDate(-1)} hitSlop={12}>
                <Ionicons name="chevron-back" size={18} color={C.text2} />
              </Pressable>
              <Text style={{ fontSize: 14, fontWeight: '600', color: logDate === todayDateStr ? C.text1 : C.accent }}>{logDateLabel}</Text>
              <Pressable onPress={() => shiftLogDate(1)} hitSlop={12} disabled={logDate === todayDateStr}>
                <Ionicons name="chevron-forward" size={18} color={logDate === todayDateStr ? C.text3 : C.text2} />
              </Pressable>
            </View>

            <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
              <View style={loggerSt.tabBar}>
                {(['search', 'scan', 'manual'] as const).map(t => (
                  <Pressable key={t} style={[loggerSt.tab, tab === t && loggerSt.tabActive]} onPress={() => setTab(t)}>
                    <Ionicons
                      name={t === 'search' ? 'search-outline' : t === 'scan' ? 'barcode-outline' : 'pencil-outline'}
                      size={14}
                      color={tab === t ? '#fff' : C.text3}
                    />
                    <Text style={[loggerSt.tabText, tab === t && loggerSt.tabTextActive]}>
                      {t === 'search' ? 'Search' : t === 'scan' ? 'Scan' : 'Manual'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={{ flex: 1, paddingHorizontal: 20 }}>
              {tab === 'search' && (
                <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                  {pendingFood ? (() => {
                    const isCustomFood = !!(pendingFood as any).id
                    const qty = parseFloat(servingQty) || 0
                    const pFood = pendingFood as any
                    const cf = pendingFood as CustomFood
                    const isPer100g = isCustomFood && cf.kcal_per_100g != null
                    const servingOpts: ServingOption[] = isCustomFood ? (pFood.serving_options ?? []) : []
                    const origG = parseGrams(defaultServingLabel(pendingFood))
                    const curG = parseGrams(servingLabel)
                    const scale = isCustomFood ? 1 : (origG && curG ? curG / origG : 1)
                    // For non-custom gram mode: derive kcal/100g from amount_label
                    const nonCustomBaseG = !isCustomFood ? origG : null
                    let previewKcal: number | null = null
                    let previewProtein: number | null = null
                    let previewFat: number | null = null
                    let previewCarb: number | null = null
                    if (isPer100g && pendingGrams && parseFloat(pendingGrams) > 0) {
                      const g = parseFloat(pendingGrams)
                      previewKcal = Math.round(cf.kcal_per_100g! * g / 100)
                      previewProtein = cf.protein_per_100g != null ? Math.round(cf.protein_per_100g * g / 100 * 10) / 10 : null
                      previewFat = cf.fat_per_100g != null ? Math.round(cf.fat_per_100g * g / 100 * 10) / 10 : null
                      previewCarb = cf.carb_per_100g != null ? Math.round(cf.carb_per_100g * g / 100 * 10) / 10 : null
                    } else if (!isCustomFood && pendingQtyMode === 'gram' && pendingGrams && parseFloat(pendingGrams) > 0) {
                      const g = parseFloat(pendingGrams)
                      const sc = nonCustomBaseG ? g / nonCustomBaseG : 1
                      previewKcal = Math.round(pendingFood.kcal * sc)
                      previewProtein = pFood.protein_g != null ? Math.round(pFood.protein_g * sc * 10) / 10 : null
                      previewFat = pFood.fat_g != null ? Math.round(pFood.fat_g * sc * 10) / 10 : null
                      previewCarb = pFood.carb_g != null ? Math.round(pFood.carb_g * sc * 10) / 10 : null
                    } else if (isCustomFood && selectedServingOption && qty > 0) {
                      previewKcal = Math.round(selectedServingOption.kcal * qty)
                      previewProtein = selectedServingOption.protein_g != null ? Math.round(selectedServingOption.protein_g * qty * 10) / 10 : null
                      previewFat = selectedServingOption.fat_g != null ? Math.round(selectedServingOption.fat_g * qty * 10) / 10 : null
                      previewCarb = selectedServingOption.carb_g != null ? Math.round(selectedServingOption.carb_g * qty * 10) / 10 : null
                    } else if (qty > 0) {
                      previewKcal = Math.round(pendingFood.kcal * qty * scale)
                      previewProtein = pFood.protein_g != null ? Math.round(pFood.protein_g * qty * scale * 10) / 10 : null
                      previewFat = pFood.fat_g != null ? Math.round(pFood.fat_g * qty * scale * 10) / 10 : null
                      previewCarb = pFood.carb_g != null ? Math.round(pFood.carb_g * qty * scale * 10) / 10 : null
                    }
                    const canAdd = isPer100g
                      ? (parseFloat(pendingGrams) > 0)
                      : !isCustomFood && pendingQtyMode === 'gram'
                        ? parseFloat(pendingGrams) > 0
                        : qty > 0
                    return (
                      <View style={{ gap: 10 }}>
                        <Text style={loggerSt.sectionLabel}>{pendingFood.name}</Text>
                        {isCustomFood && !hideCalories && !isPer100g && (
                          <Text style={{ fontSize: 12, color: C.text3 }}>
                            per serving: {pendingFood.kcal} kcal
                            {pFood.protein_g != null ? ` · P ${pFood.protein_g}g` : ''}
                            {pFood.fat_g != null ? ` · F ${pFood.fat_g}g` : ''}
                            {pFood.carb_g != null ? ` · C ${pFood.carb_g}g` : ''}
                          </Text>
                        )}
                        {isCustomFood && !hideCalories && isPer100g && (
                          <Text style={{ fontSize: 12, color: C.text3 }}>
                            per 100g: {cf.kcal_per_100g} kcal
                            {cf.protein_per_100g != null ? ` · P ${cf.protein_per_100g}g` : ''}
                            {cf.fat_per_100g != null ? ` · F ${cf.fat_per_100g}g` : ''}
                            {cf.carb_per_100g != null ? ` · C ${cf.carb_per_100g}g` : ''}
                          </Text>
                        )}
                        {isPer100g ? (
                          <>
                            <TextInput
                              style={st.addFormInput}
                              value={pendingGrams}
                              onChangeText={setPendingGrams}
                              placeholder="Amount (g)"
                              keyboardType="decimal-pad"
                              placeholderTextColor={C.text3}
                              autoFocus
                            />
                            {pendingGrams && parseFloat(pendingGrams) > 0 && !hideCalories && previewKcal != null && (
                              <Text style={lw.derivedDuration}>≈ {previewKcal} kcal</Text>
                            )}
                          </>
                        ) : (
                          <>
                            {isCustomFood && servingOpts.length > 0 && (
                              <View style={{ gap: 6 }}>
                                <Text style={[loggerSt.sectionLabel, { marginBottom: 0 }]}>Serving size</Text>
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                                  {servingOpts.map((opt, i) => (
                                    <Pressable
                                      key={opt.label + i}
                                      style={[loggerSt.servingChip, selectedServingOption?.label === opt.label && loggerSt.servingChipActive]}
                                      onPress={() => setSelectedServingOption(selectedServingOption?.label === opt.label ? null : opt)}
                                    >
                                      <Text style={[loggerSt.servingChipText, selectedServingOption?.label === opt.label && { color: '#fff' }]}>{opt.label}</Text>
                                    </Pressable>
                                  ))}
                                  <Pressable
                                    style={[loggerSt.servingChip, !selectedServingOption && { backgroundColor: C.surface2, borderColor: C.border }]}
                                    onPress={() => setSelectedServingOption(null)}
                                  >
                                    <Text style={[loggerSt.servingChipText, !selectedServingOption && { color: C.text2 }]}>Custom</Text>
                                  </Pressable>
                                </View>
                                {!selectedServingOption && (
                                  <Text style={{ fontSize: 11, color: C.text3, fontStyle: 'italic' }}>using base serving</Text>
                                )}
                              </View>
                            )}
                            {!isCustomFood ? (
                              <View style={{ gap: 10 }}>
                                {/* Mode toggle: Fractions | Grams */}
                                <View style={{ flexDirection: 'row', gap: 8 }}>
                                  {(['fraction', 'gram'] as const).map(m => (
                                    <Pressable key={m}
                                      style={[st.addFormModeBtn, pendingQtyMode === m && st.addFormModeBtnActive]}
                                      onPress={() => { setPendingQtyMode(m); setPendingGrams('') }}>
                                      <Text style={[st.addFormModeBtnText, pendingQtyMode === m && { color: C.white }]}>
                                        {m === 'fraction' ? 'Portions' : 'Grams'}
                                      </Text>
                                    </Pressable>
                                  ))}
                                </View>

                                {pendingQtyMode === 'fraction' ? (
                                  <View>
                                    <Pressable
                                      style={loggerSt.portionDropdown}
                                      onPress={() => setPortionsOpen(o => !o)}
                                    >
                                      <Text style={loggerSt.portionDropdownText}>Portion size</Text>
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                        <Text style={{ fontSize: 14, fontWeight: '700', color: C.accent }}>
                                          {PORTION_OPTIONS.find(c => Math.abs(qty - c.value) < 0.02)?.label ?? '1'}
                                        </Text>
                                        <Ionicons name={portionsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={C.text2} />
                                      </View>
                                    </Pressable>
                                    {portionsOpen && (
                                      <View style={loggerSt.portionDropdownList}>
                                        {PORTION_OPTIONS.map(opt => {
                                          const active = Math.abs(qty - opt.value) < 0.02
                                          return (
                                            <Pressable
                                              key={opt.label}
                                              style={[loggerSt.portionDropdownItem, active && { backgroundColor: C.accentBg }]}
                                              onPress={() => { setServingQty(String(opt.value)); setPortionsOpen(false) }}
                                            >
                                              <Text style={[loggerSt.portionDropdownItemText, active && { color: C.accent, fontWeight: '700' }]}>{opt.label}</Text>
                                              {active && <Ionicons name="checkmark" size={15} color={C.accent} />}
                                            </Pressable>
                                          )
                                        })}
                                      </View>
                                    )}
                                  </View>
                                ) : (
                                  <>
                                    <TextInput
                                      style={st.addFormInput}
                                      value={pendingGrams}
                                      onChangeText={setPendingGrams}
                                      placeholder="Amount in grams"
                                      keyboardType="decimal-pad"
                                      placeholderTextColor={C.text3}
                                      autoFocus
                                    />
                                    {!nonCustomBaseG && (
                                      <Text style={{ fontSize: 11, color: C.text3, fontStyle: 'italic' }}>
                                        No gram reference for this food — kcal scaled from serving size
                                      </Text>
                                    )}
                                  </>
                                )}
                              </View>
                            ) : (
                              <View style={st.qtyRow}>
                                <Text style={st.qtyLabel}>Servings</Text>
                                <TextInput
                                  style={st.qtyInput}
                                  value={servingQty}
                                  onChangeText={v => setServingQty(v.replace(',', '.'))}
                                  keyboardType="decimal-pad"
                                  returnKeyType="done"
                                  autoFocus
                                  selectTextOnFocus
                                />
                              </View>
                            )}
                            {!hideCalories && previewKcal != null && (
                              <>
                                <Text style={st.qtyPreview}>{previewKcal} kcal</Text>
                                {(previewProtein != null || previewFat != null || previewCarb != null) && (
                                  <Text style={{ fontSize: 12, color: C.text2 }}>
                                    {[
                                      previewProtein != null ? `P ${previewProtein}g` : null,
                                      previewFat != null ? `F ${previewFat}g` : null,
                                      previewCarb != null ? `C ${previewCarb}g` : null,
                                    ].filter(Boolean).join(' · ')}
                                  </Text>
                                )}
                              </>
                            )}
                          </>
                        )}
                        {!isCustomFood && (
                          <Pressable style={st.saveToggleRow} onPress={() => { setSaveToMyFoods(v => !v); setSaveMyFoodsMode('unit'); setSaveMyFoodsKcal100g('') }}>
                            <View style={[st.saveToggleCheck, saveToMyFoods && st.saveToggleCheckActive]}>
                              {saveToMyFoods && <Ionicons name="checkmark" size={11} color="#fff" />}
                            </View>
                            <Text style={st.saveToggleLabel}>Save to My Foods</Text>
                          </Pressable>
                        )}
                        {!isCustomFood && saveToMyFoods && (
                          <View style={{ gap: 8 }}>
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                              {(['unit', 'gram'] as const).map(m => (
                                <Pressable
                                  key={m}
                                  style={[st.addFormModeBtn, saveMyFoodsMode === m && st.addFormModeBtnActive]}
                                  onPress={() => setSaveMyFoodsMode(m)}
                                >
                                  <Text style={[st.addFormModeBtnText, saveMyFoodsMode === m && { color: C.white }]}>
                                    {m === 'unit' ? 'Per unit' : 'Per 100g'}
                                  </Text>
                                </Pressable>
                              ))}
                            </View>
                            {saveMyFoodsMode === 'gram' && (
                              <TextInput
                                style={st.addFormInput}
                                value={saveMyFoodsKcal100g}
                                onChangeText={setSaveMyFoodsKcal100g}
                                placeholder="kcal per 100g"
                                keyboardType="decimal-pad"
                                placeholderTextColor={C.text3}
                              />
                            )}
                          </View>
                        )}
                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                          <Pressable style={[st.addFormBtn, { flex: 1, backgroundColor: C.surface2 }]} onPress={() => { setPendingFood(null); setSelectedServingOption(null); setPendingGrams('') }}>
                            <Text style={[st.addFormBtnText, { color: C.text2 }]}>Back</Text>
                          </Pressable>
                          <Pressable
                            style={[st.addFormBtn, { flex: 1 }, (adding || !canAdd) && { opacity: 0.5 }]}
                            onPress={confirmPending}
                            disabled={adding || !canAdd}
                          >
                            <Text style={st.addFormBtnText}>{adding ? 'Adding…' : 'Add to log'}</Text>
                          </Pressable>
                        </View>
                      </View>
                    )
                  })() : (
                    <>
                      <View style={[st.searchRow, { marginBottom: 8 }]}>
                        <Ionicons name="search-outline" size={15} color={C.text3} />
                        <TextInput
                          style={st.searchInput}
                          value={search}
                          onChangeText={setSearch}
                          placeholder="Search foods…"
                          placeholderTextColor={C.text3}
                          returnKeyType="search"
                          clearButtonMode="while-editing"
                          autoFocus
                        />
                      </View>
                      {search.trim() ? (
                        <>
                          {searchResults.length > 0 && searchResults.map((food, i) => (
                            <Pressable key={food.name + i} style={[loggerSt.resultRow, i > 0 && loggerSt.resultRowBorder]} onPress={() => selectFood(food)}>
                              <Text style={loggerSt.resultName}>{food.name}</Text>
                              {!hideCalories && <Text style={loggerSt.resultMeta}>{food.kcal} kcal</Text>}
                            </Pressable>
                          ))}
                          {presetSearchResults.length > 0 && (
                            <>
                              {searchResults.length > 0 && <Text style={[loggerSt.sectionLabel, { marginTop: 12 }]}>My Meals</Text>}
                              {presetSearchResults.map((preset, i) => {
                                const total = (preset.items ?? []).reduce((s, it) => s + it.kcal, 0)
                                return (
                                  <Pressable
                                    key={preset.id}
                                    style={[loggerSt.resultRow, (i > 0 || searchResults.length > 0) && loggerSt.resultRowBorder]}
                                    onPress={async () => { await onLogPreset(preset); onClose() }}
                                  >
                                    <Text style={loggerSt.resultName}>{preset.name}</Text>
                                    {!hideCalories && <Text style={loggerSt.resultMeta}>{total} kcal · meal</Text>}
                                  </Pressable>
                                )
                              })}
                            </>
                          )}
                          {searchResults.length === 0 && presetSearchResults.length === 0 && (
                            <Text style={st.emptyNote}>No results for "{search}"</Text>
                          )}
                        </>
                      ) : (
                        <>
                          {recentFoods.length > 0 && (
                            <>
                              <Text style={loggerSt.sectionLabel}>Recently logged</Text>
                              {recentFoods.map((food, i) => (
                                <Pressable key={food.name + i} style={[loggerSt.resultRow, i > 0 && loggerSt.resultRowBorder]} onPress={() => selectFood(food as any)}>
                                  <Text style={loggerSt.resultName}>{food.name}</Text>
                                  {!hideCalories && <Text style={loggerSt.resultMeta}>{food.kcal} kcal</Text>}
                                </Pressable>
                              ))}
                            </>
                          )}
                          {(() => {
                            const uncategorized = customFoods.filter(f => !f.category)
                            if (!uncategorized.length) return null
                            return (
                              <>
                                <Text style={loggerSt.sectionLabel}>My Foods</Text>
                                {uncategorized.map((food, i) => (
                                  <Pressable
                                    key={food.id}
                                    style={[loggerSt.resultRow, i > 0 && loggerSt.resultRowBorder]}
                                    onPress={() => selectFood(food as any)}
                                  >
                                    <Text style={loggerSt.resultName}>{food.name}</Text>
                                    {!hideCalories && <Text style={loggerSt.resultMeta}>{food.kcal} kcal</Text>}
                                  </Pressable>
                                ))}
                                <Text style={[loggerSt.sectionLabel, { marginTop: 14 }]}>Common foods</Text>
                              </>
                            )
                          })()}
                          {allPresets.length > 0 && (
                            <>
                              <Text style={loggerSt.sectionLabel}>My Meals</Text>
                              {allPresets.map((preset, i) => {
                                const total = (preset.items ?? []).reduce((s, it) => s + it.kcal, 0)
                                return (
                                  <Pressable
                                    key={preset.id}
                                    style={[loggerSt.resultRow, i > 0 && loggerSt.resultRowBorder]}
                                    onPress={async () => { await onLogPreset(preset); onClose() }}
                                  >
                                    <Text style={loggerSt.resultName}>{preset.name}</Text>
                                    {!hideCalories && <Text style={loggerSt.resultMeta}>{total} kcal</Text>}
                                  </Pressable>
                                )
                              })}
                              {!customFoods.filter(f => !f.category).length && (
                                <Text style={[loggerSt.sectionLabel, { marginTop: 14 }]}>Common foods</Text>
                              )}
                            </>
                          )}
                          {COMMON_FOOD_CATEGORIES.map(cat => (
                            <QuickAddCategory
                              key={cat.category}
                              cat={{
                                category: cat.category,
                                items: [
                                  ...customFoods.filter(f => f.category === cat.category) as CommonFood[],
                                  ...cat.items,
                                ],
                              }}
                              hideCalories={hideCalories}
                              onSelect={selectFood}
                            />
                          ))}
                        </>
                      )}
                    </>
                  )}
                </ScrollView>
              )}

              {tab === 'scan' && scannedProduct && (
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                  <View style={{ gap: 10 }}>
                    <TextInput
                      style={st.addFormInput}
                      value={scanName}
                      onChangeText={setScanName}
                      placeholder="Product name"
                      placeholderTextColor={C.text3}
                      returnKeyType="next"
                    />
                    {!hideCalories && (
                      <Text style={{ fontSize: 12, color: C.text3 }}>
                        {'per 100g: '}{scannedProduct.kcalPer100g} kcal
                        {scannedProduct.proteinPer100g != null ? ` · P ${Math.round(scannedProduct.proteinPer100g * 10) / 10}g` : ''}
                        {scannedProduct.fatPer100g != null ? ` · F ${Math.round(scannedProduct.fatPer100g * 10) / 10}g` : ''}
                        {scannedProduct.carbPer100g != null ? ` · C ${Math.round(scannedProduct.carbPer100g * 10) / 10}g` : ''}
                      </Text>
                    )}
                    <View style={st.qtyRow}>
                      <Text style={st.qtyLabel}>1 serving =</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <TextInput
                          style={st.qtyInput}
                          value={scanAmount}
                          onChangeText={v => setScanAmount(v.replace(',', '.'))}
                          keyboardType="decimal-pad"
                          returnKeyType="next"
                          autoFocus
                          selectTextOnFocus
                        />
                        <Text style={{ color: C.text3, fontSize: 13 }}>g</Text>
                      </View>
                    </View>
                    <View style={st.qtyRow}>
                      <Text style={st.qtyLabel}>Number of servings</Text>
                      <TextInput
                        style={st.qtyInput}
                        value={scanServings}
                        onChangeText={v => setScanServings(v.replace(',', '.'))}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        selectTextOnFocus
                      />
                    </View>
                    {!hideCalories && parseFloat(scanAmount) > 0 && parseFloat(scanServings) > 0 && (() => {
                      const r = parseFloat(scanAmount) * (parseFloat(scanServings) || 1) / 100
                      const p = scannedProduct.proteinPer100g != null ? Math.round(scannedProduct.proteinPer100g * r * 10) / 10 : null
                      const f = scannedProduct.fatPer100g != null ? Math.round(scannedProduct.fatPer100g * r * 10) / 10 : null
                      const c = scannedProduct.carbPer100g != null ? Math.round(scannedProduct.carbPer100g * r * 10) / 10 : null
                      return (
                        <>
                          <Text style={st.qtyPreview}>= {Math.round(scannedProduct.kcalPer100g * r)} kcal</Text>
                          {(p != null || f != null || c != null) && (
                            <Text style={{ fontSize: 12, color: C.text2 }}>
                              {[p != null ? `P ${p}g` : null, f != null ? `F ${f}g` : null, c != null ? `C ${c}g` : null].filter(Boolean).join(' · ')}
                            </Text>
                          )}
                        </>
                      )
                    })()}
                    <View style={st.saveToggleGroup}>
                      <Pressable style={st.saveToggleRow} onPress={() => setSaveToMyFoods(v => !v)}>
                        <View style={[st.saveToggleCheck, saveToMyFoods && st.saveToggleCheckActive]}>
                          {saveToMyFoods && <Ionicons name="checkmark" size={11} color="#fff" />}
                        </View>
                        <Text style={st.saveToggleLabel}>Save to My Foods</Text>
                      </Pressable>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                      <Pressable style={[st.addFormBtn, { flex: 1, backgroundColor: C.surface2 }]} onPress={() => { setScannedProduct(null); setScanName(''); lastScannedRef.current = null; setSaveToMyFoods(false) }}>
                        <Text style={[st.addFormBtnText, { color: C.text2 }]}>Scan again</Text>
                      </Pressable>
                      <Pressable style={[st.addFormBtn, { flex: 1 }, adding && { opacity: 0.5 }]} onPress={confirmScan} disabled={adding}>
                        <Text style={st.addFormBtnText}>{adding ? 'Adding…' : 'Add to log'}</Text>
                      </Pressable>
                    </View>
                  </View>
                </ScrollView>
              )}

              {tab === 'manual' && (
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                  <View style={{ gap: 10 }}>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
                      {([
                        { key: 'gram',  label: 'Gram' },
                        { key: 'unit',  label: 'Unit' },
                        { key: 'total', label: 'Total' },
                      ] as const).map(({ key, label }) => (
                        <Pressable key={key}
                          style={[st.addFormModeBtn, manualMode === key && st.addFormModeBtnActive]}
                          onPress={() => setManualMode(key)}>
                          <Text style={[st.addFormModeBtnText, manualMode === key && { color: C.white }]}>{label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <TextInput style={st.addFormInput} value={manualName} onChangeText={setManualName}
                      placeholder="Food name" placeholderTextColor={C.text3} returnKeyType="next" autoFocus />
                    {manualMode === 'gram' && (
                      <>
                        <TextInput style={st.addFormInput} value={manualKcal} onChangeText={setManualKcal}
                          placeholder="kcal per 100g" placeholderTextColor={C.text3} keyboardType="numeric" returnKeyType="next" />
                        <TextInput style={st.addFormInput} value={manualGrams} onChangeText={setManualGrams}
                          placeholder="Amount (g)" placeholderTextColor={C.text3} keyboardType="decimal-pad" returnKeyType="next" />
                        {manualKcal && manualGrams && parseInt(manualKcal) > 0 && parseFloat(manualGrams) > 0 && !hideCalories && (
                          <Text style={lw.derivedDuration}>≈ {Math.round(parseInt(manualKcal) * parseFloat(manualGrams) / 100)} kcal total</Text>
                        )}
                      </>
                    )}
                    {manualMode === 'unit' && (
                      <>
                        <TextInput style={st.addFormInput} value={manualKcal} onChangeText={setManualKcal}
                          placeholder="kcal per unit" placeholderTextColor={C.text3} keyboardType="numeric" returnKeyType="next" />
                        <TextInput style={st.addFormInput} value={manualUnitCount} onChangeText={setManualUnitCount}
                          placeholder="Number of units" placeholderTextColor={C.text3} keyboardType="decimal-pad" returnKeyType="next" />
                        {manualKcal && manualUnitCount && parseInt(manualKcal) > 0 && parseFloat(manualUnitCount) > 0 && !hideCalories && (
                          <Text style={lw.derivedDuration}>≈ {Math.round(parseInt(manualKcal) * parseFloat(manualUnitCount))} kcal total</Text>
                        )}
                      </>
                    )}
                    {manualMode === 'total' && (
                      <TextInput style={st.addFormInput} value={manualKcal} onChangeText={setManualKcal}
                        placeholder="Calories (kcal)" placeholderTextColor={C.text3} keyboardType="numeric" returnKeyType="next" />
                    )}
                    <Text style={loggerSt.sectionLabel}>
                      {manualMode === 'gram' ? 'Macros per 100g (optional)' : manualMode === 'unit' ? 'Macros per unit (optional)' : 'Macros (optional)'}
                    </Text>
                    <View style={st.addFormMacroRow}>
                      <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={manualProtein}
                        onChangeText={v => setManualProtein(v.replace(',', '.'))}
                        placeholder="Protein g" placeholderTextColor={C.text3} keyboardType="decimal-pad" returnKeyType="next" />
                      <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={manualFat}
                        onChangeText={v => setManualFat(v.replace(',', '.'))}
                        placeholder="Fat g" placeholderTextColor={C.text3} keyboardType="decimal-pad" returnKeyType="next" />
                      <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={manualCarb}
                        onChangeText={v => setManualCarb(v.replace(',', '.'))}
                        placeholder="Carbs g" placeholderTextColor={C.text3} keyboardType="decimal-pad"
                        returnKeyType="done" onSubmitEditing={submitManual} />
                    </View>
                    <View style={st.saveToggleGroup}>
                      <Pressable style={st.saveToggleRow} onPress={() => setSaveToMyFoods(v => !v)}>
                        <View style={[st.saveToggleCheck, saveToMyFoods && st.saveToggleCheckActive]}>
                          {saveToMyFoods && <Ionicons name="checkmark" size={11} color="#fff" />}
                        </View>
                        <Text style={st.saveToggleLabel}>Save to My Foods</Text>
                      </Pressable>
                      <Pressable style={st.saveToggleRow} onPress={() => setSaveAsPreset(v => !v)}>
                        <View style={[st.saveToggleCheck, saveAsPreset && st.saveToggleCheckActive]}>
                          {saveAsPreset && <Ionicons name="checkmark" size={11} color="#fff" />}
                        </View>
                        <Text style={st.saveToggleLabel}>Save as preset</Text>
                      </Pressable>
                    </View>
                    {saveToMyFoods && (
                      <View style={{ gap: 8, paddingTop: 4 }}>
                        <Text style={loggerSt.sectionLabel}>Serving sizes (optional)</Text>
                        {manualServings.map((s, i) => (
                          <View key={s.label + i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface2, borderRadius: 8, padding: 8 }}>
                            <Text style={{ flex: 1, fontSize: 13, color: C.text1 }}>{s.label}</Text>
                            {!hideCalories && <Text style={{ fontSize: 12, color: C.text3 }}>{s.kcal} kcal</Text>}
                            <Pressable onPress={() => setManualServings(prev => prev.filter((_, j) => j !== i))} hitSlop={8}>
                              <Ionicons name="close-outline" size={16} color={C.danger} />
                            </Pressable>
                          </View>
                        ))}
                        <TextInput
                          style={st.addFormInput}
                          value={newServingLabel}
                          onChangeText={setNewServingLabel}
                          placeholder="Label (e.g. 1 bowl)"
                          placeholderTextColor={C.text3}
                          returnKeyType="next"
                        />
                        <TextInput
                          style={st.addFormInput}
                          value={newServingKcal}
                          onChangeText={setNewServingKcal}
                          placeholder="Calories (kcal)"
                          placeholderTextColor={C.text3}
                          keyboardType="numeric"
                          returnKeyType="next"
                        />
                        <View style={st.addFormMacroRow}>
                          <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={newServingProtein}
                            onChangeText={v => setNewServingProtein(v.replace(',', '.'))}
                            placeholder="Protein g" placeholderTextColor={C.text3} keyboardType="decimal-pad" returnKeyType="next" />
                          <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={newServingFat}
                            onChangeText={v => setNewServingFat(v.replace(',', '.'))}
                            placeholder="Fat g" placeholderTextColor={C.text3} keyboardType="decimal-pad" returnKeyType="next" />
                          <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={newServingCarb}
                            onChangeText={v => setNewServingCarb(v.replace(',', '.'))}
                            placeholder="Carbs g" placeholderTextColor={C.text3} keyboardType="decimal-pad" returnKeyType="done" />
                        </View>
                        <Pressable
                          style={[st.addFormBtn, { backgroundColor: C.surface2 }, (!newServingLabel.trim() || !(parseFloat(newServingKcal) > 0)) && { opacity: 0.5 }]}
                          onPress={() => {
                            const k = parseFloat(newServingKcal)
                            if (!newServingLabel.trim() || !(k > 0)) return
                            setManualServings(prev => [...prev, {
                              label: newServingLabel.trim(),
                              kcal: Math.round(k),
                              protein_g: newServingProtein ? parseFloat(newServingProtein.replace(',', '.')) : null,
                              fat_g: newServingFat ? parseFloat(newServingFat.replace(',', '.')) : null,
                              carb_g: newServingCarb ? parseFloat(newServingCarb.replace(',', '.')) : null,
                            }])
                            setNewServingLabel(''); setNewServingKcal('')
                            setNewServingProtein(''); setNewServingFat(''); setNewServingCarb('')
                          }}
                          disabled={!newServingLabel.trim() || !(parseFloat(newServingKcal) > 0)}
                        >
                          <Text style={[st.addFormBtnText, { color: C.text2 }]}>Add serving size</Text>
                        </Pressable>
                      </View>
                    )}
                    <Pressable style={[st.addFormBtn, adding && { opacity: 0.6 }]} onPress={submitManual} disabled={adding}>
                      <Text style={st.addFormBtnText}>{adding ? 'Adding…' : 'Add to log'}</Text>
                    </Pressable>
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </Modal>
  )
}

// ─── Meal preset picker ────────────────────────────────────────────────────────

function parseItemBaseGrams(amountLabel: string | null): number | null {
  if (!amountLabel) return null
  const m = amountLabel.match(/^(\d+(?:\.\d+)?)\s*g$/i)
  return m ? parseFloat(m[1]) : null
}

function MealPresetPickerModal({ meal, presets, onSelect, onManage, onClose }: {
  meal: MealItem; presets: MealPreset[]
  onSelect: (p: MealPreset, qty: number, grams?: number) => void; onManage: () => void; onClose: () => void
}) {
  const [selected, setSelected] = useState<MealPreset | null>(null)
  const [qty, setQty] = useState(1)

  function pickPreset(p: MealPreset) {
    if (selected?.id === p.id) { setSelected(null) } else { setSelected(p); setQty(1) }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.modalOverlay} onPress={onClose} />
      <View style={st.pickerSheet}>
        <View style={st.pickerHandle} />
        <View style={st.pickerTitleRow}>
          <Text style={st.pickerTitle}>{meal.name}</Text>
          <Pressable onPress={onManage} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="pencil-outline" size={14} color={C.accent2} />
            <Text style={{ fontSize: 13, color: C.accent2, fontWeight: '600' }}>Edit</Text>
          </Pressable>
        </View>
        <ScrollView>
          {presets.map(preset => {
            const total = (preset.items ?? []).reduce((acc, it) => acc + it.kcal, 0)
            const isSelected = selected?.id === preset.id
            return (
              <View key={preset.id}>
                <Pressable
                  style={[st.pickerRow, isSelected && { backgroundColor: C.accentBg }]}
                  onPress={() => pickPreset(preset)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={st.pickerRowName}>{preset.name}</Text>
                    <Text style={st.pickerRowMeta}>{(preset.items ?? []).length} items · {total} kcal</Text>
                  </View>
                  <Ionicons name={isSelected ? 'checkmark-circle' : 'add-circle-outline'} size={20} color={C.accent2} />
                </Pressable>
                {isSelected && (
                  <View style={st.presetStepperRow}>
                    <Pressable
                      style={st.presetStepperBtn}
                      onPress={() => setQty(q => Math.max(1, q - 1))}
                    >
                      <Ionicons name="remove" size={20} color={C.text1} />
                    </Pressable>
                    <Text style={st.presetStepperQty}>{qty}×</Text>
                    <Pressable
                      style={st.presetStepperBtn}
                      onPress={() => setQty(q => q + 1)}
                    >
                      <Ionicons name="add" size={20} color={C.text1} />
                    </Pressable>
                    <Pressable
                      style={st.presetStepperAdd}
                      onPress={() => { onSelect(preset, qty); onClose() }}
                    >
                      <Text style={st.presetStepperAddText}>Add</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )
          })}
        </ScrollView>
      </View>
    </Modal>
  )
}

// ─── Log workout modal ────────────────────────────────────────────────────────

// Endurance sports use distance + pace/speed or avg HR — not the generic intensity cards
const ENDURANCE_SPORT_TYPES = ['Run', 'Walk', 'Cycling', 'Swim']

function metFromRunWalkSpeed(speedKmh: number, sportType: string): number {
  if (sportType === 'Walk') {
    if (speedKmh < 4.0) return 2.5
    if (speedKmh < 5.0) return 3.5
    if (speedKmh < 6.5) return 4.5
    return 6.0
  }
  if (speedKmh < 8.0) return 6.0
  if (speedKmh < 10.0) return 8.3
  if (speedKmh < 12.0) return 9.8
  if (speedKmh < 14.0) return 11.0
  return 13.5
}

function metFromCyclingSpeed(speedKmh: number): number {
  if (speedKmh < 16) return 4.0
  if (speedKmh < 20) return 6.0
  if (speedKmh < 25) return 8.0
  if (speedKmh < 30) return 10.0
  return 12.0
}

function metFromSwimPace(paceSecPer100m: number): number {
  if (paceSecPer100m > 150) return 5.0
  if (paceSecPer100m > 120) return 7.0
  if (paceSecPer100m > 100) return 9.0
  return 11.0
}

function metFromHrBucket(avgHr: number, sport: typeof MANUAL_SPORT_OPTIONS[0]): number {
  if (avgHr < 125) return sport.mets[0]
  if (avgHr < 145) return sport.mets[1]
  if (avgHr < 162) return sport.mets[2]
  return sport.mets[3]
}

function LogWorkoutModal({ visible, weightKg, hideCalories, onClose, onSave }: {
  visible: boolean
  weightKg: number
  hideCalories: boolean
  onClose: () => void
  onSave: (type: string, name: string, durationMin: number, kcal: number) => Promise<void>
}) {
  const [sportIdx, setSportIdx] = useState(0)
  // Gym-style state
  const [durationStr, setDurationStr] = useState('60')
  const [intensityIdx, setIntensityIdx] = useState(1)
  // Endurance state
  const [distanceStr, setDistanceStr] = useState('')
  const [paceMinStr, setPaceMinStr] = useState('')
  const [paceSecStr, setPaceSecStr] = useState('')
  const [speedStr, setSpeedStr] = useState('')
  const [avgHrStr, setAvgHrStr] = useState('')
  const [enduranceMode, setEnduranceMode] = useState<'pace' | 'hr'>('pace')
  const [saving, setSaving] = useState(false)

  const sport = MANUAL_SPORT_OPTIONS[sportIdx]
  const isEndurance = ENDURANCE_SPORT_TYPES.includes(sport.type)
  const isCycling = sport.type === 'Cycling'
  const isSwim = sport.type === 'Swim'

  function handleSportChange(i: number) {
    setSportIdx(i)
    setDistanceStr('')
    setPaceMinStr('')
    setPaceSecStr('')
    setSpeedStr('')
    setAvgHrStr('')
    setEnduranceMode('pace')
  }

  // Derive duration + MET from endurance inputs
  const enduranceDerived = (() => {
    const dist = parseFloat(distanceStr) || 0
    if (enduranceMode === 'pace') {
      if (isCycling) {
        const speedKmh = parseFloat(speedStr) || 0
        if (dist <= 0 || speedKmh <= 0) return null
        return { durationMin: (dist / speedKmh) * 60, met: metFromCyclingSpeed(speedKmh) }
      }
      const totalPaceSec = (parseInt(paceMinStr) || 0) * 60 + (parseInt(paceSecStr) || 0)
      if (dist <= 0 || totalPaceSec <= 0) return null
      if (isSwim) {
        return { durationMin: (totalPaceSec * dist) / (100 * 60), met: metFromSwimPace(totalPaceSec) }
      }
      const speedKmh = 3600 / totalPaceSec
      return { durationMin: (totalPaceSec * dist) / 60, met: metFromRunWalkSpeed(speedKmh, sport.type) }
    }
    // HR mode: needs both distance and duration; HR determines MET bucket
    const durMin = Math.max(1, parseInt(durationStr) || 0)
    const hr = parseInt(avgHrStr) || 0
    if (dist <= 0 || hr <= 0) return null
    return { durationMin: durMin, met: metFromHrBucket(hr, sport) }
  })()

  const gymDurationMin = Math.max(1, parseInt(durationStr) || 0)
  const gymKcal = Math.round(sport.mets[intensityIdx] * weightKg * (gymDurationMin / 60))
  const enduranceKcal = enduranceDerived
    ? Math.round(enduranceDerived.met * weightKg * (enduranceDerived.durationMin / 60))
    : 0

  async function handleSave() {
    const durationMin = isEndurance ? enduranceDerived?.durationMin ?? 0 : gymDurationMin
    const kcal = isEndurance ? enduranceKcal : gymKcal
    if (durationMin <= 0 || kcal <= 0) return
    setSaving(true)
    await onSave(sport.type, `${sport.label} workout`, Math.round(durationMin), kcal)
    setSaving(false)
    setSportIdx(0); setDurationStr('60'); setIntensityIdx(1)
    setDistanceStr(''); setPaceMinStr(''); setPaceSecStr(''); setSpeedStr(''); setAvgHrStr('')
    setEnduranceMode('pace')
    if (!hideCalories) {
      Alert.alert('Workout logged', `~${kcal.toLocaleString()} kcal burned added to your day.`)
    }
  }

  const canSave = isEndurance ? enduranceDerived !== null : gymDurationMin > 0

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={lw.sheet} contentContainerStyle={lw.content} keyboardShouldPersistTaps="handled">
          <View style={lw.header}>
            <Text style={lw.title}>Log workout</Text>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={C.text2} /></Pressable>
          </View>

          <Text style={lw.sectionLabel}>Activity</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={lw.chipScroll} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
            {MANUAL_SPORT_OPTIONS.map((s, i) => (
              <Pressable key={s.type} style={[lw.chip, i === sportIdx && lw.chipActive]} onPress={() => handleSportChange(i)}>
                <Text style={[lw.chipText, i === sportIdx && lw.chipTextActive]}>{s.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {isEndurance ? (
            <>
              {/* Distance */}
              <Text style={lw.sectionLabel}>Distance ({isSwim ? 'm' : 'km'})</Text>
              <TextInput
                style={lw.distanceInput}
                value={distanceStr}
                onChangeText={setDistanceStr}
                keyboardType="decimal-pad"
                placeholder={isSwim ? 'e.g. 2000' : 'e.g. 10.5'}
                placeholderTextColor={C.text3}
              />

              {/* Pace / HR toggle */}
              <View style={lw.modeToggleRow}>
                <Pressable style={[lw.modeBtn, enduranceMode === 'pace' && lw.modeBtnActive]} onPress={() => setEnduranceMode('pace')}>
                  <Text style={[lw.modeBtnText, enduranceMode === 'pace' && lw.modeBtnTextActive]}>{isCycling ? 'Speed' : 'Pace'}</Text>
                </Pressable>
                <Pressable style={[lw.modeBtn, enduranceMode === 'hr' && lw.modeBtnActive]} onPress={() => setEnduranceMode('hr')}>
                  <Text style={[lw.modeBtnText, enduranceMode === 'hr' && lw.modeBtnTextActive]}>Avg HR</Text>
                </Pressable>
              </View>

              {enduranceMode === 'pace' ? (
                <>
                  <Text style={lw.sectionLabel}>{isCycling ? 'Average speed' : isSwim ? 'Pace (per 100m)' : 'Pace (per km)'}</Text>
                  {isCycling ? (
                    <View style={lw.paceRow}>
                      <TextInput
                        style={[lw.paceInput, { flex: 1 }]}
                        value={speedStr}
                        onChangeText={setSpeedStr}
                        keyboardType="decimal-pad"
                        placeholder="e.g. 28"
                        placeholderTextColor={C.text3}
                      />
                      <Text style={lw.paceUnit}>km/h</Text>
                    </View>
                  ) : (
                    <View style={lw.paceRow}>
                      <TextInput
                        style={lw.paceInput}
                        value={paceMinStr}
                        onChangeText={v => setPaceMinStr(v.replace(/\D/g, '').slice(0, 2))}
                        keyboardType="numeric"
                        placeholder="5"
                        placeholderTextColor={C.text3}
                        maxLength={2}
                      />
                      <Text style={lw.paceSep}>:</Text>
                      <TextInput
                        style={lw.paceInput}
                        value={paceSecStr}
                        onChangeText={v => setPaceSecStr(v.replace(/\D/g, '').slice(0, 2))}
                        keyboardType="numeric"
                        placeholder="30"
                        placeholderTextColor={C.text3}
                        maxLength={2}
                      />
                      <Text style={lw.paceUnit}>{isSwim ? '/ 100m' : '/ km'}</Text>
                    </View>
                  )}
                  {enduranceDerived && (
                    <Text style={lw.derivedDuration}>≈ {Math.round(enduranceDerived.durationMin)} min</Text>
                  )}
                </>
              ) : (
                <>
                  <Text style={lw.sectionLabel}>Average heart rate (bpm)</Text>
                  <TextInput
                    style={lw.distanceInput}
                    value={avgHrStr}
                    onChangeText={setAvgHrStr}
                    keyboardType="numeric"
                    placeholder="e.g. 145"
                    placeholderTextColor={C.text3}
                  />
                  <Text style={lw.sectionLabel}>Duration (minutes)</Text>
                  <View style={lw.durationRow}>
                    <Pressable style={lw.durationBtn} onPress={() => setDurationStr(v => String(Math.max(5, (parseInt(v) || 0) - 5)))} hitSlop={6}>
                      <Ionicons name="remove" size={20} color={C.text1} />
                    </Pressable>
                    <TextInput style={lw.durationInput} value={durationStr} onChangeText={setDurationStr} keyboardType="numeric" selectTextOnFocus />
                    <Pressable style={lw.durationBtn} onPress={() => setDurationStr(v => String((parseInt(v) || 0) + 5))} hitSlop={6}>
                      <Ionicons name="add" size={20} color={C.text1} />
                    </Pressable>
                  </View>
                </>
              )}
            </>
          ) : (
            <>
              <Text style={lw.sectionLabel}>Duration (minutes)</Text>
              <View style={lw.durationRow}>
                <Pressable style={lw.durationBtn} onPress={() => setDurationStr(v => String(Math.max(5, (parseInt(v) || 0) - 5)))} hitSlop={6}>
                  <Ionicons name="remove" size={20} color={C.text1} />
                </Pressable>
                <TextInput style={lw.durationInput} value={durationStr} onChangeText={setDurationStr} keyboardType="numeric" selectTextOnFocus />
                <Pressable style={lw.durationBtn} onPress={() => setDurationStr(v => String((parseInt(v) || 0) + 5))} hitSlop={6}>
                  <Ionicons name="add" size={20} color={C.text1} />
                </Pressable>
              </View>

              <Text style={lw.sectionLabel}>Intensity</Text>
              {INTENSITY_OPTIONS.map((opt, i) => (
                <Pressable key={opt.label} style={[lw.intensityCard, i === intensityIdx && lw.intensityCardActive]} onPress={() => setIntensityIdx(i)}>
                  <View style={[lw.intensityDot, i === intensityIdx && lw.intensityDotActive]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[lw.intensityLabel, i === intensityIdx && lw.intensityLabelActive]}>{opt.label}</Text>
                    <Text style={lw.intensityDesc}>{opt.description}</Text>
                  </View>
                </Pressable>
              ))}
            </>
          )}

          <Pressable style={[lw.saveBtn, (!canSave || saving) && { opacity: 0.4 }]} onPress={handleSave} disabled={!canSave || saving}>
            <Text style={lw.saveBtnText}>{saving ? 'Saving…' : 'Log this workout'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ─── Calorie breakdown modal ───────────────────────────────────────────────────

function CalorieBreakdownModal({ visible, dailyTarget, burned, planned, consumed, displayMax, hideCalories, logs, userId, onDeleteLog, onEditLog, onClose }: {
  visible: boolean; dailyTarget: number | null; burned: number; planned: number
  consumed: number; displayMax: number | null; hideCalories: boolean
  logs: FoodLog[]; userId: string | null; onDeleteLog: (id: string) => void
  onEditLog: (id: string, name: string, kcal: number, protein: number | null, fat: number | null, carb: number | null) => Promise<void>
  onClose: () => void
}) {
  const todayStr = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [historyLogs, setHistoryLogs] = useState<FoodLog[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [editingLog, setEditingLog] = useState<FoodLog | null>(null)
  const [editName, setEditName] = useState('')
  const [editKcal, setEditKcal] = useState('')
  const [editProtein, setEditProtein] = useState('')
  const [editFat, setEditFat] = useState('')
  const [editCarb, setEditCarb] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addName, setAddName] = useState('')
  const [addKcal, setAddKcal] = useState('')
  const [addProtein, setAddProtein] = useState('')
  const [addFat, setAddFat] = useState('')
  const [addCarb, setAddCarb] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const insets = useSafeAreaInsets()

  useEffect(() => { if (visible) setSelectedDate(todayStr) }, [visible])

  useEffect(() => {
    if (!visible || selectedDate === todayStr || !userId) return
    setHistoryLoading(true)
    setHistoryLogs([])
    supabase.from('food_logs')
      .select('id, user_id, date, name, kcal, protein_g, fat_g, carb_g, meal_name, meal_index, logged_at')
      .eq('user_id', userId).eq('date', selectedDate).order('logged_at')
      .then(({ data }) => { setHistoryLogs((data ?? []) as FoodLog[]); setHistoryLoading(false) })
  }, [selectedDate, visible])

  const isToday = selectedDate === todayStr
  const displayLogs = isToday ? logs : historyLogs
  const displayConsumed = isToday ? consumed : historyLogs.reduce((s, l) => s + l.kcal, 0)
  const total = dailyTarget != null ? dailyTarget + burned + planned : null

  function shiftDay(delta: number) {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    const next = d.toISOString().split('T')[0]
    if (next <= todayStr) { setSelectedDate(next); setShowAddForm(false); setEditingLog(null) }
  }

  async function deleteHistoryLog(log: FoodLog) {
    Alert.alert('Remove entry?', `Remove "${log.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        setHistoryLogs(prev => prev.filter(l => l.id !== log.id))
        await supabase.from('food_logs').delete().eq('id', log.id)
      }},
    ])
  }

  async function saveHistoryEdit() {
    if (!editingLog) return
    const k = parseInt(editKcal)
    if (!editName.trim() || isNaN(k) || k <= 0) return
    setEditSaving(true)
    const { data: updated } = await supabase.from('food_logs')
      .update({ name: editName.trim(), kcal: k, protein_g: editProtein ? parseFloat(editProtein) : null, fat_g: editFat ? parseFloat(editFat) : null, carb_g: editCarb ? parseFloat(editCarb) : null })
      .eq('id', editingLog.id)
      .select('id, user_id, date, name, kcal, protein_g, fat_g, carb_g, meal_name, meal_index, logged_at')
      .single()
    if (updated) setHistoryLogs(prev => prev.map(l => l.id === editingLog.id ? updated as FoodLog : l))
    setEditSaving(false)
    setEditingLog(null)
  }

  async function submitAddForm() {
    if (!userId) return
    const k = parseInt(addKcal)
    if (!addName.trim() || isNaN(k) || k <= 0) return
    setAddSaving(true)
    const { data: inserted } = await supabase.from('food_logs')
      .insert({ user_id: userId, date: selectedDate, name: addName.trim(), kcal: k, protein_g: addProtein ? parseFloat(addProtein) : null, fat_g: addFat ? parseFloat(addFat) : null, carb_g: addCarb ? parseFloat(addCarb) : null })
      .select('id, user_id, date, name, kcal, protein_g, fat_g, carb_g, meal_name, meal_index, logged_at')
      .single()
    if (inserted) setHistoryLogs(prev => [...prev, inserted as FoodLog])
    setAddSaving(false)
    setShowAddForm(false)
    setAddName(''); setAddKcal(''); setAddProtein(''); setAddFat(''); setAddCarb('')
  }

  const dateLabel = isToday
    ? 'Today'
    : new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={st.modalOverlay} onPress={onClose} />
      <View style={[st.breakdownSheet, { paddingBottom: Math.max(28, insets.bottom), maxHeight: '85%' }]}>
        {/* Date navigator */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Pressable onPress={() => shiftDay(-1)} hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="chevron-back" size={22} color={C.text1} />
          </Pressable>
          <Text style={{ fontSize: 16, fontWeight: '700', color: C.text1 }}>{dateLabel}</Text>
          <Pressable onPress={() => shiftDay(1)} hitSlop={12} style={{ padding: 4 }} disabled={isToday}>
            <Ionicons name="chevron-forward" size={22} color={isToday ? C.text3 : C.text1} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Target breakdown — today only */}
          {isToday && (
            <>
              <Text style={[st.breakdownTitle, { marginTop: 0 }]}>Calorie target</Text>
              {[
                { label: 'Baseline (rest day)', value: dailyTarget },
                { label: 'Burned (activities)', value: burned > 0 ? burned : null },
                { label: 'Planned workouts', value: planned > 0 ? planned : null },
                { label: 'Maximum (optional)', value: displayMax },
              ].map(row => row.value != null && (
                <View key={row.label} style={st.breakdownRow}>
                  <Text style={st.breakdownLabel}>{row.label}</Text>
                  {!hideCalories && <Text style={st.breakdownValue}>{row.value.toLocaleString()} kcal</Text>}
                </View>
              ))}
              {total != null && !hideCalories && (
                <View style={[st.breakdownRow, { borderTopWidth: 1, borderTopColor: C.divider, marginTop: 8, paddingTop: 12 }]}>
                  <Text style={[st.breakdownLabel, { fontWeight: '700', color: C.text1 }]}>Daily minimum</Text>
                  <Text style={[st.breakdownValue, { color: C.accent2, fontWeight: '700' }]}>{total.toLocaleString()} kcal</Text>
                </View>
              )}
            </>
          )}

          {/* Food log */}
          <View style={[st.breakdownRow, { borderTopWidth: isToday ? 1 : 0, borderTopColor: C.divider, marginTop: isToday ? 16 : 0, paddingTop: isToday ? 16 : 0, marginBottom: 4 }]}>
            <Text style={[st.breakdownLabel, { fontWeight: '700', color: C.text1 }]}>
              {isToday ? 'What you ate today' : 'Food log'}
            </Text>
            {!hideCalories && displayConsumed > 0 && (
              <Text style={[st.breakdownValue, { color: C.text2 }]}>{displayConsumed.toLocaleString()} kcal</Text>
            )}
          </View>

          {historyLoading && <ActivityIndicator color={C.accent2} style={{ marginVertical: 16 }} />}

          {!historyLoading && displayLogs.length === 0 && (
            <Text style={[st.breakdownLabel, { color: C.text3, paddingVertical: 8 }]}>Nothing logged on this day.</Text>
          )}

          {!historyLoading && displayLogs.map(log => (
            <View key={log.id} style={[st.breakdownRow, { alignItems: 'center' }]}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={st.breakdownLabel} numberOfLines={1}>{log.name}</Text>
                {log.meal_name && <Text style={{ fontSize: 11, color: C.text3, marginTop: 1 }}>{log.meal_name}</Text>}
              </View>
              {!hideCalories && <Text style={[st.breakdownValue, { marginRight: 10 }]}>{log.kcal.toLocaleString()} kcal</Text>}
              <Pressable onPress={() => {
                setEditingLog(log)
                setEditName(log.name)
                setEditKcal(String(log.kcal))
                setEditProtein(log.protein_g != null ? String(log.protein_g) : '')
                setEditFat(log.fat_g != null ? String(log.fat_g) : '')
                setEditCarb(log.carb_g != null ? String(log.carb_g) : '')
              }} hitSlop={8} style={{ marginRight: 6 }}>
                <Ionicons name="pencil-outline" size={15} color={C.accent2} />
              </Pressable>
              <Pressable onPress={() => isToday ? onDeleteLog(log.id) : deleteHistoryLog(log)} hitSlop={8}>
                <Ionicons name="trash-outline" size={15} color={C.danger} />
              </Pressable>
            </View>
          ))}

          {!isToday && !historyLoading && !showAddForm && (
            <Pressable
              onPress={() => setShowAddForm(true)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, marginTop: 4 }}
            >
              <Ionicons name="add-circle-outline" size={18} color={C.accent2} />
              <Text style={{ fontSize: 14, color: C.accent2, fontWeight: '600' }}>Add entry</Text>
            </Pressable>
          )}
        </ScrollView>

        {editingLog && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg, padding: 20, gap: 10, zIndex: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.text1, marginBottom: 4 }}>Edit entry</Text>
            <TextInput style={st.addFormInput} value={editName} onChangeText={setEditName} placeholder="Name" placeholderTextColor={C.text3} />
            <TextInput style={st.addFormInput} value={editKcal} onChangeText={setEditKcal} placeholder="kcal" keyboardType="numeric" placeholderTextColor={C.text3} />
            <View style={st.addFormMacroRow}>
              <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={editProtein} onChangeText={setEditProtein} placeholder="Protein g" keyboardType="decimal-pad" placeholderTextColor={C.text3} />
              <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={editFat} onChangeText={setEditFat} placeholder="Fat g" keyboardType="decimal-pad" placeholderTextColor={C.text3} />
              <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={editCarb} onChangeText={setEditCarb} placeholder="Carbs g" keyboardType="decimal-pad" placeholderTextColor={C.text3} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <Pressable style={[st.addFormBtn, { flex: 1, backgroundColor: C.surface2 }]} onPress={() => setEditingLog(null)}>
                <Text style={[st.addFormBtnText, { color: C.text2 }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[st.addFormBtn, { flex: 1 }, editSaving && { opacity: 0.6 }]}
                onPress={async () => {
                  if (isToday) {
                    const k = parseInt(editKcal)
                    if (!editName.trim() || isNaN(k) || k <= 0) return
                    setEditSaving(true)
                    await onEditLog(editingLog.id, editName.trim(), k, editProtein ? parseFloat(editProtein) : null, editFat ? parseFloat(editFat) : null, editCarb ? parseFloat(editCarb) : null)
                    setEditSaving(false)
                    setEditingLog(null)
                  } else {
                    await saveHistoryEdit()
                  }
                }}
                disabled={editSaving}
              >
                <Text style={st.addFormBtnText}>{editSaving ? 'Saving…' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {showAddForm && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg, padding: 20, gap: 10, zIndex: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.text1, marginBottom: 4 }}>Add entry — {dateLabel}</Text>
            <TextInput style={st.addFormInput} value={addName} onChangeText={setAddName} placeholder="Name" placeholderTextColor={C.text3} autoFocus />
            <TextInput style={st.addFormInput} value={addKcal} onChangeText={setAddKcal} placeholder="kcal" keyboardType="numeric" placeholderTextColor={C.text3} />
            <View style={st.addFormMacroRow}>
              <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={addProtein} onChangeText={setAddProtein} placeholder="Protein g" keyboardType="decimal-pad" placeholderTextColor={C.text3} />
              <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={addFat} onChangeText={setAddFat} placeholder="Fat g" keyboardType="decimal-pad" placeholderTextColor={C.text3} />
              <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={addCarb} onChangeText={setAddCarb} placeholder="Carbs g" keyboardType="decimal-pad" placeholderTextColor={C.text3} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <Pressable style={[st.addFormBtn, { flex: 1, backgroundColor: C.surface2 }]} onPress={() => { setShowAddForm(false); setAddName(''); setAddKcal(''); setAddProtein(''); setAddFat(''); setAddCarb('') }}>
                <Text style={[st.addFormBtnText, { color: C.text2 }]}>Cancel</Text>
              </Pressable>
              <Pressable style={[st.addFormBtn, { flex: 1 }, addSaving && { opacity: 0.6 }]} onPress={submitAddForm} disabled={addSaving}>
                <Text style={st.addFormBtnText}>{addSaving ? 'Saving…' : 'Add'}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </Modal>
  )
}

// ─── Meal builder modal ───────────────────────────────────────────────────────

function MealBuilderModal({ visible, userId, customFoods, mealSlots, editPreset, initialSlots, onSave, onClose }: {
  visible: boolean
  userId: string
  customFoods: CustomFood[]
  mealSlots: MealItem[]
  editPreset?: MealPreset
  initialSlots?: Set<number>
  onSave: () => void
  onClose: () => void
}) {
  const [mealName, setMealName] = useState('')
  const [items, setItems] = useState<{ name: string; kcal: number; protein_g: number | null; fat_g: number | null; carb_g: number | null }[]>([])
  const [itemSearch, setItemSearch] = useState('')
  const [pendingFood, setPendingFood] = useState<{ name: string; kcal: number; protein_g?: number | null } | null>(null)
  const [pendingQty, setPendingQty] = useState('1')
  const [itemName, setItemName] = useState('')
  const [itemKcal, setItemKcal] = useState('')
  const [itemProtein, setItemProtein] = useState('')
  const [itemFat, setItemFat] = useState('')
  const [itemCarb, setItemCarb] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedSlots, setSelectedSlots] = useState<Set<number>>(new Set())
  const [scanMode, setScanMode] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const [scannedProduct, setScannedProduct] = useState<{ name: string; kcalPer100g: number } | null>(null)
  const [scanAmount, setScanAmount] = useState('100')
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const lastScannedRef = useRef<string | null>(null)
  const insets = useSafeAreaInsets()

  useEffect(() => {
    if (editPreset) {
      setMealName(editPreset.name)
      setItems((editPreset.items ?? []).map(it => ({ name: it.name, kcal: it.kcal, protein_g: it.protein_g ?? null, fat_g: it.fat_g ?? null, carb_g: it.carb_g ?? null })))
      setSelectedSlots(new Set(initialSlots ?? []))
    }
  }, [editPreset?.id])

  useEffect(() => {
    if (!visible) {
      setMealName(''); setItems([]); setItemSearch(''); setPendingFood(null)
      setSelectedSlots(new Set()); setScanMode(false); setScannedProduct(null)
    }
  }, [visible])

  const searchResults = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    if (!q) return []
    const commonHits = COMMON_FOOD_CATEGORIES.flatMap(c => c.items).filter(f => f.name.toLowerCase().includes(q))
    const customHits = customFoods.filter(f => f.name.toLowerCase().includes(q))
    return [...customHits, ...commonHits].slice(0, 15) as { name: string; kcal: number; protein_g?: number | null }[]
  }, [itemSearch, customFoods])

  function selectFromSearch(food: { name: string; kcal: number; protein_g?: number | null }) {
    setPendingFood(food)
    setPendingQty('1')
    setItemSearch('')
  }

  function confirmPending() {
    if (!pendingFood) return
    const qty = parseFloat(pendingQty) || 0
    if (qty <= 0) return
    setItems(prev => [...prev, {
      name: pendingFood.name,
      kcal: Math.round(pendingFood.kcal * qty),
      protein_g: pendingFood.protein_g ? Math.round(pendingFood.protein_g * qty * 10) / 10 : null,
      fat_g: null,
      carb_g: null,
    }])
    setPendingFood(null)
    setPendingQty('1')
  }

  function addManual() {
    const k = parseInt(itemKcal)
    if (!itemName.trim() || isNaN(k) || k <= 0) return
    setItems(prev => [...prev, {
      name: itemName.trim(), kcal: k,
      protein_g: itemProtein ? parseFloat(itemProtein.replace(',', '.')) : null,
      fat_g: itemFat ? parseFloat(itemFat.replace(',', '.')) : null,
      carb_g: itemCarb ? parseFloat(itemCarb.replace(',', '.')) : null,
    }])
    setItemName(''); setItemKcal(''); setItemProtein(''); setItemFat(''); setItemCarb('')
  }

  function toggleSlot(index: number) {
    setSelectedSlots(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function handleBarcodeScan({ data }: { data: string }) {
    if (lastScannedRef.current === data || scanLoading) return
    lastScannedRef.current = data
    setScanLoading(true)
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${data}.json`)
      const json = await res.json()
      if (json.status === 1 && json.product) {
        const p = json.product
        const name = p.product_name || p.abbreviated_product_name || 'Unknown product'
        const nutriments = p.nutriments ?? {}
        const kcalPer100g = Math.round(nutriments['energy-kcal_100g'] ?? nutriments['energy-kcal'] ?? 0)
        setScannedProduct({ name, kcalPer100g })
        setScanAmount('100')
      } else {
        Alert.alert('Not found', 'Product not found in the database.')
        lastScannedRef.current = null
      }
    } catch {
      Alert.alert('Error', 'Could not look up barcode.')
      lastScannedRef.current = null
    }
    setScanLoading(false)
  }

  function confirmScan() {
    if (!scannedProduct) return
    const g = parseFloat(scanAmount) || 0
    if (g <= 0) return
    const kcal = Math.round(scannedProduct.kcalPer100g * g / 100)
    setItems(prev => [...prev, { name: `${scannedProduct.name} (${g}g)`, kcal, protein_g: null, fat_g: null, carb_g: null }])
    setScannedProduct(null)
    lastScannedRef.current = null
    setScanMode(false)
  }

  async function save() {
    if (!mealName.trim() || items.length === 0) return
    setSaving(true)
    if (editPreset) {
      await Promise.all([
        supabase.from('meal_presets').update({ name: mealName.trim() }).eq('id', editPreset.id),
        supabase.from('meal_preset_items').delete().eq('preset_id', editPreset.id),
      ])
      await supabase.from('meal_preset_items').insert(
        items.map((it, i) => ({ preset_id: editPreset.id, name: it.name, kcal: it.kcal, protein_g: it.protein_g, fat_g: it.fat_g, carb_g: it.carb_g, sort_order: i }))
      )
      await supabase.from('meal_slot_presets').delete().eq('preset_id', editPreset.id).eq('user_id', userId)
      if (selectedSlots.size > 0) {
        await supabase.from('meal_slot_presets').insert(
          [...selectedSlots].map((slotIdx, i) => ({ user_id: userId, meal_index: slotIdx, preset_id: editPreset.id, sort_order: i }))
        )
      }
    } else {
      const { data: preset } = await supabase.from('meal_presets')
        .insert({ user_id: userId, name: mealName.trim(), sort_order: 0 })
        .select('id, user_id, name, sort_order').single()
      if (!preset) { setSaving(false); return }
      await Promise.all([
        supabase.from('meal_preset_items').insert(
          items.map((it, i) => ({ preset_id: preset.id, name: it.name, kcal: it.kcal, protein_g: it.protein_g, fat_g: it.fat_g, carb_g: it.carb_g, sort_order: i }))
        ),
        selectedSlots.size > 0
          ? supabase.from('meal_slot_presets').insert(
              [...selectedSlots].map((slotIdx, i) => ({ user_id: userId, meal_index: slotIdx, preset_id: preset.id, sort_order: i }))
            )
          : Promise.resolve(),
      ])
    }
    setSaving(false)
    onSave()
    onClose()
  }

  const total = items.reduce((s, it) => s + it.kcal, 0)

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[{ flex: 1, backgroundColor: C.bg }, { paddingTop: insets.top }]}>
        <View style={st.builderHeader}>
          <Text style={st.builderHeaderTitle}>{editPreset ? 'Edit meal' : 'Build a meal'}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={C.text1} />
          </Pressable>
        </View>

        {scanMode ? (
          <View style={{ flex: 1 }}>
            {!cameraPermission?.granted ? (
              <View style={st.builderPermBox}>
                <Ionicons name="camera-outline" size={40} color={C.text3} />
                <Text style={{ fontSize: 14, color: C.text2, textAlign: 'center' }}>Camera access is needed to scan barcodes</Text>
                <Pressable style={[st.addFormBtn, { paddingHorizontal: 24 }]} onPress={requestCameraPermission}>
                  <Text style={st.addFormBtnText}>Allow camera</Text>
                </Pressable>
              </View>
            ) : scannedProduct ? (
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={st.builderScanSheet}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: C.text1, marginBottom: 4 }}>{scannedProduct.name}</Text>
                <Text style={{ fontSize: 13, color: C.text3, marginBottom: 16 }}>{scannedProduct.kcalPer100g} kcal per 100g</Text>
                <View style={st.qtyRow}>
                  <Text style={st.qtyLabel}>Amount (grams)</Text>
                  <TextInput
                    style={st.qtyInput}
                    value={scanAmount}
                    onChangeText={setScanAmount}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                    autoFocus
                    selectTextOnFocus
                  />
                </View>
                {parseFloat(scanAmount) > 0 && (
                  <Text style={[st.qtyPreview, { marginVertical: 8 }]}>
                    = {Math.round(scannedProduct.kcalPer100g * parseFloat(scanAmount) / 100)} kcal
                  </Text>
                )}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  <Pressable style={[st.addFormBtn, { flex: 1, backgroundColor: C.surface2 }]} onPress={() => { setScannedProduct(null); lastScannedRef.current = null }}>
                    <Text style={[st.addFormBtnText, { color: C.text2 }]}>Scan again</Text>
                  </Pressable>
                  <Pressable style={[st.addFormBtn, { flex: 1 }]} onPress={confirmScan}>
                    <Text style={st.addFormBtnText}>Add</Text>
                  </Pressable>
                </View>
              </KeyboardAvoidingView>
            ) : (
              <View style={{ flex: 1 }}>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  onBarcodeScanned={scanLoading ? undefined : handleBarcodeScan}
                  barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
                />
                {/* Viewfinder overlay */}
                <View style={{ flex: 1 }}>
                  <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} />
                  <View style={{ flexDirection: 'row', height: 180 }}>
                    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} />
                    <View style={{ width: 260 }}>
                      <View style={{ position: 'absolute', top: 0, left: 0, width: 28, height: 28, borderTopWidth: 3, borderLeftWidth: 3, borderColor: '#fff' }} />
                      <View style={{ position: 'absolute', top: 0, right: 0, width: 28, height: 28, borderTopWidth: 3, borderRightWidth: 3, borderColor: '#fff' }} />
                      <View style={{ position: 'absolute', bottom: 0, left: 0, width: 28, height: 28, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: '#fff' }} />
                      <View style={{ position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderBottomWidth: 3, borderRightWidth: 3, borderColor: '#fff' }} />
                    </View>
                    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} />
                  </View>
                  <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', paddingTop: 28, gap: 20 }}>
                    <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center', opacity: 0.85 }}>Align barcode within the frame</Text>
                    <Pressable
                      style={{ backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }}
                      onPress={() => setScanMode(false)}
                    >
                      <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
                {scanLoading && (
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' }}>
                    <ActivityIndicator size="large" color="#fff" />
                    <Text style={{ color: '#fff', marginTop: 12, fontSize: 14 }}>Looking up product…</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        ) : (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={st.builderScroll} keyboardShouldPersistTaps="handled">

              <TextInput
                style={st.addFormInput}
                value={mealName}
                onChangeText={setMealName}
                placeholder="Meal name (e.g. Yoghurt with granola)"
                placeholderTextColor={C.text3}
                returnKeyType="next"
              />

              {items.map((it, i) => (
                <View key={i} style={st.builderItemRow}>
                  <Text style={st.builderItemName} numberOfLines={1}>{it.name}</Text>
                  <Text style={st.builderItemKcal}>{it.kcal} kcal</Text>
                  <Pressable onPress={() => setItems(prev => prev.filter((_, j) => j !== i))} hitSlop={8}>
                    <Ionicons name="close-outline" size={16} color={C.danger} />
                  </Pressable>
                </View>
              ))}

              {total > 0 && <Text style={st.builderTotal}>Total: {total} kcal</Text>}

              {!pendingFood && (
                <View style={[st.searchRow, { marginBottom: 0 }]}>
                  <Ionicons name="search-outline" size={15} color={C.text3} />
                  <TextInput
                    style={st.searchInput}
                    value={itemSearch}
                    onChangeText={setItemSearch}
                    placeholder="Search foods to add…"
                    placeholderTextColor={C.text3}
                    returnKeyType="search"
                    clearButtonMode="while-editing"
                  />
                </View>
              )}

              {!pendingFood && searchResults.length > 0 && (
                <View style={st.builderResults}>
                  {searchResults.map((food, i) => (
                    <Pressable
                      key={food.name + i}
                      style={[st.foodRow, i < searchResults.length - 1 && st.foodRowBorder]}
                      onPress={() => selectFromSearch(food)}
                    >
                      <Text style={st.foodName}>{food.name}</Text>
                      <Text style={st.foodKcal}>{food.kcal} kcal</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {!pendingFood && itemSearch.trim() !== '' && searchResults.length === 0 && (
                <Text style={[st.emptyNote, { marginTop: 6 }]}>No results — add manually below.</Text>
              )}

              {pendingFood && (() => {
                const qty = parseFloat(pendingQty) || 0
                const computedKcal = qty > 0 ? Math.round(pendingFood.kcal * qty) : null
                return (
                  <View style={st.builderPendingBox}>
                    <Text style={st.builderPendingName} numberOfLines={1}>{pendingFood.name}</Text>
                    <View style={st.builderPendingRow}>
                      <Text style={st.builderPendingLabel}>Servings</Text>
                      <TextInput
                        style={st.builderPendingInput}
                        value={pendingQty}
                        onChangeText={v => setPendingQty(v.replace(',', '.'))}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        autoFocus
                        selectTextOnFocus
                        onSubmitEditing={confirmPending}
                      />
                      {computedKcal != null && (
                        <Text style={st.builderPendingKcal}>= {computedKcal} kcal</Text>
                      )}
                      <Pressable style={st.builderAddBtn} onPress={confirmPending} disabled={qty <= 0}>
                        <Ionicons name="checkmark" size={18} color="#fff" />
                      </Pressable>
                      <Pressable onPress={() => setPendingFood(null)} hitSlop={10}>
                        <Ionicons name="close-outline" size={20} color={C.text3} />
                      </Pressable>
                    </View>
                  </View>
                )
              })()}

              <Pressable style={st.builderScanBtn} onPress={() => { setScanMode(true); lastScannedRef.current = null; setScannedProduct(null) }}>
                <Ionicons name="barcode-outline" size={16} color={C.accent} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: C.accent }}>Scan barcode</Text>
              </Pressable>

              <View style={st.builderAddRow}>
                <TextInput
                  style={[st.addFormInput, { flex: 2 }]}
                  value={itemName}
                  onChangeText={setItemName}
                  placeholder="Custom item"
                  placeholderTextColor={C.text3}
                  returnKeyType="next"
                />
                <TextInput
                  style={[st.addFormInput, { flex: 1 }]}
                  value={itemKcal}
                  onChangeText={setItemKcal}
                  placeholder="kcal"
                  placeholderTextColor={C.text3}
                  keyboardType="numeric"
                  returnKeyType="next"
                />
              </View>
              <View style={st.builderAddRow}>
                <TextInput
                  style={[st.addFormInput, { flex: 1 }]}
                  value={itemProtein}
                  onChangeText={v => setItemProtein(v.replace(',', '.'))}
                  placeholder="Prot g"
                  placeholderTextColor={C.text3}
                  keyboardType="decimal-pad"
                  returnKeyType="next"
                />
                <TextInput
                  style={[st.addFormInput, { flex: 1 }]}
                  value={itemFat}
                  onChangeText={v => setItemFat(v.replace(',', '.'))}
                  placeholder="Fat g"
                  placeholderTextColor={C.text3}
                  keyboardType="decimal-pad"
                  returnKeyType="next"
                />
                <TextInput
                  style={[st.addFormInput, { flex: 1 }]}
                  value={itemCarb}
                  onChangeText={v => setItemCarb(v.replace(',', '.'))}
                  placeholder="Carbs g"
                  placeholderTextColor={C.text3}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  onSubmitEditing={addManual}
                />
                <Pressable style={st.builderAddBtn} onPress={addManual}>
                  <Ionicons name="add" size={18} color="#fff" />
                </Pressable>
              </View>

              {mealSlots.length > 0 && (
                <>
                  <Text style={st.builderSlotHeading}>Link to meal slots (optional)</Text>
                  {mealSlots.map(slot => (
                    <Pressable key={slot.meal_index} style={st.builderSlotRow} onPress={() => toggleSlot(slot.meal_index)}>
                      <View style={[st.builderSlotCheck, selectedSlots.has(slot.meal_index) && st.builderSlotCheckActive]}>
                        {selectedSlots.has(slot.meal_index) && <Ionicons name="checkmark" size={12} color="#fff" />}
                      </View>
                      <Text style={st.builderSlotName}>{slot.name}</Text>
                      <Text style={{ fontSize: 12, color: C.text3 }}>{slot.scheduled_time}</Text>
                    </Pressable>
                  ))}
                </>
              )}

            </ScrollView>
          </KeyboardAvoidingView>
        )}

        {/* Sticky footer: Cancel + Save */}
        {!scanMode && (
          <View style={[st.builderFooter, { paddingBottom: Math.max(16, insets.bottom) }]}>
            <Pressable style={st.builderCancelBtn} onPress={onClose}>
              <Text style={st.builderCancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[st.builderSaveBtn, (saving || !mealName.trim() || items.length === 0) && { opacity: 0.4 }]}
              onPress={save}
              disabled={saving || !mealName.trim() || items.length === 0}
            >
              <Text style={st.builderSaveBtnText}>{saving ? 'Saving…' : 'Save meal'}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingBottom: 16 },

  // Top bar
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4,
  },
  topDate: { fontSize: 13, color: C.text3, fontWeight: '500', flex: 1, textAlign: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: C.border },
  avatarPlaceholder: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface2,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border,
  },

  // Greeting
  greetingBlock: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 },
  greetingLine1: { fontSize: 36, fontWeight: '800', color: C.text1, lineHeight: 40 },
  greetingLine2: { fontSize: 36, fontWeight: '800', color: C.text1, lineHeight: 44 },

  // Period banner
  periodBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 20, marginBottom: 12,
    backgroundColor: 'rgba(233,30,140,0.08)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(233,30,140,0.18)',
  },
  periodBannerText: { fontSize: 12, color: '#E91E8C', fontWeight: '600' },

  // Calorie card
  calorieCard: {
    marginHorizontal: 16, borderRadius: 20, padding: 22, marginBottom: 16,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  progressTrack: {
    height: 10, backgroundColor: 'rgba(28,25,23,0.12)', borderRadius: 5,
    overflow: 'hidden', marginBottom: 10,
  },
  progressFill: { height: 10, backgroundColor: C.accent, borderRadius: 5 },
  calorieNum: { fontSize: 52, fontWeight: '800', color: C.text1, lineHeight: 56 },
  calorieLabelDark: { fontSize: 15, color: C.text2, fontWeight: '500', marginTop: 2 },
  calorieEmpty: { fontSize: 14, color: C.text2, fontStyle: 'italic' },
  calorieChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  chip: {
    backgroundColor: 'rgba(28,25,23,0.08)', borderRadius: 10,
    paddingHorizontal: 9, paddingVertical: 4,
  },
  chipText: { fontSize: 11, color: C.text2, fontWeight: '500' },
  chipEaten: { backgroundColor: 'rgba(28,25,23,0.14)' },
  chipEatenText: { color: C.text1, fontWeight: '700' },

  // Cards
  card: {
    backgroundColor: C.surface, marginHorizontal: 16, marginBottom: 12, borderRadius: 18, padding: 18,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: C.text1 },
  emptyNote: { fontSize: 13, color: C.text3, fontStyle: 'italic', paddingVertical: 4 },

  // Sync / plan
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, backgroundColor: C.accentBg, borderRadius: 20 },
  syncBtnText: { fontSize: 12, fontWeight: '600', color: C.accent2 },
  planBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  planBtnText: { fontSize: 13, fontWeight: '600', color: C.accent2 },

  // Coach notes
  coachNoteRow: {
    borderLeftWidth: 3, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: C.surface2, marginBottom: 8,
  },
  coachNoteTag: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  coachNoteDate: { fontSize: 11, color: C.text3, marginLeft: 'auto' as any },
  coachNoteContent: { fontSize: 13, color: C.text1, lineHeight: 19 },

  // Activities
  activityRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingLeft: 10,
    borderLeftWidth: 3, borderRadius: 6, marginBottom: 6, backgroundColor: C.surface2,
  },
  activityName: { fontSize: 13, fontWeight: '700', color: C.text1 },
  activityType: { fontSize: 11, color: C.text3, marginTop: 1 },
  activityKcal: { fontSize: 13, fontWeight: '700', color: C.accent, marginRight: 8 },

  // Meals
  mealCard: { borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, marginBottom: 8 },
  mealCardChecked: { borderColor: C.accent2 + '55', backgroundColor: C.accent2 + '08' },
  mealCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  mealName: { fontSize: 14, fontWeight: '700', color: C.text1 },
  mealTime: { fontSize: 11, color: C.text3, marginTop: 1 },
  mealHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mealKcalBadge: { fontSize: 12, color: C.accent2, fontWeight: '600' },
  checkCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkCircleActive: { backgroundColor: C.accent2, borderColor: C.accent2 },
  mealLogRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  mealLogName: { flex: 1, fontSize: 13, color: C.text2 },
  mealLogKcal: { fontSize: 12, color: C.text3, marginRight: 8 },
  mealActions: { flexDirection: 'row', gap: 8, marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  mealActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: C.surface2 },
  mealActionBtnCoral: { backgroundColor: C.accent2Bg },
  mealActionText: { fontSize: 12, fontWeight: '600', color: C.accent },
  mealSuggestionBanner: { backgroundColor: C.accentBg, borderRadius: 10, padding: 10, marginBottom: 8 },
  mealSuggestionText: { fontSize: 13, color: C.text2, lineHeight: 18 },

  // Past unresolved workouts
  unresolvedCard: { borderWidth: 1, borderColor: C.accent2 + '55', borderRadius: 8, padding: 10, marginBottom: 8, backgroundColor: C.accent2 + '08' },
  unresolvedRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  unresolvedTitle: { fontSize: 13, fontWeight: '700', color: C.text1, flex: 1 },
  unresolvedDate: { fontSize: 11, color: C.text3, marginBottom: 8 },
  unresolvedBtns: { flexDirection: 'row', gap: 8 },
  unresolvedYes: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accent2, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  unresolvedYesText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  unresolvedSkip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: C.border },
  unresolvedSkipText: { fontSize: 12, color: C.text3 },
  unresolvedSkipRed: { borderColor: '#EF535066' },
  unresolvedSkipRedText: { fontSize: 12, color: '#EF5350', fontWeight: '600' },
  mealSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  mealSummaryLabel: { fontSize: 13, fontWeight: '700', color: C.text2 },
  mealSummaryValue: { fontSize: 13, fontWeight: '700', color: C.accent },

  // Quick add
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 14, color: C.text1 },
  catSection: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  catHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  catLabel: { fontSize: 13, fontWeight: '700', color: C.text2 },
  foodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, paddingHorizontal: 4 },
  foodRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.divider },
  foodName: { fontSize: 13, color: C.text1 },
  foodKcal: { fontSize: 12, color: C.text3 },
  browseBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingTop: 12, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  browseBtnText: { fontSize: 13, fontWeight: '600', color: C.accent },

  // Food log
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accent, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  addBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  logRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  logRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.divider },
  logName: { flex: 1, fontSize: 13, color: C.text1, fontWeight: '600' },
  logMeta: { fontSize: 11, color: C.text3 },
  logKcal: { fontSize: 12, color: C.text3, marginRight: 4 },
  logTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: C.divider },
  logTotalLabel: { fontSize: 13, fontWeight: '700', color: C.text2 },
  logTotalValue: { fontSize: 13, fontWeight: '700', color: C.accent2 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: C.overlay },
  addFormSheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, gap: 10 },
  addFormTitle: { fontSize: 16, fontWeight: '800', color: C.text1, marginBottom: 4 },
  addFormInput: { borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: C.text1, backgroundColor: C.surface2 },
  addFormMacroRow: { flexDirection: 'row', gap: 8 },
  addFormMacroInput: { flex: 1, paddingHorizontal: 10 },
  addFormBtn: { backgroundColor: C.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  addFormBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  addFormModeBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  addFormModeBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  addFormModeBtnText: { fontSize: 13, fontWeight: '700', color: C.text2 },
  saveToggleGroup: { gap: 8, marginTop: 4 },
  saveToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  saveToggleCheck: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  saveToggleCheckActive: { backgroundColor: C.accent, borderColor: C.accent },
  saveToggleLabel: { fontSize: 13, color: C.text2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qtyLabel: { fontSize: 13, color: C.text2, flex: 1 },
  qtyInput: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, color: C.text1, width: 80, textAlign: 'center', backgroundColor: C.surface2 },
  qtyPreview: { fontSize: 13, color: C.accent2, fontWeight: '600', textAlign: 'center' },

  // Preset picker
  pickerSheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: '70%' },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  pickerTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  pickerTitle: { fontSize: 17, fontWeight: '800', color: C.text1 },
  pickerRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  pickerRowSelected: { backgroundColor: C.accent + '0e' },
  pickerRowName: { fontSize: 14, fontWeight: '700', color: C.text1 },
  pickerRowMeta: { fontSize: 12, color: C.text3, marginTop: 2 },
  presetStepperRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  presetStepperBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  presetStepperQty: { fontSize: 17, fontWeight: '700', color: C.text1, minWidth: 32, textAlign: 'center' },
  presetStepperAdd: { flex: 1, backgroundColor: C.accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  presetStepperAddText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  pickerQtyRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider, marginTop: 4 },
  pickerQtyBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  pickerQtyNum:    { fontSize: 18, fontWeight: '800', color: C.text1, minWidth: 32, textAlign: 'center' },
  pickerAddBtn:    { flex: 1, backgroundColor: C.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  pickerAddBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Calorie breakdown modal
  breakdownSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36 },
  breakdownTitle: { fontSize: 17, fontWeight: '800', color: C.text1, marginBottom: 16 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  breakdownLabel: { fontSize: 14, color: C.text2 },
  breakdownValue: { fontSize: 14, fontWeight: '600', color: C.text1 },

  // My Meals
  mealPresetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  mealPresetName: { fontSize: 14, fontWeight: '700', color: C.text1 },
  mealPresetMeta: { fontSize: 12, color: C.text3, marginTop: 1 },

  // Meal builder
  builderHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.divider },
  builderHeaderTitle: { fontSize: 18, fontWeight: '800', color: C.text1 },
  builderScroll: { padding: 20, gap: 10, paddingBottom: 48 },
  builderScanBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingVertical: 10, borderWidth: 1, borderColor: C.accent, borderRadius: 12 },
  builderScanFrame: { flex: 1 },
  builderScanSheet: { flex: 1, padding: 20, justifyContent: 'center', gap: 8 },
  builderPermBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  builderSlotHeading: { fontSize: 13, fontWeight: '700', color: C.text2, marginTop: 8 },
  builderSlotRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  builderSlotCheck: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  builderSlotCheckActive: { backgroundColor: C.accent, borderColor: C.accent },
  builderSlotName: { flex: 1, fontSize: 14, color: C.text1 },
  builderItemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.divider },
  builderItemName: { flex: 1, fontSize: 13, color: C.text1 },
  builderItemKcal: { fontSize: 12, color: C.text3 },
  builderTotal: { fontSize: 12, color: C.accent2, fontWeight: '600' },
  builderResults: { maxHeight: 160, borderWidth: 1, borderColor: C.border, borderRadius: 10, marginTop: 4 },
  builderPendingBox: { backgroundColor: C.surface2, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.accent2Border, gap: 8 },
  builderPendingName: { fontSize: 13, fontWeight: '700', color: C.text1 },
  builderPendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  builderPendingLabel: { fontSize: 13, color: C.text2 },
  builderPendingInput: { borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 16, fontWeight: '700', color: C.text1, width: 64, textAlign: 'center', backgroundColor: C.surface },
  builderPendingKcal: { flex: 1, fontSize: 13, color: C.accent2, fontWeight: '600' },
  builderAddRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  builderAddBtn: { backgroundColor: C.accent2, borderRadius: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  builderFooter: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider, backgroundColor: C.bg },
  builderCancelBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  builderCancelBtnText: { fontSize: 15, fontWeight: '700', color: C.text2 },
  builderSaveBtn: { flex: 1, backgroundColor: C.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  builderSaveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Cycle tracker card
  cycleCard:         { backgroundColor: C.surface, borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(233,30,140,0.2)' },
  cycleHeaderRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cyclePhaseDot:     { width: 8, height: 8, borderRadius: 4 },
  cyclePhaseLabel:   { fontSize: 15, fontWeight: '700', color: C.text1 },
  cycleDayText:      { fontSize: 12, color: C.text3, marginLeft: 4 },
  cycleTrack:        { height: 6, backgroundColor: C.surface3, borderRadius: 3, marginBottom: 6, overflow: 'hidden' },
  cycleFill:         { height: 6, borderRadius: 3 },
  cycleBarWrapper:   { marginBottom: 10, paddingBottom: 22 },
  cycleSegBar:       { height: 10, borderRadius: 5, overflow: 'hidden', flexDirection: 'row' },
  cycleMarkerWrap:   { position: 'absolute', top: -4, alignItems: 'center', transform: [{ translateX: -9 }] },
  cycleMarkerDot:    { width: 18, height: 18, borderRadius: 9, backgroundColor: C.surface, borderWidth: 2.5, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, elevation: 4 },
  cycleMarkerLabel:  { fontSize: 10, color: C.text3, marginTop: 3, fontWeight: '600' },
  cyclePhaseDesc:    { fontSize: 12, color: C.text3, marginBottom: 8 },
  cycleMessage:      { fontSize: 13, fontStyle: 'italic', lineHeight: 19, marginBottom: 10, marginTop: 4 },
  cycleCoachRow:     { gap: 6, marginBottom: 10 },
  cycleCoachChip:    { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: C.surface2, borderRadius: 8, padding: 8 },
  cycleCoachChipText: { fontSize: 12, color: C.text2, flex: 1, lineHeight: 17 },
  cycleSeverityRow:  { flexDirection: 'row', gap: 8, marginTop: 4 },
  cycleSeverityBtn:  { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  cycleSeverityText: { fontSize: 13, fontWeight: '600', color: C.text2 },
  cycleEmpty:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cycleEmptyText:    { fontSize: 14, color: C.text3 },
  // Cycle modal
  cycleModalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  cycleModalTitle:    { fontSize: 18, fontWeight: '700', color: C.text1 },
  cycleModalLabel:    { fontSize: 14, fontWeight: '600', color: C.text2, marginBottom: 8 },
  cycleModalInput:    { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, fontSize: 16, color: C.text1 },
  cycleModalHint:     { fontSize: 12, color: C.text3, marginTop: 12, lineHeight: 18 },
  cycleModalSave:     { backgroundColor: C.accent, borderRadius: 14, padding: 16, alignItems: 'center' },
  cycleModalSaveText: { fontSize: 16, fontWeight: '700', color: C.white },
  cycleLenBtn:        { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  cycleLenBtnActive:  { borderColor: '#E91E8C', backgroundColor: 'rgba(233,30,140,0.06)' },
  cycleLenBtnText:    { fontSize: 14, color: C.text2, fontWeight: '500' },
  cycleLenBtnTextActive: { color: '#E91E8C', fontWeight: '700' },
  cycleTypeRow:       { flexDirection: 'row', gap: 10 },
  cycleTypeBtn:       { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface },
  cycleTypeBtnActive: { borderColor: '#E91E8C', backgroundColor: 'rgba(233,30,140,0.06)' },
  cycleTypeBtnText:   { fontSize: 15, fontWeight: '700', color: C.text1, marginBottom: 2 },
  cycleTypeBtnTextActive: { color: '#E91E8C' },
  cycleTypeBtnSub:    { fontSize: 12, color: C.text3 },
  cycleDateRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cycleDateField:     { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, fontSize: 18, color: C.text1, textAlign: 'center', fontWeight: '600' },
  cycleDateSep:       { fontSize: 20, color: C.text3, fontWeight: '300' },
})

const lw = StyleSheet.create({
  sheet:   { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, paddingBottom: 48 },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  title:   { fontSize: 18, fontWeight: '800', color: C.text1 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 10, marginTop: 20 },

  chipScroll: { marginHorizontal: -20, paddingLeft: 20 },
  chip:       { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface },
  chipActive: { borderColor: C.accent, backgroundColor: C.accent + '18' },
  chipText:       { fontSize: 14, fontWeight: '600', color: C.text2 },
  chipTextActive: { color: C.accent },

  durationRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  durationBtn:  { width: 44, height: 44, borderRadius: 22, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  durationInput: { fontSize: 48, fontWeight: '800', color: C.text1, minWidth: 80, textAlign: 'center' },

  intensityCard:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface, marginBottom: 8 },
  intensityCardActive: { borderColor: C.accent, backgroundColor: C.accent + '10' },
  intensityDot:        { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: C.border },
  intensityDotActive:  { borderColor: C.accent, backgroundColor: C.accent },
  intensityLabel:      { fontSize: 15, fontWeight: '700', color: C.text1 },
  intensityLabelActive: { color: C.accent },
  intensityDesc:  { fontSize: 12, color: C.text3, marginTop: 1 },
  intensityMet:   { fontSize: 12, fontWeight: '600', color: C.text3 },

  estimateCard:  { backgroundColor: C.surface2, borderRadius: 14, padding: 20, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: C.border },
  estimateLabel: { fontSize: 12, fontWeight: '600', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6 },
  estimateKcal:  { fontSize: 48, fontWeight: '900', color: C.accent, marginVertical: 4 },
  estimateNote:  { fontSize: 12, color: C.text3 },

  saveBtn:     { backgroundColor: C.accent, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  distanceInput: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 10, padding: 14,
    fontSize: 22, fontWeight: '700', color: C.text1, backgroundColor: C.surface,
  },
  modeToggleRow: { flexDirection: 'row', gap: 8, marginTop: 20, marginBottom: 4 },
  modeBtn:       { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface },
  modeBtnActive: { borderColor: C.accent, backgroundColor: C.accent + '18' },
  modeBtnText:       { fontSize: 14, fontWeight: '700', color: C.text2 },
  modeBtnTextActive: { color: C.accent },

  paceRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  paceInput: {
    width: 64, borderWidth: 1.5, borderColor: C.border, borderRadius: 10,
    padding: 12, fontSize: 22, fontWeight: '700', color: C.text1,
    backgroundColor: C.surface, textAlign: 'center',
  },
  paceSep:  { fontSize: 26, fontWeight: '800', color: C.text1 },
  paceUnit: { fontSize: 14, fontWeight: '600', color: C.text3, marginLeft: 4 },
  derivedDuration: { fontSize: 13, fontWeight: '600', color: C.accent, marginTop: 8 },
})

const loggerSt = StyleSheet.create({
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12, maxHeight: '88%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '800', color: C.text1 },
  tabBar: { flexDirection: 'row', backgroundColor: C.surface2, borderRadius: 10, padding: 3 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 8, gap: 5 },
  tabActive: { backgroundColor: C.accent },
  tabText: { fontSize: 12, fontWeight: '600', color: C.text3 },
  tabTextActive: { color: '#fff' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  resultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11, paddingHorizontal: 2 },
  resultRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  resultName: { fontSize: 13, color: C.text1, flex: 1 },
  resultMeta: { fontSize: 12, color: C.text3 },
  servingChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2 },
  servingChipActive: { backgroundColor: C.accent, borderColor: C.accent },
  servingChipText: { fontSize: 12, fontWeight: '600', color: C.text2 },
  portionDropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.surface2, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 11 },
  portionDropdownText: { fontSize: 14, fontWeight: '600', color: C.text1 },
  portionDropdownList: { backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, marginTop: 4, overflow: 'hidden' },
  portionDropdownItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.divider },
  portionDropdownItemText: { fontSize: 14, color: C.text1 },
})
