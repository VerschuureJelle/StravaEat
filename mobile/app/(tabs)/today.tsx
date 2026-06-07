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

interface TodayActivity { id: string; name: string; type: string; total_kcal: number }
interface PlannedWorkout { id: string; sport_type: string; target_kcal: number; workout_description: string | null; status: 'completed' | 'skipped' | null; is_key: boolean }
interface PastUnresolved { id: string; sport_type: string; target_kcal: number; workout_description: string | null; planned_for: string; is_key: boolean; distance_m: number | null; target_duration_min: number | null }
interface MealItem {
  meal_index: number; name: string; scheduled_time: string; checked: boolean
  kcal: number | null; protein_g: number | null; fat_g: number | null; carb_g: number | null
}
interface CustomFood { id: string; name: string; kcal: number; protein_g: number | null; fat_g: number | null; carb_g: number | null; amount_label: string | null; category: string | null }

// ─── Sport colours ────────────────────────────────────────────────────────────

function sportColor(type: string) {
  const t = type.toLowerCase()
  if (t.includes('swim')) return C.swim
  if (t.includes('run') || t.includes('jog')) return C.run
  if (t.includes('walk')) return C.walk
  if (t.includes('ride') || t.includes('bike') || t.includes('cycling') || t.includes('virtual')) return C.ride
  return C.sport
}

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
  const [cycleType, setCycleType] = useState<'regular' | 'irregular'>('regular')
  const [lastPeriodStart, setLastPeriodStart] = useState<string | null>(null)
  const [showCycleModal, setShowCycleModal] = useState(false)
  const [cycleLengthDraft, setCycleLengthDraft] = useState('28')
  const [periodLengthDraft, setPeriodLengthDraft] = useState('5')
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
        .select('hide_calories, daily_kcal_target, max_kcal_target, meal_notif_delay_min, cycle_length, period_length, cycle_type, last_period_start, on_period, period_severity')
        .eq('id', user.id).single()
        .then(({ data }) => {
          if (!data) return
          setHideCalories(data.hide_calories ?? false)
          setDailyTarget(data.daily_kcal_target)
          setMaxKcalTarget(data.max_kcal_target)
          setMealNotifDelayMin(data.meal_notif_delay_min ?? 60)
          setCycleLength(data.cycle_length ?? 28)
          setPeriodLength(data.period_length ?? 5)
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
      supabase.from('users').select('name, avatar_url, sex, daily_kcal_target, max_kcal_target, hide_calories, on_period, period_severity, meal_notif_delay_min, cycle_length, period_length, cycle_type, last_period_start').eq('id', user.id).single(),
      supabase.from('activities').select('id, name, type, total_kcal').eq('user_id', user.id).gte('date', todayStr).lt('date', tomorrow).not('total_kcal', 'is', null),
      supabase.from('planned_workouts').select('id, sport_type, target_kcal, workout_description, status, is_key').eq('user_id', user.id).eq('planned_for', todayStr),
      supabase.from('food_logs').select('id, user_id, date, name, kcal, protein_g, fat_g, carb_g, meal_name, meal_index, logged_at').eq('user_id', user.id).eq('date', todayStr).order('logged_at'),
      supabase.from('meal_templates').select('id, meal_index, name, scheduled_time, kcal, protein_g, fat_g, carb_g').eq('user_id', user.id).order('meal_index'),
      supabase.from('meal_checks').select('meal_index').eq('user_id', user.id).eq('date', todayStr),
      supabase.from('meal_slot_presets').select('meal_index, sort_order, preset:meal_presets(*, items:meal_preset_items(*))').eq('user_id', user.id).order('sort_order'),
      supabase.from('custom_foods').select('id, name, kcal, protein_g, fat_g, carb_g, amount_label, category').eq('user_id', user.id),
      supabase.from('meal_presets').select('id, name, sort_order, items:meal_preset_items(id, preset_id, name, kcal, protein_g, fat_g, carb_g, amount_label, sort_order)').eq('user_id', user.id).order('name'),
    ])

    if (profileRes.data) {
      setUserName(profileRes.data.name)
      setAvatarUrl(profileRes.data.avatar_url ?? null)
      setSex(profileRes.data.sex ?? null)
      setDailyTarget(profileRes.data.daily_kcal_target)
      setMaxKcalTarget(profileRes.data.max_kcal_target)
      setHideCalories(profileRes.data.hide_calories ?? false)
      setOnPeriod(profileRes.data.on_period ?? false)
      setPeriodSeverity(profileRes.data.period_severity ?? null)
      setMealNotifDelayMin(profileRes.data.meal_notif_delay_min ?? 60)
      const cl = profileRes.data.cycle_length ?? 28
      const pl = profileRes.data.period_length ?? 5
      const ct: 'regular' | 'irregular' = profileRes.data.cycle_type ?? 'regular'
      const lps: string | null = profileRes.data.last_period_start ?? null
      setCycleLength(cl)
      setPeriodLength(pl)
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
    })))

    const pMap: Record<number, MealPreset[]> = {}
    for (const row of (presetsRes.data ?? []) as any[]) {
      if (!row.preset) continue
      if (!pMap[row.meal_index]) pMap[row.meal_index] = []
      pMap[row.meal_index].push(row.preset as MealPreset)
    }
    setPresetsMap(pMap)

    setCustomFoods((customRes.data ?? []) as CustomFood[])
    setAllPresets((allPresetsRes.data ?? []) as MealPreset[])
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

  // ── Food log actions ───────────────────────────────────────────────────────

  async function addFood(name: string, kcal: number, protein: number | null, fat: number | null, carb: number | null, mealIndex: number | null = null) {
    if (!userId) return

    // Stack duplicate entries: query DB directly to avoid stale-closure issues with logs state.
    const { data: existingRows } = await supabase
      .from('food_logs')
      .select('id, name, kcal, protein_g, fat_g, carb_g, meal_index')
      .eq('user_id', userId)
      .eq('date', todayStr)

    const existing = (existingRows ?? []).find(l => {
      if (l.meal_index !== mealIndex) return false
      const m = l.name.match(/^(\d+)× (.+)$/)
      return (m ? m[2] : l.name) === name
    })

    if (existing) {
      const prevCount = existing.name.match(/^(\d+)× /)
      const count = prevCount ? parseInt(prevCount[1]) : 1
      const newName = `${count + 1}× ${name}`
      const newKcal = existing.kcal + kcal
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
      user_id: userId, date: todayStr, name, kcal,
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
            { user_id: userId, meal_index: mealIndex, date: todayStr },
            { onConflict: 'user_id,meal_index,date' }
          ),
          cancelMealNotification(mealIndex!),
        ])
      }
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

  async function logPreset(preset: MealPreset, meal: MealItem) {
    if (!userId) return
    const items = preset.items ?? []
    const total = items.reduce((acc, it) => ({
      kcal: acc.kcal + it.kcal,
      protein: acc.protein + (it.protein_g ?? 0),
      fat: acc.fat + (it.fat_g ?? 0),
      carb: acc.carb + (it.carb_g ?? 0),
    }), { kcal: 0, protein: 0, fat: 0, carb: 0 })
    const [logRes] = await Promise.all([
      supabase.from('food_logs').insert({
        user_id: userId, date: todayStr,
        name: preset.name,
        kcal: total.kcal,
        protein_g: total.protein || null,
        fat_g: total.fat || null,
        carb_g: total.carb || null,
        meal_index: meal.meal_index, meal_name: meal.name,
      }).select('id, user_id, date, name, kcal, protein_g, fat_g, carb_g, meal_name, meal_index, logged_at').single(),
      supabase.from('meal_checks').upsert({ user_id: userId, meal_index: meal.meal_index, date: todayStr }, { onConflict: 'user_id,meal_index,date' }),
    ])
    if (logRes.data) {
      setLogs(prev => [...prev, logRes.data as FoodLog])
      setConsumedKcal(prev => prev + total.kcal)
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
        if (meal.scheduled_time) {
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
    const total = items.reduce((acc, it) => ({
      kcal: acc.kcal + it.kcal,
      protein: acc.protein + (it.protein_g ?? 0),
      fat: acc.fat + (it.fat_g ?? 0),
      carb: acc.carb + (it.carb_g ?? 0),
    }), { kcal: 0, protein: 0, fat: 0, carb: 0 })
    const meal = mealIndex != null ? meals.find(m => m.meal_index === mealIndex) : null
    const { data: inserted, error } = await supabase.from('food_logs').insert({
      user_id: userId, date: todayStr,
      name: preset.name,
      kcal: total.kcal,
      protein_g: total.protein || null,
      fat_g: total.fat || null,
      carb_g: total.carb || null,
      meal_index: mealIndex,
      meal_name: meal?.name ?? null,
    }).select('id, user_id, date, name, kcal, protein_g, fat_g, carb_g, meal_name, meal_index, logged_at').single()
    if (error) { Alert.alert('Error', error.message); return }
    if (inserted) {
      setLogs(prev => [...prev, inserted as FoodLog])
      setConsumedKcal(prev => prev + total.kcal)
    }
  }

  async function saveCustomFood(name: string, kcal: number, protein: number | null, fat: number | null, carb: number | null) {
    if (!userId) return
    const { data } = await supabase.from('custom_foods').insert({
      user_id: userId, name, kcal, protein_g: protein, fat_g: fat, carb_g: carb,
    }).select('id, name, kcal, protein_g, fat_g, carb_g, amount_label, category').single()
    if (data) setCustomFoods(prev => [...prev, data as CustomFood])
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
      // Without a known cycle length we only know we're in a post-menstrual phase
      return { label: 'Post-menstrual', color: '#66BB6A', description: 'Recovery phase' }
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
    const isLateLuteal = cycleType === 'regular' && day >= cycleLength - 6
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
                    {cycleType === 'regular'
                      ? <Text style={st.cycleDayText}>Day {cycleDay} of {cycleLength}</Text>
                      : <Text style={st.cycleDayText}>Day {cycleDay}</Text>
                    }
                    <Ionicons name="chevron-forward" size={14} color={C.text3} style={{ marginLeft: 'auto' }} />
                  </View>
                  {cycleType === 'regular' && (
                    <View style={st.cycleTrack}>
                      <View style={[st.cycleFill, { width: `${Math.round((cycleDay / cycleLength) * 100)}%` as any, backgroundColor: phase.color }]} />
                    </View>
                  )}

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
                    <>
                      <View style={st.progressTrack}>
                        <View style={[st.progressFill, { width: `${Math.round(barPct * 100)}%` as any }]} />
                      </View>
                      <Text style={st.calorieLabelDark}>
                        {consumedKcal > (displayMaxKcal ?? Infinity)
                          ? 'You\'ve exceeded your daily maximum'
                          : consumedKcal >= displayKcal
                            ? 'Daily target reached'
                            : `You're at ${Math.round(barPct * 100)}% of your daily goal`}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={st.calorieNum}>
                        {consumedKcal >= displayKcal
                          ? (consumedKcal > (displayMaxKcal ?? Infinity) ? '!' : '✓')
                          : (displayKcal - consumedKcal).toLocaleString()}
                      </Text>
                      <Text style={st.calorieLabelDark}>{status?.text ?? ''}</Text>
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
                  <Text style={st.activityType}>{a.type}</Text>
                </View>
                {!hideCalories && <Text style={st.activityKcal}>+{Math.round(a.total_kcal).toLocaleString()} kcal</Text>}
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
        onClose={() => setCalorieModalOpen(false)}
      />

      {pickerMeal && (
        <MealPresetPickerModal
          meal={pickerMeal}
          presets={presetsMap[pickerMeal.meal_index] ?? []}
          onSelect={preset => logPreset(preset, pickerMeal)}
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
        onAdd={async (name, kcal, protein, fat, carb, mealIdx) => {
          await addFood(name, kcal, protein, fat, carb, mealIdx)
        }}
        onLogPreset={(preset) => logMealBundle(preset, foodLoggerMealIndex)}
        onSaveToMyFoods={saveCustomFood}
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
                const len = parseInt(cycleLengthDraft) || 28
                const pLen = parseInt(periodLengthDraft) || 5
                setCycleLength(len)
                setPeriodLength(pLen)
                setCycleType(cycleTypeDraft)
                setLastPeriodStart(isoDate)
                if (userId) {
                  await supabase.from('users').update({
                    cycle_length: len,
                    period_length: pLen,
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
  onAdd: (name: string, kcal: number, protein: number | null, fat: number | null, carb: number | null, mealIdx: number | null) => Promise<void>
  onLogPreset: (preset: MealPreset) => Promise<void>
  onSaveToMyFoods: (name: string, kcal: number, protein: number | null, fat: number | null, carb: number | null) => Promise<void>
  onSaveAsPreset: (name: string, kcal: number, protein: number | null, fat: number | null, carb: number | null) => Promise<void>
  onClose: () => void
}) {
  const [tab, setTab] = useState<'search' | 'scan' | 'manual'>('search')
  const [search, setSearch] = useState('')
  const [pendingFood, setPendingFood] = useState<(CommonFood & { amount_label?: string | null }) | null>(null)
  const [servingLabel, setServingLabel] = useState('')
  const [servingQty, setServingQty] = useState('1')
  const [scannedProduct, setScannedProduct] = useState<{
    name: string; kcalPer100g: number
    proteinPer100g: number | null; fatPer100g: number | null; carbPer100g: number | null
  } | null>(null)
  const [scanAmount, setScanAmount] = useState('100')
  const [scanServings, setScanServings] = useState('1')
  const [scanLoading, setScanLoading] = useState(false)
  const lastScannedRef = useRef<string | null>(null)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [manualName, setManualName] = useState('')
  const [manualKcal, setManualKcal] = useState('')
  const [manualProtein, setManualProtein] = useState('')
  const [manualFat, setManualFat] = useState('')
  const [manualCarb, setManualCarb] = useState('')
  const [adding, setAdding] = useState(false)
  const [saveToMyFoods, setSaveToMyFoods] = useState(false)
  const [saveAsPreset, setSaveAsPreset] = useState(false)
  const insets = useSafeAreaInsets()
  useEffect(() => {
    if (!visible) {
      setTab('search'); setSearch(''); setPendingFood(null)
      setScannedProduct(null); lastScannedRef.current = null
      setManualName(''); setManualKcal(''); setManualProtein(''); setManualFat(''); setManualCarb('')
      setSaveToMyFoods(false); setSaveAsPreset(false)
    }
  }, [visible])

  const searchResults = useMemo(() => {
    const q = search.trim()
    if (!q) return []
    const customHits = customFoods.filter(f => fuzzyFoodMatch(f.name, q))
    const commonHits = COMMON_FOOD_CATEGORIES.flatMap(c => c.items).filter(f => fuzzyFoodMatch(f.name, q))
    return [...customHits, ...commonHits].slice(0, 20) as (CommonFood & { amount_label?: string | null })[]
  }, [search, customFoods])

  function selectFood(food: CommonFood & { amount_label?: string | null }) {
    setPendingFood(food)
    setServingLabel(defaultServingLabel(food))
    setServingQty('1')
    setSearch('')
  }

  async function confirmPending() {
    if (!pendingFood) return
    const qty = parseFloat(servingQty) || 0
    if (qty <= 0) return
    const origGrams = parseGrams(defaultServingLabel(pendingFood))
    const curGrams = parseGrams(servingLabel)
    const scale = origGrams && curGrams ? curGrams / origGrams : 1
    const kcal = Math.round(pendingFood.kcal * qty * scale)
    const protein = pendingFood.protein_g != null ? Math.round(pendingFood.protein_g * qty * scale * 10) / 10 : null
    const fat = pendingFood.fat_g != null ? Math.round(pendingFood.fat_g * qty * scale * 10) / 10 : null
    const carb = pendingFood.carb_g != null ? Math.round(pendingFood.carb_g * qty * scale * 10) / 10 : null
    setAdding(true)
    await onAdd(pendingFood.name, kcal, protein, fat, carb, mealIndex)
    setAdding(false)
    setPendingFood(null)
    onClose()
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
        const n = p.nutriments ?? {}
        setScannedProduct({
          name,
          kcalPer100g: Math.round(n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0),
          proteinPer100g: n['proteins_100g'] ?? null,
          fatPer100g: n['fat_100g'] ?? null,
          carbPer100g: n['carbohydrates_100g'] ?? null,
        })
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
    const name = scannedProduct.name
    const kcal = Math.round(scannedProduct.kcalPer100g * r)
    const protein = scannedProduct.proteinPer100g != null ? Math.round(scannedProduct.proteinPer100g * r * 10) / 10 : null
    const fat = scannedProduct.fatPer100g != null ? Math.round(scannedProduct.fatPer100g * r * 10) / 10 : null
    const carb = scannedProduct.carbPer100g != null ? Math.round(scannedProduct.carbPer100g * r * 10) / 10 : null
    setAdding(true)
    await onAdd(name, kcal, protein, fat, carb, mealIndex)
    if (saveToMyFoods) await onSaveToMyFoods(name, kcal, protein, fat, carb)
    setAdding(false)
    setSaveToMyFoods(false)
    setScannedProduct(null); lastScannedRef.current = null
    onClose()
  }

  async function submitManual() {
    const k = parseInt(manualKcal)
    if (!manualName.trim() || isNaN(k) || k <= 0) { Alert.alert('Invalid', 'Enter a name and calories.'); return }
    const name = manualName.trim()
    const protein = manualProtein ? parseFloat(manualProtein.replace(',', '.')) : null
    const fat = manualFat ? parseFloat(manualFat.replace(',', '.')) : null
    const carb = manualCarb ? parseFloat(manualCarb.replace(',', '.')) : null
    setAdding(true)
    await onAdd(name, k, protein, fat, carb, mealIndex)
    await Promise.all([
      saveToMyFoods ? onSaveToMyFoods(name, k, protein, fat, carb) : Promise.resolve(),
      saveAsPreset  ? onSaveAsPreset(name, k, protein, fat, carb)  : Promise.resolve(),
    ])
    setAdding(false)
    setManualName(''); setManualKcal(''); setManualProtein(''); setManualFat(''); setManualCarb('')
    setSaveToMyFoods(false); setSaveAsPreset(false)
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
                  {pendingFood ? (
                    <View style={{ gap: 10 }}>
                      <Text style={loggerSt.sectionLabel}>{pendingFood.name}</Text>
                      <View style={st.qtyRow}>
                        <Text style={st.qtyLabel}>1 serving =</Text>
                        <TextInput
                          style={st.qtyInput}
                          value={servingLabel}
                          onChangeText={setServingLabel}
                          placeholder="e.g. 100g"
                          placeholderTextColor={C.text3}
                          returnKeyType="next"
                          selectTextOnFocus
                        />
                      </View>
                      <View style={st.qtyRow}>
                        <Text style={st.qtyLabel}>Number of servings</Text>
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
                      {!hideCalories && parseFloat(servingQty) > 0 && (() => {
                        const qty = parseFloat(servingQty) || 0
                        const origG = parseGrams(defaultServingLabel(pendingFood))
                        const curG = parseGrams(servingLabel)
                        const scale = origG && curG ? curG / origG : 1
                        return <Text style={st.qtyPreview}>{Math.round(pendingFood.kcal * qty * scale)} kcal</Text>
                      })()}
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                        <Pressable style={[st.addFormBtn, { flex: 1, backgroundColor: C.surface2 }]} onPress={() => setPendingFood(null)}>
                          <Text style={[st.addFormBtnText, { color: C.text2 }]}>Back</Text>
                        </Pressable>
                        <Pressable
                          style={[st.addFormBtn, { flex: 1 }, (adding || parseFloat(servingQty) <= 0) && { opacity: 0.5 }]}
                          onPress={confirmPending}
                          disabled={adding || parseFloat(servingQty) <= 0}
                        >
                          <Text style={st.addFormBtnText}>{adding ? 'Adding…' : 'Add to log'}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
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
                        searchResults.length > 0 ? (
                          searchResults.map((food, i) => (
                            <Pressable key={food.name + i} style={[loggerSt.resultRow, i > 0 && loggerSt.resultRowBorder]} onPress={() => selectFood(food)}>
                              <Text style={loggerSt.resultName}>{food.name}</Text>
                              {!hideCalories && <Text style={loggerSt.resultMeta}>{food.kcal} kcal</Text>}
                            </Pressable>
                          ))
                        ) : (
                          <Text style={st.emptyNote}>No results for "{search}"</Text>
                        )
                      ) : (
                        <>
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
                    <Text style={loggerSt.sectionLabel}>{scannedProduct.name}</Text>
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
                      <Pressable style={[st.addFormBtn, { flex: 1, backgroundColor: C.surface2 }]} onPress={() => { setScannedProduct(null); lastScannedRef.current = null; setSaveToMyFoods(false) }}>
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
                    <TextInput style={st.addFormInput} value={manualName} onChangeText={setManualName}
                      placeholder="Food name" placeholderTextColor={C.text3} returnKeyType="next" autoFocus />
                    <TextInput style={st.addFormInput} value={manualKcal} onChangeText={setManualKcal}
                      placeholder="Calories (kcal)" placeholderTextColor={C.text3} keyboardType="numeric" returnKeyType="next" />
                    <Text style={loggerSt.sectionLabel}>Macros (optional)</Text>
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

function MealPresetPickerModal({ meal, presets, onSelect, onManage, onClose }: {
  meal: MealItem; presets: MealPreset[]
  onSelect: (p: MealPreset) => void; onManage: () => void; onClose: () => void
}) {
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
        <Text style={{ fontSize: 13, color: C.text2, marginBottom: 14 }}>Choose a preset</Text>
        <ScrollView>
          {presets.map(preset => {
            const total = (preset.items ?? []).reduce((acc, it) => acc + it.kcal, 0)
            return (
              <Pressable key={preset.id} style={st.pickerRow} onPress={() => onSelect(preset)}>
                <View style={{ flex: 1 }}>
                  <Text style={st.pickerRowName}>{preset.name}</Text>
                  <Text style={st.pickerRowMeta}>{(preset.items ?? []).length} items · {total} kcal</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={C.text3} />
              </Pressable>
            )
          })}
        </ScrollView>
      </View>
    </Modal>
  )
}

// ─── Calorie breakdown modal ───────────────────────────────────────────────────

function CalorieBreakdownModal({ visible, dailyTarget, burned, planned, consumed, displayMax, hideCalories, logs, userId, onDeleteLog, onClose }: {
  visible: boolean; dailyTarget: number | null; burned: number; planned: number
  consumed: number; displayMax: number | null; hideCalories: boolean
  logs: FoodLog[]; userId: string | null; onDeleteLog: (id: string) => void; onClose: () => void
}) {
  const todayStr = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [historyLogs, setHistoryLogs] = useState<FoodLog[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
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
    if (next <= todayStr) setSelectedDate(next)
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
              {isToday && (
                <Pressable onPress={() => onDeleteLog(log.id)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={15} color={C.danger} />
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
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
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  pickerRowName: { fontSize: 14, fontWeight: '700', color: C.text1 },
  pickerRowMeta: { fontSize: 12, color: C.text3, marginTop: 2 },

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
})
