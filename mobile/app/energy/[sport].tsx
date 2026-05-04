import { useEffect, useState } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, Alert, useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg'
import { supabase } from '../../lib/supabase'
import type { BurnSchemaPoint } from '../../types'

type BlankForm = { hr: string; kcal: string; fat: string; carb: string }
const BLANK: BlankForm = { hr: '', kcal: '', fat: '', carb: '' }

export default function BurnSchemaScreen() {
  const { sport } = useLocalSearchParams<{ sport: string }>()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const [userId, setUserId] = useState<string | null>(null)
  const [points, setPoints] = useState<BurnSchemaPoint[]>([])
  const [form, setForm] = useState<BlankForm>(BLANK)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [sport])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    const { data } = await supabase
      .from('burn_schema_points')
      .select('*')
      .eq('user_id', user.id)
      .eq('sport_type', sport)
      .order('hr_value')
    setPoints(data ?? [])
  }

  async function addPoint() {
    if (!userId) return
    if (!form.hr || !form.kcal) { Alert.alert('Required', 'HR and kcal/hr are required.'); return }
    const hr = parseInt(form.hr), kcal = parseFloat(form.kcal)
    if (isNaN(hr) || isNaN(kcal) || hr <= 0 || kcal <= 0) {
      Alert.alert('Invalid', 'Enter valid positive numbers.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('burn_schema_points').upsert({
      user_id: userId,
      sport_type: sport,
      hr_value: hr,
      kcal_per_hour: kcal,
      fat_g_per_hour: form.fat ? parseFloat(form.fat) : null,
      carb_g_per_hour: form.carb ? parseFloat(form.carb) : null,
    }, { onConflict: 'user_id,sport_type,hr_value' })
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    setForm(BLANK)
    await load()
  }

  async function deletePoint(id: string) {
    await supabase.from('burn_schema_points').delete().eq('id', id)
    setPoints(prev => prev.filter(p => p.id !== id))
  }

  const chartWidth = width - 32

  return (
    <SafeAreaView style={styles.container}>
      <Pressable style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Burn schema</Text>
        <Text style={styles.sport}>{sport}</Text>

        {points.length < 2 && (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>
              Add at least 2 points to enable custom calorie calculation for this sport.
            </Text>
          </View>
        )}

        {/* Points table */}
        {points.length > 0 && (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.cell, styles.headerCell]}>HR</Text>
              <Text style={[styles.cell, styles.headerCell]}>kcal/hr</Text>
              <Text style={[styles.cell, styles.headerCell]}>fat g/hr</Text>
              <Text style={[styles.cell, styles.headerCell]}>carb g/hr</Text>
              <View style={{ width: 32 }} />
            </View>
            {points.map(pt => (
              <View key={pt.id} style={styles.tableRow}>
                <Text style={styles.cell}>{pt.hr_value}</Text>
                <Text style={styles.cell}>{pt.kcal_per_hour}</Text>
                <Text style={styles.cell}>{pt.fat_g_per_hour ?? '—'}</Text>
                <Text style={styles.cell}>{pt.carb_g_per_hour ?? '—'}</Text>
                <Pressable onPress={() => deletePoint(pt.id)} hitSlop={8}>
                  <Text style={styles.deleteBtn}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Chart */}
        {points.length >= 2 && <BurnChart points={points} width={chartWidth} />}

        {/* Add form */}
        <Text style={styles.formTitle}>Add point</Text>
        <View style={styles.row}>
          <View style={styles.half}>
            <Text style={styles.inputLabel}>HR (bpm)</Text>
            <TextInput style={styles.input} placeholder="e.g. 150" keyboardType="numeric"
              value={form.hr} onChangeText={v => setForm(f => ({ ...f, hr: v }))} />
          </View>
          <View style={styles.half}>
            <Text style={styles.inputLabel}>kcal/hr</Text>
            <TextInput style={styles.input} placeholder="e.g. 570" keyboardType="numeric"
              value={form.kcal} onChangeText={v => setForm(f => ({ ...f, kcal: v }))} />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.half}>
            <Text style={styles.inputLabel}>Fat (g/hr)</Text>
            <TextInput style={styles.input} placeholder="optional" keyboardType="numeric"
              value={form.fat} onChangeText={v => setForm(f => ({ ...f, fat: v }))} />
          </View>
          <View style={styles.half}>
            <Text style={styles.inputLabel}>Carb (g/hr)</Text>
            <TextInput style={styles.input} placeholder="optional" keyboardType="numeric"
              value={form.carb} onChangeText={v => setForm(f => ({ ...f, carb: v }))} />
          </View>
        </View>
        <Pressable style={[styles.addBtn, saving && styles.addBtnDisabled]} onPress={addPoint} disabled={saving}>
          <Text style={styles.addBtnText}>Add</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

function BurnChart({ points, width }: { points: BurnSchemaPoint[]; width: number }) {
  const H = 180
  const PAD = { top: 16, right: 16, bottom: 32, left: 52 }
  const chartW = Math.max(width - PAD.left - PAD.right, 1)
  const chartH = H - PAD.top - PAD.bottom

  const hrMin = points[0].hr_value
  const hrMax = points[points.length - 1].hr_value
  const kcalMax = Math.max(...points.map(p => p.kcal_per_hour)) * 1.1 || 1
  const hrRange = hrMax - hrMin || 1

  const toX = (hr: number) => PAD.left + ((hr - hrMin) / hrRange) * chartW
  const toY = (k: number) => PAD.top + chartH - (k / kcalMax) * chartH
  const polyline = points.map(p => `${toX(p.hr_value)},${toY(p.kcal_per_hour)}`).join(' ')

  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(kcalMax * f / 1.1))

  return (
    <Svg width={width} height={H} style={styles.chart}>
      {yTicks.map(val => {
        const y = toY(val)
        return (
          <View key={val}>
            <Line x1={PAD.left} y1={y} x2={PAD.left + chartW} y2={y} stroke="#f0f0f0" strokeWidth={1} />
            <SvgText x={PAD.left - 4} y={y + 4} fontSize={9} fill="#bbb" textAnchor="end">{val}</SvgText>
          </View>
        )
      })}
      <Line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + chartH} stroke="#ddd" strokeWidth={1} />
      <Line x1={PAD.left} y1={PAD.top + chartH} x2={PAD.left + chartW} y2={PAD.top + chartH} stroke="#ddd" strokeWidth={1} />
      <Polyline points={polyline} fill="none" stroke="#FC4C02" strokeWidth={2.5} strokeLinejoin="round" />
      {points.map(p => (
        <SvgText key={p.id} x={toX(p.hr_value)} y={PAD.top + chartH + 18} fontSize={10} fill="#aaa" textAnchor="middle">
          {p.hr_value}
        </SvgText>
      ))}
      <SvgText x={12} y={PAD.top + chartH / 2 + 22} fontSize={9} fill="#bbb"
        rotation={-90} originX={12} originY={PAD.top + chartH / 2}>
        kcal/hr
      </SvgText>
    </Svg>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  back: { paddingHorizontal: 16, paddingVertical: 12 },
  backText: { fontSize: 16, color: '#FC4C02', fontWeight: '600' },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 13, fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.6 },
  sport: { fontSize: 26, fontWeight: '800', marginBottom: 16 },
  warnBox: { backgroundColor: '#FFF8E1', borderRadius: 10, padding: 14, marginBottom: 16 },
  warnText: { fontSize: 13, color: '#795548', lineHeight: 18 },
  table: { marginBottom: 8 },
  tableHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#f8f8f8',
  },
  cell: { flex: 1, fontSize: 14, color: '#333' },
  headerCell: { fontSize: 10, fontWeight: '700', color: '#bbb', textTransform: 'uppercase' },
  deleteBtn: { fontSize: 20, color: '#ccc', width: 32, textAlign: 'center' },
  chart: { marginVertical: 12 },
  formTitle: { fontSize: 14, fontWeight: '700', color: '#444', marginTop: 16, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  half: { flex: 1, marginBottom: 10 },
  inputLabel: { fontSize: 10, fontWeight: '700', color: '#aaa', marginBottom: 4, textTransform: 'uppercase' },
  input: {
    borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8,
    padding: 11, fontSize: 14, backgroundColor: '#fafafa',
  },
  addBtn: { backgroundColor: '#FC4C02', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
})
