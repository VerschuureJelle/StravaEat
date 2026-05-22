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
import { W as C } from '../../lib/themeWarm'
import { AppDrawer, HamburgerBtn } from '../../components/DrawerNav'
import { COMMON_FOOD_CATEGORIES } from '../../lib/commonFoods'
import type { CommonFood } from '../../lib/commonFoods'
import type { FoodLog, MealTemplate, MealPreset, MealPresetItem } from '../../types'
import FoodPickerModal from '../../components/FoodPickerModal'

// ─── Local types ──────────────────────────────────────────────────────────────

interface TodayActivity { id: string; name: string; type: string; total_kcal: number }
interface PlannedWorkout { id: string; sport_type: string; target_kcal: number; workout_description: string | null }
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
  const [maxKcalTarget, setMaxKcalTarget] = useState<number | null>(null)
  const [hideCalories, setHideCalories] = useState(false)

  // Period
  const [onPeriod, setOnPeriod] = useState(false)
  const [periodSeverity, setPeriodSeverity] = useState<'minor' | 'medium' | 'severe' | null>(null)

  // Calories
  const [burnedKcal, setBurnedKcal] = useState(0)
  const [plannedKcal, setPlannedKcal] = useState(0)
  const [consumedKcal, setConsumedKcal] = useState(0)

  // Activities
  const [todayActivities, setTodayActivities] = useState<TodayActivity[]>([])
  const [plannedWorkouts, setPlannedWorkouts] = useState<PlannedWorkout[]>([])
  const [syncing, setSyncing] = useState(false)

  // Meals
  const [meals, setMeals] = useState<MealItem[]>([])
  const [presetsMap, setPresetsMap] = useState<Record<number, MealPreset[]>>({})
  const [pickerMeal, setPickerMeal] = useState<MealItem | null>(null)

  // Food log
  const [logs, setLogs] = useState<FoodLog[]>([])
  const [loading, setLoading] = useState(true)

  // Quick add
  const [quickAddItem, setQuickAddItem] = useState<CommonFood | null>(null)
  const [quickAddSearch, setQuickAddSearch] = useState('')
  const [customFoods, setCustomFoods] = useState<CustomFood[]>([])

  // Add form
  const [showAddForm, setShowAddForm] = useState(false)
  const [addMealIndex, setAddMealIndex] = useState<number | null>(null)
  const [foodName, setFoodName] = useState('')
  const [foodKcal, setFoodKcal] = useState('')
  const [foodProtein, setFoodProtein] = useState('')
  const [foodFat, setFoodFat] = useState('')
  const [foodCarb, setFoodCarb] = useState('')
  const [adding, setAdding] = useState(false)

  // Food picker
  const [foodPickerVisible, setFoodPickerVisible] = useState(false)

  // Calorie modal
  const [calorieModalOpen, setCalorieModalOpen] = useState(false)

  // My meals
  const [allPresets, setAllPresets] = useState<MealPreset[]>([])
  const [showMealBuilder, setShowMealBuilder] = useState(false)
  const [editingPreset, setEditingPreset] = useState<MealPreset | null>(null)
  const [myMealsExpanded, setMyMealsExpanded] = useState(true)
  const [todayLogExpanded, setTodayLogExpanded] = useState(true)

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

  useFocusEffect(useCallback(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('users').select('hide_calories').eq('id', user.id).single()
        .then(({ data }) => { if (data) setHideCalories(data.hide_calories ?? false) })
    })
  }, []))

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    setLoading(true)

    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

    const [profileRes, activitiesRes, plannedRes, logsRes, templatesRes, checksRes, presetsRes, customRes, allPresetsRes] = await Promise.all([
      supabase.from('users').select('name, avatar_url, sex, daily_kcal_target, max_kcal_target, hide_calories, on_period, period_severity').eq('id', user.id).single(),
      supabase.from('activities').select('id, name, type, total_kcal').eq('user_id', user.id).gte('date', todayStr).lt('date', tomorrow).not('total_kcal', 'is', null),
      supabase.from('planned_workouts').select('id, sport_type, target_kcal, workout_description').eq('user_id', user.id).eq('planned_for', todayStr),
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
    }

    const acts = (activitiesRes.data ?? []) as TodayActivity[]
    setTodayActivities(acts)
    setBurnedKcal(Math.round(acts.reduce((s, a) => s + (a.total_kcal ?? 0), 0)))

    const planned = (plannedRes.data ?? []) as PlannedWorkout[]
    setPlannedWorkouts(planned)
    setPlannedKcal(Math.round(planned.reduce((s, p) => s + p.target_kcal, 0)))

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

  async function syncStrava() {
    if (!userId || syncing) return
    setSyncing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      await supabase.functions.invoke('sync-recent', { headers: { Authorization: `Bearer ${session.access_token}` } })
      await load()
    } catch {
      Alert.alert('Sync failed', 'Could not connect to Strava. Try again.')
    } finally {
      setSyncing(false)
    }
  }

  // ── Food log actions ───────────────────────────────────────────────────────

  async function addFood(name: string, kcal: number, protein: number | null, fat: number | null, carb: number | null, mealIndex: number | null = null) {
    if (!userId) return
    const meal = mealIndex != null ? meals.find(m => m.meal_index === mealIndex) : null
    const { data: inserted } = await supabase.from('food_logs').insert({
      user_id: userId, date: todayStr, name, kcal,
      protein_g: protein, fat_g: fat, carb_g: carb,
      meal_index: mealIndex, meal_name: meal?.name ?? null,
    }).select('id, user_id, date, name, kcal, protein_g, fat_g, carb_g, meal_name, meal_index, logged_at').single()
    if (inserted) {
      setLogs(prev => [...prev, inserted as FoodLog])
      setConsumedKcal(prev => prev + inserted.kcal)
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

  async function submitAddForm() {
    const k = parseInt(foodKcal)
    if (!foodName.trim() || isNaN(k) || k <= 0) { Alert.alert('Invalid', 'Enter a name and calories.'); return }
    setAdding(true)
    await addFood(
      foodName.trim(), k,
      foodProtein ? parseFloat(foodProtein.replace(',', '.')) : null,
      foodFat ? parseFloat(foodFat.replace(',', '.')) : null,
      foodCarb ? parseFloat(foodCarb.replace(',', '.')) : null,
      addMealIndex,
    )
    setFoodName(''); setFoodKcal(''); setFoodProtein(''); setFoodFat(''); setFoodCarb('')
    setShowAddForm(false); setAddMealIndex(null)
    setAdding(false)
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
    // Optimistic update — flip immediately so the UI responds instantly
    setMeals(prev => prev.map(m =>
      m.meal_index === meal.meal_index ? { ...m, checked: !m.checked } : m
    ))
    try {
      if (meal.checked) {
        await supabase.from('meal_checks').delete().eq('user_id', userId).eq('meal_index', meal.meal_index).eq('date', todayStr)
      } else {
        await supabase.from('meal_checks').upsert({ user_id: userId, meal_index: meal.meal_index, date: todayStr }, { onConflict: 'user_id,meal_index,date' })
      }
    } catch {
      // Revert on failure
      setMeals(prev => prev.map(m =>
        m.meal_index === meal.meal_index ? { ...m, checked: meal.checked } : m
      ))
    }
  }

  async function addFromPicker(food: { name: string; kcal: number; protein_g: number | null; fat_g: number | null; carb_g: number | null; amount_label?: string | null }) {
    await addFood(food.name, food.kcal, food.protein_g, food.fat_g, food.carb_g, null)
    setFoodPickerVisible(false)
  }

  async function logMealBundle(preset: MealPreset) {
    if (!userId) return
    const items = preset.items ?? []
    if (!items.length) return
    const total = items.reduce((acc, it) => ({
      kcal: acc.kcal + it.kcal,
      protein: acc.protein + (it.protein_g ?? 0),
      fat: acc.fat + (it.fat_g ?? 0),
      carb: acc.carb + (it.carb_g ?? 0),
    }), { kcal: 0, protein: 0, fat: 0, carb: 0 })
    const { data: inserted } = await supabase.from('food_logs').insert({
      user_id: userId, date: todayStr,
      name: preset.name,
      kcal: total.kcal,
      protein_g: total.protein || null,
      fat_g: total.fat || null,
      carb_g: total.carb || null,
    }).select('id, user_id, date, name, kcal, protein_g, fat_g, carb_g, meal_name, meal_index, logged_at').single()
    if (inserted) {
      setLogs(prev => [...prev, inserted as FoodLog])
      setConsumedKcal(prev => prev + total.kcal)
    }
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

  const allCats = useMemo(() => {
    const knownCats = new Set(COMMON_FOOD_CATEGORIES.map(c => c.category))
    return [
      ...COMMON_FOOD_CATEGORIES.map(cat => ({
        category: cat.category,
        items: [
          ...customFoods.filter(f => f.category === cat.category) as CommonFood[],
          ...cat.items,
        ],
      })),
      ...[...new Set(customFoods.filter(f => f.category && !knownCats.has(f.category!)).map(f => f.category!))].map(cat => ({
        category: cat,
        items: customFoods.filter(f => f.category === cat) as CommonFood[],
      })),
    ]
  }, [customFoods])

  // ── UI ─────────────────────────────────────────────────────────────────────

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

          {/* ── Period banner ── */}
          {onPeriod && sex === 'female' && (
            <View style={st.periodBanner}>
              <Ionicons name="heart-outline" size={13} color="#E91E8C" />
              <Text style={st.periodBannerText}>
                Period active{periodSeverity && periodSeverity !== 'minor' ? ` · ${periodSeverity}` : ''} — target adjusted
              </Text>
            </View>
          )}

          {/* ── Calorie card ── */}
          <Pressable onPress={() => setCalorieModalOpen(true)} activeOpacity={0.92}>
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
                      <Text style={st.calorieLabelDark}>{status?.text ?? 'kcal today'}</Text>
                    </>
                  ) : (
                    <>
                      <Text style={st.calorieNum}>
                        {consumedKcal >= displayKcal
                          ? (consumedKcal > (displayMaxKcal ?? Infinity) ? '!' : '✓')
                          : (displayKcal - consumedKcal).toLocaleString()}
                      </Text>
                      <Text style={st.calorieLabelDark}>{status?.text ?? ''}</Text>
                    </>
                  )}
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

            {todayActivities.length === 0 && plannedWorkouts.length === 0 && (
              <Text style={st.emptyNote}>No activities today yet.</Text>
            )}

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
              <Text style={st.cardTitle}>Meals</Text>
              {meals.map(meal => {
                const presets = presetsMap[meal.meal_index] ?? []
                const mealLogs = logs.filter(l => l.meal_index === meal.meal_index)
                const mealKcal = mealLogs.reduce((s, l) => s + l.kcal, 0)
                return (
                  <View key={meal.meal_index} style={[st.mealCard, meal.checked && st.mealCardChecked]}>
                    <Pressable style={st.mealCardHeader} onPress={() => toggleMealCheck(meal)}>
                      <View>
                        <Text style={st.mealName}>{meal.name}</Text>
                        <Text style={st.mealTime}>{meal.scheduled_time}</Text>
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
                      <Pressable style={[st.mealActionBtn, st.mealActionBtnCoral]} onPress={() => { setAddMealIndex(meal.meal_index); setShowAddForm(true) }}>
                        <Ionicons name="add-outline" size={13} color={C.accent2} />
                        <Text style={[st.mealActionText, { color: C.accent2 }]}>Add food</Text>
                      </Pressable>
                    </View>
                  </View>
                )
              })}
            </View>
          )}

          {/* ── My Meals ── */}
          <View style={st.card}>
            <Pressable style={st.cardHeader} onPress={() => setMyMealsExpanded(v => !v)}>
              <Text style={st.cardTitle}>My Meals</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pressable style={st.addBtn} onPress={e => { e.stopPropagation?.(); setShowMealBuilder(true) }}>
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={st.addBtnText}>New</Text>
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
                  <Text style={st.emptyNote}>No meal presets yet — tap New to build one.</Text>
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

          {/* ── Quick add ── */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Quick add</Text>
            <View style={st.searchRow}>
              <Ionicons name="search-outline" size={15} color={C.text3} />
              <TextInput
                style={st.searchInput}
                value={quickAddSearch}
                onChangeText={setQuickAddSearch}
                placeholder="Search foods…"
                placeholderTextColor={C.text3}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>

            {quickAddSearch.trim() ? (() => {
              const q = quickAddSearch.toLowerCase()
              const hits = allCats.flatMap(c => c.items).filter(f => f.name.toLowerCase().includes(q))
              if (!hits.length) return <Text style={st.emptyNote}>No results for "{quickAddSearch}"</Text>
              return hits.map((food, i) => (
                <Pressable key={food.name + i} style={[st.foodRow, i < hits.length - 1 && st.foodRowBorder]}
                  onPress={() => setQuickAddItem(food)}>
                  <Text style={st.foodName}>{food.name}</Text>
                  {!hideCalories && <Text style={st.foodKcal}>{food.kcal} kcal</Text>}
                </Pressable>
              ))
            })() : allCats.map(cat => (
              <QuickAddCategory key={cat.category} cat={cat} hideCalories={hideCalories}
                onSelect={food => setQuickAddItem(food)} />
            ))}

            <Pressable style={st.browseBtn} onPress={() => setFoodPickerVisible(true)}>
              <Ionicons name="search-outline" size={14} color={C.accent} />
              <Text style={st.browseBtnText}>Browse all foods</Text>
            </Pressable>
          </View>

          {/* ── Today's log ── */}
          <View style={st.card}>
            <Pressable style={st.cardHeader} onPress={() => setTodayLogExpanded(v => !v)}>
              <Text style={st.cardTitle}>Today's log</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pressable style={st.addBtn} onPress={e => { e.stopPropagation?.(); setAddMealIndex(null); setShowAddForm(true) }}>
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={st.addBtnText}>Add</Text>
                </Pressable>
                <Ionicons
                  name={todayLogExpanded ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={C.text3}
                />
              </View>
            </Pressable>

            {todayLogExpanded && (
              <>
                {loading && <ActivityIndicator color={C.accent2} style={{ marginVertical: 12 }} />}
                {!loading && logs.length === 0 && <Text style={st.emptyNote}>Nothing logged yet today.</Text>}

                {logs.map((log, i) => (
                  <View key={log.id} style={[st.logRow, i < logs.length - 1 && st.logRowBorder]}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.logName} numberOfLines={1}>{log.name}</Text>
                      {log.meal_name && <Text style={st.logMeta}>{log.meal_name}</Text>}
                    </View>
                    {!hideCalories && <Text style={st.logKcal}>{log.kcal} kcal</Text>}
                    <Pressable onPress={() => deleteLog(log.id)} hitSlop={8} style={{ marginLeft: 8 }}>
                      <Ionicons name="trash-outline" size={15} color={C.danger} />
                    </Pressable>
                  </View>
                ))}

                {logs.length > 0 && !hideCalories && (
                  <View style={st.logTotal}>
                    <Text style={st.logTotalLabel}>Total eaten</Text>
                    <Text style={st.logTotalValue}>{consumedKcal.toLocaleString()} kcal</Text>
                  </View>
                )}
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

      {quickAddItem && (
        <QuickAddModal
          food={quickAddItem}
          hideCalories={hideCalories}
          onAdd={async (kcal, protein, fat, carb) => {
            await addFood(quickAddItem.name, kcal, protein, fat, carb, null)
            setQuickAddItem(null)
          }}
          onClose={() => setQuickAddItem(null)}
        />
      )}

      <Modal visible={showAddForm} transparent animationType="slide" onRequestClose={() => setShowAddForm(false)}>
        <Pressable style={st.modalOverlay} onPress={() => setShowAddForm(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ justifyContent: 'flex-end' }}>
          <View style={st.addFormSheet}>
            <Text style={st.addFormTitle}>
              {addMealIndex != null ? `Add to ${meals.find(m => m.meal_index === addMealIndex)?.name ?? 'meal'}` : 'Log food'}
            </Text>
            <TextInput style={st.addFormInput} value={foodName} onChangeText={setFoodName}
              placeholder="Food name" placeholderTextColor={C.text3} returnKeyType="next" />
            <TextInput style={st.addFormInput} value={foodKcal} onChangeText={setFoodKcal}
              placeholder="Calories (kcal)" placeholderTextColor={C.text3} keyboardType="numeric"
              returnKeyType="next" />
            <View style={st.addFormMacroRow}>
              <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={foodProtein}
                onChangeText={v => setFoodProtein(v.replace(',', '.'))}
                placeholder="Protein g" placeholderTextColor={C.text3} keyboardType="decimal-pad" returnKeyType="next" />
              <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={foodFat}
                onChangeText={v => setFoodFat(v.replace(',', '.'))}
                placeholder="Fat g" placeholderTextColor={C.text3} keyboardType="decimal-pad" returnKeyType="next" />
              <TextInput style={[st.addFormInput, st.addFormMacroInput]} value={foodCarb}
                onChangeText={v => setFoodCarb(v.replace(',', '.'))}
                placeholder="Carbs g" placeholderTextColor={C.text3} keyboardType="decimal-pad"
                returnKeyType="done" onSubmitEditing={submitAddForm} />
            </View>
            <Pressable style={[st.addFormBtn, adding && { opacity: 0.6 }]} onPress={submitAddForm} disabled={adding}>
              <Text style={st.addFormBtnText}>{adding ? 'Adding…' : 'Add to log'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {userId && (
        <FoodPickerModal
          visible={foodPickerVisible}
          userId={userId}
          onSelect={food => addFromPicker(food)}
          onClose={() => setFoodPickerVisible(false)}
        />
      )}

      {userId && (
        <MealBuilderModal
          visible={showMealBuilder || editingPreset != null}
          userId={userId}
          customFoods={customFoods}
          mealSlots={meals}
          editPreset={editingPreset ?? undefined}
          initialSlots={editingPreset ? presetSlotMap[editingPreset.id] : undefined}
          onSave={async () => { await refreshPresets(userId) }}
          onClose={() => { setShowMealBuilder(false); setEditingPreset(null) }}
        />
      )}
    </SafeAreaView>
  )
}

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

// ─── Quick add qty modal ───────────────────────────────────────────────────────

function parseGrams(label: string): number | null {
  const m = label.trim().match(/^(\d+(?:\.\d+)?)\s*(g|ml|kg|l)?$/i)
  return m ? parseFloat(m[1]) : null
}

function QuickAddModal({ food, hideCalories, onAdd, onClose }: {
  food: CommonFood & { amount_label?: string | null }
  hideCalories: boolean
  onAdd: (kcal: number, protein: number | null, fat: number | null, carb: number | null) => void
  onClose: () => void
}) {
  const defaultLabel = food.amount_label ?? '100g'
  const [servingLabel, setServingLabel] = useState(defaultLabel)
  const [qty, setQty] = useState('1')

  const q = parseFloat(qty) || 0
  const origGrams = parseGrams(defaultLabel)
  const curGrams = parseGrams(servingLabel)
  const servingScale = origGrams && curGrams ? curGrams / origGrams : 1
  const kcal = Math.round(food.kcal * q * servingScale)
  const protein = food.protein_g != null ? Math.round(food.protein_g * q * servingScale * 10) / 10 : null

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.modalOverlay} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ justifyContent: 'flex-end' }}>
        <View style={st.addFormSheet}>
          <Text style={st.addFormTitle}>{food.name}</Text>

          <View style={st.qtyRow}>
            <Text style={st.qtyLabel}>1 serving =</Text>
            <TextInput
              style={st.qtyInput}
              value={servingLabel}
              onChangeText={setServingLabel}
              placeholder="e.g. 100g"
              placeholderTextColor={C.text4}
              returnKeyType="next"
              selectTextOnFocus
            />
          </View>

          <View style={st.qtyRow}>
            <Text style={st.qtyLabel}>Number of servings</Text>
            <TextInput
              style={st.qtyInput}
              value={qty}
              onChangeText={v => setQty(v.replace(',', '.'))}
              keyboardType="decimal-pad"
              returnKeyType="done"
              autoFocus
              selectTextOnFocus
            />
          </View>

          {!hideCalories && q > 0 && (
            <Text style={st.qtyPreview}>
              {kcal} kcal{protein != null ? ` · ${protein}g protein` : ''}
            </Text>
          )}
          <Pressable style={[st.addFormBtn, q <= 0 && { opacity: 0.4 }]}
            onPress={() => q > 0 && onAdd(kcal, protein, null, null)} disabled={q <= 0}>
            <Text style={st.addFormBtnText}>Add to log</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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

function CalorieBreakdownModal({ visible, dailyTarget, burned, planned, consumed, displayMax, hideCalories, onClose }: {
  visible: boolean; dailyTarget: number | null; burned: number; planned: number
  consumed: number; displayMax: number | null; hideCalories: boolean; onClose: () => void
}) {
  const total = dailyTarget != null ? dailyTarget + burned + planned : null
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={st.modalOverlay} onPress={onClose} />
      <View style={st.breakdownSheet}>
        <Text style={st.breakdownTitle}>Today's calorie target</Text>
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
        {total != null && !hideCalories && (
          <View style={[st.breakdownRow, { marginTop: 4 }]}>
            <Text style={[st.breakdownLabel, { color: C.text2 }]}>Consumed so far</Text>
            <Text style={[st.breakdownValue, { color: C.text2 }]}>{consumed.toLocaleString()} kcal</Text>
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
    setItems(prev => [...prev, { name: `${scannedProduct.name} (${g}g)`, kcal, protein_g: null }])
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
})
