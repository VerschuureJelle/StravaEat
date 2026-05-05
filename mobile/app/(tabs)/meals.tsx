import { useState, useCallback } from 'react'
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { scheduleMealNotifications, cancelMealNotification } from '../../lib/notifications'
import type { MealTemplate } from '../../types'

function localDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isOverdue(scheduledTime: string): boolean {
  const now = new Date()
  const [hh, mm] = scheduledTime.split(':').map(Number)
  return now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm)
}

interface MealItem {
  meal_index: number
  name: string
  scheduled_time: string
  checked: boolean
}

export default function MealsScreen() {
  const [userId, setUserId] = useState<string | null>(null)
  const [meals, setMeals] = useState<MealItem[]>([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState<number | null>(null)

  const todayStr = localDate()

  useFocusEffect(useCallback(() => {
    load()
  }, []))

  async function load() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    setUserId(user.id)

    const [templatesRes, checksRes] = await Promise.all([
      supabase.from('meal_templates').select('*').eq('user_id', user.id).order('meal_index'),
      supabase.from('meal_checks').select('meal_index').eq('user_id', user.id).eq('date', todayStr),
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
    setLoading(false)

    // Refresh notification schedule based on current check state
    await scheduleMealNotifications(items.map(m => ({
      meal_index: m.meal_index,
      name: m.name,
      scheduled_time: m.scheduled_time,
      date: todayStr,
      checked: m.checked,
    })))
  }

  async function toggleMeal(meal: MealItem) {
    if (!userId) return
    setChecking(meal.meal_index)

    if (meal.checked) {
      // Uncheck — remove the check record
      await supabase.from('meal_checks')
        .delete()
        .eq('user_id', userId)
        .eq('meal_index', meal.meal_index)
        .eq('date', todayStr)
      // Reschedule notification if meal is still in the future (+ 1h window)
      const [hh, mm] = meal.scheduled_time.split(':').map(Number)
      const [y, mo, d] = todayStr.split('-').map(Number)
      const overdueTime = new Date(y, mo - 1, d, hh + 1, mm, 0, 0)
      if (overdueTime.getTime() > Date.now()) {
        await scheduleMealNotifications([{ ...meal, date: todayStr, checked: false }])
      }
    } else {
      // Check — record it and cancel the overdue notification
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

  const checkedCount = meals.filter(m => m.checked).length
  const allDone = meals.length > 0 && checkedCount === meals.length

  return (
    <SafeAreaView style={st.container}>
      <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
        <Text style={st.screenTitle}>Meal Plan</Text>
        <Text style={st.dateText}>
          {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </Text>

        {/* Progress card */}
        {meals.length > 0 && (
          <View style={[st.progressCard, allDone && st.progressCardDone]}>
            {allDone ? (
              <View style={st.doneRow}>
                <Ionicons name="checkmark-circle" size={22} color="#4CAF50" />
                <Text style={st.doneText}>All meals done for today!</Text>
              </View>
            ) : (
              <>
                <View style={st.progressLabelRow}>
                  <Text style={st.progressLabel}>{checkedCount} of {meals.length} meals</Text>
                  <Text style={st.progressPct}>{Math.round((checkedCount / meals.length) * 100)}%</Text>
                </View>
                <View style={st.barTrack}>
                  <View style={[st.barFill, { width: `${(checkedCount / meals.length) * 100}%` as any }]} />
                </View>
              </>
            )}
          </View>
        )}

        {loading && <ActivityIndicator color="#FC4C02" style={{ marginTop: 24 }} />}

        {!loading && meals.length === 0 && (
          <View style={st.emptyBox}>
            <Ionicons name="restaurant-outline" size={52} color="#e0e0e0" />
            <Text style={st.emptyTitle}>No meal plan set up</Text>
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
                  ? <ActivityIndicator size="small" color={meal.checked ? '#fff' : '#FC4C02'} />
                  : meal.checked
                    ? <Ionicons name="checkmark" size={16} color="#fff" />
                    : null
                }
              </View>

              <View style={st.mealInfo}>
                <Text style={[st.mealName, meal.checked && st.mealNameChecked]}>{meal.name}</Text>
                <View style={st.mealMetaRow}>
                  <Ionicons
                    name="time-outline"
                    size={13}
                    color={overdue ? '#EF5350' : '#bbb'}
                  />
                  <Text style={[st.mealTime, overdue && st.mealTimeOverdue]}>
                    {meal.scheduled_time}
                  </Text>
                  {overdue && (
                    <View style={st.overdueTag}>
                      <Text style={st.overdueTagText}>overdue</Text>
                    </View>
                  )}
                  {meal.checked && (
                    <Text style={st.checkedLabel}>done</Text>
                  )}
                </View>
              </View>
            </Pressable>
          )
        })}
      </ScrollView>
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f9' },
  content: { padding: 16, paddingBottom: 48, gap: 10 },

  screenTitle: { fontSize: 26, fontWeight: '800', color: '#111', marginBottom: 2 },
  dateText: { fontSize: 14, color: '#aaa', marginBottom: 8 },

  progressCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  progressCardDone: { backgroundColor: '#F1FFF3' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  doneText: { fontSize: 15, fontWeight: '700', color: '#388E3C' },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  progressLabel: { fontSize: 14, fontWeight: '600', color: '#333' },
  progressPct: { fontSize: 14, fontWeight: '800', color: '#FC4C02' },
  barTrack: { height: 6, backgroundColor: '#f0f0f0', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: '#FC4C02', borderRadius: 3 },

  mealCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
    borderLeftWidth: 3, borderLeftColor: 'transparent',
  },
  mealCardChecked: { opacity: 0.55 },
  mealCardOverdue: { borderLeftColor: '#EF5350' },

  checkbox: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 2, borderColor: '#ddd',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxChecked: { backgroundColor: '#FC4C02', borderColor: '#FC4C02' },

  mealInfo: { flex: 1 },
  mealName: { fontSize: 16, fontWeight: '600', color: '#111', marginBottom: 4 },
  mealNameChecked: { textDecorationLine: 'line-through', color: '#aaa' },

  mealMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  mealTime: { fontSize: 13, color: '#aaa' },
  mealTimeOverdue: { color: '#EF5350', fontWeight: '600' },

  overdueTag: {
    backgroundColor: '#FFEBEE', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 2, marginLeft: 2,
  },
  overdueTagText: { fontSize: 11, fontWeight: '700', color: '#EF5350' },
  checkedLabel: { fontSize: 11, fontWeight: '600', color: '#4CAF50', marginLeft: 2 },

  emptyBox: { alignItems: 'center', paddingVertical: 56, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#888' },
  emptyNote: { fontSize: 14, color: '#bbb', textAlign: 'center', lineHeight: 20, maxWidth: 260 },
})
