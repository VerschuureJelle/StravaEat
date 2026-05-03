import { useEffect, useState } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  Alert, useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg'
import { supabase } from '../../lib/supabase'
import type { UserProfile, BurnSchemaPoint } from '../../types'

const STRAVA_CLIENT_ID = process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID!
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/strava-callback`

type BlankForm = { hr: string; kcal: string; fat: string; carb: string }
const BLANK_FORM: BlankForm = { hr: '', kcal: '', fat: '', carb: '' }

export default function SettingsScreen() {
  const { width } = useWindowDimensions()
  const [userId, setUserId] = useState<string | null>(null)

  // Profile
  const [savedProfile, setSavedProfile] = useState<Partial<UserProfile>>({})
  const [editedProfile, setEditedProfile] = useState<Partial<UserProfile>>({})
  const [savingProfile, setSavingProfile] = useState(false)

  // Energy expenditure
  const [sports, setSports] = useState<string[]>([])
  const [sportMethods, setSportMethods] = useState<Record<string, 'standard' | 'custom'>>({})
  const [burnPoints, setBurnPoints] = useState<Record<string, BurnSchemaPoint[]>>({})
  const [expandedSport, setExpandedSport] = useState<string | null>(null)
  const [forms, setForms] = useState<Record<string, BlankForm>>({})
  const [savingPt, setSavingPt] = useState(false)

  const isDirty = JSON.stringify(editedProfile) !== JSON.stringify(savedProfile)

  useEffect(() => {
    load()
    const sub = Linking.addEventListener('url', handleStravaDeepLink)
    return () => sub.remove()
  }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)

    const [profileRes, activitiesRes, settingsRes, burnRes] = await Promise.all([
      supabase.from('users').select('*').eq('id', user.id).single(),
      supabase.from('activities').select('type').eq('user_id', user.id),
      supabase.from('sport_energy_settings').select('*').eq('user_id', user.id),
      supabase.from('burn_schema_points').select('*').eq('user_id', user.id).order('hr_value'),
    ])

    if (profileRes.data) {
      setSavedProfile(profileRes.data)
      setEditedProfile(profileRes.data)
    }

    const sportSet = new Set<string>(
      (activitiesRes.data ?? []).map((a: { type: string }) => a.type).filter(Boolean),
    )
    setSports([...sportSet].sort())

    const methodMap: Record<string, 'standard' | 'custom'> = {}
    for (const s of (settingsRes.data ?? [])) {
      methodMap[s.sport_type] = s.method as 'standard' | 'custom'
    }
    setSportMethods(methodMap)

    const burnMap: Record<string, BurnSchemaPoint[]> = {}
    for (const pt of (burnRes.data ?? [])) {
      if (!burnMap[pt.sport_type]) burnMap[pt.sport_type] = []
      burnMap[pt.sport_type].push(pt)
    }
    setBurnPoints(burnMap)
  }

  async function handleStravaDeepLink(event: { url: string }) {
    if (!event.url.startsWith('stravaeat://auth')) return
    const parsed = Linking.parse(event.url)
    if (parsed.queryParams?.linked === 'true') {
      await load()
      Alert.alert('Connected', 'Strava account linked successfully.')
    } else if (parsed.queryParams?.error) {
      Alert.alert('Connection failed', parsed.queryParams.error as string)
    }
  }

  async function handleConnectStrava() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const params = new URLSearchParams({
      client_id: STRAVA_CLIENT_ID,
      redirect_uri: CALLBACK_URL,
      response_type: 'code',
      scope: 'activity:read_all',
      approval_prompt: 'force',
      state: user.id,
    })
    await WebBrowser.openAuthSessionAsync(
      `https://www.strava.com/oauth/authorize?${params}`,
      'stravaeat://auth',
    )
  }

  async function saveProfile() {
    if (!userId || !isDirty) return
    setSavingProfile(true)
    const { error } = await supabase.from('users').update(editedProfile).eq('id', userId)
    setSavingProfile(false)
    if (error) { Alert.alert('Error', error.message); return }
    setSavedProfile(editedProfile)
  }

  async function setMethod(sport: string, method: 'standard' | 'custom') {
    if (!userId) return
    const { error } = await supabase.from('sport_energy_settings').upsert(
      { user_id: userId, sport_type: sport, method },
      { onConflict: 'user_id,sport_type' },
    )
    if (error) { Alert.alert('Error', error.message); return }
    setSportMethods(prev => ({ ...prev, [sport]: method }))
    if (method === 'custom') setExpandedSport(sport)
  }

  async function addBurnPoint(sport: string) {
    if (!userId) return
    const form = forms[sport] ?? BLANK_FORM
    if (!form.hr || !form.kcal) { Alert.alert('Required', 'HR and kcal/hr are required.'); return }
    const hr = parseInt(form.hr), kcal = parseFloat(form.kcal)
    if (isNaN(hr) || isNaN(kcal) || hr <= 0 || kcal <= 0) {
      Alert.alert('Invalid', 'Enter valid positive numbers.')
      return
    }
    setSavingPt(true)
    const { error } = await supabase.from('burn_schema_points').upsert({
      user_id: userId,
      sport_type: sport,
      hr_value: hr,
      kcal_per_hour: kcal,
      fat_g_per_hour: form.fat ? parseFloat(form.fat) : null,
      carb_g_per_hour: form.carb ? parseFloat(form.carb) : null,
    }, { onConflict: 'user_id,sport_type,hr_value' })
    setSavingPt(false)
    if (error) { Alert.alert('Error', error.message); return }
    setForms(prev => ({ ...prev, [sport]: BLANK_FORM }))
    const { data } = await supabase.from('burn_schema_points')
      .select('*').eq('user_id', userId).eq('sport_type', sport).order('hr_value')
    setBurnPoints(prev => ({ ...prev, [sport]: data ?? [] }))
  }

  async function deleteBurnPoint(sport: string, id: string) {
    await supabase.from('burn_schema_points').delete().eq('id', id)
    setBurnPoints(prev => ({ ...prev, [sport]: (prev[sport] ?? []).filter(p => p.id !== id) }))
  }

  function updateForm(sport: string, key: keyof BlankForm, value: string) {
    setForms(prev => ({ ...prev, [sport]: { ...(prev[sport] ?? BLANK_FORM), [key]: value } }))
  }

  const profileField = (label: string, key: keyof UserProfile, numeric?: boolean) => (
    <View key={key} style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={editedProfile[key] != null ? String(editedProfile[key]) : ''}
        keyboardType={numeric ? 'numeric' : 'default'}
        onChangeText={v =>
          setEditedProfile(p => ({ ...p, [key]: numeric ? (v ? parseFloat(v) : null) : v }))
        }
      />
    </View>
  )

  const chartWidth = width - 64

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* ── Profile ───────────────────────────────────── */}
        <Text style={styles.sectionHeader}>Profile</Text>

        <View style={styles.stravaRow}>
          <View>
            <Text style={styles.stravaLabel}>Strava</Text>
            <Text style={styles.stravaStatus}>
              {savedProfile.strava_id ? `Connected (ID: ${savedProfile.strava_id})` : 'Not connected'}
            </Text>
          </View>
          <Pressable style={styles.stravaBtn} onPress={handleConnectStrava}>
            <Text style={styles.stravaBtnText}>
              {savedProfile.strava_id ? 'Reconnect' : 'Connect'}
            </Text>
          </Pressable>
        </View>

        {profileField('Name', 'name')}
        {profileField('Age', 'age', true)}
        {profileField('Weight (kg)', 'weight_kg', true)}
        {profileField('Height (cm)', 'height_cm', true)}
        {profileField('Max Heart Rate (bpm)', 'max_hr', true)}
        {profileField('Resting Heart Rate (bpm)', 'resting_hr', true)}

        <Pressable
          style={[styles.saveBtn, (!isDirty || savingProfile) && styles.saveBtnDisabled]}
          onPress={saveProfile}
          disabled={!isDirty || savingProfile}
        >
          <Text style={styles.saveBtnText}>{savingProfile ? 'Saving…' : 'Save'}</Text>
        </Pressable>

        {/* ── Energy Expenditure ────────────────────────── */}
        {sports.length > 0 && (
          <>
            <Text style={[styles.sectionHeader, { marginTop: 40 }]}>Energy Expenditure</Text>
            <Text style={styles.sectionNote}>
              Choose how calories are calculated per sport type. Custom uses your HR → kcal/hr burn schema (min. 2 points required).
            </Text>

            {sports.map(sport => {
              const method = sportMethods[sport] ?? 'standard'
              const pts = burnPoints[sport] ?? []
              const isExpanded = expandedSport === sport && method === 'custom'
              const form = forms[sport] ?? BLANK_FORM

              return (
                <View key={sport} style={styles.sportCard}>
                  {/* Sport header */}
                  <Pressable
                    style={styles.sportHeader}
                    onPress={() => method === 'custom' && setExpandedSport(isExpanded ? null : sport)}
                  >
                    <Text style={styles.sportName}>{sport}</Text>
                    {method === 'custom' && (
                      <Text style={styles.expandChevron}>{isExpanded ? '▲' : '▼'}</Text>
                    )}
                  </Pressable>

                  {/* Method toggle */}
                  <View style={styles.methodRow}>
                    <Pressable
                      style={[styles.methodBtn, method === 'standard' && styles.methodBtnActive]}
                      onPress={() => setMethod(sport, 'standard')}
                    >
                      <Text style={[styles.methodBtnText, method === 'standard' && styles.methodBtnTextActive]}>
                        Standard
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.methodBtn, method === 'custom' && styles.methodBtnActive]}
                      onPress={() => setMethod(sport, 'custom')}
                    >
                      <Text style={[styles.methodBtnText, method === 'custom' && styles.methodBtnTextActive]}>
                        Custom
                      </Text>
                    </Pressable>
                  </View>

                  {/* Custom panel */}
                  {isExpanded && (
                    <View style={styles.customPanel}>
                      {pts.length < 2 && (
                        <View style={styles.warnBox}>
                          <Text style={styles.warnText}>
                            Add at least 2 points to enable custom calorie calculation.
                          </Text>
                        </View>
                      )}

                      {pts.length > 0 && (
                        <>
                          <View style={styles.tableHeaderRow}>
                            <Text style={[styles.tableCell, styles.tableHeaderCell]}>HR</Text>
                            <Text style={[styles.tableCell, styles.tableHeaderCell]}>kcal/hr</Text>
                            <Text style={[styles.tableCell, styles.tableHeaderCell]}>fat g/hr</Text>
                            <Text style={[styles.tableCell, styles.tableHeaderCell]}>carb g/hr</Text>
                            <View style={{ width: 28 }} />
                          </View>
                          {pts.map(pt => (
                            <View key={pt.id} style={styles.tableDataRow}>
                              <Text style={styles.tableCell}>{pt.hr_value}</Text>
                              <Text style={styles.tableCell}>{pt.kcal_per_hour}</Text>
                              <Text style={styles.tableCell}>{pt.fat_g_per_hour ?? '—'}</Text>
                              <Text style={styles.tableCell}>{pt.carb_g_per_hour ?? '—'}</Text>
                              <Pressable onPress={() => deleteBurnPoint(sport, pt.id)} hitSlop={8}>
                                <Text style={styles.deleteBtn}>×</Text>
                              </Pressable>
                            </View>
                          ))}
                        </>
                      )}

                      {pts.length >= 2 && <BurnChart points={pts} width={chartWidth} />}

                      {/* Add form */}
                      <Text style={styles.addFormLabel}>Add point</Text>
                      <View style={styles.inputRow}>
                        <View style={styles.inputGroup}>
                          <Text style={styles.inputLabel}>HR (bpm)</Text>
                          <TextInput
                            style={styles.input}
                            placeholder="e.g. 150"
                            keyboardType="numeric"
                            value={form.hr}
                            onChangeText={v => updateForm(sport, 'hr', v)}
                          />
                        </View>
                        <View style={styles.inputGroup}>
                          <Text style={styles.inputLabel}>kcal/hr</Text>
                          <TextInput
                            style={styles.input}
                            placeholder="e.g. 570"
                            keyboardType="numeric"
                            value={form.kcal}
                            onChangeText={v => updateForm(sport, 'kcal', v)}
                          />
                        </View>
                      </View>
                      <View style={styles.inputRow}>
                        <View style={styles.inputGroup}>
                          <Text style={styles.inputLabel}>Fat (g/hr)</Text>
                          <TextInput
                            style={styles.input}
                            placeholder="optional"
                            keyboardType="numeric"
                            value={form.fat}
                            onChangeText={v => updateForm(sport, 'fat', v)}
                          />
                        </View>
                        <View style={styles.inputGroup}>
                          <Text style={styles.inputLabel}>Carb (g/hr)</Text>
                          <TextInput
                            style={styles.input}
                            placeholder="optional"
                            keyboardType="numeric"
                            value={form.carb}
                            onChangeText={v => updateForm(sport, 'carb', v)}
                          />
                        </View>
                      </View>
                      <Pressable
                        style={[styles.addBtn, savingPt && styles.addBtnDisabled]}
                        onPress={() => addBurnPoint(sport)}
                        disabled={savingPt}
                      >
                        <Text style={styles.addBtnText}>Add</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              )
            })}
          </>
        )}

        {/* Sign out */}
        <Pressable style={styles.signOutBtn} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

function BurnChart({ points, width }: { points: BurnSchemaPoint[]; width: number }) {
  const H = 160
  const PAD = { top: 12, right: 12, bottom: 28, left: 48 }
  const chartW = Math.max(width - PAD.left - PAD.right, 1)
  const chartH = H - PAD.top - PAD.bottom

  const hrMin = points[0].hr_value
  const hrMax = points[points.length - 1].hr_value
  const kcalMax = Math.max(...points.map(p => p.kcal_per_hour)) * 1.1 || 1
  const hrRange = hrMax - hrMin || 1

  const toX = (hr: number) => PAD.left + ((hr - hrMin) / hrRange) * chartW
  const toY = (k: number) => PAD.top + chartH - (k / kcalMax) * chartH

  const polyline = points.map(p => `${toX(p.hr_value)},${toY(p.kcal_per_hour)}`).join(' ')

  return (
    <Svg width={width} height={H} style={styles.chart}>
      <Line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + chartH} stroke="#e0e0e0" strokeWidth={1} />
      <Line x1={PAD.left} y1={PAD.top + chartH} x2={PAD.left + chartW} y2={PAD.top + chartH} stroke="#e0e0e0" strokeWidth={1} />
      <Polyline points={polyline} fill="none" stroke="#FC4C02" strokeWidth={2.5} strokeLinejoin="round" />
      {points.map(p => (
        <SvgText key={p.id} x={toX(p.hr_value)} y={PAD.top + chartH + 16} fontSize={10} fill="#aaa" textAnchor="middle">
          {p.hr_value}
        </SvgText>
      ))}
      <SvgText
        x={10} y={PAD.top + chartH / 2 + 20}
        fontSize={9} fill="#bbb"
        rotation={-90} originX={10} originY={PAD.top + chartH / 2}
      >
        kcal/hr
      </SvgText>
    </Svg>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingBottom: 60 },

  sectionHeader: { fontSize: 22, fontWeight: '800', marginBottom: 16 },
  sectionNote: { fontSize: 13, color: '#888', marginBottom: 18, lineHeight: 18 },

  // Profile
  stravaRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#f8f8f8', borderRadius: 12, padding: 16, marginBottom: 4,
  },
  stravaLabel: { fontSize: 14, fontWeight: '700' },
  stravaStatus: { fontSize: 13, color: '#888', marginTop: 2 },
  stravaBtn: { backgroundColor: '#FC4C02', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  stravaBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  fieldGroup: { marginTop: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#666', marginBottom: 6, textTransform: 'uppercase' },
  saveBtn: {
    backgroundColor: '#FC4C02', padding: 14, borderRadius: 10,
    alignItems: 'center', marginTop: 24,
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Energy
  sportCard: {
    borderWidth: 1, borderColor: '#ececec', borderRadius: 14,
    marginBottom: 12, overflow: 'hidden',
  },
  sportHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#fafafa',
  },
  sportName: { fontSize: 15, fontWeight: '700' },
  expandChevron: { fontSize: 12, color: '#aaa' },
  methodRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  methodBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: '#ddd', alignItems: 'center',
  },
  methodBtnActive: { backgroundColor: '#FC4C02', borderColor: '#FC4C02' },
  methodBtnText: { fontSize: 13, fontWeight: '600', color: '#888' },
  methodBtnTextActive: { color: '#fff' },

  customPanel: { paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  warnBox: { backgroundColor: '#FFF8E1', borderRadius: 8, padding: 12, marginTop: 12, marginBottom: 8 },
  warnText: { fontSize: 13, color: '#795548', lineHeight: 18 },

  tableHeaderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 12, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  tableDataRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f8f8f8',
  },
  tableCell: { flex: 1, fontSize: 13, color: '#333' },
  tableHeaderCell: { fontSize: 10, fontWeight: '700', color: '#bbb', textTransform: 'uppercase' },
  deleteBtn: { fontSize: 18, color: '#ccc', width: 28, textAlign: 'center' },

  chart: { marginVertical: 12, alignSelf: 'center' },

  addFormLabel: { fontSize: 13, fontWeight: '700', marginTop: 16, marginBottom: 10, color: '#555' },
  inputRow: { flexDirection: 'row', gap: 10 },
  inputGroup: { flex: 1, marginBottom: 10 },
  inputLabel: { fontSize: 10, fontWeight: '700', color: '#aaa', marginBottom: 4, textTransform: 'uppercase' },
  input: {
    borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8,
    padding: 10, fontSize: 14, backgroundColor: '#fff',
  },
  addBtn: {
    backgroundColor: '#FC4C02', padding: 12,
    borderRadius: 8, alignItems: 'center', marginTop: 4,
  },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  signOutBtn: { padding: 20, alignItems: 'center', marginTop: 20 },
  signOutText: { color: '#bbb', fontSize: 14 },
})
