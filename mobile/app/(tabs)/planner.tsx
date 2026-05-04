import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import type { HeartRateZone, BurnSchemaPoint, SportEnergySetting, PlannedWorkout } from '../../types'

// ─── helpers ───────────────────────────────────────────────────────────────

function localDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

function formatDuration(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function interpolateKcalPerHour(hr: number, pts: BurnSchemaPoint[]): number {
  if (pts.length === 0) return 0
  const sorted = [...pts].sort((a, b) => a.hr_value - b.hr_value)
  const p0 = sorted[0], pN = sorted[sorted.length - 1]
  if (hr <= p0.hr_value) return p0.kcal_per_hour
  if (hr >= pN.hr_value) return pN.kcal_per_hour
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i], hi = sorted[i + 1]
    if (hr >= lo.hr_value && hr <= hi.hr_value) {
      const t = (hr - lo.hr_value) / (hi.hr_value - lo.hr_value)
      return lo.kcal_per_hour + t * (hi.kcal_per_hour - lo.kcal_per_hour)
    }
  }
  return 0
}

// ─── types ─────────────────────────────────────────────────────────────────

type PlannerMode = 'kcal' | 'build' | 'ai'

interface ZoneSuggestion {
  zone: HeartRateZone
  midHR: number
  kcalPerHour: number
  durationMin: number
  distanceFormatted: string | null
  paceFormatted: string | null
}

interface WorkoutSegment {
  id: string
  inputType: 'distance' | 'time'
  value: string
  zoneId: string
  repeats: string
}

interface SegmentResult {
  totalKcal: number
  totalDurationMin: number
  segments: Array<{ label: string; kcal: number; durationMin: number }>
}

interface AiResult {
  plan: string
  estimated_kcal: number | null
}

// ─── screen ────────────────────────────────────────────────────────────────

export default function PlannerScreen() {
  const [userId, setUserId] = useState<string | null>(null)
  const [weightKg, setWeightKg] = useState<number | null>(null)

  const [sports, setSports] = useState<string[]>([])
  const [selectedSport, setSelectedSport] = useState<string>('')

  const [zones, setZones] = useState<HeartRateZone[]>([])
  const [burnSchema, setBurnSchema] = useState<BurnSchemaPoint[]>([])
  const [sportSettings, setSportSettings] = useState<SportEnergySetting[]>([])
  const [avgSpeedBySport, setAvgSpeedBySport] = useState<Record<string, number>>({})

  // Today's saved plans
  const [todayPlans, setTodayPlans] = useState<PlannedWorkout[]>([])
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null)

  // Mode
  const [mode, setMode] = useState<PlannerMode>('kcal')

  // kcal mode
  const [targetKcal, setTargetKcal] = useState('500')
  const [suggestions, setSuggestions] = useState<ZoneSuggestion[]>([])
  const [calculated, setCalculated] = useState(false)

  // build mode (multi-segment)
  const [segments, setSegments] = useState<WorkoutSegment[]>([
    { id: '1', inputType: 'distance', value: '', zoneId: '', repeats: '1' },
  ])
  const [segResult, setSegResult] = useState<SegmentResult | null>(null)

  // ai mode
  const [aiInput, setAiInput] = useState('')
  const [aiResult, setAiResult] = useState<AiResult | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)

    const todayStr = localDate()

    const [profileRes, activitiesRes, zonesRes, burnRes, settingsRes, plansRes] = await Promise.all([
      supabase.from('users').select('weight_kg').eq('id', user.id).single(),
      supabase.from('activities').select('type, distance_m, duration_sec').eq('user_id', user.id),
      supabase.from('heart_rate_zones').select('*').eq('user_id', user.id).order('zone_number'),
      supabase.from('burn_schema_points').select('*').eq('user_id', user.id).order('hr_value'),
      supabase.from('sport_energy_settings').select('*').eq('user_id', user.id),
      supabase.from('planned_workouts').select('*').eq('user_id', user.id).eq('planned_for', todayStr).order('created_at'),
    ])

    setWeightKg(profileRes.data?.weight_kg ?? null)
    setZones(zonesRes.data ?? [])
    setBurnSchema(burnRes.data ?? [])
    setSportSettings(settingsRes.data ?? [])
    setTodayPlans(plansRes.data ?? [])

    const sportSet = new Set<string>(
      (activitiesRes.data ?? []).map((a: any) => a.type).filter(Boolean),
    )
    const sportList = [...sportSet].sort()
    setSports(sportList)
    if (sportList.length > 0) setSelectedSport(sportList[0])

    const speedMap: Record<string, number> = {}
    for (const sport of sportSet) {
      const acts = (activitiesRes.data ?? []).filter(
        (a: any) => a.type === sport && a.distance_m > 0 && a.duration_sec > 0,
      )
      if (acts.length > 0) {
        const totalDist = acts.reduce((s: number, a: any) => s + a.distance_m, 0)
        const totalSec = acts.reduce((s: number, a: any) => s + a.duration_sec, 0)
        speedMap[sport] = totalDist / totalSec
      }
    }
    setAvgSpeedBySport(speedMap)
  }

  function getKcalPerHour(zone: HeartRateZone): number {
    const setting = sportSettings.find(s => s.sport_type === selectedSport)
    const method = setting?.method ?? 'standard'
    const effectiveSport = setting?.linked_sport_type ?? selectedSport
    const schemaPts = burnSchema.filter(p => p.sport_type === effectiveSport)
    const useCustom = method === 'custom' && schemaPts.length >= 2
    const midHR = Math.round((zone.min_bpm + zone.max_bpm) / 2)
    return useCustom
      ? interpolateKcalPerHour(midHR, schemaPts)
      : zone.met_value * (weightKg ?? 70)
  }

  async function deletePlan(id: string) {
    setDeletingPlanId(id)
    await supabase.from('planned_workouts').delete().eq('id', id)
    setTodayPlans(prev => prev.filter(p => p.id !== id))
    setDeletingPlanId(null)
  }

  // ─── kcal mode ─────────────────────────────────────────────────────────────

  const calculate = useCallback(() => {
    const kcal = parseFloat(targetKcal)
    if (isNaN(kcal) || kcal <= 0) { Alert.alert('Invalid', 'Enter a positive calorie target.'); return }
    if (zones.length === 0) { Alert.alert('No zones', 'Set up your heart rate zones in Settings first.'); return }
    if (!weightKg) { Alert.alert('No weight', 'Add your weight in Settings → Personal Info first.'); return }

    const avgSpeed = avgSpeedBySport[selectedSport] ?? null
    const results: ZoneSuggestion[] = zones.map(zone => {
      const midHR = Math.round((zone.min_bpm + zone.max_bpm) / 2)
      const kcalPerHour = getKcalPerHour(zone)
      const durationHours = kcal / kcalPerHour
      const durationMin = Math.round(durationHours * 60)
      const durationSec = durationHours * 3600

      let distanceFormatted: string | null = null
      let paceFormatted: string | null = null

      if (avgSpeed && avgSpeed > 0) {
        const distM = avgSpeed * durationSec
        if (/swim/i.test(selectedSport)) {
          distanceFormatted = `${Math.round(distM)} m`
          const s = 100 / avgSpeed
          paceFormatted = `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} /100m`
        } else if (/run|jog|walk/i.test(selectedSport)) {
          distanceFormatted = `${(distM / 1000).toFixed(1)} km`
          const s = 1000 / avgSpeed
          paceFormatted = `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} /km`
        } else {
          distanceFormatted = `${(distM / 1000).toFixed(1)} km`
          paceFormatted = `${(avgSpeed * 3.6).toFixed(1)} km/h`
        }
      }

      return { zone, midHR, kcalPerHour: Math.round(kcalPerHour), durationMin, distanceFormatted, paceFormatted }
    })

    setSuggestions(results)
    setCalculated(true)
  }, [targetKcal, selectedSport, zones, burnSchema, sportSettings, weightKg, avgSpeedBySport])

  async function planFromKcalMode(suggestion: ZoneSuggestion) {
    if (!userId) return
    setSaving(true)
    const { error } = await supabase.from('planned_workouts').insert({
      user_id: userId,
      sport_type: selectedSport,
      target_kcal: Math.round(parseFloat(targetKcal)),
      zone_id: suggestion.zone.id,
      target_duration_min: suggestion.durationMin,
      target_hr: suggestion.midHR,
      planned_for: localDate(),
    })
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    Alert.alert('Planned!', `${selectedSport} in ${suggestion.zone.name} added to today.`)
    load()
  }

  // ─── build mode (multi-segment) ─────────────────────────────────────────────

  function addSegment() {
    setSegments(prev => [...prev, { id: String(Date.now()), inputType: 'distance', value: '', zoneId: '', repeats: '1' }])
    setSegResult(null)
  }

  function removeSegment(id: string) {
    setSegments(prev => prev.filter(s => s.id !== id))
    setSegResult(null)
  }

  function updateSegment(id: string, patch: Partial<WorkoutSegment>) {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
    setSegResult(null)
  }

  function calculateSegments() {
    if (zones.length === 0) { Alert.alert('No zones', 'Set up your HR zones in Settings first.'); return }
    if (!weightKg) { Alert.alert('No weight', 'Add your weight in Settings → Personal Info first.'); return }

    const results: SegmentResult['segments'] = []
    let totalKcal = 0
    let totalDurationMin = 0

    for (const seg of segments) {
      const val = parseFloat(seg.value)
      if (isNaN(val) || val <= 0) {
        Alert.alert('Invalid segment', 'All segments need a positive distance or time value.')
        return
      }
      const repeats = Math.max(1, parseInt(seg.repeats) || 1)
      const zone = zones.find(z => z.id === seg.zoneId)
      if (!zone) { Alert.alert('Missing zone', 'Select a zone for every segment.'); return }

      const kcalPerHour = getKcalPerHour(zone)
      let durationMin: number
      let label: string

      if (seg.inputType === 'time') {
        durationMin = val
        label = `${val} min @ ${zone.name}`
      } else {
        const avgSpeed = avgSpeedBySport[selectedSport]
        if (!avgSpeed) {
          Alert.alert('No pace data', `No historical pace found for ${selectedSport}. Use time-based segments instead.`)
          return
        }
        const isSwim = /swim/i.test(selectedSport)
        const distM = isSwim ? val : val * 1000
        durationMin = distM / avgSpeed / 60
        label = isSwim ? `${val} m @ ${zone.name}` : `${val} km @ ${zone.name}`
      }

      const segKcal = Math.round(kcalPerHour * (durationMin / 60)) * repeats
      const segDurationMin = durationMin * repeats

      results.push({
        label: repeats > 1 ? `${repeats}× (${label})` : label,
        kcal: segKcal,
        durationMin: Math.round(segDurationMin),
      })
      totalKcal += segKcal
      totalDurationMin += segDurationMin
    }

    setSegResult({ totalKcal: Math.round(totalKcal), totalDurationMin: Math.round(totalDurationMin), segments: results })
  }

  async function planFromBuildMode() {
    if (!segResult || !userId) return
    const description = segResult.segments
      .map(s => `${s.label} (~${s.kcal} kcal, ${formatDuration(s.durationMin)})`)
      .join('\n')
    setSaving(true)
    const { error } = await supabase.from('planned_workouts').insert({
      user_id: userId,
      sport_type: selectedSport,
      target_kcal: segResult.totalKcal,
      target_duration_min: segResult.totalDurationMin,
      planned_for: localDate(),
      workout_description: description,
    })
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    Alert.alert('Planned!', `${selectedSport} workout (${segResult.totalKcal} kcal) added to today.`)
    load()
  }

  // ─── ai mode ───────────────────────────────────────────────────────────────

  async function askAI() {
    if (!aiInput.trim()) return
    setAiLoading(true)
    setAiResult(null)
    try {
      const res = await supabase.functions.invoke('ai-coach', {
        body: { message: aiInput, sport: selectedSport || undefined },
      })
      if (res.error) {
        const body = await res.error.context?.json?.().catch(() => null)
        throw new Error(body?.error ?? res.error.message)
      }
      setAiResult(res.data as AiResult)
    } catch (e: any) {
      Alert.alert('AI Coach error', e?.message ?? 'Could not reach AI Coach.')
    } finally {
      setAiLoading(false)
    }
  }

  async function planFromAIMode() {
    if (!aiResult || !userId) return
    const kcal = aiResult.estimated_kcal
    if (!kcal) { Alert.alert('No estimate', 'The AI response did not include a kcal estimate.'); return }
    setSaving(true)
    const { error } = await supabase.from('planned_workouts').insert({
      user_id: userId,
      sport_type: selectedSport || 'General',
      target_kcal: kcal,
      planned_for: localDate(),
      workout_description: aiResult.plan,
    })
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    Alert.alert('Planned!', "AI workout added to today's plan.")
    load()
  }

  const sportColor = getSportColor(selectedSport)

  return (
    <SafeAreaView style={st.container}>
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <Text style={st.screenTitle}>Workout Planner</Text>

        {/* Today's plan */}
        {todayPlans.length > 0 && (
          <View style={st.todayCard}>
            <Text style={st.sectionLabel}>Today's plan</Text>
            {todayPlans.map((plan, i) => (
              <View key={plan.id} style={[st.planRow, i < todayPlans.length - 1 && st.planRowBorder]}>
                <View style={[st.planDot, { backgroundColor: getSportColor(plan.sport_type) }]} />
                <View style={st.planInfo}>
                  <Text style={st.planSport}>{plan.sport_type}</Text>
                  <Text style={st.planMeta}>
                    {plan.target_kcal} kcal
                    {plan.target_duration_min ? ` · ${formatDuration(plan.target_duration_min)}` : ''}
                  </Text>
                  {plan.workout_description ? (
                    <Text style={st.planDesc} numberOfLines={3}>{plan.workout_description}</Text>
                  ) : null}
                </View>
                <Pressable onPress={() => deletePlan(plan.id)} hitSlop={12} disabled={deletingPlanId === plan.id}>
                  {deletingPlanId === plan.id
                    ? <ActivityIndicator size="small" color="#ccc" />
                    : <Ionicons name="trash-outline" size={18} color="#ccc" />
                  }
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Sport selector */}
        <Text style={st.label}>Sport</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.chipRow} contentContainerStyle={st.chipContent}>
          {sports.map(sport => (
            <Pressable
              key={sport}
              style={[st.chip, selectedSport === sport && { backgroundColor: getSportColor(sport), borderColor: getSportColor(sport) }]}
              onPress={() => { setSelectedSport(sport); setCalculated(false); setSegResult(null) }}
            >
              <MaterialCommunityIcons name={getSportIcon(sport) as any} size={14} color={selectedSport === sport ? '#fff' : getSportColor(sport)} />
              <Text style={[st.chipText, selectedSport === sport && st.chipTextActive]}>{sport}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Mode selector */}
        <View style={st.modeRow}>
          {([
            { key: 'kcal',  label: 'Target kcal',  icon: 'flame-outline' as const },
            { key: 'build', label: 'Build workout', icon: 'list-outline' as const },
            { key: 'ai',    label: 'AI Coach',      icon: 'sparkles-outline' as const },
          ] as const).map(m => (
            <Pressable
              key={m.key}
              style={[st.modeBtn, mode === m.key && { backgroundColor: sportColor, borderColor: sportColor }]}
              onPress={() => setMode(m.key)}
            >
              <Ionicons name={m.icon} size={13} color={mode === m.key ? '#fff' : '#888'} />
              <Text style={[st.modeBtnText, mode === m.key && st.modeBtnTextActive]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* ─── KCAL MODE ─────────────────────────────────────────────────────── */}
        {mode === 'kcal' && (
          <>
            <Text style={st.label}>Target (kcal)</Text>
            <View style={st.kcalRow}>
              {[300, 400, 500, 600, 750, 1000].map(v => (
                <Pressable
                  key={v}
                  style={[st.kcalPreset, targetKcal === String(v) && { backgroundColor: sportColor, borderColor: sportColor }]}
                  onPress={() => { setTargetKcal(String(v)); setCalculated(false) }}
                >
                  <Text style={[st.kcalPresetText, targetKcal === String(v) && st.kcalPresetTextActive]}>{v}</Text>
                </Pressable>
              ))}
            </View>
            <View style={st.kcalInputRow}>
              <TextInput
                style={st.kcalInput}
                value={targetKcal}
                onChangeText={v => { setTargetKcal(v); setCalculated(false) }}
                keyboardType="numeric"
                placeholder="Other amount"
              />
              <Text style={st.kcalUnit}>kcal</Text>
            </View>

            <Pressable style={[st.calcBtn, { backgroundColor: sportColor }]} onPress={calculate}>
              <Ionicons name="calculator-outline" size={18} color="#fff" />
              <Text style={st.calcBtnText}>Calculate</Text>
            </Pressable>

            {calculated && suggestions.map(s => (
              <View key={s.zone.id} style={[st.suggestionCard, { borderLeftColor: sportColor }]}>
                <View style={st.suggestionTop}>
                  <View>
                    <Text style={st.zoneName}>{s.zone.name}</Text>
                    <Text style={st.zoneHR}>{s.zone.min_bpm}–{s.zone.max_bpm} bpm · ~{s.midHR} bpm avg</Text>
                  </View>
                  <Text style={[st.duration, { color: sportColor }]}>{formatDuration(s.durationMin)}</Text>
                </View>
                <View style={st.suggestionMeta}>
                  <View style={st.metaItem}>
                    <Ionicons name="flame-outline" size={13} color="#aaa" />
                    <Text style={st.metaText}>{s.kcalPerHour} kcal/hr</Text>
                  </View>
                  {s.distanceFormatted && (
                    <View style={st.metaItem}>
                      <Ionicons name="navigate-outline" size={13} color="#aaa" />
                      <Text style={st.metaText}>{s.distanceFormatted}</Text>
                    </View>
                  )}
                  {s.paceFormatted && (
                    <View style={st.metaItem}>
                      <Ionicons name="speedometer-outline" size={13} color="#aaa" />
                      <Text style={st.metaText}>{s.paceFormatted}</Text>
                    </View>
                  )}
                </View>
                <Pressable
                  style={[st.planBtn, saving && st.planBtnDisabled]}
                  onPress={() => planFromKcalMode(s)}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator size="small" color="#FC4C02" /> : <Text style={st.planBtnText}>Plan for today →</Text>}
                </Pressable>
              </View>
            ))}

            {calculated && suggestions.length === 0 && (
              <View style={st.emptyBox}>
                <Text style={st.emptyText}>No zones configured. Add HR zones in Settings first.</Text>
              </View>
            )}
          </>
        )}

        {/* ─── BUILD MODE ─────────────────────────────────────────────────────── */}
        {mode === 'build' && (
          <>
            <Text style={st.label}>Workout segments</Text>

            {segments.map((seg, idx) => {
              const selZone = zones.find(z => z.id === seg.zoneId)
              const isSwim = /swim/i.test(selectedSport)
              return (
                <View key={seg.id} style={st.segCard}>
                  <View style={st.segHeader}>
                    <Text style={st.segIndex}>Segment {idx + 1}</Text>
                    {segments.length > 1 && (
                      <Pressable onPress={() => removeSegment(seg.id)} hitSlop={10}>
                        <Ionicons name="close-circle-outline" size={20} color="#ccc" />
                      </Pressable>
                    )}
                  </View>

                  {/* Distance / Time toggle */}
                  <View style={st.segToggleRow}>
                    <Pressable
                      style={[st.segToggleBtn, seg.inputType === 'distance' && { backgroundColor: sportColor, borderColor: sportColor }]}
                      onPress={() => updateSegment(seg.id, { inputType: 'distance', value: '' })}
                    >
                      <Text style={[st.segToggleText, seg.inputType === 'distance' && { color: '#fff' }]}>Distance</Text>
                    </Pressable>
                    <Pressable
                      style={[st.segToggleBtn, seg.inputType === 'time' && { backgroundColor: sportColor, borderColor: sportColor }]}
                      onPress={() => updateSegment(seg.id, { inputType: 'time', value: '' })}
                    >
                      <Text style={[st.segToggleText, seg.inputType === 'time' && { color: '#fff' }]}>Time</Text>
                    </Pressable>
                  </View>

                  {/* Value + Repeats */}
                  <View style={st.segInputRow}>
                    <View style={st.segInputGroup}>
                      <TextInput
                        style={st.segInput}
                        value={seg.value}
                        onChangeText={v => updateSegment(seg.id, { value: v })}
                        placeholder={seg.inputType === 'distance' ? (isSwim ? 'e.g. 400' : 'e.g. 5') : 'e.g. 20'}
                        keyboardType="decimal-pad"
                      />
                      <Text style={st.segInputUnit}>{seg.inputType === 'distance' ? (isSwim ? 'm' : 'km') : 'min'}</Text>
                    </View>
                    <View style={st.segRepeatGroup}>
                      <TextInput
                        style={st.segInput}
                        value={seg.repeats}
                        onChangeText={v => updateSegment(seg.id, { repeats: v })}
                        placeholder="1"
                        keyboardType="number-pad"
                      />
                      <Text style={st.segInputUnit}>repeats</Text>
                    </View>
                  </View>

                  {/* Zone picker */}
                  <View style={st.segZoneRow}>
                    {zones.map(z => (
                      <Pressable
                        key={z.id}
                        style={[st.segZoneBtn, seg.zoneId === z.id && { backgroundColor: sportColor, borderColor: sportColor }]}
                        onPress={() => updateSegment(seg.id, { zoneId: z.id })}
                      >
                        <Text style={[st.segZoneBtnNum, seg.zoneId === z.id && { color: '#fff' }]}>Z{z.zone_number}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {selZone && (
                    <Text style={st.segZoneDetail}>{selZone.name} · {selZone.min_bpm}–{selZone.max_bpm} bpm</Text>
                  )}
                </View>
              )
            })}

            <Pressable style={st.addSegBtn} onPress={addSegment}>
              <Ionicons name="add-circle-outline" size={18} color={sportColor} />
              <Text style={[st.addSegBtnText, { color: sportColor }]}>Add segment</Text>
            </Pressable>

            <Pressable style={[st.calcBtn, { backgroundColor: sportColor }]} onPress={calculateSegments}>
              <Ionicons name="stats-chart-outline" size={18} color="#fff" />
              <Text style={st.calcBtnText}>Calculate workout</Text>
            </Pressable>

            {segResult && (
              <View style={[st.segResultCard, { borderLeftColor: sportColor }]}>
                <View style={st.segResultTotals}>
                  <View style={st.segResultStat}>
                    <Text style={[st.segResultValue, { color: sportColor }]}>{segResult.totalKcal}</Text>
                    <Text style={st.segResultLabel}>kcal</Text>
                  </View>
                  <View style={st.divider} />
                  <View style={st.segResultStat}>
                    <Text style={[st.segResultValue, { color: sportColor }]}>{formatDuration(segResult.totalDurationMin)}</Text>
                    <Text style={st.segResultLabel}>total</Text>
                  </View>
                </View>
                {segResult.segments.map((s, i) => (
                  <View key={i} style={st.segBreakRow}>
                    <Text style={st.segBreakLabel}>{s.label}</Text>
                    <Text style={st.segBreakMeta}>{s.kcal} kcal · {formatDuration(s.durationMin)}</Text>
                  </View>
                ))}
                <Pressable
                  style={[st.planBtn, { marginTop: 14 }, saving && st.planBtnDisabled]}
                  onPress={planFromBuildMode}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator size="small" color="#FC4C02" /> : <Text style={st.planBtnText}>Plan for today →</Text>}
                </Pressable>
              </View>
            )}
          </>
        )}

        {/* ─── AI COACH MODE ─────────────────────────────────────────────────── */}
        {mode === 'ai' && (
          <>
            <View style={st.aiInfoBox}>
              <Ionicons name="sparkles-outline" size={14} color="#7C83FD" />
              <Text style={st.aiInfoText}>
                Describe what you want to achieve and the AI Coach will design a workout around your HR zones and historical pace.
              </Text>
            </View>

            <Text style={st.label}>Your request</Text>
            <TextInput
              style={st.aiInput}
              value={aiInput}
              onChangeText={setAiInput}
              placeholder={'e.g. "I want to burn 500 kcal running" or "Plan a threshold running session, 45 min"'}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <Pressable
              style={[st.calcBtn, { backgroundColor: '#7C83FD' }, aiLoading && st.planBtnDisabled]}
              onPress={askAI}
              disabled={aiLoading}
            >
              {aiLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <>
                    <Ionicons name="send-outline" size={18} color="#fff" />
                    <Text style={st.calcBtnText}>Ask AI Coach</Text>
                  </>
              }
            </Pressable>

            {aiResult && (
              <View style={st.aiResultCard}>
                <View style={st.aiResultHeader}>
                  <Ionicons name="sparkles-outline" size={14} color="#7C83FD" />
                  <Text style={st.aiResultTitle}>AI Coach plan</Text>
                  {aiResult.estimated_kcal && (
                    <View style={st.aiKcalBadge}>
                      <Text style={st.aiKcalBadgeText}>~{aiResult.estimated_kcal} kcal</Text>
                    </View>
                  )}
                </View>
                <Text style={st.aiResultText}>{aiResult.plan}</Text>
                <Pressable
                  style={[st.planBtn, { marginTop: 16 }, saving && st.planBtnDisabled]}
                  onPress={planFromAIMode}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator size="small" color="#FC4C02" />
                    : <Text style={st.planBtnText}>Save as today's plan →</Text>
                  }
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── styles ────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingBottom: 60 },

  screenTitle: { fontSize: 26, fontWeight: '800', marginBottom: 20 },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#aaa',
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12,
  },
  label: { fontSize: 11, fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },

  // Today's plan card
  todayCard: {
    backgroundColor: '#fafafa', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#ebebeb', marginBottom: 24,
  },
  planRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, gap: 12 },
  planRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  planDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  planInfo: { flex: 1 },
  planSport: { fontSize: 14, fontWeight: '700', color: '#111', marginBottom: 2 },
  planMeta: { fontSize: 12, color: '#888', marginBottom: 2 },
  planDesc: { fontSize: 12, color: '#aaa', lineHeight: 17 },

  chipRow: { marginBottom: 24 },
  chipContent: { gap: 8, paddingRight: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5, borderColor: '#e0e0e0', backgroundColor: '#fafafa',
  },
  chipText: { fontSize: 13, fontWeight: '600', color: '#555' },
  chipTextActive: { color: '#fff' },

  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 28 },
  modeBtn: {
    flex: 1, flexDirection: 'column', alignItems: 'center', gap: 4,
    paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: '#e0e0e0', backgroundColor: '#fafafa',
  },
  modeBtnText: { fontSize: 11, fontWeight: '600', color: '#888', textAlign: 'center' },
  modeBtnTextActive: { color: '#fff' },

  kcalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  kcalPreset: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#e0e0e0', backgroundColor: '#fafafa',
  },
  kcalPresetText: { fontSize: 14, fontWeight: '600', color: '#555' },
  kcalPresetTextActive: { color: '#fff' },
  kcalInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 24 },
  kcalInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
    padding: 12, fontSize: 16, backgroundColor: '#fafafa',
  },
  kcalUnit: { fontSize: 14, color: '#aaa', fontWeight: '600' },

  calcBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 15, borderRadius: 12, marginBottom: 24,
  },
  calcBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Segment builder
  segCard: {
    backgroundColor: '#fafafa', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#ebebeb', marginBottom: 10,
  },
  segHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  segIndex: { fontSize: 11, fontWeight: '700', color: '#bbb', textTransform: 'uppercase', letterSpacing: 0.5 },

  segToggleRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  segToggleBtn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
    borderWidth: 1.5, borderColor: '#e0e0e0', backgroundColor: '#fff',
  },
  segToggleText: { fontSize: 13, fontWeight: '600', color: '#555' },

  segInputRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  segInputGroup: { flex: 2 },
  segRepeatGroup: { flex: 1 },
  segInput: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 8,
    padding: 10, fontSize: 15, backgroundColor: '#fff', marginBottom: 2,
  },
  segInputUnit: { fontSize: 11, color: '#bbb', textAlign: 'center' },

  segZoneRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segZoneBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1.5, borderColor: '#e0e0e0', backgroundColor: '#fff',
  },
  segZoneBtnNum: { fontSize: 13, fontWeight: '800', color: '#555' },
  segZoneDetail: { fontSize: 11, color: '#aaa', marginTop: 7 },

  addSegBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    justifyContent: 'center', paddingVertical: 12, marginBottom: 16,
  },
  addSegBtnText: { fontSize: 14, fontWeight: '700' },

  segResultCard: { borderLeftWidth: 4, borderRadius: 12, backgroundColor: '#fafafa', padding: 16, marginBottom: 12 },
  segResultTotals: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  segResultStat: { flex: 1, alignItems: 'center' },
  segResultValue: { fontSize: 26, fontWeight: '800' },
  segResultLabel: { fontSize: 11, color: '#aaa', marginTop: 2 },
  divider: { width: 1, height: 36, backgroundColor: '#e0e0e0' },
  segBreakRow: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#efefef' },
  segBreakLabel: { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 1 },
  segBreakMeta: { fontSize: 12, color: '#aaa' },

  // Suggestions (kcal mode)
  suggestionCard: {
    borderLeftWidth: 4, borderRadius: 12, backgroundColor: '#fafafa',
    padding: 16, marginBottom: 12,
  },
  suggestionTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  zoneName: { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 2 },
  zoneHR: { fontSize: 12, color: '#aaa' },
  duration: { fontSize: 26, fontWeight: '800' },
  suggestionMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 13, color: '#555' },

  planBtn: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#FC4C02', borderRadius: 8, padding: 10, alignItems: 'center' },
  planBtnDisabled: { opacity: 0.5 },
  planBtnText: { color: '#FC4C02', fontWeight: '700', fontSize: 14 },

  // AI mode
  aiInfoBox: { flexDirection: 'row', gap: 8, backgroundColor: '#F0F0FF', borderRadius: 12, padding: 12, marginBottom: 20 },
  aiInfoText: { flex: 1, fontSize: 13, color: '#5C63D8', lineHeight: 18 },
  aiInput: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 12,
    padding: 14, fontSize: 15, backgroundColor: '#fafafa',
    minHeight: 100, marginBottom: 16,
  },
  aiResultCard: { backgroundColor: '#fafafa', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e8e8ff' },
  aiResultHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  aiResultTitle: { fontSize: 14, fontWeight: '700', color: '#333', flex: 1 },
  aiKcalBadge: { backgroundColor: '#7C83FD22', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  aiKcalBadgeText: { fontSize: 12, fontWeight: '700', color: '#7C83FD' },
  aiResultText: { fontSize: 14, color: '#333', lineHeight: 21 },

  emptyBox: { padding: 24, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#aaa', textAlign: 'center' },
})
