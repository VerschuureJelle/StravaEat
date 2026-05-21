import { useState, useCallback, useRef } from 'react'
import {
  View, Text, ScrollView, StyleSheet, Pressable, TextInput,
  Modal, Alert, Platform, KeyboardAvoidingView, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { supabase } from '../../lib/supabase'
import { C } from '../../lib/theme'
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

// ─── Sport colours / icons ────────────────────────────────────────────────────

function sportColor(type: string) {
  const t = type.toLowerCase()
  if (t.includes('swim')) return '#29B6F6'
  if (t.includes('run') || t.includes('jog')) return '#EF5350'
  if (t.includes('walk')) return '#FF8A65'
  if (t.includes('ride') || t.includes('bike') || t.includes('cycling') || t.includes('virtual')) return '#66BB6A'
  return '#90A4AE'
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function TodayScreen() {
  const router = useRouter()

  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string | null>(null)

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
  const [checking, setChecking] = useState<number | null>(null)

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
  const [adding, setAdding] = useState(false)

  // Food picker
  const [foodPickerVisible, setFoodPickerVisible] = useState(false)

  // Calorie modal
  const [calorieModalOpen, setCalorieModalOpen] = useState(false)

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

  // ── Load ───────────────────────────────────────────────────────────────────

  useFocusEffect(useCallback(() => { load() }, []))

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    setLoading(true)

    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

    const [profileRes, activitiesRes, plannedRes, logsRes, templatesRes, checksRes, presetsRes, customRes] = await Promise.all([
      supabase.from('users').select('name, daily_kcal_target, max_kcal_target, hide_calories, on_period, period_severity').eq('id', user.id).single(),
      supabase.from('activities').select('id, name, type, total_kcal').eq('user_id', user.id).gte('date', todayStr).lt('date', tomorrow).not('total_kcal', 'is', null),
      supabase.from('planned_workouts').select('id, sport_type, target_kcal, workout_description').eq('user_id', user.id).eq('planned_for', todayStr),
      supabase.from('food_logs').select('*').eq('user_id', user.id).eq('date', todayStr).order('logged_at'),
      supabase.from('meal_templates').select('*').eq('user_id', user.id).order('meal_index'),
      supabase.from('meal_checks').select('meal_index').eq('user_id', user.id).eq('date', todayStr),
      supabase.from('meal_slot_presets').select('meal_index, sort_order, preset:meal_presets(*, items:meal_preset_items(*))').eq('user_id', user.id).order('sort_order'),
      supabase.from('custom_foods').select('*').eq('user_id', user.id),
    ])

    if (profileRes.data) {
      setUserName(profileRes.data.name)
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
    await supabase.from('food_logs').insert({
      user_id: userId, date: todayStr, name, kcal,
      protein_g: protein, fat_g: fat, carb_g: carb,
      meal_index: mealIndex, meal_name: meal?.name ?? null,
    })
    await load()
  }

  async function deleteLog(id: string) {
    const entry = logs.find(l => l.id === id)
    Alert.alert('Remove entry?', `Remove "${entry?.name ?? 'this entry'}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        await supabase.from('food_logs').delete().eq('id', id)
        await load()
      }},
    ])
  }

  async function submitAddForm() {
    const k = parseInt(foodKcal)
    if (!foodName.trim() || isNaN(k) || k <= 0) { Alert.alert('Invalid', 'Enter a name and calories.'); return }
    setAdding(true)
    await addFood(foodName.trim(), k, foodProtein ? parseFloat(foodProtein) : null, null, null, addMealIndex)
    setFoodName(''); setFoodKcal(''); setFoodProtein('')
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
    await supabase.from('food_logs').insert({
      user_id: userId, date: todayStr,
      name: preset.name,
      kcal: total.kcal,
      protein_g: total.protein || null,
      fat_g: total.fat || null,
      carb_g: total.carb || null,
      meal_index: meal.meal_index, meal_name: meal.name,
    })
    await supabase.from('meal_checks').upsert({ user_id: userId, meal_index: meal.meal_index, date: todayStr }, { onConflict: 'user_id,meal_index,date' })
    setPickerMeal(null)
    await load()
  }

  async function toggleMealCheck(meal: MealItem) {
    if (!userId || checking === meal.meal_index) return
    setChecking(meal.meal_index)
    if (meal.checked) {
      await supabase.from('meal_checks').delete().eq('user_id', userId).eq('meal_index', meal.meal_index).eq('date', todayStr)
    } else {
      await supabase.from('meal_checks').upsert({ user_id: userId, meal_index: meal.meal_index, date: todayStr }, { onConflict: 'user_id,meal_index,date' })
    }
    setChecking(null)
    await load()
  }

  async function addFromPicker(food: { name: string; kcal: number; protein_g: number | null; fat_g: number | null; carb_g: number | null; amount_label?: string | null }) {
    await addFood(food.name, food.kcal, food.protein_g, food.fat_g, food.carb_g, null)
    setFoodPickerVisible(false)
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function calorieStatusLabel() {
    if (displayKcal == null) return null
    const isOver = consumedKcal >= displayKcal
    const isExceeded = displayMaxKcal != null && consumedKcal > displayMaxKcal
    if (isExceeded) return { text: 'Daily maximum exceeded', color: '#FF8A80' }
    if (isOver) return { text: 'Daily minimum reached', color: '#A5D6A7' }
    return { text: `${(displayKcal - consumedKcal).toLocaleString()} kcal remaining`, color: 'rgba(255,255,255,0.9)' }
  }

  const status = calorieStatusLabel()
  const barPct = displayKcal ? Math.min(consumedKcal / Math.max(displayKcal, 1), 1) : 0

  // ── UI ─────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={st.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">

          {/* ── Gradient header ── */}
          <LinearGradient colors={['#1A1040', '#2D1B69', '#1A2980']} style={st.hero}>

            {/* Top row: greeting + settings */}
            <View style={st.heroTopRow}>
              <View>
                <Text style={st.heroGreeting}>{greeting}{userName ? `, ${userName.split(' ')[0]}` : ''}</Text>
                <Text style={st.heroDate}>{dateLabel}</Text>
              </View>
              <Pressable onPress={() => router.push('/(tabs)/settings')} hitSlop={10}>
                <Ionicons name="settings-outline" size={22} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </View>

            {/* Period banner */}
            {onPeriod && (
              <View style={st.periodBanner}>
                <Ionicons name="heart-outline" size={13} color="#F48FB1" />
                <Text style={st.periodBannerText}>
                  Period active{periodSeverity && periodSeverity !== 'minor' ? ` · ${periodSeverity}` : ''} — target adjusted
                </Text>
              </View>
            )}

            {/* Calorie display */}
            <Pressable style={st.calorieBlock} onPress={() => setCalorieModalOpen(true)}>
              {displayKcal != null ? (
                <>
                  {hideCalories ? (
                    <>
                      <View style={st.progressTrack}>
                        <View style={[st.progressFill, { width: `${Math.round(barPct * 100)}%` as any }]} />
                      </View>
                      <Text style={[st.calorieLabel, status && { color: status.color }]}>{status?.text ?? 'kcal today'}</Text>
                    </>
                  ) : (
                    <>
                      <Text style={[st.calorieNum, status?.color !== 'rgba(255,255,255,0.9)' && status && { color: status.color }]}>
                        {consumedKcal >= displayKcal ? (consumedKcal > (displayMaxKcal ?? Infinity) ? '!' : '✓') : (displayKcal - consumedKcal).toLocaleString()}
                      </Text>
                      <Text style={[st.calorieLabel, status && { color: status.color }]}>{status?.text ?? ''}</Text>
                    </>
                  )}

                  <View style={st.calorieBreakdown}>
                    {dailyTarget != null && <Text style={st.breakdownChip}>{dailyTarget.toLocaleString()} baseline</Text>}
                    {burnedKcal > 0 && <Text style={st.breakdownChip}>+{burnedKcal.toLocaleString()} burned</Text>}
                    {plannedKcal > 0 && <Text style={st.breakdownChip}>+{plannedKcal.toLocaleString()} planned</Text>}
                    <Text style={[st.breakdownChip, { color: '#B39DDB' }]}>{consumedKcal.toLocaleString()} eaten</Text>
                  </View>
                </>
              ) : (
                <Text style={st.calorieEmpty}>Set a calorie target in Settings</Text>
              )}
            </Pressable>
          </LinearGradient>

          {/* ── Today's workouts ── */}
          <View style={st.section}>
            <View style={st.sectionHeader}>
              <Text style={st.sectionTitle}>Workouts today</Text>
              <Pressable style={st.syncBtn} onPress={syncStrava} disabled={syncing}>
                {syncing
                  ? <ActivityIndicator size="small" color={C.accent} />
                  : <><Ionicons name="sync-outline" size={14} color={C.accent} /><Text style={st.syncBtnText}>Sync Strava</Text></>
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
            <View style={st.section}>
              <Text style={st.sectionTitle}>Meals</Text>
              {meals.map(meal => {
                const presets = presetsMap[meal.meal_index] ?? []
                const mealLogs = logs.filter(l => l.meal_index === meal.meal_index)
                const mealKcal = mealLogs.reduce((s, l) => s + l.kcal, 0)
                return (
                  <View key={meal.meal_index} style={[st.mealCard, meal.checked && st.mealCardChecked]}>
                    <View style={st.mealCardHeader}>
                      <View>
                        <Text style={st.mealName}>{meal.name}</Text>
                        <Text style={st.mealTime}>{meal.scheduled_time}</Text>
                      </View>
                      <View style={st.mealHeaderRight}>
                        {mealKcal > 0 && !hideCalories && <Text style={st.mealKcalBadge}>{mealKcal} kcal</Text>}
                        <Pressable
                          onPress={() => toggleMealCheck(meal)}
                          style={[st.checkCircle, meal.checked && st.checkCircleActive]}
                          hitSlop={8}
                        >
                          {(meal.checked || checking === meal.meal_index) && (
                            <Ionicons name="checkmark" size={14} color="#fff" />
                          )}
                        </Pressable>
                      </View>
                    </View>

                    {/* Logged items for this meal */}
                    {mealLogs.map(log => (
                      <View key={log.id} style={st.mealLogRow}>
                        <Text style={st.mealLogName} numberOfLines={1}>{log.name}</Text>
                        {!hideCalories && <Text style={st.mealLogKcal}>{log.kcal} kcal</Text>}
                        <Pressable onPress={() => deleteLog(log.id)} hitSlop={8}>
                          <Ionicons name="close-outline" size={16} color={C.text3} />
                        </Pressable>
                      </View>
                    ))}

                    {/* Action row */}
                    <View style={st.mealActions}>
                      {presets.length > 0 && (
                        <Pressable style={st.mealActionBtn} onPress={() => setPickerMeal(meal)}>
                          <Ionicons name="bookmark-outline" size={13} color={C.accent} />
                          <Text style={st.mealActionText}>Preset</Text>
                        </Pressable>
                      )}
                      <Pressable style={st.mealActionBtn} onPress={() => { setAddMealIndex(meal.meal_index); setShowAddForm(true) }}>
                        <Ionicons name="add-outline" size={13} color={C.accent2} />
                        <Text style={[st.mealActionText, { color: C.accent2 }]}>Add food</Text>
                      </Pressable>
                    </View>
                  </View>
                )
              })}
            </View>
          )}

          {/* ── Quick add ── */}
          <View style={st.section}>
            <Text style={st.sectionTitle}>Quick add</Text>
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

            {(() => {
              const knownCats = new Set(COMMON_FOOD_CATEGORIES.map(c => c.category))
              const allCats: { category: string; items: CommonFood[] }[] = [
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

              if (quickAddSearch.trim()) {
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
              }

              return allCats.map(cat => (
                <QuickAddCategory key={cat.category} cat={cat} hideCalories={hideCalories}
                  onSelect={food => setQuickAddItem(food)} />
              ))
            })()}

            <Pressable style={st.browseBtn} onPress={() => setFoodPickerVisible(true)}>
              <Ionicons name="search-outline" size={14} color={C.accent} />
              <Text style={st.browseBtnText}>Browse all foods</Text>
            </Pressable>
          </View>

          {/* ── Today's log ── */}
          <View style={st.section}>
            <View style={st.sectionHeader}>
              <Text style={st.sectionTitle}>Today's log</Text>
              <Pressable style={st.addBtn} onPress={() => { setAddMealIndex(null); setShowAddForm(true) }}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={st.addBtnText}>Add</Text>
              </Pressable>
            </View>

            {loading && <ActivityIndicator color={C.accent} style={{ marginVertical: 12 }} />}
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
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Modals ── */}

      {/* Calorie breakdown modal */}
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

      {/* Meal preset picker */}
      {pickerMeal && (
        <MealPresetPickerModal
          meal={pickerMeal}
          presets={presetsMap[pickerMeal.meal_index] ?? []}
          onSelect={preset => logPreset(preset, pickerMeal)}
          onManage={() => { setPickerMeal(null); router.push('/(tabs)/settings') }}
          onClose={() => setPickerMeal(null)}
        />
      )}

      {/* Quick add qty modal */}
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

      {/* Manual add form */}
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
            <TextInput style={st.addFormInput} value={foodProtein} onChangeText={setFoodProtein}
              placeholder="Protein g (optional)" placeholderTextColor={C.text3} keyboardType="decimal-pad"
              returnKeyType="done" onSubmitEditing={submitAddForm} />
            <Pressable style={[st.addFormBtn, adding && { opacity: 0.6 }]} onPress={submitAddForm} disabled={adding}>
              <Text style={st.addFormBtnText}>{adding ? 'Adding…' : 'Add to log'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Browse food picker */}
      {userId && (
        <FoodPickerModal
          visible={foodPickerVisible}
          userId={userId}
          onSelect={food => addFromPicker(food)}
          onClose={() => setFoodPickerVisible(false)}
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

function QuickAddModal({ food, hideCalories, onAdd, onClose }: {
  food: CommonFood & { amount_label?: string | null }
  hideCalories: boolean
  onAdd: (kcal: number, protein: number | null, fat: number | null, carb: number | null) => void
  onClose: () => void
}) {
  const [qty, setQty] = useState('1')
  const q = parseFloat(qty) || 0
  const kcal = Math.round(food.kcal * q)
  const protein = food.protein_g != null ? Math.round(food.protein_g * q * 10) / 10 : null

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.modalOverlay} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ justifyContent: 'flex-end' }}>
        <View style={st.addFormSheet}>
          <Text style={st.addFormTitle}>{food.name}</Text>
          <View style={st.qtyRow}>
            <Text style={st.qtyLabel}>Servings (1 = {food.amount_label ?? '100g'})</Text>
            <TextInput style={st.qtyInput} value={qty} onChangeText={setQty}
              keyboardType="decimal-pad" returnKeyType="done" autoFocus selectTextOnFocus />
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
            <Text style={[st.breakdownValue, { color: C.accent, fontWeight: '700' }]}>{total.toLocaleString()} kcal</Text>
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingBottom: 16 },

  // Hero
  hero: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28 },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  heroGreeting: { fontSize: 22, fontWeight: '800', color: '#fff' },
  heroDate: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  periodBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(244,143,177,0.15)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6, marginBottom: 12,
  },
  periodBannerText: { fontSize: 12, color: '#F48FB1', fontWeight: '600' },
  calorieBlock: { marginTop: 4 },
  progressTrack: { height: 12, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 6, overflow: 'hidden', marginBottom: 10 },
  progressFill: { height: 12, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 6 },
  calorieNum: { fontSize: 52, fontWeight: '800', color: '#fff', lineHeight: 54 },
  calorieLabel: { fontSize: 15, color: 'rgba(255,255,255,0.8)', fontWeight: '500', marginTop: 2 },
  calorieEmpty: { fontSize: 14, color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' },
  calorieBreakdown: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  breakdownChip: { fontSize: 11, color: 'rgba(255,255,255,0.65)', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },

  // Sections
  section: { backgroundColor: C.surface, marginHorizontal: 16, marginTop: 12, borderRadius: 16, padding: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: C.text1 },
  emptyNote: { fontSize: 13, color: C.text3, fontStyle: 'italic', paddingVertical: 4 },

  // Sync / plan
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, backgroundColor: C.surface2, borderRadius: 20 },
  syncBtnText: { fontSize: 12, fontWeight: '600', color: C.accent },
  planBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  planBtnText: { fontSize: 13, fontWeight: '600', color: C.accent2 },

  // Activities
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingLeft: 10, borderLeftWidth: 3, borderRadius: 4, marginBottom: 6, backgroundColor: C.surface2 },
  activityName: { fontSize: 13, fontWeight: '700', color: C.text1 },
  activityType: { fontSize: 11, color: C.text3, marginTop: 1 },
  activityKcal: { fontSize: 13, fontWeight: '700', color: C.accent, marginRight: 8 },

  // Meals
  mealCard: { borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, marginBottom: 8 },
  mealCardChecked: { borderColor: C.accent + '55', backgroundColor: C.accent + '08' },
  mealCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  mealName: { fontSize: 14, fontWeight: '700', color: C.text1 },
  mealTime: { fontSize: 11, color: C.text3, marginTop: 1 },
  mealHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mealKcalBadge: { fontSize: 12, color: C.accent, fontWeight: '600' },
  checkCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkCircleActive: { backgroundColor: C.accent, borderColor: C.accent },
  mealLogRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  mealLogName: { flex: 1, fontSize: 13, color: C.text2 },
  mealLogKcal: { fontSize: 12, color: C.text3, marginRight: 8 },
  mealActions: { flexDirection: 'row', gap: 8, marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  mealActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: C.surface2 },
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
  logTotalValue: { fontSize: 13, fontWeight: '700', color: C.accent },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  addFormSheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36, gap: 10 },
  addFormTitle: { fontSize: 16, fontWeight: '800', color: C.text1, marginBottom: 4 },
  addFormInput: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.text1 },
  addFormBtn: { backgroundColor: C.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  addFormBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qtyLabel: { fontSize: 13, color: C.text2, flex: 1 },
  qtyInput: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, color: C.text1, width: 80, textAlign: 'center' },
  qtyPreview: { fontSize: 13, color: C.accent, fontWeight: '600', textAlign: 'center' },

  // Preset picker
  pickerSheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36, maxHeight: '70%' },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  pickerTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  pickerTitle: { fontSize: 17, fontWeight: '800', color: C.text1 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  pickerRowName: { fontSize: 14, fontWeight: '700', color: C.text1 },
  pickerRowMeta: { fontSize: 12, color: C.text3, marginTop: 2 },

  // Calorie breakdown modal
  breakdownSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 36 },
  breakdownTitle: { fontSize: 17, fontWeight: '800', color: C.text1, marginBottom: 16 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  breakdownLabel: { fontSize: 14, color: C.text2 },
  breakdownValue: { fontSize: 14, fontWeight: '600', color: C.text1 },
})
