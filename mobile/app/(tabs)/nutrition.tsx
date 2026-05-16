import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { scheduleMealNotifications, cancelMealNotification } from '../../lib/notifications'
import { C } from '../../lib/theme'
import type { FoodLog, MealTemplate } from '../../types'

interface CustomFood {
  id: string
  name: string
  kcal: number
  protein_g: number | null
  fat_g: number | null
  carb_g: number | null
}

type SubTab = 'nutrition' | 'meals' | 'estimate'

function localDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isOverdue(scheduledTime: string): boolean {
  const now = new Date()
  const [hh, mm] = scheduledTime.split(':').map(Number)
  return now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm)
}

function getSportColor(type: string): string {
  if (/swim/i.test(type)) return C.swim
  if (/run|jog/i.test(type)) return C.run
  if (/walk/i.test(type)) return C.walk
  if (/ride|bike|cycling|virtual/i.test(type)) return C.ride
  return C.walk
}

function getSportIcon(type: string): string {
  if (/swim/i.test(type)) return 'swim'
  if (/run|jog/i.test(type)) return 'run'
  if (/walk/i.test(type)) return 'walk'
  if (/ride|bike|cycling|virtual/i.test(type)) return 'bike'
  return 'lightning-bolt'
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

const ACTIVITY_LEVELS = [
  {
    key: 'sedentary', label: 'Sedentary', detail: 'Desk job, little movement', factor: 1.2,
    info: 'You have a desk job or study and don\'t exercise regularly. You walk to the car, around the office, but your body is largely still for most of the day.',
  },
  {
    key: 'light', label: 'Light', detail: '1–3 workouts/week', factor: 1.375,
    info: 'You exercise 1–3 times per week at a casual pace — a few walks, a gym session, a weekend ride. Outside of those sessions your daily life is mostly sedentary.',
  },
  {
    key: 'moderate', label: 'Moderate', detail: '3–5 workouts/week', factor: 1.55,
    info: 'You train consistently 3–5 days per week at a real intensity. Your workouts are planned and regular. This fits most recreational athletes who exercise but have a desk job otherwise.',
  },
  {
    key: 'active', label: 'Active', detail: '6–7 hard sessions/week', factor: 1.725,
    info: 'You train hard 6–7 days per week, or combine regular intense training with a job that keeps you on your feet. Think a competitive club runner or cyclist doing daily rides.',
  },
  {
    key: 'very_active', label: 'Very active', detail: 'Athlete + physical job', factor: 1.9,
    info: 'You combine high-volume, high-intensity daily training with a physically demanding job — construction worker who trains, professional athlete in a build phase, or military personnel.',
  },
] as const

type ActivityLevel = typeof ACTIVITY_LEVELS[number]['key']

const QUIZ_QUESTIONS = [
  {
    id: 'q1',
    question: 'How many days per week do you exercise?',
    options: [
      { label: '0–1 days',  score: 0 },
      { label: '2–3 days',  score: 1 },
      { label: '4–5 days',  score: 2 },
      { label: '6–7 days',  score: 3 },
    ],
  },
  {
    id: 'q2',
    question: 'What is your daily life like outside of exercise?',
    options: [
      { label: 'Mostly sitting — desk job, studying, driving', score: 0 },
      { label: 'Mix of sitting and moving around',             score: 1 },
      { label: 'On my feet most of the day',                  score: 2 },
      { label: 'Physical labor — construction, nursing, etc.', score: 3 },
    ],
  },
  {
    id: 'q3',
    question: 'How intense are your typical workouts?',
    options: [
      { label: 'Light — easy walks, gentle yoga',           score: 0 },
      { label: 'Moderate — I sweat and breathe harder',     score: 1 },
      { label: 'Hard — intervals, racing, pushing limits',  score: 2 },
    ],
  },
] as const

function scoreToLevel(score: number): ActivityLevel {
  if (score <= 1) return 'sedentary'
  if (score <= 3) return 'light'
  if (score <= 5) return 'moderate'
  if (score <= 7) return 'active'
  return 'very_active'
}

function calcMifflinTDEE(
  weight_kg: number, height_cm: number, age: number,
  sex: 'male' | 'female' | 'other', factor: number,
): { bmr: number; tdee: number } {
  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age
  const offset = sex === 'female' ? -161 : sex === 'male' ? 5 : -78
  const bmr = Math.round(base + offset)
  return { bmr, tdee: Math.round(bmr * factor) }
}

interface TodayActivity { id: string; name: string; type: string; total_kcal: number }
interface MealItem { meal_index: number; name: string; scheduled_time: string; checked: boolean; kcal: number | null }

export default function NutritionScreen() {
  const [subTab, setSubTab] = useState<SubTab>('nutrition')
  const [userId, setUserId] = useState<string | null>(null)

  // ── Nutrition state ──────────────────────────────────────────────────────────
  const [baseline, setBaseline] = useState<number | null>(null)
  const [editingTarget, setEditingTarget] = useState(false)
  const [targetInput, setTargetInput] = useState('')
  const [burnedKcal, setBurnedKcal] = useState(0)
  const [plannedKcal, setPlannedKcal] = useState(0)
  const [activities, setActivities] = useState<TodayActivity[]>([])
  const [logs, setLogs] = useState<FoodLog[]>([])
  const [nutritionLoading, setNutritionLoading] = useState(true)
  const [foodName, setFoodName] = useState('')
  const [foodKcal, setFoodKcal] = useState('')
  const [foodProtein, setFoodProtein] = useState('')
  const [foodFat, setFoodFat] = useState('')
  const [foodCarb, setFoodCarb] = useState('')
  const [adding, setAdding] = useState(false)
  const [customFoods, setCustomFoods] = useState<CustomFood[]>([])
  const [customFoodsModalVisible, setCustomFoodsModalVisible] = useState(false)

  // ── Meal plan state ──────────────────────────────────────────────────────────
  const [meals, setMeals] = useState<MealItem[]>([])
  const [mealsLoading, setMealsLoading] = useState(true)
  const [checking, setChecking] = useState<number | null>(null)
  const [mealKcalInputs, setMealKcalInputs] = useState<Record<number, string>>({})

  // ── Estimate tab state ───────────────────────────────────────────────────────
  const [profileWeight, setProfileWeight] = useState<number | null>(null)
  const [profileHeight, setProfileHeight] = useState<number | null>(null)
  const [profileAge, setProfileAge] = useState<number | null>(null)
  const [profileSex, setProfileSex] = useState<'male' | 'female' | 'other' | null>(null)
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('moderate')
  const [showActivityQuiz, setShowActivityQuiz] = useState(false)
  const [showActivityInfo, setShowActivityInfo] = useState(false)

  const todayStr = localDate()

  const target = baseline != null ? baseline + burnedKcal + plannedKcal : null
  const consumed = logs.reduce((s, l) => s + l.kcal, 0)
  const remaining = target != null ? target - consumed : null
  const progress = target != null && target > 0 ? Math.min(consumed / target, 1) : 0
  const checkedCount = meals.filter(m => m.checked).length
  const allMealsDone = meals.length > 0 && checkedCount === meals.length
  const barColor = remaining != null && remaining < 0 ? C.danger : C.accent

  useFocusEffect(useCallback(() => {
    loadAll()
  }, []))

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    await Promise.all([loadNutrition(user.id), loadMeals(user.id)])
  }

  async function loadNutrition(uid: string) {
    setNutritionLoading(true)
    const [profileRes, actsRes, plannedRes, logsRes, customFoodsRes] = await Promise.all([
      supabase.from('users').select('daily_kcal_target, weight_kg, height_cm, age, sex').eq('id', uid).single(),
      supabase.from('activities').select('id, name, type, total_kcal')
        .eq('user_id', uid).gte('date', todayStr).not('total_kcal', 'is', null),
      supabase.from('planned_workouts').select('target_kcal')
        .eq('user_id', uid).eq('planned_for', todayStr),
      supabase.from('food_logs').select('*')
        .eq('user_id', uid).eq('date', todayStr).order('logged_at'),
      supabase.from('custom_foods').select('*').eq('user_id', uid).order('name'),
    ])
    setBaseline(profileRes.data?.daily_kcal_target ?? null)
    setProfileWeight(profileRes.data?.weight_kg ?? null)
    setProfileHeight(profileRes.data?.height_cm ?? null)
    setProfileAge(profileRes.data?.age ?? null)
    setProfileSex(profileRes.data?.sex ?? null)
    setActivities(actsRes.data ?? [])
    setBurnedKcal(Math.round((actsRes.data ?? []).reduce((s: number, a: any) => s + (a.total_kcal ?? 0), 0)))
    setPlannedKcal(Math.round((plannedRes.data ?? []).reduce((s: number, p: any) => s + p.target_kcal, 0)))
    setLogs(logsRes.data ?? [])
    setCustomFoods(customFoodsRes.data ?? [])
    setNutritionLoading(false)
  }

  async function loadMeals(uid: string) {
    setMealsLoading(true)
    const [templatesRes, checksRes] = await Promise.all([
      supabase.from('meal_templates').select('*').eq('user_id', uid).order('meal_index'),
      supabase.from('meal_checks').select('meal_index').eq('user_id', uid).eq('date', todayStr),
    ])
    const templates = (templatesRes.data ?? []) as MealTemplate[]
    const checkedSet = new Set<number>((checksRes.data ?? []).map((c: any) => c.meal_index as number))
    const items: MealItem[] = templates.map(t => ({
      meal_index: t.meal_index,
      name: t.name,
      scheduled_time: t.scheduled_time,
      checked: checkedSet.has(t.meal_index),
      kcal: (t as any).kcal ?? null,
    }))
    setMeals(items)
    const inputs: Record<number, string> = {}
    for (const item of items) {
      inputs[item.meal_index] = item.kcal != null ? String(item.kcal) : ''
    }
    setMealKcalInputs(inputs)
    setMealsLoading(false)
    await scheduleMealNotifications(items.map(m => ({
      meal_index: m.meal_index,
      name: m.name,
      scheduled_time: m.scheduled_time,
      date: todayStr,
      checked: m.checked,
    })))
  }

  async function saveTarget() {
    const val = parseInt(targetInput)
    if (isNaN(val) || val <= 0 || val > 10000) { Alert.alert('Invalid value', 'Enter a calorie target between 1 and 10 000.'); return }
    if (!userId) return
    await supabase.from('users').update({ daily_kcal_target: val }).eq('id', userId)
    setBaseline(val)
    setEditingTarget(false)
    setTargetInput('')
  }

  async function addEntry() {
    const kcal = parseInt(foodKcal)
    if (!foodName.trim()) { Alert.alert('Missing name', 'Enter a food name.'); return }
    if (isNaN(kcal) || kcal <= 0) { Alert.alert('Invalid kcal', 'Enter a positive calorie amount.'); return }
    if (kcal > 5000) { Alert.alert('Invalid kcal', 'Enter a value of 5000 kcal or less.'); return }
    if (!userId) return
    setAdding(true)
    const protein = foodProtein ? Math.min(Math.max(parseFloat(foodProtein), 0), 500) : null
    const fat = foodFat ? Math.min(Math.max(parseFloat(foodFat), 0), 500) : null
    const carb = foodCarb ? Math.min(Math.max(parseFloat(foodCarb), 0), 500) : null
    const { error } = await supabase.from('food_logs').insert({
      user_id: userId, date: todayStr, name: foodName.trim(), kcal,
      protein_g: isNaN(protein as number) ? null : protein,
      fat_g: isNaN(fat as number) ? null : fat,
      carb_g: isNaN(carb as number) ? null : carb,
    })
    setAdding(false)
    if (error) { Alert.alert('Error', error.message); return }
    setFoodName(''); setFoodKcal(''); setFoodProtein(''); setFoodFat(''); setFoodCarb('')
    loadNutrition(userId)
  }

  async function deleteEntry(id: string) {
    await supabase.from('food_logs').delete().eq('id', id)
    setLogs(prev => prev.filter(l => l.id !== id))
  }

  async function addFromCustomFood(food: CustomFood) {
    if (!userId) return
    const { error } = await supabase.from('food_logs').insert({
      user_id: userId, date: todayStr, name: food.name, kcal: food.kcal,
      protein_g: food.protein_g, fat_g: food.fat_g, carb_g: food.carb_g,
    })
    if (error) { Alert.alert('Error', error.message); return }
    setCustomFoodsModalVisible(false)
    loadNutrition(userId)
  }

  async function saveAsCustomFood() {
    const kcal = parseInt(foodKcal)
    if (!foodName.trim()) { Alert.alert('Missing name', 'Enter a food name first.'); return }
    if (isNaN(kcal) || kcal <= 0) { Alert.alert('Missing kcal', 'Enter the calorie amount first.'); return }
    if (!userId) return
    const protein = foodProtein ? parseFloat(foodProtein) : null
    const fat = foodFat ? parseFloat(foodFat) : null
    const carb = foodCarb ? parseFloat(foodCarb) : null
    const { error } = await supabase.from('custom_foods').insert({
      user_id: userId, name: foodName.trim(), kcal,
      protein_g: isNaN(protein as number) ? null : protein,
      fat_g: isNaN(fat as number) ? null : fat,
      carb_g: isNaN(carb as number) ? null : carb,
    })
    if (error) { Alert.alert('Error', error.message); return }
    const { data } = await supabase.from('custom_foods').select('*').eq('user_id', userId).order('name')
    setCustomFoods(data ?? [])
    Alert.alert('Saved', `"${foodName.trim()}" added to My Foods.`)
  }

  async function deleteCustomFood(id: string) {
    await supabase.from('custom_foods').delete().eq('id', id)
    setCustomFoods(prev => prev.filter(f => f.id !== id))
  }

  function handleMealTap(meal: MealItem) {
    if (meal.checked) {
      uncheckMeal(meal)
    } else {
      confirmMealLog(meal)
    }
  }

  async function uncheckMeal(meal: MealItem) {
    if (!userId) return
    setChecking(meal.meal_index)
    await Promise.all([
      supabase.from('meal_checks').delete()
        .eq('user_id', userId).eq('meal_index', meal.meal_index).eq('date', todayStr),
      supabase.from('food_logs').delete()
        .eq('user_id', userId).eq('meal_index', meal.meal_index).eq('date', todayStr),
    ])
    const [hh, mm] = meal.scheduled_time.split(':').map(Number)
    const [y, mo, d] = todayStr.split('-').map(Number)
    if (new Date(y, mo - 1, d, hh + 1, mm, 0, 0).getTime() > Date.now()) {
      await scheduleMealNotifications([{ ...meal, date: todayStr, checked: false }])
    }
    setMeals(prev => prev.map(m => m.meal_index === meal.meal_index ? { ...m, checked: false } : m))
    setChecking(null)
    loadNutrition(userId)
  }

  async function confirmMealLog(meal: MealItem) {
    if (!userId) return
    setChecking(meal.meal_index)
    const kcalStr = mealKcalInputs[meal.meal_index] ?? ''
    const kcal = kcalStr ? parseInt(kcalStr) : null
    await supabase.from('meal_checks').upsert(
      { user_id: userId, meal_index: meal.meal_index, date: todayStr },
      { onConflict: 'user_id,meal_index,date' },
    )
    await cancelMealNotification(meal.meal_index)
    if (kcal && kcal > 0 && kcal <= 5000) {
      await supabase.from('food_logs').insert({
        user_id: userId, date: todayStr, name: meal.name, kcal,
        meal_index: meal.meal_index,
      })
    }
    setMeals(prev => prev.map(m => m.meal_index === meal.meal_index ? { ...m, checked: true } : m))
    setChecking(null)
    loadNutrition(userId)
  }

  return (
    <SafeAreaView style={st.container}>
      {/* Sub-tab selector */}
      <View style={st.segRow}>
        {([
          { key: 'nutrition', label: "Today's log" },
          { key: 'meals', label: 'Meal Plan' },
          { key: 'estimate', label: 'Estimate' },
        ] as const).map(tab => (
          <Pressable
            key={tab.key}
            style={[st.segBtn, subTab === tab.key && st.segBtnActive]}
            onPress={() => setSubTab(tab.key)}
          >
            <Text style={[st.segText, subTab === tab.key && st.segTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>

      <CustomFoodsModal
        visible={customFoodsModalVisible}
        foods={customFoods}
        onAdd={addFromCustomFood}
        onDelete={deleteCustomFood}
        onClose={() => setCustomFoodsModalVisible(false)}
      />

      <CalorieQuizModal
        visible={showActivityQuiz}
        onApply={level => { setActivityLevel(level); setShowActivityQuiz(false); setShowActivityInfo(false) }}
        onClose={() => setShowActivityQuiz(false)}
      />

      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <Text style={st.screenTitle}>Nutrition</Text>

        {/* ── TODAY'S LOG ──────────────────────────────────────────────────── */}
        {subTab === 'nutrition' && (
          <>
            {/* Progress card */}
            <View style={st.card}>
              <Text style={st.cardLabel}>Today's intake</Text>
              <View style={st.progressRow}>
                <Text style={st.consumedNum}>{consumed.toLocaleString()}</Text>
                {target != null && <Text style={st.targetNum}> / {target.toLocaleString()} kcal</Text>}
              </View>
              {target != null && (
                <View style={st.barTrack}>
                  <View style={[st.barFill, { width: `${Math.round(progress * 100)}%` as any, backgroundColor: barColor }]} />
                </View>
              )}
              <View style={st.progressMeta}>
                {remaining != null && !editingTarget && (
                  <Text style={[st.remainingText, remaining < 0 && st.overText]}>
                    {remaining < 0
                      ? `${Math.abs(remaining).toLocaleString()} kcal over target`
                      : `${remaining.toLocaleString()} kcal remaining`}
                  </Text>
                )}
                {editingTarget ? (
                  <View style={st.targetEditRow}>
                    <TextInput
                      style={st.targetEditInput}
                      value={targetInput}
                      onChangeText={setTargetInput}
                      placeholder={baseline != null ? String(baseline) : 'e.g. 2200'}
                      placeholderTextColor={C.text3}
                      keyboardType="numeric"
                      autoFocus
                      returnKeyType="done"
                      onSubmitEditing={saveTarget}
                    />
                    <Text style={st.targetEditUnit}>kcal / day</Text>
                    <Pressable style={st.targetSaveBtn} onPress={saveTarget}>
                      <Text style={st.targetSaveBtnText}>Save</Text>
                    </Pressable>
                    <Pressable onPress={() => { setEditingTarget(false); setTargetInput('') }}>
                      <Ionicons name="close-outline" size={20} color={C.text3} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    style={st.targetEditTrigger}
                    onPress={() => { setTargetInput(baseline != null ? String(baseline) : ''); setEditingTarget(true) }}
                  >
                    <Ionicons name="pencil-outline" size={12} color={C.text3} />
                    <Text style={st.targetEditTriggerText}>
                      {baseline == null ? 'Set daily calorie target' : 'Edit target'}
                    </Text>
                  </Pressable>
                )}
              </View>
              {target != null && (
                <View style={st.breakdownRow}>
                  {baseline != null && (
                    <View style={st.breakdownChip}>
                      <Ionicons name="body-outline" size={11} color={C.text2} />
                      <Text style={st.breakdownText}>{baseline.toLocaleString()} baseline</Text>
                    </View>
                  )}
                  {burnedKcal > 0 && (
                    <View style={st.breakdownChip}>
                      <Ionicons name="flame-outline" size={11} color={C.accent} />
                      <Text style={[st.breakdownText, { color: C.accent }]}>+{Math.round(burnedKcal)} burned</Text>
                    </View>
                  )}
                  {plannedKcal > 0 && (
                    <View style={st.breakdownChip}>
                      <Ionicons name="calendar-outline" size={11} color={C.accent2} />
                      <Text style={[st.breakdownText, { color: C.accent2 }]}>+{plannedKcal} planned</Text>
                    </View>
                  )}
                </View>
              )}
              {activities.length > 0 && (
                <View style={st.activityRow}>
                  {activities.map(a => (
                    <View key={a.id} style={[st.activityPill, { backgroundColor: getSportColor(a.type) + '18' }]}>
                      <MaterialCommunityIcons name={getSportIcon(a.type) as any} size={11} color={getSportColor(a.type)} />
                      <Text style={[st.activityPillText, { color: getSportColor(a.type) }]}>
                        {a.name} · {Math.round(a.total_kcal)} kcal
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Log food */}
            <View style={st.card}>
              <View style={st.cardLabelRow}>
                <Text style={st.cardLabel}>Log food</Text>
                <Pressable onPress={() => setCustomFoodsModalVisible(true)} style={st.myFoodsBtn}>
                  <Ionicons name="bookmark-outline" size={13} color={C.accent} />
                  <Text style={st.myFoodsBtnText}>My Foods</Text>
                </Pressable>
              </View>
              <TextInput
                style={st.input}
                value={foodName}
                onChangeText={setFoodName}
                placeholder="Food name (e.g. Oatmeal with banana)"
                placeholderTextColor={C.text3}
                returnKeyType="next"
              />
              <View style={st.addRow}>
                <View style={st.macroInputWrap}>
                  <TextInput
                    style={[st.input, st.macroInput]}
                    value={foodKcal}
                    onChangeText={setFoodKcal}
                    placeholder="kcal *"
                    placeholderTextColor={C.text3}
                    keyboardType="numeric"
                  />
                </View>
                <View style={st.macroInputWrap}>
                  <TextInput
                    style={[st.input, st.macroInput]}
                    value={foodProtein}
                    onChangeText={setFoodProtein}
                    placeholder="protein g"
                    placeholderTextColor={C.text3}
                    keyboardType="decimal-pad"
                  />
                </View>
                <Pressable
                  style={[st.addBtn, adding && { opacity: 0.5 }]}
                  onPress={addEntry}
                  disabled={adding}
                >
                  {adding
                    ? <ActivityIndicator size="small" color={C.white} />
                    : <Ionicons name="add" size={22} color={C.white} />
                  }
                </Pressable>
              </View>
              <View style={st.addRow}>
                <View style={st.macroInputWrap}>
                  <TextInput
                    style={[st.input, st.macroInput]}
                    value={foodFat}
                    onChangeText={setFoodFat}
                    placeholder="fat g"
                    placeholderTextColor={C.text3}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={st.macroInputWrap}>
                  <TextInput
                    style={[st.input, st.macroInput]}
                    value={foodCarb}
                    onChangeText={setFoodCarb}
                    placeholder="carb g"
                    placeholderTextColor={C.text3}
                    keyboardType="decimal-pad"
                  />
                </View>
                <Pressable
                  style={[st.addBtn, st.saveTemplateBtn]}
                  onPress={saveAsCustomFood}
                  hitSlop={4}
                >
                  <Ionicons name="bookmark-outline" size={20} color={C.text2} />
                </Pressable>
              </View>
            </View>

            {/* Food log list */}
            <View style={st.card}>
              <Text style={st.cardLabel}>Today's log</Text>
              {nutritionLoading && <ActivityIndicator color={C.accent} style={{ marginVertical: 12 }} />}
              {!nutritionLoading && logs.length === 0 && (
                <Text style={st.emptyNote}>No food logged yet. Add your first entry above.</Text>
              )}
              {logs.map((log, i) => (
                <View key={log.id} style={[st.logRow, i < logs.length - 1 && st.logRowBorder]}>
                  <View style={st.logLeft}>
                    <Text style={st.logName} numberOfLines={1}>{log.name}</Text>
                    <Text style={st.logMeta}>
                      {formatTime(log.logged_at)}
                      {log.protein_g != null ? ` · P ${log.protein_g}g` : ''}
                      {log.fat_g != null ? ` · F ${log.fat_g}g` : ''}
                      {log.carb_g != null ? ` · C ${log.carb_g}g` : ''}
                    </Text>
                  </View>
                  <Text style={st.logKcal}>{log.kcal} kcal</Text>
                  <Pressable onPress={() => deleteEntry(log.id)} hitSlop={10} style={st.deleteBtn}>
                    <Ionicons name="trash-outline" size={16} color={C.text3} />
                  </Pressable>
                </View>
              ))}
              {logs.length > 0 && (() => {
                const totalP = logs.reduce((s, l) => s + (l.protein_g ?? 0), 0)
                const totalF = logs.reduce((s, l) => s + (l.fat_g ?? 0), 0)
                const totalC = logs.reduce((s, l) => s + (l.carb_g ?? 0), 0)
                const hasMacros = totalP > 0 || totalF > 0 || totalC > 0
                return (
                  <>
                    {hasMacros && (
                      <View style={st.macroTotalsRow}>
                        {totalP > 0 && <View style={st.macroChip}><Text style={[st.macroChipText, { color: C.accent }]}>P {Math.round(totalP)}g</Text></View>}
                        {totalF > 0 && <View style={st.macroChip}><Text style={[st.macroChipText, { color: C.walk }]}>F {Math.round(totalF)}g</Text></View>}
                        {totalC > 0 && <View style={st.macroChip}><Text style={[st.macroChipText, { color: C.accent2 }]}>C {Math.round(totalC)}g</Text></View>}
                      </View>
                    )}
                    <View style={st.totalRow}>
                      <Text style={st.totalLabel}>Total</Text>
                      <Text style={st.totalValue}>{consumed.toLocaleString()} kcal</Text>
                    </View>
                  </>
                )
              })()}
            </View>
          </>
        )}

        {/* ── MEAL PLAN ────────────────────────────────────────────────────── */}
        {subTab === 'meals' && (
          <>
            {meals.length > 0 && (
              <View style={[st.card, allMealsDone && { backgroundColor: 'rgba(76,175,80,0.1)', borderColor: 'rgba(76,175,80,0.2)' }]}>
                {allMealsDone ? (
                  <View style={st.doneRow}>
                    <Ionicons name="checkmark-circle" size={22} color={C.success} />
                    <Text style={st.doneText}>All meals done for today!</Text>
                  </View>
                ) : (
                  <>
                    <View style={st.mealProgressLabelRow}>
                      <Text style={st.mealProgressLabel}>{checkedCount} of {meals.length} meals eaten</Text>
                      <Text style={st.mealProgressPct}>{Math.round((checkedCount / meals.length) * 100)}%</Text>
                    </View>
                    <View style={st.barTrack}>
                      <View style={[st.barFill, { width: `${(checkedCount / meals.length) * 100}%` as any, backgroundColor: C.accent }]} />
                    </View>
                  </>
                )}
              </View>
            )}

            {mealsLoading && <ActivityIndicator color={C.accent} style={{ marginVertical: 12 }} />}

            {!mealsLoading && meals.length === 0 && (
              <View style={st.mealEmptyBox}>
                <Ionicons name="restaurant-outline" size={52} color={C.text3} />
                <Text style={st.mealEmptyTitle}>No meal plan set up</Text>
                <Text style={st.emptyNote}>
                  Go to Settings → Meal Plan to configure your daily meals and times.
                </Text>
              </View>
            )}

            {meals.map(meal => {
              const overdue = !meal.checked && isOverdue(meal.scheduled_time)
              const isChecking = checking === meal.meal_index
              return (
                <View
                  key={meal.meal_index}
                  style={[st.mealCard, meal.checked && st.mealCardChecked, overdue && st.mealCardOverdue]}
                >
                  <Pressable
                    style={[st.checkbox, meal.checked && st.checkboxChecked]}
                    onPress={() => handleMealTap(meal)}
                    disabled={isChecking}
                  >
                    {isChecking
                      ? <ActivityIndicator size="small" color={meal.checked ? C.white : C.accent} />
                      : meal.checked
                        ? <Ionicons name="checkmark" size={16} color={C.white} />
                        : null
                    }
                  </Pressable>
                  <View style={st.mealInfo}>
                    <Text style={[st.mealName, meal.checked && st.mealNameChecked]}>{meal.name}</Text>
                    <View style={st.mealMetaRow}>
                      <Ionicons name="time-outline" size={13} color={overdue ? C.danger : C.text2} />
                      <Text style={[st.mealTime, overdue && st.mealTimeOverdue]}>{meal.scheduled_time}</Text>
                      {overdue && (
                        <View style={st.overdueTag}>
                          <Text style={st.overdueTagText}>overdue</Text>
                        </View>
                      )}
                      {meal.checked && <Text style={st.checkedLabel}>done</Text>}
                    </View>
                  </View>
                  {!meal.checked ? (
                    <TextInput
                      style={st.mealKcalInput}
                      value={mealKcalInputs[meal.meal_index] ?? ''}
                      onChangeText={v => setMealKcalInputs(prev => ({ ...prev, [meal.meal_index]: v }))}
                      placeholder={meal.kcal != null ? String(meal.kcal) : 'kcal'}
                      placeholderTextColor={C.text3}
                      keyboardType="numeric"
                    />
                  ) : (
                    <Text style={st.mealKcalBadge}>
                      {mealKcalInputs[meal.meal_index] ? `${mealKcalInputs[meal.meal_index]} kcal` : ''}
                    </Text>
                  )}
                </View>
              )
            })}
          </>
        )}

        {/* ── CALORIC INTAKE ESTIMATE ──────────────────────────────────────── */}
        {subTab === 'estimate' && (() => {
          const w = profileWeight
          const h = profileHeight
          const a = profileAge
          const s = profileSex
          const hasData = w && h && a && s
          const selectedLevel = ACTIVITY_LEVELS.find(l => l.key === activityLevel)!
          const result = hasData ? calcMifflinTDEE(w!, h!, a!, s!, selectedLevel.factor) : null

          return (
            <>
              <Text style={st.estimateTitle}>Caloric intake estimate</Text>
              <Text style={st.estimateNote}>
                Uses the Mifflin-St Jeor formula to estimate your daily energy needs based on your body measurements and activity level.
              </Text>

              {!hasData && (
                <View style={st.estimateWarning}>
                  <Ionicons name="information-circle-outline" size={18} color={C.accent2} />
                  <Text style={st.estimateWarningText}>
                    Fill in your weight, height, age and sex in Settings → Profile to see your estimate.
                  </Text>
                </View>
              )}

              {hasData && (
                <View style={st.calcCard}>
                  {/* Activity level */}
                  <View style={st.calcActivityHeader}>
                    <Text style={st.calcActivityLabel}>Activity level</Text>
                    <Pressable
                      onPress={() => setShowActivityInfo(v => !v)}
                      style={st.infoBtn}
                      hitSlop={10}
                    >
                      <Text style={st.infoBtnText}>i</Text>
                    </Pressable>
                  </View>

                  {showActivityInfo && (
                    <View style={st.infoPopup}>
                      <Text style={st.infoPopupTitle}>{selectedLevel.label}</Text>
                      <Text style={st.infoPopupText}>{selectedLevel.info}</Text>
                    </View>
                  )}

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}
                    contentContainerStyle={{ gap: 6, paddingRight: 4 }}>
                    {ACTIVITY_LEVELS.map(level => (
                      <Pressable
                        key={level.key}
                        style={[st.activityChip, activityLevel === level.key && st.activityChipActive]}
                        onPress={() => { setActivityLevel(level.key); setShowActivityInfo(false) }}
                      >
                        <Text style={[st.activityChipLabel, activityLevel === level.key && st.activityChipLabelActive]}>
                          {level.label}
                        </Text>
                        <Text style={st.activityChipDetail}>{level.detail}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>

                  <Pressable onPress={() => setShowActivityQuiz(true)} style={st.helpBtn}>
                    <Ionicons name="help-circle-outline" size={13} color={C.accent} />
                    <Text style={st.helpBtnText}>Help me choose</Text>
                  </Pressable>

                  <View style={st.calcBreakdown}>
                    <View style={st.calcBreakdownRow}>
                      <Text style={st.calcBreakdownLabel}>Basal metabolic rate (at rest)</Text>
                      <Text style={st.calcBreakdownValue}>{result!.bmr.toLocaleString()} kcal</Text>
                    </View>
                    <View style={st.calcBreakdownRow}>
                      <Text style={st.calcBreakdownLabel}>Activity multiplier</Text>
                      <Text style={st.calcBreakdownValue}>× {selectedLevel.factor}</Text>
                    </View>
                    <View style={[st.calcBreakdownRow, st.calcBreakdownTotal]}>
                      <Text style={st.calcTotalLabel}>Daily target</Text>
                      <Text style={st.calcTotalValue}>{result!.tdee.toLocaleString()} kcal</Text>
                    </View>
                  </View>

                  <Pressable
                    style={st.useTargetBtn}
                    onPress={async () => {
                      if (!userId) return
                      await supabase.from('users').update({ daily_kcal_target: result!.tdee }).eq('id', userId)
                      setBaseline(result!.tdee)
                      Alert.alert('Target updated', `Daily target set to ${result!.tdee.toLocaleString()} kcal.`)
                    }}
                  >
                    <Ionicons name="checkmark-circle-outline" size={16} color={C.white} />
                    <Text style={st.useTargetBtnText}>Use {result!.tdee.toLocaleString()} kcal as target</Text>
                  </Pressable>
                </View>
              )}
            </>
          )
        })()}
      </ScrollView>
    </SafeAreaView>
  )
}

function CalorieQuizModal({
  visible, onApply, onClose,
}: {
  visible: boolean
  onApply: (level: ActivityLevel) => void
  onClose: () => void
}) {
  const [answers, setAnswers] = useState<(number | null)[]>([null, null, null])

  useEffect(() => {
    if (visible) setAnswers([null, null, null])
  }, [visible])

  const allAnswered = answers.every(a => a !== null)
  const totalScore = allAnswered ? (answers as number[]).reduce((s, a) => s + a, 0) : 0
  const recommended = allAnswered ? ACTIVITY_LEVELS.find(l => l.key === scoreToLevel(totalScore))! : null

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={qz.overlay} onPress={onClose}>
        <Pressable style={qz.sheet} onPress={e => e.stopPropagation()}>
          <View style={qz.handle} />
          <Text style={qz.title}>Find your activity level</Text>
          <Text style={qz.subtitle}>Answer 3 questions — takes about 30 seconds</Text>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={qz.scrollContent}>
            {QUIZ_QUESTIONS.map((q, qi) => (
              <View key={q.id} style={qz.questionBlock}>
                <Text style={qz.questionNum}>Question {qi + 1} of {QUIZ_QUESTIONS.length}</Text>
                <Text style={qz.questionText}>{q.question}</Text>
                {q.options.map(opt => {
                  const selected = answers[qi] === opt.score
                  return (
                    <Pressable
                      key={opt.score}
                      style={[qz.optionBtn, selected && qz.optionBtnActive]}
                      onPress={() => setAnswers(prev => {
                        const next = [...prev]
                        next[qi] = opt.score
                        return next
                      })}
                    >
                      <View style={[qz.dot, selected && qz.dotActive]} />
                      <Text style={[qz.optionText, selected && qz.optionTextActive]}>{opt.label}</Text>
                    </Pressable>
                  )
                })}
              </View>
            ))}

            {recommended && (
              <View style={qz.resultBox}>
                <Text style={qz.resultPre}>Recommended activity level</Text>
                <Text style={qz.resultLevel}>{recommended.label}</Text>
                <Text style={qz.resultFactor}>× {recommended.factor} multiplier</Text>
                <Text style={qz.resultInfo}>{recommended.info}</Text>
                <Pressable style={qz.applyBtn} onPress={() => onApply(recommended.key)}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={C.white} />
                  <Text style={qz.applyBtnText}>Apply — {recommended.label}</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>

          <Pressable onPress={onClose} style={qz.cancelBtn}>
            <Text style={qz.cancelBtnText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function CustomFoodsModal({ visible, foods, onAdd, onDelete, onClose }: {
  visible: boolean
  foods: CustomFood[]
  onAdd: (food: CustomFood) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={cf.overlay} onPress={onClose}>
        <Pressable style={cf.sheet} onPress={e => e.stopPropagation()}>
          <View style={cf.handle} />
          <Text style={cf.title}>My Foods</Text>
          <Text style={cf.subtitle}>Tap a food to add it to today's log.</Text>

          {foods.length === 0 ? (
            <View style={cf.empty}>
              <Ionicons name="bookmark-outline" size={44} color={C.text3} />
              <Text style={cf.emptyText}>
                No saved foods yet. Fill in a food below and tap the bookmark icon to save it here.
              </Text>
            </View>
          ) : (
            <ScrollView style={cf.list} showsVerticalScrollIndicator={false}>
              {foods.map(food => (
                <View key={food.id} style={cf.item}>
                  <Pressable style={cf.itemMain} onPress={() => onAdd(food)}>
                    <View style={{ flex: 1 }}>
                      <Text style={cf.itemName}>{food.name}</Text>
                      <Text style={cf.itemMeta}>
                        {food.kcal} kcal
                        {food.protein_g != null ? ` · P ${food.protein_g}g` : ''}
                        {food.fat_g != null ? ` · F ${food.fat_g}g` : ''}
                        {food.carb_g != null ? ` · C ${food.carb_g}g` : ''}
                      </Text>
                    </View>
                    <Ionicons name="add-circle-outline" size={24} color={C.accent} />
                  </Pressable>
                  <Pressable onPress={() => onDelete(food.id)} hitSlop={8} style={cf.deleteBtn}>
                    <Ionicons name="trash-outline" size={16} color={C.text3} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          <Pressable style={cf.closeBtn} onPress={onClose}>
            <Text style={cf.closeBtnText}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const qz = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8,
    maxHeight: '90%',
  },
  handle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: '800', color: C.text1, marginBottom: 4 },
  subtitle: { fontSize: 13, color: C.text2, marginBottom: 20 },
  scrollContent: { paddingBottom: 8 },
  questionBlock: { marginBottom: 24 },
  questionNum: { fontSize: 10, fontWeight: '700', color: C.accent, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 },
  questionText: { fontSize: 15, fontWeight: '700', color: C.text1, lineHeight: 21, marginBottom: 12 },
  optionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 10, borderWidth: 1.5, borderColor: C.border,
    backgroundColor: C.surface2, marginBottom: 6,
  },
  optionBtnActive: { borderColor: C.accent, backgroundColor: C.accentBg },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: C.border, backgroundColor: C.surface },
  dotActive: { borderColor: C.accent, backgroundColor: C.accent },
  optionText: { fontSize: 14, color: C.text2, flex: 1, lineHeight: 19 },
  optionTextActive: { color: C.accent, fontWeight: '600' },
  resultBox: {
    backgroundColor: C.accentBg, borderRadius: 14, padding: 16,
    borderWidth: 1.5, borderColor: C.accent + '44', marginBottom: 12,
  },
  resultPre: { fontSize: 10, fontWeight: '700', color: C.accent, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4 },
  resultLevel: { fontSize: 22, fontWeight: '800', color: C.text1, marginBottom: 2 },
  resultFactor: { fontSize: 13, fontWeight: '600', color: C.accent, marginBottom: 10 },
  resultInfo: { fontSize: 13, color: C.text2, lineHeight: 19, marginBottom: 14 },
  applyBtn: {
    backgroundColor: C.accent, borderRadius: 10, padding: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  applyBtnText: { color: C.white, fontWeight: '800', fontSize: 14 },
  cancelBtn: { padding: 14, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, color: C.text3 },
})

const cf = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingBottom: 40, paddingTop: 12,
    maxHeight: '80%',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: -4 },
  },
  handle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: '800', color: C.text1, marginBottom: 4 },
  subtitle: { fontSize: 13, color: C.text2, marginBottom: 16 },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  emptyText: { fontSize: 14, color: C.text3, textAlign: 'center', lineHeight: 20 },
  list: { maxHeight: 320 },
  item: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  itemMain: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    gap: 12, paddingVertical: 14,
  },
  itemName: { fontSize: 15, fontWeight: '600', color: C.text1, marginBottom: 2 },
  itemMeta: { fontSize: 12, color: C.text2 },
  deleteBtn: { padding: 8 },
  closeBtn: { backgroundColor: C.accent, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 16 },
  closeBtnText: { color: C.white, fontWeight: '800', fontSize: 16 },
})

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  segRow: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 16, marginBottom: 0,
    backgroundColor: C.surface2, borderRadius: 10, padding: 3,
  },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segBtnActive: { backgroundColor: C.surface3, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segText: { fontSize: 13, fontWeight: '600', color: C.text3 },
  segTextActive: { color: C.text1 },

  content: { padding: 16, paddingBottom: 48, gap: 14 },
  screenTitle: { fontSize: 26, fontWeight: '800', color: C.text1, marginBottom: 4 },

  card: {
    backgroundColor: C.surface, borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardLabel: {
    fontSize: 11, fontWeight: '700', color: C.text3,
    textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 14,
  },

  progressRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 12 },
  consumedNum: { fontSize: 40, fontWeight: '800', color: C.text1 },
  targetNum: { fontSize: 18, color: C.text2, fontWeight: '600' },
  barTrack: { height: 8, backgroundColor: C.surface3, borderRadius: 4, overflow: 'hidden', marginBottom: 10 },
  barFill: { height: 8, borderRadius: 4 },
  progressMeta: { marginBottom: 10 },
  remainingText: { fontSize: 13, color: C.text2, fontWeight: '500' },
  overText: { color: C.danger, fontWeight: '700' },
  noTargetNote: { fontSize: 13, color: C.text3, fontStyle: 'italic' },
  targetEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  targetEditInput: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6, fontSize: 15,
    backgroundColor: C.surface2, color: C.text1, minWidth: 80,
  },
  targetEditUnit: { fontSize: 13, color: C.text3 },
  targetSaveBtn: { backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  targetSaveBtnText: { fontSize: 13, fontWeight: '700', color: C.white },
  targetEditTrigger: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  targetEditTriggerText: { fontSize: 12, color: C.text3 },
  breakdownRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  breakdownChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.surface2, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: C.border },
  breakdownText: { fontSize: 12, color: C.text2 },
  activityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  activityPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  activityPillText: { fontSize: 12, fontWeight: '600' },

  input: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 10,
    padding: 12, fontSize: 15, backgroundColor: C.surface2, marginBottom: 10,
    color: C.text1,
  },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  macroInputWrap: { flex: 1 },
  macroInput: { marginBottom: 0 },
  addBtn: {
    backgroundColor: C.accent, borderRadius: 10, width: 46, height: 46,
    alignItems: 'center', justifyContent: 'center',
  },

  cardLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  myFoodsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.accentBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
  },
  myFoodsBtnText: { fontSize: 12, fontWeight: '700', color: C.accent },
  saveTemplateBtn: { backgroundColor: C.surface2, borderWidth: 1.5, borderColor: C.border },

  emptyNote: { fontSize: 14, color: C.text3, textAlign: 'center', paddingVertical: 16, fontStyle: 'italic' },
  logRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 },
  logRowBorder: { borderBottomWidth: 1, borderBottomColor: C.divider },
  logLeft: { flex: 1 },
  logName: { fontSize: 15, color: C.text1, fontWeight: '500', marginBottom: 2 },
  logMeta: { fontSize: 12, color: C.text2 },
  logKcal: { fontSize: 15, fontWeight: '700', color: C.text1 },
  deleteBtn: { padding: 4 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 2, borderTopColor: C.border, marginTop: 4, paddingTop: 12 },
  totalLabel: { fontSize: 14, fontWeight: '700', color: C.text1 },
  totalValue: { fontSize: 18, fontWeight: '800', color: C.text1 },
  macroTotalsRow: { flexDirection: 'row', gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.divider },
  macroChip: { backgroundColor: C.surface2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  macroChipText: { fontSize: 12, fontWeight: '700' },

  // Meal plan sub-tab
  mealProgressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  mealProgressLabel: { fontSize: 14, fontWeight: '600', color: C.text2 },
  mealProgressPct: { fontSize: 14, fontWeight: '800', color: C.accent },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  doneText: { fontSize: 15, fontWeight: '700', color: C.success },

  mealCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.surface, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
    borderLeftWidth: 3, borderLeftColor: 'transparent',
  },
  mealCardChecked: { opacity: 0.55 },
  mealCardOverdue: { borderLeftColor: C.danger },
  checkbox: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2,
  },
  checkboxChecked: { backgroundColor: C.accent, borderColor: C.accent },
  mealInfo: { flex: 1 },
  mealName: { fontSize: 16, fontWeight: '600', color: C.text1, marginBottom: 4 },
  mealNameChecked: { textDecorationLine: 'line-through', color: C.text2 },
  mealMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  mealTime: { fontSize: 13, color: C.text3 },
  mealTimeOverdue: { color: C.danger, fontWeight: '600' },
  overdueTag: { backgroundColor: 'rgba(239,83,80,0.15)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 2 },
  overdueTagText: { fontSize: 11, fontWeight: '700', color: C.danger },
  checkedLabel: { fontSize: 11, fontWeight: '600', color: C.success, marginLeft: 2 },
  mealEmptyBox: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  mealEmptyTitle: { fontSize: 16, fontWeight: '700', color: C.text2 },

  // Inline meal kcal input
  mealKcalInput: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, width: 68,
    fontSize: 14, backgroundColor: C.surface2, color: C.text1,
    textAlign: 'center',
  },
  mealKcalBadge: { fontSize: 12, fontWeight: '600', color: C.text2, minWidth: 68, textAlign: 'right' },

  // Estimate tab
  estimateTitle: { fontSize: 22, fontWeight: '800', color: C.text1, marginBottom: 4 },
  estimateNote: { fontSize: 13, color: C.text2, lineHeight: 19, marginBottom: 16 },
  estimateWarning: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: C.surface2, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border,
  },
  estimateWarningText: { flex: 1, fontSize: 13, color: C.text2, lineHeight: 19 },

  calcCard: {
    borderRadius: 16, padding: 16,
    backgroundColor: C.accentBg, borderWidth: 1, borderColor: C.accent + '33',
  },
  calcActivityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  calcActivityLabel: { fontSize: 11, fontWeight: '700', color: C.text2, textTransform: 'uppercase', letterSpacing: 0.6 },
  infoBtn: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  infoBtnText: { fontSize: 11, fontWeight: '800', color: C.accent, lineHeight: 14 },
  infoPopup: {
    backgroundColor: C.surface, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.border, marginBottom: 10,
  },
  infoPopupTitle: { fontSize: 13, fontWeight: '800', color: C.text1, marginBottom: 4 },
  infoPopupText: { fontSize: 12, color: C.text2, lineHeight: 18 },
  activityChip: {
    paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface,
    minWidth: 90, alignItems: 'center',
  },
  activityChipActive: { borderColor: C.accent, backgroundColor: C.surface },
  activityChipLabel: { fontSize: 12, fontWeight: '700', color: C.text2, textAlign: 'center' },
  activityChipLabelActive: { color: C.accent },
  activityChipDetail: { fontSize: 9, color: C.text3, marginTop: 2, textAlign: 'center' },
  helpBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 4, marginBottom: 14 },
  helpBtnText: { fontSize: 12, fontWeight: '600', color: C.accent },
  calcBreakdown: { backgroundColor: C.surface, borderRadius: 10, padding: 12, marginBottom: 12, gap: 8 },
  calcBreakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  calcBreakdownTotal: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8, marginTop: 2 },
  calcBreakdownLabel: { fontSize: 12, color: C.text2 },
  calcBreakdownValue: { fontSize: 12, fontWeight: '600', color: C.text1 },
  calcTotalLabel: { fontSize: 14, fontWeight: '800', color: C.text1 },
  calcTotalValue: { fontSize: 18, fontWeight: '800', color: C.accent },
  useTargetBtn: {
    backgroundColor: C.accent, borderRadius: 10, padding: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  useTargetBtnText: { color: C.white, fontWeight: '800', fontSize: 14 },
})
