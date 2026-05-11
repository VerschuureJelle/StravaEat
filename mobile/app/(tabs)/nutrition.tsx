import { useState, useCallback } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { scheduleMealNotifications, cancelMealNotification } from '../../lib/notifications'
import { C } from '../../lib/theme'
import type { FoodLog, MealTemplate } from '../../types'

type SubTab = 'nutrition' | 'meals'

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

interface TodayActivity { id: string; name: string; type: string; total_kcal: number }
interface MealItem { meal_index: number; name: string; scheduled_time: string; checked: boolean }

export default function NutritionScreen() {
  const [subTab, setSubTab] = useState<SubTab>('nutrition')
  const [userId, setUserId] = useState<string | null>(null)

  // ── Nutrition state ──────────────────────────────────────────────────────────
  const [baseline, setBaseline] = useState<number | null>(null)
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

  // ── Meal plan state ──────────────────────────────────────────────────────────
  const [meals, setMeals] = useState<MealItem[]>([])
  const [mealsLoading, setMealsLoading] = useState(true)
  const [checking, setChecking] = useState<number | null>(null)

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
    const [profileRes, actsRes, plannedRes, logsRes] = await Promise.all([
      supabase.from('users').select('daily_kcal_target').eq('id', uid).single(),
      supabase.from('activities').select('id, name, type, total_kcal')
        .eq('user_id', uid).gte('date', todayStr).not('total_kcal', 'is', null),
      supabase.from('planned_workouts').select('target_kcal')
        .eq('user_id', uid).eq('planned_for', todayStr),
      supabase.from('food_logs').select('*')
        .eq('user_id', uid).eq('date', todayStr).order('logged_at'),
    ])
    setBaseline(profileRes.data?.daily_kcal_target ?? null)
    setActivities(actsRes.data ?? [])
    setBurnedKcal((actsRes.data ?? []).reduce((s: number, a: any) => s + (a.total_kcal ?? 0), 0))
    setPlannedKcal((plannedRes.data ?? []).reduce((s: number, p: any) => s + p.target_kcal, 0))
    setLogs(logsRes.data ?? [])
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
    }))
    setMeals(items)
    setMealsLoading(false)
    await scheduleMealNotifications(items.map(m => ({
      meal_index: m.meal_index,
      name: m.name,
      scheduled_time: m.scheduled_time,
      date: todayStr,
      checked: m.checked,
    })))
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

  async function toggleMeal(meal: MealItem) {
    if (!userId) return
    setChecking(meal.meal_index)
    if (meal.checked) {
      await supabase.from('meal_checks').delete()
        .eq('user_id', userId).eq('meal_index', meal.meal_index).eq('date', todayStr)
      const [hh, mm] = meal.scheduled_time.split(':').map(Number)
      const [y, mo, d] = todayStr.split('-').map(Number)
      if (new Date(y, mo - 1, d, hh + 1, mm, 0, 0).getTime() > Date.now()) {
        await scheduleMealNotifications([{ ...meal, date: todayStr, checked: false }])
      }
    } else {
      await supabase.from('meal_checks').upsert(
        { user_id: userId, meal_index: meal.meal_index, date: todayStr },
        { onConflict: 'user_id,meal_index,date' },
      )
      await cancelMealNotification(meal.meal_index)
    }
    setMeals(prev => prev.map(m =>
      m.meal_index === meal.meal_index ? { ...m, checked: !m.checked } : m,
    ))
    setChecking(null)
  }

  return (
    <SafeAreaView style={st.container}>
      {/* Sub-tab selector */}
      <View style={st.segRow}>
        {([
          { key: 'nutrition', label: "Today's log" },
          { key: 'meals', label: 'Meal Plan' },
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
                {remaining != null && (
                  <Text style={[st.remainingText, remaining < 0 && st.overText]}>
                    {remaining < 0
                      ? `${Math.abs(remaining).toLocaleString()} kcal over target`
                      : `${remaining.toLocaleString()} kcal remaining`}
                  </Text>
                )}
                {target == null && (
                  <Text style={st.noTargetNote}>Set a daily calorie target in Settings → Profile</Text>
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
              <Text style={st.cardLabel}>Log food</Text>
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
                <View style={{ width: 46 }} />
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
                <Pressable
                  key={meal.meal_index}
                  style={[st.mealCard, meal.checked && st.mealCardChecked, overdue && st.mealCardOverdue]}
                  onPress={() => toggleMeal(meal)}
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
                </Pressable>
              )
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

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
})
