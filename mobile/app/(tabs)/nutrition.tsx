import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import type { FoodLog } from '../../types'

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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

interface TodayActivity { id: string; name: string; type: string; total_kcal: number }

export default function NutritionScreen() {
  const [userId, setUserId] = useState<string | null>(null)

  // Calorie context
  const [baseline, setBaseline] = useState<number | null>(null)
  const [burnedKcal, setBurnedKcal] = useState(0)
  const [plannedKcal, setPlannedKcal] = useState(0)
  const [activities, setActivities] = useState<TodayActivity[]>([])

  // Food log
  const [logs, setLogs] = useState<FoodLog[]>([])
  const [loading, setLoading] = useState(true)

  // Add form
  const [foodName, setFoodName] = useState('')
  const [foodKcal, setFoodKcal] = useState('')
  const [foodProtein, setFoodProtein] = useState('')
  const [adding, setAdding] = useState(false)

  const todayStr = new Date().toISOString().slice(0, 10)
  const target = baseline != null ? baseline + burnedKcal + plannedKcal : null
  const consumed = logs.reduce((s, l) => s + l.kcal, 0)
  const remaining = target != null ? target - consumed : null
  const progress = target != null && target > 0 ? Math.min(consumed / target, 1) : 0

  useEffect(() => { load() }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)

    const [profileRes, actsRes, plannedRes, logsRes] = await Promise.all([
      supabase.from('users').select('daily_kcal_target').eq('id', user.id).single(),
      supabase.from('activities').select('id, name, type, total_kcal')
        .eq('user_id', user.id).gte('date', todayStr).not('total_kcal', 'is', null),
      supabase.from('planned_workouts').select('target_kcal')
        .eq('user_id', user.id).eq('planned_for', todayStr),
      supabase.from('food_logs').select('*')
        .eq('user_id', user.id).eq('date', todayStr).order('logged_at'),
    ])

    setBaseline(profileRes.data?.daily_kcal_target ?? null)
    setActivities(actsRes.data ?? [])
    setBurnedKcal((actsRes.data ?? []).reduce((s: number, a: any) => s + (a.total_kcal ?? 0), 0))
    setPlannedKcal((plannedRes.data ?? []).reduce((s: number, p: any) => s + p.target_kcal, 0))
    setLogs(logsRes.data ?? [])
    setLoading(false)
  }, [])

  async function addEntry() {
    const kcal = parseInt(foodKcal)
    if (!foodName.trim()) { Alert.alert('Missing name', 'Enter a food name.'); return }
    if (isNaN(kcal) || kcal <= 0) { Alert.alert('Invalid kcal', 'Enter a positive calorie amount.'); return }
    if (!userId) return

    setAdding(true)
    const protein = foodProtein ? parseFloat(foodProtein) : null
    const { error } = await supabase.from('food_logs').insert({
      user_id: userId,
      date: todayStr,
      name: foodName.trim(),
      kcal,
      protein_g: isNaN(protein as number) ? null : protein,
    })
    setAdding(false)

    if (error) { Alert.alert('Error', error.message); return }
    setFoodName('')
    setFoodKcal('')
    setFoodProtein('')
    load()
  }

  async function deleteEntry(id: string) {
    await supabase.from('food_logs').delete().eq('id', id)
    setLogs(prev => prev.filter(l => l.id !== id))
  }

  const barColor = remaining != null && remaining < 0 ? '#EF5350' : '#FC4C02'

  return (
    <SafeAreaView style={st.container}>
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <Text style={st.screenTitle}>Nutrition</Text>

        {/* Progress card */}
        <View style={st.card}>
          <Text style={st.cardLabel}>Today's intake</Text>
          <View style={st.progressRow}>
            <Text style={st.consumedNum}>{consumed.toLocaleString()}</Text>
            {target != null && (
              <Text style={st.targetNum}> / {target.toLocaleString()} kcal</Text>
            )}
          </View>

          {/* Progress bar */}
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
              <Text style={st.noTargetNote}>Set a daily calorie target in Settings → Personal Info</Text>
            )}
          </View>

          {/* Target breakdown */}
          {target != null && (
            <View style={st.breakdownRow}>
              {baseline != null && (
                <View style={st.breakdownChip}>
                  <Ionicons name="body-outline" size={11} color="#888" />
                  <Text style={st.breakdownText}>{baseline.toLocaleString()} baseline</Text>
                </View>
              )}
              {burnedKcal > 0 && (
                <View style={st.breakdownChip}>
                  <Ionicons name="flame-outline" size={11} color="#FC4C02" />
                  <Text style={[st.breakdownText, { color: '#FC4C02' }]}>+{Math.round(burnedKcal)} burned</Text>
                </View>
              )}
              {plannedKcal > 0 && (
                <View style={st.breakdownChip}>
                  <Ionicons name="calendar-outline" size={11} color="#7C83FD" />
                  <Text style={[st.breakdownText, { color: '#7C83FD' }]}>+{plannedKcal} planned</Text>
                </View>
              )}
            </View>
          )}

          {/* Burned activities */}
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

        {/* Quick add */}
        <View style={st.card}>
          <Text style={st.cardLabel}>Log food</Text>
          <TextInput
            style={st.input}
            value={foodName}
            onChangeText={setFoodName}
            placeholder="Food name (e.g. Oatmeal with banana)"
            returnKeyType="next"
          />
          <View style={st.addRow}>
            <View style={st.macroInputWrap}>
              <TextInput
                style={[st.input, st.macroInput]}
                value={foodKcal}
                onChangeText={setFoodKcal}
                placeholder="kcal"
                keyboardType="numeric"
              />
            </View>
            <View style={st.macroInputWrap}>
              <TextInput
                style={[st.input, st.macroInput]}
                value={foodProtein}
                onChangeText={setFoodProtein}
                placeholder="protein g (opt)"
                keyboardType="decimal-pad"
              />
            </View>
            <Pressable
              style={[st.addBtn, adding && { opacity: 0.5 }]}
              onPress={addEntry}
              disabled={adding}
            >
              {adding
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="add" size={22} color="#fff" />
              }
            </Pressable>
          </View>
        </View>

        {/* Food log */}
        <View style={st.card}>
          <Text style={st.cardLabel}>Today's log</Text>
          {loading && <ActivityIndicator color="#FC4C02" style={{ marginVertical: 12 }} />}
          {!loading && logs.length === 0 && (
            <Text style={st.emptyNote}>No food logged yet. Add your first entry above.</Text>
          )}
          {logs.map((log, i) => (
            <View key={log.id} style={[st.logRow, i < logs.length - 1 && st.logRowBorder]}>
              <View style={st.logLeft}>
                <Text style={st.logName} numberOfLines={1}>{log.name}</Text>
                <Text style={st.logMeta}>
                  {formatTime(log.logged_at)}
                  {log.protein_g != null ? ` · ${log.protein_g}g protein` : ''}
                </Text>
              </View>
              <Text style={st.logKcal}>{log.kcal} kcal</Text>
              <Pressable onPress={() => deleteEntry(log.id)} hitSlop={10} style={st.deleteBtn}>
                <Ionicons name="trash-outline" size={16} color="#ccc" />
              </Pressable>
            </View>
          ))}
          {logs.length > 0 && (
            <View style={st.totalRow}>
              <Text style={st.totalLabel}>Total</Text>
              <Text style={st.totalValue}>{consumed.toLocaleString()} kcal</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f9' },
  content: { padding: 16, paddingBottom: 48, gap: 14 },

  screenTitle: { fontSize: 26, fontWeight: '800', color: '#111', marginBottom: 4 },

  card: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardLabel: {
    fontSize: 11, fontWeight: '700', color: '#aaa',
    textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 14,
  },

  // Progress
  progressRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 12 },
  consumedNum: { fontSize: 40, fontWeight: '800', color: '#111' },
  targetNum: { fontSize: 18, color: '#aaa', fontWeight: '600' },
  barTrack: { height: 8, backgroundColor: '#f0f0f0', borderRadius: 4, overflow: 'hidden', marginBottom: 10 },
  barFill: { height: 8, borderRadius: 4 },
  progressMeta: { marginBottom: 10 },
  remainingText: { fontSize: 13, color: '#888', fontWeight: '500' },
  overText: { color: '#EF5350', fontWeight: '700' },
  noTargetNote: { fontSize: 13, color: '#bbb', fontStyle: 'italic' },

  breakdownRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  breakdownChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f8f8f8', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  breakdownText: { fontSize: 12, color: '#888' },

  activityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  activityPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  activityPillText: { fontSize: 12, fontWeight: '600' },

  // Add form
  input: {
    borderWidth: 1.5, borderColor: '#ebebeb', borderRadius: 10,
    padding: 12, fontSize: 15, backgroundColor: '#fafafa', marginBottom: 10,
  },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  macroInputWrap: { flex: 1 },
  macroInput: { marginBottom: 0 },
  addBtn: {
    backgroundColor: '#FC4C02', borderRadius: 10, width: 46, height: 46,
    alignItems: 'center', justifyContent: 'center',
  },

  // Log list
  emptyNote: { fontSize: 14, color: '#bbb', textAlign: 'center', paddingVertical: 16, fontStyle: 'italic' },
  logRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 },
  logRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  logLeft: { flex: 1 },
  logName: { fontSize: 15, color: '#111', fontWeight: '500', marginBottom: 2 },
  logMeta: { fontSize: 12, color: '#aaa' },
  logKcal: { fontSize: 15, fontWeight: '700', color: '#333' },
  deleteBtn: { padding: 4 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 2, borderTopColor: '#111', marginTop: 4, paddingTop: 12 },
  totalLabel: { fontSize: 14, fontWeight: '700', color: '#111' },
  totalValue: { fontSize: 18, fontWeight: '800', color: '#111' },
})
