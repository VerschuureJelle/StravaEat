import { useEffect, useState } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, Alert, useWindowDimensions, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Svg, { Polyline, Line, Text as SvgText, Circle } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { C } from '../../lib/theme'
import type { BurnSchemaPoint } from '../../types'

type BlankForm = { hr: string; kcal: string; fat: string; carb: string; protein: string }
const BLANK: BlankForm = { hr: '', kcal: '', fat: '', carb: '', protein: '' }

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
    const carb = form.carb ? parseFloat(form.carb) : null
    const fat = form.fat ? parseFloat(form.fat) : null
    const protein = form.protein ? parseFloat(form.protein) : null
    if (carb !== null && isNaN(carb)) { Alert.alert('Invalid', 'Enter a valid number for carbs.'); return }
    if (fat !== null && isNaN(fat)) { Alert.alert('Invalid', 'Enter a valid number for fat.'); return }
    if (protein !== null && isNaN(protein)) { Alert.alert('Invalid', 'Enter a valid number for protein.'); return }
    setSaving(true)
    const { error } = await supabase.from('burn_schema_points').upsert({
      user_id: userId,
      sport_type: sport,
      hr_value: hr,
      kcal_per_hour: kcal,
      fat_g_per_hour: fat,
      carb_g_per_hour: carb,
      protein_g_per_hour: protein,
    }, { onConflict: 'user_id,sport_type,hr_value' })
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    setForm(BLANK)
    await load()
  }

  async function deletePoint(id: string) {
    Alert.alert('Delete point?', 'Remove this HR → kcal/hr data point?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('burn_schema_points').delete().eq('id', id)
        setPoints(prev => prev.filter(p => p.id !== id))
      }},
    ])
  }

  const chartWidth = width - 32

  return (
    <SafeAreaView style={styles.container}>
      <Pressable style={styles.back} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={20} color={C.accent} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Burn schema</Text>
        <Text style={styles.title}>{sport}</Text>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={C.accent2} style={{ marginTop: 1 }} />
          <Text style={styles.infoText}>
            Enter how many kcal/hr you burn at each heart rate. Optionally add fat, carbs, and protein (g/hr).
            HR values are free to choose and apply only to {sport}.
          </Text>
        </View>

        {points.length < 2 && (
          <View style={styles.warnBox}>
            <Ionicons name="warning-outline" size={15} color={C.warning} style={{ marginTop: 1 }} />
            <Text style={styles.warnText}>
              Add at least 2 points to activate the custom calculation for {sport}.
            </Text>
          </View>
        )}

        {/* Chart */}
        {points.length >= 2 && <BurnChart points={points} width={chartWidth} />}

        {/* Points table */}
        {points.length > 0 && (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.cell, styles.headerCell]}>HR</Text>
              <Text style={[styles.cell, styles.headerCell]}>kcal/hr</Text>
              <Text style={[styles.cell, styles.headerCell]}>fat g/hr</Text>
              <Text style={[styles.cell, styles.headerCell]}>carb g/hr</Text>
              <Text style={[styles.cell, styles.headerCell]}>prot g/hr</Text>
              <View style={{ width: 36 }} />
            </View>
            {points.map(pt => (
              <View key={pt.id} style={styles.tableRow}>
                <Text style={styles.cell}>{pt.hr_value}</Text>
                <Text style={styles.cell}>{pt.kcal_per_hour}</Text>
                <Text style={styles.cell}>{pt.fat_g_per_hour != null ? pt.fat_g_per_hour : '—'}</Text>
                <Text style={styles.cell}>{pt.carb_g_per_hour != null ? pt.carb_g_per_hour : '—'}</Text>
                <Text style={styles.cell}>{pt.protein_g_per_hour != null ? pt.protein_g_per_hour : '—'}</Text>
                <Pressable onPress={() => deletePoint(pt.id)} hitSlop={8} style={styles.deleteBtn}>
                  <Ionicons name="trash-outline" size={16} color={C.text3} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Add form */}
        <Text style={styles.formTitle}>Add point</Text>

        <View style={styles.row}>
          <View style={styles.half}>
            <Text style={styles.inputLabel}>HR (bpm) *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 150"
              placeholderTextColor={C.text3}
              keyboardType="numeric"
              value={form.hr}
              onChangeText={v => setForm(f => ({ ...f, hr: v }))}
            />
          </View>
          <View style={styles.half}>
            <Text style={styles.inputLabel}>kcal/hr *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 570"
              placeholderTextColor={C.text3}
              keyboardType="numeric"
              value={form.kcal}
              onChangeText={v => setForm(f => ({ ...f, kcal: v }))}
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.third}>
            <Text style={styles.inputLabel}>Fat g/hr</Text>
            <TextInput
              style={styles.input}
              placeholder="optional"
              placeholderTextColor={C.text3}
              keyboardType="numeric"
              value={form.fat}
              onChangeText={v => setForm(f => ({ ...f, fat: v }))}
            />
          </View>
          <View style={styles.third}>
            <Text style={styles.inputLabel}>Carb g/hr</Text>
            <TextInput
              style={styles.input}
              placeholder="optional"
              placeholderTextColor={C.text3}
              keyboardType="numeric"
              value={form.carb}
              onChangeText={v => setForm(f => ({ ...f, carb: v }))}
            />
          </View>
          <View style={styles.third}>
            <Text style={styles.inputLabel}>Protein g/hr</Text>
            <TextInput
              style={styles.input}
              placeholder="optional"
              placeholderTextColor={C.text3}
              keyboardType="numeric"
              value={form.protein}
              onChangeText={v => setForm(f => ({ ...f, protein: v }))}
            />
          </View>
        </View>

        <Pressable
          style={[styles.addBtn, saving && styles.addBtnDisabled]}
          onPress={addPoint}
          disabled={saving}
        >
          <Ionicons name="add" size={18} color={C.white} />
          <Text style={styles.addBtnText}>{saving ? 'Saving…' : 'Add point'}</Text>
        </Pressable>

        <View style={styles.hintBox}>
          <Text style={styles.hintTitle}>How it works</Text>
          <Text style={styles.hintText}>
            • Add one point per heart rate value you know from training or measurement.{'\n'}
            • The app linearly interpolates between points.{'\n'}
            • Fat, carb, and protein fields are optional — leave blank to skip tracking that macro.{'\n'}
            • No points? Falls back to standard MET calculation.
          </Text>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function BurnChart({ points, width }: { points: BurnSchemaPoint[]; width: number }) {
  const H = 190
  const PAD = { top: 20, right: 20, bottom: 36, left: 56 }
  const chartW = Math.max(width - PAD.left - PAD.right, 1)
  const chartH = H - PAD.top - PAD.bottom

  const hrMin = points[0].hr_value
  const hrMax = points[points.length - 1].hr_value
  const kcalMax = Math.max(...points.map(p => p.kcal_per_hour)) * 1.15 || 1
  const hrRange = hrMax - hrMin || 1

  const toX = (hr: number) => PAD.left + ((hr - hrMin) / hrRange) * chartW
  const toY = (k: number) => PAD.top + chartH - (k / kcalMax) * chartH
  const polyline = points.map(p => `${toX(p.hr_value)},${toY(p.kcal_per_hour)}`).join(' ')

  const carbPoints = points.filter(p => p.carb_g_per_hour != null)
  const carbMax = carbPoints.length > 0
    ? Math.max(...carbPoints.map(p => p.carb_g_per_hour!)) * 1.15 || 1
    : 1
  const toCarbY = (g: number) => PAD.top + chartH - (g / carbMax) * chartH
  const carbPolyline = carbPoints.map(p => `${toX(p.hr_value)},${toCarbY(p.carb_g_per_hour!)}`).join(' ')

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round((kcalMax / 1.15) * f))

  return (
    <View style={styles.chartContainer}>
      <Svg width={width} height={H}>
        {/* Grid lines */}
        {yTicks.map(val => {
          const y = toY(val)
          return (
            <Line key={val} x1={PAD.left} y1={y} x2={PAD.left + chartW} y2={y}
              stroke={C.surface3} strokeWidth={1} />
          )
        })}
        {/* Y axis */}
        <Line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + chartH}
          stroke={C.border} strokeWidth={1} />
        {/* X axis */}
        <Line x1={PAD.left} y1={PAD.top + chartH} x2={PAD.left + chartW} y2={PAD.top + chartH}
          stroke={C.border} strokeWidth={1} />

        {/* Y axis labels */}
        {yTicks.map(val => (
          <SvgText key={val} x={PAD.left - 6} y={toY(val) + 4}
            fontSize={9} fill={C.text2} textAnchor="end">{val}</SvgText>
        ))}

        {/* kcal line */}
        <Polyline points={polyline} fill="none" stroke={C.accent} strokeWidth={2.5} strokeLinejoin="round" />
        {points.map(p => (
          <Circle key={p.id} cx={toX(p.hr_value)} cy={toY(p.kcal_per_hour)} r={4}
            fill={C.accent} />
        ))}

        {/* carb line */}
        {carbPoints.length >= 2 && (
          <>
            <Polyline points={carbPolyline} fill="none" stroke={C.accent2} strokeWidth={2}
              strokeLinejoin="round" strokeDasharray="4 3" />
            {carbPoints.map(p => (
              <Circle key={p.id} cx={toX(p.hr_value)} cy={toCarbY(p.carb_g_per_hour!)} r={3}
                fill={C.accent2} />
            ))}
          </>
        )}

        {/* X labels */}
        {points.map(p => (
          <SvgText key={p.id} x={toX(p.hr_value)} y={PAD.top + chartH + 20}
            fontSize={9} fill={C.text2} textAnchor="middle">{p.hr_value}</SvgText>
        ))}

        {/* Y axis label */}
        <SvgText x={10} y={PAD.top + chartH / 2}
          fontSize={9} fill={C.text2}
          rotation={-90} originX={10} originY={PAD.top + chartH / 2}>
          kcal/hr
        </SvgText>

        {/* X axis label */}
        <SvgText x={PAD.left + chartW / 2} y={H - 2}
          fontSize={9} fill={C.text2} textAnchor="middle">
          HR (bpm)
        </SvgText>
      </Svg>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: C.accent }]} />
          <Text style={styles.legendText}>kcal/hr</Text>
        </View>
        {carbPoints.length >= 2 && (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: C.accent2 }]} />
            <Text style={styles.legendText}>carb g/hr</Text>
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 12 },
  backText: { fontSize: 15, color: C.accent, fontWeight: '600' },
  content: { padding: 16, paddingBottom: 56 },
  label: { fontSize: 11, fontWeight: '700', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8 },
  title: { fontSize: 26, fontWeight: '800', color: C.text1, marginBottom: 16 },

  infoBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: C.accent2Bg, borderRadius: 10,
    padding: 12, marginBottom: 12, borderWidth: 1, borderColor: C.accent2Border,
  },
  infoText: { flex: 1, fontSize: 13, color: C.accent2, lineHeight: 18 },

  warnBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: C.warningBg, borderRadius: 10,
    padding: 12, marginBottom: 12, borderWidth: 1, borderColor: C.warningBorder,
  },
  warnText: { flex: 1, fontSize: 13, color: C.warning, lineHeight: 18 },

  chartContainer: { marginVertical: 12 },
  legend: { flexDirection: 'row', gap: 16, paddingHorizontal: 4, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: C.text2 },

  table: { marginBottom: 16 },
  tableHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.surface2,
  },
  cell: { flex: 1, fontSize: 14, color: C.text1 },
  headerCell: { fontSize: 10, fontWeight: '700', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.4 },
  deleteBtn: { width: 36, alignItems: 'center' },

  formTitle: { fontSize: 14, fontWeight: '700', color: C.text2, marginTop: 8, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  half: { flex: 1 },
  third: { flex: 1 },
  inputLabel: { fontSize: 10, fontWeight: '700', color: C.text3, marginBottom: 5, textTransform: 'uppercase' },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 8,
    padding: 11, fontSize: 14, backgroundColor: C.surface,
    color: C.text1, marginBottom: 4,
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.accent, padding: 14, borderRadius: 10, marginTop: 6,
  },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { color: C.white, fontWeight: '700', fontSize: 15 },

  hintBox: {
    backgroundColor: C.surface, borderRadius: 12, padding: 14, marginTop: 24,
    borderWidth: 1, borderColor: C.border,
  },
  hintTitle: { fontSize: 13, fontWeight: '700', color: C.text2, marginBottom: 8 },
  hintText: { fontSize: 12, color: C.text3, lineHeight: 19 },
})
