import { useState, useCallback, useEffect, useRef } from 'react'
import { CameraView, useCameraPermissions } from 'expo-camera'
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
import { ACTIVITY_LEVELS } from '../../lib/activityLevels'
import type { ActivityLevelKey as ActivityLevel } from '../../lib/activityLevels'
import type { FoodLog, MealTemplate } from '../../types'

interface CustomFood {
  id: string
  name: string
  kcal: number
  protein_g: number | null
  fat_g: number | null
  carb_g: number | null
}

interface DayData {
  dateStr: string
  dayLabel: string
  fullDate: string
  isToday: boolean
  isFuture: boolean
  consumed: number
  burned: number
  target: number | null
}

type SubTab = 'nutrition' | 'meals' | 'week' | 'estimate'
type NutriPeriod = 'total' | 'week' | 'month' | 'year' | 'custom'

const NUTRI_PERIOD_OPTIONS: { label: string; value: NutriPeriod }[] = [
  { label: 'All history', value: 'total' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
  { label: 'Year', value: 'year' },
  { label: 'Custom range…', value: 'custom' },
]

function localDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nStartOf(period: Exclude<NutriPeriod, 'total' | 'custom'>, anchor: Date): Date {
  const d = new Date(anchor)
  switch (period) {
    case 'week': { const dow = d.getDay(); d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); d.setHours(0, 0, 0, 0); return d }
    case 'month': d.setDate(1); d.setHours(0, 0, 0, 0); return d
    case 'year': d.setMonth(0, 1); d.setHours(0, 0, 0, 0); return d
  }
}
function nEndOf(period: Exclude<NutriPeriod, 'total' | 'custom'>, start: Date): Date {
  const d = new Date(start)
  switch (period) {
    case 'week': d.setDate(d.getDate() + 6); d.setHours(23, 59, 59, 999); return d
    case 'month': d.setMonth(d.getMonth() + 1, 0); d.setHours(23, 59, 59, 999); return d
    case 'year': d.setMonth(11, 31); d.setHours(23, 59, 59, 999); return d
  }
}
function nAdvance(period: Exclude<NutriPeriod, 'total' | 'custom'>, anchor: Date, delta: number): Date {
  const d = new Date(anchor)
  switch (period) {
    case 'week': d.setDate(d.getDate() + delta * 7); break
    case 'month': d.setMonth(d.getMonth() + delta); break
    case 'year': d.setFullYear(d.getFullYear() + delta); break
  }
  return d
}
function nNavLabel(period: Exclude<NutriPeriod, 'total' | 'custom'>, anchor: Date): string {
  const start = nStartOf(period, anchor), end = nEndOf(period, start)
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(undefined, o)
  switch (period) {
    case 'week': return `${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short', year: 'numeric' })}`
    case 'month': return fmt(start, { month: 'long', year: 'numeric' })
    case 'year': return String(start.getFullYear())
  }
}
function parseDDMMYYYYNutri(s: string): string | null {
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d))
  if (isNaN(date.getTime())) return null
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}
function generateDays(startStr: string, endStr: string): DayData[] {
  const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const todayStr = localDate()
  const result: DayData[] = []
  const cur = new Date(startStr + 'T12:00:00')
  const end = new Date(endStr + 'T12:00:00')
  while (cur <= end) {
    const dateStr = toDateStr(cur)
    result.push({
      dateStr,
      dayLabel: SHORT_DAYS[cur.getDay()],
      fullDate: cur.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      isToday: dateStr === todayStr,
      isFuture: dateStr > todayStr,
      consumed: 0, burned: 0, target: null,
    })
    cur.setDate(cur.getDate() + 1)
  }
  return result
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

interface CommonFood { name: string; kcal: number; protein_g?: number; fat_g?: number; carb_g?: number }
const COMMON_FOOD_CATEGORIES: { category: string; items: CommonFood[] }[] = [
  {
    category: 'Fruit',
    items: [
      { name: 'Apple (medium)', kcal: 72, carb_g: 19 },
      { name: 'Banana (medium)', kcal: 89, carb_g: 23, protein_g: 1 },
      { name: 'Orange (medium)', kcal: 62, carb_g: 15 },
      { name: 'Raspberries (100g)', kcal: 52, carb_g: 12, protein_g: 1 },
      { name: 'Blueberries (100g)', kcal: 57, carb_g: 14, protein_g: 1 },
      { name: 'Strawberries (100g)', kcal: 32, carb_g: 8 },
      { name: 'Mango (100g)', kcal: 60, carb_g: 15 },
      { name: 'Grapes (100g)', kcal: 69, carb_g: 18 },
    ],
  },
  {
    category: 'Drinks',
    items: [
      { name: 'Cup of coffee (black)', kcal: 2 },
      { name: 'Coffee with milk', kcal: 30, protein_g: 2, fat_g: 1 },
      { name: 'Latte (250ml)', kcal: 120, protein_g: 6, fat_g: 5, carb_g: 10 },
      { name: 'Cup of tea (black)', kcal: 1 },
      { name: 'Tea with milk', kcal: 20, protein_g: 1 },
      { name: 'Coke (330ml)', kcal: 139, carb_g: 35 },
      { name: 'Diet Coke (330ml)', kcal: 1 },
      { name: 'Orange juice (250ml)', kcal: 112, carb_g: 26 },
      { name: 'Whole milk (250ml)', kcal: 152, protein_g: 8, fat_g: 8, carb_g: 12 },
      { name: 'Oat milk (250ml)', kcal: 130, protein_g: 3, fat_g: 5, carb_g: 17 },
      { name: 'Sports drink (500ml)', kcal: 150, carb_g: 36 },
      { name: 'Protein shake (scoop)', kcal: 120, protein_g: 25, carb_g: 4, fat_g: 2 },
    ],
  },
  {
    category: 'Bread & Grains',
    items: [
      { name: 'Slice of bread (white)', kcal: 79, carb_g: 15, protein_g: 3, fat_g: 1 },
      { name: 'Slice of bread (whole wheat)', kcal: 69, carb_g: 12, protein_g: 4, fat_g: 1 },
      { name: 'Bagel (plain)', kcal: 270, carb_g: 53, protein_g: 10, fat_g: 2 },
      { name: 'Croissant', kcal: 231, carb_g: 26, protein_g: 5, fat_g: 12 },
      { name: 'Oats (50g uncooked)', kcal: 188, protein_g: 6, fat_g: 3, carb_g: 33 },
      { name: 'White rice (100g uncooked)', kcal: 365, protein_g: 7, fat_g: 1, carb_g: 79 },
      { name: 'Pasta (100g uncooked)', kcal: 371, protein_g: 13, fat_g: 2, carb_g: 74 },
      { name: 'Wrap / tortilla', kcal: 210, carb_g: 36, protein_g: 5, fat_g: 5 },
    ],
  },
  {
    category: 'Dairy & Eggs',
    items: [
      { name: 'Egg (large)', kcal: 72, protein_g: 6, fat_g: 5 },
      { name: 'Greek yogurt (150g)', kcal: 133, protein_g: 15, fat_g: 5, carb_g: 6 },
      { name: 'Cottage cheese (100g)', kcal: 98, protein_g: 11, fat_g: 4, carb_g: 3 },
      { name: 'Cheddar cheese (30g)', kcal: 120, protein_g: 7, fat_g: 10 },
      { name: 'Skyr (150g)', kcal: 90, protein_g: 15, fat_g: 0, carb_g: 6 },
    ],
  },
  {
    category: 'Protein',
    items: [
      { name: 'Chicken breast (100g)', kcal: 165, protein_g: 31, fat_g: 4 },
      { name: 'Salmon (100g)', kcal: 208, protein_g: 20, fat_g: 13 },
      { name: 'Tuna in water (100g)', kcal: 116, protein_g: 26, fat_g: 1 },
      { name: 'Beef mince 5% fat (100g)', kcal: 137, protein_g: 21, fat_g: 5 },
      { name: 'Tofu (100g)', kcal: 76, protein_g: 8, fat_g: 5, carb_g: 2 },
      { name: 'Energy bar (avg)', kcal: 220, protein_g: 8, carb_g: 30, fat_g: 7 },
    ],
  },
  {
    category: 'Nuts & Spreads',
    items: [
      { name: 'Almonds (30g)', kcal: 174, protein_g: 6, fat_g: 15, carb_g: 6 },
      { name: 'Peanut butter (1 tbsp)', kcal: 94, protein_g: 4, fat_g: 8, carb_g: 3 },
      { name: 'Almond butter (1 tbsp)', kcal: 98, protein_g: 3, fat_g: 9, carb_g: 3 },
      { name: 'Avocado (half)', kcal: 120, fat_g: 11, carb_g: 6, protein_g: 2 },
      { name: 'Hummus (2 tbsp)', kcal: 70, protein_g: 3, fat_g: 5, carb_g: 5 },
    ],
  },
  {
    category: 'Snacks & Sweets',
    items: [
      { name: 'Banana bread (slice)', kcal: 196, carb_g: 33, protein_g: 3, fat_g: 6 },
      { name: 'Dark chocolate (30g)', kcal: 170, fat_g: 12, carb_g: 13, protein_g: 2 },
      { name: 'Rice cake (plain)', kcal: 35, carb_g: 7 },
      { name: 'Granola bar', kcal: 193, carb_g: 29, protein_g: 4, fat_g: 7 },
      { name: 'Medjool date (1 piece)', kcal: 66, carb_g: 18 },
    ],
  },
]

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

  // ── Quick add state ──────────────────────────────────────────────────────────
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  // ── Barcode scanner state ────────────────────────────────────────────────────
  const [scannerVisible, setScannerVisible] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const [scanResult, setScanResult] = useState<{ name: string; kcal: number; protein_g: number | null; fat_g: number | null; carb_g: number | null } | null>(null)
  const lastScannedRef = useRef<string | null>(null)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()

  // ── Macro goals state ────────────────────────────────────────────────────────
  const [goalProtein, setGoalProtein] = useState<number | null>(null)
  const [goalFat, setGoalFat] = useState<number | null>(null)
  const [goalCarb, setGoalCarb] = useState<number | null>(null)


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
  const effectiveProteinGoal = goalProtein ?? (baseline ? Math.round(baseline * 0.2 / 4) : null)
  const effectiveFatGoal = goalFat ?? (baseline ? Math.round(baseline * 0.3 / 9) : null)
  const effectiveCarbGoal = goalCarb ?? (baseline ? Math.round(baseline * 0.5 / 4) : null)
  const checkedCount = meals.filter(m => m.checked).length
  const allMealsDone = meals.length > 0 && checkedCount === meals.length
  const barColor = remaining != null && remaining < 0 ? C.danger : C.accent

  useFocusEffect(useCallback(() => {
    loadAll()
  }, []))

  async function openScanner() {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission()
      if (!result.granted) return
    }
    lastScannedRef.current = null
    setScanResult(null)
    setScannerVisible(true)
  }

  async function handleBarcodeScan({ data }: { data: string }) {
    if (lastScannedRef.current === data) return
    lastScannedRef.current = data
    setScanLoading(true)
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v3/product/${data}.json`)
      const json = await res.json()
      const p = json.product
      if (!p) { setScanLoading(false); setScanResult(null); Alert.alert('Not found', 'Product not found in Open Food Facts. Try entering it manually.'); return }
      const kcalPer100 = p.nutriments?.['energy-kcal_100g'] ?? p.nutriments?.['energy-kcal'] ?? null
      if (!kcalPer100) { setScanLoading(false); Alert.alert('No calorie data', 'This product has no calorie data. Enter it manually.'); return }
      setScanResult({
        name: p.product_name ?? p.abbreviated_product_name ?? 'Unknown product',
        kcal: Math.round(kcalPer100),
        protein_g: p.nutriments?.proteins_100g != null ? Math.round(p.nutriments.proteins_100g * 10) / 10 : null,
        fat_g: p.nutriments?.fat_100g != null ? Math.round(p.nutriments.fat_100g * 10) / 10 : null,
        carb_g: p.nutriments?.carbohydrates_100g != null ? Math.round(p.nutriments.carbohydrates_100g * 10) / 10 : null,
      })
    } catch {
      Alert.alert('Error', 'Could not fetch product data.')
    } finally {
      setScanLoading(false)
    }
  }

  function applyScanResult() {
    if (!scanResult) return
    setFoodName(scanResult.name)
    setFoodKcal(String(scanResult.kcal))
    setFoodProtein(scanResult.protein_g != null ? String(scanResult.protein_g) : '')
    setFoodFat(scanResult.fat_g != null ? String(scanResult.fat_g) : '')
    setFoodCarb(scanResult.carb_g != null ? String(scanResult.carb_g) : '')
    setScannerVisible(false)
    setScanResult(null)
  }

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    await Promise.all([loadNutrition(user.id), loadMeals(user.id)])
  }

  async function loadNutrition(uid: string) {
    setNutritionLoading(true)
    const [profileRes, actsRes, plannedRes, logsRes, customFoodsRes] = await Promise.all([
      supabase.from('users').select('daily_kcal_target, weight_kg, height_cm, age, sex, goal_protein_g, goal_fat_g, goal_carb_g').eq('id', uid).single(),
      supabase.from('activities').select('id, name, type, total_kcal')
        .eq('user_id', uid).gte('date', todayStr).not('total_kcal', 'is', null),
      supabase.from('planned_workouts').select('target_kcal')
        .eq('user_id', uid).eq('planned_for', todayStr),
      supabase.from('food_logs').select('*')
        .eq('user_id', uid).eq('date', todayStr).order('logged_at'),
      supabase.from('custom_foods').select('*').eq('user_id', uid).order('name'),
    ])
    setBaseline(profileRes.data?.daily_kcal_target ?? null)
    setGoalProtein(profileRes.data?.goal_protein_g ?? null)
    setGoalFat(profileRes.data?.goal_fat_g ?? null)
    setGoalCarb(profileRes.data?.goal_carb_g ?? null)
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
          { key: 'nutrition', label: 'Today' },
          { key: 'meals', label: 'Meals' },
          { key: 'week', label: 'Week' },
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

      <BarcodeScannerModal
        visible={scannerVisible}
        loading={scanLoading}
        result={scanResult}
        onBarcodeScanned={handleBarcodeScan}
        onApply={applyScanResult}
        onRetry={() => { lastScannedRef.current = null; setScanResult(null) }}
        onClose={() => { setScannerVisible(false); setScanResult(null) }}
      />

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
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={openScanner} style={[st.myFoodsBtn, { backgroundColor: 'rgba(126,87,194,0.12)' }]}>
                    <Ionicons name="barcode-outline" size={13} color="#7E57C2" />
                    <Text style={[st.myFoodsBtnText, { color: '#7E57C2' }]}>Scan</Text>
                  </Pressable>
                  <Pressable onPress={() => setCustomFoodsModalVisible(true)} style={st.myFoodsBtn}>
                    <Ionicons name="bookmark-outline" size={13} color={C.accent} />
                    <Text style={st.myFoodsBtnText}>My Foods</Text>
                  </Pressable>
                </View>
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

            {/* Common foods quick-add */}
            <View style={st.card}>
              <Text style={st.cardLabel}>Quick add</Text>
              <Text style={st.quickAddNote}>Tap any item to pre-fill the form above</Text>
              {COMMON_FOOD_CATEGORIES.map(cat => {
                const isOpen = expandedCategories.has(cat.category)
                return (
                  <View key={cat.category} style={st.quickAddCategory}>
                    <Pressable
                      style={st.quickAddCategoryHeader}
                      onPress={() => setExpandedCategories(prev => {
                        const next = new Set(prev)
                        isOpen ? next.delete(cat.category) : next.add(cat.category)
                        return next
                      })}
                    >
                      <Text style={st.quickAddCategoryLabel}>{cat.category}</Text>
                      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color={C.text3} />
                    </Pressable>
                    {isOpen && cat.items.map((food, i) => (
                      <Pressable
                        key={food.name}
                        style={[st.quickAddRow, i < cat.items.length - 1 && st.quickAddRowBorder]}
                        onPress={() => {
                          setFoodName(food.name)
                          setFoodKcal(String(food.kcal))
                          setFoodProtein(food.protein_g != null ? String(food.protein_g) : '')
                          setFoodFat(food.fat_g != null ? String(food.fat_g) : '')
                          setFoodCarb(food.carb_g != null ? String(food.carb_g) : '')
                        }}
                      >
                        <Text style={st.quickAddRowName}>{food.name}</Text>
                        <Text style={st.quickAddRowKcal}>{food.kcal} kcal</Text>
                      </Pressable>
                    ))}
                  </View>
                )
              })}
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
                const macros = [
                  { label: 'Protein', color: C.accent, consumed: totalP, goal: effectiveProteinGoal },
                  { label: 'Fat', color: C.walk, consumed: totalF, goal: effectiveFatGoal },
                  { label: 'Carbs', color: C.accent2, consumed: totalC, goal: effectiveCarbGoal },
                ].filter(m => m.consumed > 0 || m.goal != null)
                return (
                  <>
                    {macros.length > 0 && (
                      <View style={st.macroProgressSection}>
                        {macros.map(m => (
                          <View key={m.label} style={st.macroProgressRow}>
                            <Text style={[st.macroProgressLabel, { color: m.color }]}>{m.label}</Text>
                            {m.goal != null ? (
                              <View style={st.macroProgressBarTrack}>
                                <View style={[st.macroProgressBarFill, {
                                  width: `${Math.min((m.consumed / m.goal) * 100, 100)}%` as any,
                                  backgroundColor: m.color,
                                }]} />
                              </View>
                            ) : (
                              <View style={{ flex: 1 }} />
                            )}
                            <Text style={[st.macroProgressValue, m.goal != null && m.consumed > m.goal && { color: C.danger }]}>
                              {Math.round(m.consumed)}g{m.goal != null ? ` / ${m.goal}g` : ''}
                            </Text>
                          </View>
                        ))}
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
                <Pressable
                  key={meal.meal_index}
                  style={[st.mealCard, meal.checked && st.mealCardChecked, overdue && st.mealCardOverdue]}
                  onPress={() => handleMealTap(meal)}
                  disabled={isChecking}
                >
                  <View style={[st.checkbox, meal.checked && st.checkboxChecked]}>
                    {isChecking
                      ? <ActivityIndicator size="small" color={meal.checked ? C.white : C.accent} />
                      : meal.checked
                        ? <Ionicons name="checkmark" size={16} color={C.white} />
                        : null
                    }
                  </View>
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
                </Pressable>
              )
            })}
          </>
        )}

        {/* ── HISTORY ──────────────────────────────────────────────────────── */}
        {subTab === 'week' && (
          <HistoryView userId={userId} />
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

// ─── History view ──────────────────────────────────────────────────────────

function DayRow({ day, last }: { day: DayData; last: boolean }) {
  const ratio = day.target && day.consumed > 0 ? day.consumed / day.target : 0
  const isMet = ratio >= 0.9 && ratio <= 1.15
  const isOver = ratio > 1.15
  const isUnder = !day.isFuture && day.consumed > 0 && ratio < 0.9
  const barColor = day.isFuture ? C.surface3
    : day.isToday ? C.accent
    : isMet ? C.success
    : isOver ? C.danger
    : isUnder ? C.warning
    : C.surface3
  const fillPct = day.isFuture ? 0 : Math.min(ratio, 1) * 100
  return (
    <View style={[hv.dayRow, !last && { borderBottomWidth: 1, borderBottomColor: C.divider }]}>
      <View style={hv.dayLabelCol}>
        <Text style={[hv.dayName, day.isToday && { color: C.accent, fontWeight: '800' }]}>{day.dayLabel}</Text>
        <Text style={hv.dayDate}>{day.fullDate}</Text>
      </View>
      <View style={hv.dayBarCol}>
        <View style={hv.barTrack}>
          <View style={[hv.barFill, { width: `${fillPct}%` as any, backgroundColor: barColor }]} />
          {isOver && <View style={[hv.barOverflow, { backgroundColor: C.danger }]} />}
        </View>
        <View style={hv.dayNumbers}>
          <Text style={[hv.dayConsumed, (day.isFuture || day.consumed === 0) && { color: C.text3 }]}>
            {day.isFuture || day.consumed === 0 ? '—' : day.consumed.toLocaleString()}
          </Text>
          {day.target != null && <Text style={hv.dayTarget}>/ {day.target.toLocaleString()} kcal</Text>}
        </View>
      </View>
      <View style={hv.statusCol}>
        {day.isToday && <View style={[hv.statusDot, { backgroundColor: C.accent }]} />}
        {!day.isToday && isMet && day.consumed > 0 && <Ionicons name="checkmark-circle" size={18} color={C.success} />}
        {!day.isToday && isOver && <Ionicons name="arrow-up-circle" size={18} color={C.danger} />}
        {!day.isToday && isUnder && <Ionicons name="remove-circle" size={18} color={C.warning} />}
        {!day.isToday && !isMet && !isOver && !isUnder && <Ionicons name="ellipse-outline" size={18} color={C.text3} />}
      </View>
    </View>
  )
}

function HistoryView({ userId }: { userId: string | null }) {
  const [period, setPeriod] = useState<NutriPeriod>('week')
  const [anchor, setAnchor] = useState(new Date())
  const [monthsBack, setMonthsBack] = useState(3)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [customStartText, setCustomStartText] = useState('')
  const [customEndText, setCustomEndText] = useState('')
  const [customStart, setCustomStart] = useState<string | null>(null)
  const [customEnd, setCustomEnd] = useState<string | null>(null)
  const [days, setDays] = useState<DayData[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!userId) return
    load()
  }, [userId, period, anchor, monthsBack, customStart, customEnd])

  async function load() {
    setLoading(true)
    const todayStr = localDate()
    let startStr: string, endStr: string
    if (period === 'total') {
      const s = new Date(); s.setMonth(s.getMonth() - monthsBack); s.setDate(1)
      startStr = toDateStr(s); endStr = todayStr
    } else if (period === 'custom') {
      if (!customStart || !customEnd) { setDays([]); setLoading(false); return }
      startStr = customStart; endStr = customEnd
    } else {
      const s = nStartOf(period, anchor)
      startStr = toDateStr(s); endStr = toDateStr(nEndOf(period, s))
    }
    const [profileRes, foodRes, actsRes] = await Promise.all([
      supabase.from('users').select('daily_kcal_target').eq('id', userId!).single(),
      supabase.from('food_logs').select('date, kcal').eq('user_id', userId!)
        .gte('date', startStr).lte('date', endStr),
      supabase.from('activities').select('date, total_kcal').eq('user_id', userId!)
        .gte('date', `${startStr}T00:00:00`).lte('date', `${endStr}T23:59:59`)
        .not('total_kcal', 'is', null),
    ])
    const baseline: number | null = profileRes.data?.daily_kcal_target ?? null
    const foodByDate: Record<string, number> = {}
    for (const row of (foodRes.data ?? [])) foodByDate[row.date] = (foodByDate[row.date] ?? 0) + row.kcal
    const burnedByDate: Record<string, number> = {}
    for (const row of (actsRes.data ?? [])) {
      const d = (row.date as string).slice(0, 10)
      burnedByDate[d] = (burnedByDate[d] ?? 0) + (row.total_kcal ?? 0)
    }
    const result = generateDays(startStr, endStr).map(day => {
      const burned = Math.round(burnedByDate[day.dateStr] ?? 0)
      return { ...day, consumed: Math.round(foodByDate[day.dateStr] ?? 0), burned, target: baseline != null ? baseline + burned : null }
    })
    setDays(result)
    setLoading(false)
  }

  function selectPeriod(p: NutriPeriod) {
    setPeriod(p); setAnchor(new Date())
    if (p !== 'custom') { setCustomStart(null); setCustomEnd(null) }
    setDropdownOpen(false)
  }

  function applyCustom() {
    const s = parseDDMMYYYYNutri(customStartText), e = parseDDMMYYYYNutri(customEndText)
    if (s && e && s <= e) { setCustomStart(s); setCustomEnd(e) }
  }

  function periodLabel(): string {
    if (period === 'total') return 'All history'
    if (period === 'custom') {
      if (customStart && customEnd) {
        const fmt = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
        return `${fmt(customStart)} – ${fmt(customEnd)}`
      }
      return 'Custom range'
    }
    return nNavLabel(period, anchor)
  }

  const isFixed = period !== 'total' && period !== 'custom'
  const past = days.filter(d => !d.isFuture && !d.isToday)
  const daysWithData = days.filter(d => !d.isFuture && d.consumed > 0)
  const metCount = daysWithData.filter(d => {
    if (!d.target) return false
    const r = d.consumed / d.target
    return r >= 0.9 && r <= 1.15
  }).length
  const avgConsumed = daysWithData.length > 0
    ? Math.round(daysWithData.reduce((s, d) => s + d.consumed, 0) / daysWithData.length)
    : null

  // Group by month for total / custom views
  const monthGroups: { key: string; label: string; days: DayData[] }[] = []
  if (period === 'total' || period === 'custom') {
    const map = new Map<string, DayData[]>()
    for (const d of days) {
      const mk = d.dateStr.slice(0, 7)
      if (!map.has(mk)) map.set(mk, [])
      map.get(mk)!.push(d)
    }
    for (const [mk, mDays] of map) {
      const [y, mo] = mk.split('-').map(Number)
      monthGroups.push({
        key: mk,
        label: new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        days: mDays,
      })
    }
  }

  return (
    <View style={{ gap: 12 }}>
      {/* Period selector */}
      <Pressable style={hv.selectorBtn} onPress={() => setDropdownOpen(true)}>
        <Text style={hv.selectorText} numberOfLines={1}>{periodLabel()}</Text>
        <Ionicons name="chevron-down" size={14} color={C.text2} style={{ marginLeft: 6 }} />
      </Pressable>

      {/* Custom range inputs */}
      {period === 'custom' && (
        <View style={hv.customRange}>
          <View style={hv.customField}>
            <Text style={hv.customLabel}>FROM</Text>
            <TextInput style={hv.customInput} placeholder="DD-MM-YYYY" placeholderTextColor={C.text3}
              value={customStartText} onChangeText={setCustomStartText} onBlur={applyCustom} keyboardType="numbers-and-punctuation" />
          </View>
          <Text style={hv.customSep}>–</Text>
          <View style={hv.customField}>
            <Text style={hv.customLabel}>TO</Text>
            <TextInput style={hv.customInput} placeholder="DD-MM-YYYY" placeholderTextColor={C.text3}
              value={customEndText} onChangeText={setCustomEndText} onBlur={applyCustom} keyboardType="numbers-and-punctuation" />
          </View>
          <Pressable style={hv.applyBtn} onPress={applyCustom}><Text style={hv.applyBtnText}>Go</Text></Pressable>
        </View>
      )}

      {/* Nav arrows */}
      {isFixed && (
        <View style={hv.navRow}>
          <Pressable style={hv.navBtn} onPress={() => setAnchor(a => nAdvance(period, a, -1))}>
            <Text style={hv.navArrow}>‹</Text>
          </Pressable>
          <Pressable style={hv.navBtn} onPress={() => setAnchor(a => nAdvance(period, a, 1))}>
            <Text style={hv.navArrow}>›</Text>
          </Pressable>
        </View>
      )}

      {loading && <ActivityIndicator color={C.accent} style={{ marginVertical: 24 }} />}

      {!loading && (
        <>
          {/* Summary */}
          {daysWithData.length > 0 && (
            <View style={hv.summaryCard}>
              <View style={hv.summaryItem}>
                <Text style={hv.summaryNum}>{metCount}/{daysWithData.length}</Text>
                <Text style={hv.summaryLabel}>days on target</Text>
              </View>
              <View style={hv.summaryDivider} />
              <View style={hv.summaryItem}>
                <Text style={hv.summaryNum}>{avgConsumed?.toLocaleString() ?? '—'}</Text>
                <Text style={hv.summaryLabel}>avg kcal/day</Text>
              </View>
              <View style={hv.summaryDivider} />
              <View style={hv.summaryItem}>
                <Text style={hv.summaryNum}>{daysWithData.length}</Text>
                <Text style={hv.summaryLabel}>days logged</Text>
              </View>
            </View>
          )}

          {/* Day rows — flat for week/month/year, grouped by month for total/custom */}
          {isFixed && days.length > 0 && (
            <View style={hv.daysCard}>
              {days.map((d, i) => <DayRow key={d.dateStr} day={d} last={i === days.length - 1} />)}
            </View>
          )}
          {!isFixed && monthGroups.map(g => (
            <View key={g.key}>
              <Text style={hv.monthHeader}>{g.label}</Text>
              <View style={hv.daysCard}>
                {g.days.map((d, i) => <DayRow key={d.dateStr} day={d} last={i === g.days.length - 1} />)}
              </View>
            </View>
          ))}

          {/* Load more */}
          {period === 'total' && (
            <Pressable style={hv.loadMoreBtn} onPress={() => setMonthsBack(n => n + 3)}>
              <Text style={hv.loadMoreText}>Load earlier months</Text>
            </Pressable>
          )}

          {/* Legend */}
          {(days.length > 0 || past.length > 0) && (
            <View style={hv.legend}>
              <View style={hv.legendItem}><Ionicons name="checkmark-circle" size={13} color={C.success} /><Text style={hv.legendText}>On target (90–115%)</Text></View>
              <View style={hv.legendItem}><Ionicons name="remove-circle" size={13} color={C.warning} /><Text style={hv.legendText}>Under (&lt;90%)</Text></View>
              <View style={hv.legendItem}><Ionicons name="arrow-up-circle" size={13} color={C.danger} /><Text style={hv.legendText}>Over (&gt;115%)</Text></View>
            </View>
          )}

          {period === 'custom' && !customStart && (
            <Text style={hv.emptyNote}>Enter a date range above.</Text>
          )}
        </>
      )}

      {/* Period dropdown */}
      <Modal visible={dropdownOpen} transparent animationType="fade">
        <Pressable style={hv.modalOverlay} onPress={() => setDropdownOpen(false)}>
          <Pressable style={hv.dropdownSheet} onPress={e => e.stopPropagation()}>
            <Text style={hv.dropdownTitle}>View period</Text>
            {NUTRI_PERIOD_OPTIONS.map(opt => (
              <Pressable key={opt.value} style={hv.dropdownRow} onPress={() => selectPeriod(opt.value)}>
                <Text style={[hv.dropdownRowText, period === opt.value && hv.dropdownRowActive]}>{opt.label}</Text>
                {period === opt.value && <Ionicons name="checkmark" size={16} color={C.accent} />}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const hv = StyleSheet.create({
  selectorBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: C.surface2, borderRadius: 10, borderWidth: 1, borderColor: C.border,
  },
  selectorText: { fontSize: 15, fontWeight: '700', color: C.text1, flex: 1 },
  customRange: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  customField: { flex: 1 },
  customLabel: { fontSize: 10, fontWeight: '700', color: C.text3, marginBottom: 4, textTransform: 'uppercase' },
  customInput: { borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 9, fontSize: 13, backgroundColor: C.surface2, color: C.text1 },
  customSep: { fontSize: 18, color: C.text3, marginBottom: 10 },
  applyBtn: { backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 1 },
  applyBtnText: { color: C.white, fontWeight: '700', fontSize: 13 },
  navRow: { flexDirection: 'row', gap: 4 },
  navBtn: { padding: 6 },
  navArrow: { fontSize: 26, color: C.text2, lineHeight: 30 },
  summaryCard: {
    flexDirection: 'row', backgroundColor: C.surface, borderRadius: 18,
    padding: 18, borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, backgroundColor: C.border, marginHorizontal: 8 },
  summaryNum: { fontSize: 22, fontWeight: '800', color: C.text1, marginBottom: 2 },
  summaryLabel: { fontSize: 11, color: C.text3, textAlign: 'center' },
  monthHeader: { fontSize: 16, fontWeight: '800', color: C.text1, paddingVertical: 4 },
  daysCard: {
    backgroundColor: C.surface, borderRadius: 18, paddingHorizontal: 18,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 10 },
  dayLabelCol: { width: 40 },
  dayName: { fontSize: 13, fontWeight: '700', color: C.text1 },
  dayDate: { fontSize: 11, color: C.text3, marginTop: 1 },
  dayBarCol: { flex: 1 },
  barTrack: { height: 7, backgroundColor: C.surface3, borderRadius: 4, overflow: 'hidden', marginBottom: 5 },
  barFill: { height: 7, borderRadius: 4 },
  barOverflow: { position: 'absolute', right: 0, top: 0, width: 4, height: 7, borderRadius: 2 },
  dayNumbers: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  dayConsumed: { fontSize: 13, fontWeight: '700', color: C.text1 },
  dayTarget: { fontSize: 11, color: C.text3 },
  statusCol: { width: 22, alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  loadMoreBtn: { padding: 14, borderRadius: 10, backgroundColor: C.surface2, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  loadMoreText: { fontSize: 14, color: C.text2, fontWeight: '600' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { fontSize: 11, color: C.text3 },
  emptyNote: { fontSize: 13, color: C.text3, textAlign: 'center', paddingVertical: 24, fontStyle: 'italic' },
  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  dropdownSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8, paddingBottom: 40,
  },
  dropdownTitle: { fontSize: 12, fontWeight: '700', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8, paddingHorizontal: 20, paddingVertical: 12 },
  dropdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderTopWidth: 1, borderTopColor: C.divider },
  dropdownRowText: { fontSize: 16, color: C.text1 },
  dropdownRowActive: { color: C.accent, fontWeight: '700' },
})

// ─── Barcode scanner modal ─────────────────────────────────────────────────

function BarcodeScannerModal({ visible, loading, result, onBarcodeScanned, onApply, onRetry, onClose }: {
  visible: boolean
  loading: boolean
  result: { name: string; kcal: number; protein_g: number | null; fat_g: number | null; carb_g: number | null } | null
  onBarcodeScanned: (scan: { data: string }) => void
  onApply: () => void
  onRetry: () => void
  onClose: () => void
}) {
  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <View style={bs.container}>
        <CameraView
          style={bs.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'qr'] }}
          onBarcodeScanned={!loading && !result ? onBarcodeScanned : undefined}
        />

        {/* Overlay */}
        <View style={bs.overlay} pointerEvents="none">
          <View style={bs.scanFrame} />
        </View>

        {/* Close button */}
        <Pressable style={bs.closeBtn} onPress={onClose}>
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>

        {/* Bottom sheet */}
        <View style={bs.sheet}>
          {loading && (
            <View style={bs.sheetContent}>
              <ActivityIndicator color={C.accent} size="large" />
              <Text style={bs.sheetHint}>Looking up product…</Text>
            </View>
          )}
          {!loading && !result && (
            <View style={bs.sheetContent}>
              <Ionicons name="barcode-outline" size={32} color={C.text3} />
              <Text style={bs.sheetHint}>Point the camera at a barcode</Text>
            </View>
          )}
          {!loading && result && (
            <View style={bs.resultContent}>
              <Text style={bs.resultName} numberOfLines={2}>{result.name}</Text>
              <Text style={bs.resultPer}>per 100g</Text>
              <View style={bs.resultMacros}>
                <View style={bs.macroPill}>
                  <Text style={[bs.macroNum, { color: C.accent }]}>{result.kcal}</Text>
                  <Text style={bs.macroLabel}>kcal</Text>
                </View>
                {result.protein_g != null && (
                  <View style={bs.macroPill}>
                    <Text style={[bs.macroNum, { color: '#29B6F6' }]}>{result.protein_g}g</Text>
                    <Text style={bs.macroLabel}>protein</Text>
                  </View>
                )}
                {result.fat_g != null && (
                  <View style={bs.macroPill}>
                    <Text style={[bs.macroNum, { color: C.warning }]}>{result.fat_g}g</Text>
                    <Text style={bs.macroLabel}>fat</Text>
                  </View>
                )}
                {result.carb_g != null && (
                  <View style={bs.macroPill}>
                    <Text style={[bs.macroNum, { color: C.accent2 }]}>{result.carb_g}g</Text>
                    <Text style={bs.macroLabel}>carbs</Text>
                  </View>
                )}
              </View>
              <View style={bs.resultBtns}>
                <Pressable style={bs.retryBtn} onPress={onRetry}>
                  <Ionicons name="refresh-outline" size={16} color={C.text2} />
                  <Text style={bs.retryText}>Scan again</Text>
                </Pressable>
                <Pressable style={bs.applyBtn} onPress={onApply}>
                  <Ionicons name="add-circle-outline" size={16} color={C.white} />
                  <Text style={bs.applyText}>Add to log</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
}

const bs = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    width: 240, height: 160, borderRadius: 16,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)',
    shadowColor: '#fff', shadowOpacity: 0.3, shadowRadius: 8,
  },
  closeBtn: {
    position: 'absolute', top: 56, right: 20,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 8,
  },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48, minHeight: 140,
  },
  sheetContent: { alignItems: 'center', gap: 12, paddingVertical: 16 },
  sheetHint: { fontSize: 15, color: C.text2, textAlign: 'center' },
  resultContent: { gap: 8 },
  resultName: { fontSize: 17, fontWeight: '800', color: C.text1, lineHeight: 22 },
  resultPer: { fontSize: 11, color: C.text3, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  resultMacros: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginVertical: 4 },
  macroPill: { backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center', minWidth: 64 },
  macroNum: { fontSize: 16, fontWeight: '800' },
  macroLabel: { fontSize: 10, color: C.text3, marginTop: 1 },
  resultBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
  retryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingVertical: 12,
    backgroundColor: C.surface2,
  },
  retryText: { fontSize: 14, fontWeight: '700', color: C.text2 },
  applyBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.accent, borderRadius: 12, paddingVertical: 12,
  },
  applyText: { fontSize: 14, fontWeight: '800', color: C.white },
})

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

  quickAddNote: { fontSize: 12, color: C.text3, marginBottom: 8 },
  quickAddCategory: { borderTopWidth: 1, borderTopColor: C.divider },
  quickAddCategoryHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11,
  },
  quickAddCategoryLabel: { fontSize: 13, fontWeight: '700', color: C.text2 },
  quickAddRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, paddingLeft: 10,
  },
  quickAddRowBorder: { borderBottomWidth: 1, borderBottomColor: C.divider },
  quickAddRowName: { fontSize: 13, color: C.text1, flex: 1 },
  quickAddRowKcal: { fontSize: 12, color: C.text3, fontWeight: '600', marginLeft: 8 },
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
  macroProgressSection: { paddingTop: 10, borderTopWidth: 1, borderTopColor: C.divider, gap: 8 },
  macroProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  macroProgressLabel: { fontSize: 12, fontWeight: '700', width: 54 },
  macroProgressBarTrack: { flex: 1, height: 6, backgroundColor: C.surface3, borderRadius: 3, overflow: 'hidden' },
  macroProgressBarFill: { height: 6, borderRadius: 3 },
  macroProgressValue: { fontSize: 12, fontWeight: '600', color: C.text2, minWidth: 76, textAlign: 'right' },

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
