import { useState, useCallback } from 'react'
import {
  View, Text, Pressable, ScrollView, StyleSheet,
  TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../../lib/supabase'
import { W as C } from '../../../lib/themeWarm'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!

type NoteType = 'note' | 'workout' | 'nutrition'

const SPORT_OPTIONS = ['Run', 'Ride', 'Swim', 'Walk', 'Strength Training', 'Yoga', 'Hiking', 'Other']

interface ScheduledWorkout {
  id: string; sport_type: string; target_kcal: number; target_duration_min: number | null
  workout_description: string | null; planned_for: string; status: string | null
}

interface AthleteData {
  profile: {
    name: string | null
    weight_kg: number | null
    age: number | null
    sex: string | null
    sport_history: string | null
    max_hr: number | null
    resting_hr: number | null
    daily_kcal_target: number | null
  }
  zones: Array<{ zone_number: number; name: string; min_bpm: number; max_bpm: number }>
  privacy: { see_activities: boolean; see_nutrition: boolean; see_meals: boolean; see_weight: boolean }
  activities: Array<{
    id: string; name: string; type: string; date: string
    duration_sec: number; distance_m: number | null; avg_hr: number | null; total_kcal: number | null
  }> | null
  nutrition: Array<{ name: string; kcal: number; protein_g: number | null; logged_at: string }> | null
  meal_templates: Array<{ meal_index: number; name: string; scheduled_time: string }> | null
  notes: Array<{ id: string; content: string; note_type: NoteType; created_at: string }>
  scheduled_workouts: ScheduledWorkout[]
}

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatDist(type: string, m: number | null) {
  if (!m) return null
  return /swim/i.test(type) ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

function getSportColor(type: string) {
  if (/swim/i.test(type)) return C.swim
  if (/run|jog/i.test(type)) return C.run
  if (/walk/i.test(type)) return C.walk
  if (/ride|bike|cycling|virtual/i.test(type)) return C.ride
  return C.sport
}

function noteTypeLabel(t: NoteType) {
  return t === 'workout' ? 'Workout' : t === 'nutrition' ? 'Nutrition' : 'Note'
}
function noteTypeColor(t: NoteType) {
  return t === 'workout' ? C.accent : t === 'nutrition' ? C.success : C.ride
}
function noteTypeIcon(t: NoteType): any {
  return t === 'workout' ? 'flash' : t === 'nutrition' ? 'restaurant' : 'chatbubble-ellipses'
}

function zoneColor(n: number) {
  return ([C.swim, C.success, C.warning, C.run, C.danger] as string[])[n - 1] ?? C.text4
}

export default function AthleteDetailScreen() {
  const { id: athleteId } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()

  const [data, setData] = useState<AthleteData | null>(null)
  const [loading, setLoading] = useState(true)

  // Workout schedule
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0] })()
  const [workoutDate, setWorkoutDate] = useState(tomorrow)
  const [workoutSport, setWorkoutSport] = useState('Run')
  const [workoutDescription, setWorkoutDescription] = useState('')
  const [workoutNote, setWorkoutNote] = useState('')
  const [dateOpen, setDateOpen] = useState(false)
  const [sportOpen, setSportOpen] = useState(false)

  const [sending, setSending] = useState(false)

  useFocusEffect(useCallback(() => { load() }, [athleteId]))

  async function load() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch(`${SUPABASE_URL}/functions/v1/coach-athlete-data`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: athleteId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load athlete data')
      setData(json)
    } catch (err: any) {
      Alert.alert('Error', err.message)
    } finally {
      setLoading(false)
    }
  }

  async function scheduleWorkout() {
    if (!workoutDescription.trim()) return
    setSending(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const calls: Promise<Response>[] = [
        fetch(`${SUPABASE_URL}/functions/v1/coach-push-workout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            athlete_id: athleteId,
            content: workoutDescription.trim(),
            note_type: 'workout',
            schedule_workout: true,
            planned_for: workoutDate,
            sport_type: workoutSport,
            target_kcal: null,
            target_duration_min: null,
          }),
        }),
      ]

      if (workoutNote.trim()) {
        calls.push(
          fetch(`${SUPABASE_URL}/functions/v1/coach-push-workout`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ athlete_id: athleteId, content: workoutNote.trim(), note_type: 'note' }),
          }),
        )
      }

      const results = await Promise.all(calls)
      for (const res of results) {
        if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Failed') }
      }

      const displayDate = workoutDate.split('-').reverse().join('-')
      setWorkoutDescription('')
      setWorkoutNote('')
      setWorkoutDate(tomorrow)
      load()
      Alert.alert('Scheduled', `Workout added to ${data?.profile.name ?? 'athlete'}'s planner for ${displayDate}.`)
    } catch (err: any) {
      Alert.alert('Error', err.message)
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={st.container}>
        <View style={st.headerRow}>
          <Pressable onPress={() => router.back()} style={st.backBtn}>
            <Ionicons name="chevron-back" size={22} color={C.text1} />
          </Pressable>
          <Text style={st.title}>Athlete</Text>
        </View>
        <ActivityIndicator color={C.accent} style={{ marginTop: 32 }} />
      </SafeAreaView>
    )
  }

  if (!data) return null

  const { profile, zones, privacy, activities, nutrition, meal_templates, notes } = data
  const kcalLast7 = nutrition
    ? nutrition.reduce((s, f) => s + f.kcal, 0)
    : null
  const kcalAvg = kcalLast7 != null && nutrition && nutrition.length > 0
    ? Math.round(kcalLast7 / 7)
    : null

  return (
    <SafeAreaView style={st.container}>
      <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>

        <View style={st.headerRow}>
          <Pressable onPress={() => router.back()} style={st.backBtn}>
            <Ionicons name="chevron-back" size={22} color={C.text1} />
          </Pressable>
          <Text style={st.title} numberOfLines={1}>{profile.name ?? 'Athlete'}</Text>
        </View>

        {/* Profile summary */}
        <View style={st.card}>
          <Text style={st.cardTitle}>Profile</Text>
          <View style={st.statsGrid}>
            {profile.age != null && <StatChip label="Age" value={String(profile.age)} />}
            {profile.weight_kg != null && <StatChip label="Weight" value={`${profile.weight_kg} kg`} />}
            {profile.max_hr != null && <StatChip label="Max HR" value={`${profile.max_hr} bpm`} />}
            {profile.resting_hr != null && <StatChip label="Rest HR" value={`${profile.resting_hr} bpm`} />}
            {profile.daily_kcal_target != null && <StatChip label="Base target" value={`${profile.daily_kcal_target} kcal`} />}
            {profile.sex != null && <StatChip label="Sex" value={profile.sex} />}
          </View>
          {profile.sport_history && (
            <Text style={st.sportHistory}>{profile.sport_history}</Text>
          )}
        </View>

        {/* HR Zones */}
        {zones.length > 0 && (
          <View style={st.card}>
            <Text style={st.cardTitle}>Heart Rate Zones</Text>
            {zones.map(z => (
              <View key={z.zone_number} style={st.zoneRow}>
                <View style={[st.zoneDot, { backgroundColor: zoneColor(z.zone_number) }]} />
                <Text style={st.zoneName}>Z{z.zone_number} {z.name}</Text>
                <Text style={st.zoneRange}>{z.min_bpm}–{z.max_bpm} bpm</Text>
              </View>
            ))}
          </View>
        )}

        {/* Activities */}
        {privacy.see_activities && (
          <View style={st.card}>
            <Text style={st.cardTitle}>Recent Activities (30 days)</Text>
            {!activities || activities.length === 0 ? (
              <Text style={st.noDataText}>No activities recorded.</Text>
            ) : (
              activities.slice(0, 10).map(a => {
                const color = getSportColor(a.type)
                const dist = formatDist(a.type, a.distance_m)
                return (
                  <View key={a.id} style={[st.actRow, { borderLeftColor: color }]}>
                    <View style={st.actInfo}>
                      <Text style={st.actName} numberOfLines={1}>{a.name}</Text>
                      <Text style={st.actMeta}>
                        {a.type} · {formatDuration(a.duration_sec)}
                        {dist ? ` · ${dist}` : ''}
                        {a.avg_hr ? ` · avg ${a.avg_hr} bpm` : ''}
                      </Text>
                    </View>
                    {a.total_kcal != null && (
                      <Text style={st.actKcal}>{Math.round(a.total_kcal)} kcal</Text>
                    )}
                  </View>
                )
              })
            )}
          </View>
        )}

        {/* Nutrition summary */}
        {privacy.see_nutrition && (
          <View style={st.card}>
            <Text style={st.cardTitle}>Nutrition (last 7 days)</Text>
            {!nutrition || nutrition.length === 0 ? (
              <Text style={st.noDataText}>No food logged.</Text>
            ) : (
              <>
                {kcalAvg != null && (
                  <View style={st.nutritionSummary}>
                    <Text style={st.nutritionAvg}>{kcalAvg.toLocaleString()}</Text>
                    <Text style={st.nutritionAvgLabel}>avg kcal/day</Text>
                  </View>
                )}
                {nutrition.slice(0, 8).map((f, i) => (
                  <View key={i} style={st.foodRow}>
                    <Text style={st.foodName} numberOfLines={1}>{f.name}</Text>
                    <Text style={st.foodKcal}>{f.kcal} kcal</Text>
                  </View>
                ))}
              </>
            )}
          </View>
        )}

        {/* Meal plan */}
        {privacy.see_meals && meal_templates && meal_templates.length > 0 && (
          <View style={st.card}>
            <Text style={st.cardTitle}>Meal Plan</Text>
            {meal_templates.map(m => (
              <View key={m.meal_index} style={st.mealRow}>
                <Ionicons name="time-outline" size={13} color={C.text4} />
                <Text style={st.mealTime}>{m.scheduled_time}</Text>
                <Text style={st.mealName}>{m.name}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Coach notes — historical */}
        {notes.length > 0 && (
          <View style={st.card}>
            <Text style={st.cardTitle}>Sent notes</Text>
            {notes.map(n => (
              <View key={n.id} style={[st.noteRow, { borderLeftColor: noteTypeColor(n.note_type) }]}>
                <View style={st.noteHeader}>
                  <Ionicons name={noteTypeIcon(n.note_type)} size={12} color={noteTypeColor(n.note_type)} />
                  <Text style={[st.noteTag, { color: noteTypeColor(n.note_type) }]}>{noteTypeLabel(n.note_type)}</Text>
                  <Text style={st.noteDate}>
                    {new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </Text>
                </View>
                <Text style={st.noteContent}>{n.content}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Scheduled workouts */}
        {(data.scheduled_workouts ?? []).length > 0 && (
          <View style={st.card}>
            <Text style={st.cardTitle}>Scheduled workouts</Text>
            {(data.scheduled_workouts ?? []).map(w => {
              const isPast = w.planned_for < new Date().toISOString().split('T')[0]
              const dateLabel = new Date(w.planned_for + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
              return (
                <View key={w.id} style={[st.schedRow, isPast && { opacity: 0.5 }]}>
                  <View style={st.schedDateBox}>
                    <Text style={st.schedDate}>{dateLabel}</Text>
                    {w.status === 'completed' && <Ionicons name="checkmark-circle" size={13} color={C.success} />}
                    {w.status === 'skipped' && <Ionicons name="close-circle" size={13} color={C.danger} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.schedSport}>{w.sport_type}</Text>
                    {w.workout_description ? <Text style={st.schedDesc} numberOfLines={2}>{w.workout_description}</Text> : null}
                    <Text style={st.schedMeta}>
                      {[w.target_duration_min ? `${w.target_duration_min} min` : null, w.target_kcal ? `~${w.target_kcal} kcal` : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </View>
              )
            })}
          </View>
        )}

        {/* Compose */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={st.card}>
            <Text style={st.cardTitle}>Schedule a workout</Text>

            <Text style={st.fieldLabel}>Date</Text>
            <Pressable style={st.dropdownBtn} onPress={() => { setDateOpen(o => !o); setSportOpen(false) }}>
              <Text style={st.dropdownBtnText}>
                {DATE_OPTIONS.find(d => d.iso === workoutDate)?.label ?? workoutDate}
              </Text>
              <Ionicons name={dateOpen ? 'chevron-up' : 'chevron-down'} size={16} color={C.text2} />
            </Pressable>
            {dateOpen && (
              <View style={st.dropdownList}>
                <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                  {DATE_OPTIONS.map(opt => {
                    const active = opt.iso === workoutDate
                    return (
                      <Pressable
                        key={opt.iso}
                        style={[st.dropdownItem, active && { backgroundColor: C.accentBg }]}
                        onPress={() => { setWorkoutDate(opt.iso); setDateOpen(false) }}
                      >
                        <Text style={[st.dropdownItemText, active && { color: C.accent, fontWeight: '700' }]}>{opt.label}</Text>
                        {active && <Ionicons name="checkmark" size={15} color={C.accent} />}
                      </Pressable>
                    )
                  })}
                </ScrollView>
              </View>
            )}

            <Text style={[st.fieldLabel, { marginTop: 14 }]}>Sport</Text>
            <Pressable style={st.dropdownBtn} onPress={() => { setSportOpen(o => !o); setDateOpen(false) }}>
              <Text style={st.dropdownBtnText}>{workoutSport}</Text>
              <Ionicons name={sportOpen ? 'chevron-up' : 'chevron-down'} size={16} color={C.text2} />
            </Pressable>
            {sportOpen && (
              <View style={st.dropdownList}>
                {SPORT_OPTIONS.map(s => {
                  const active = workoutSport === s
                  return (
                    <Pressable
                      key={s}
                      style={[st.dropdownItem, active && { backgroundColor: C.accentBg }]}
                      onPress={() => { setWorkoutSport(s); setSportOpen(false) }}
                    >
                      <Text style={[st.dropdownItemText, active && { color: C.accent, fontWeight: '700' }]}>{s}</Text>
                      {active && <Ionicons name="checkmark" size={15} color={C.accent} />}
                    </Pressable>
                  )
                })}
              </View>
            )}

            <Text style={[st.fieldLabel, { marginTop: 14 }]}>Workout description</Text>
            <TextInput
              style={[st.noteInput, { minHeight: 70 }]}
              placeholder="E.g. 45 min easy Zone 2 run, keep HR under 145 bpm"
              placeholderTextColor={C.text3}
              value={workoutDescription}
              onChangeText={setWorkoutDescription}
              multiline numberOfLines={3} textAlignVertical="top"
            />

            <Text style={st.fieldLabel}>Note to athlete (optional)</Text>
            <TextInput
              style={[st.noteInput, { minHeight: 56 }]}
              placeholder="E.g. Take it easy this week, focus on recovery"
              placeholderTextColor={C.text3}
              value={workoutNote}
              onChangeText={setWorkoutNote}
              multiline numberOfLines={2} textAlignVertical="top"
            />

            <Pressable
              style={[st.sendBtn, (!workoutDescription.trim() || sending) && st.sendBtnDisabled]}
              onPress={scheduleWorkout} disabled={!workoutDescription.trim() || sending}
            >
              {sending ? <ActivityIndicator color={C.white} size="small" /> : (
                <><Ionicons name="calendar-outline" size={15} color={C.white} /><Text style={st.sendBtnText}>Add to planner</Text></>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>

      </ScrollView>
    </SafeAreaView>
  )
}

function buildDateOptions(days = 30): { iso: string; label: string }[] {
  const options = []
  for (let i = 1; i <= days; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const iso = d.toISOString().split('T')[0]
    const label = d.toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    options.push({ iso, label })
  }
  return options
}

const DATE_OPTIONS = buildDateOptions(30)

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.statChip}>
      <Text style={st.statChipLabel}>{label}</Text>
      <Text style={st.statChipValue}>{value}</Text>
    </View>
  )
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 48, gap: 12 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  backBtn: { padding: 4 },
  title: { flex: 1, fontSize: 22, fontWeight: '800', color: C.text1 },

  card: {
    backgroundColor: C.surface, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: C.border,
  },
  cardTitle: { fontSize: 13, fontWeight: '700', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 12 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  statChip: { backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  statChipLabel: { fontSize: 10, fontWeight: '700', color: C.text3, textTransform: 'uppercase' },
  statChipValue: { fontSize: 14, fontWeight: '700', color: C.text1, marginTop: 2 },
  sportHistory: { fontSize: 13, color: C.text2, marginTop: 4, lineHeight: 18 },

  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: 1, borderTopColor: C.divider },
  zoneDot: { width: 8, height: 8, borderRadius: 4 },
  zoneName: { flex: 1, fontSize: 13, color: C.text1 },
  zoneRange: { fontSize: 12, color: C.text3, fontWeight: '600' },

  actRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderLeftWidth: 3, paddingLeft: 10, marginBottom: 6,
    borderTopWidth: 1, borderTopColor: C.divider,
  },
  actInfo: { flex: 1 },
  actName: { fontSize: 14, fontWeight: '600', color: C.text1, marginBottom: 2 },
  actMeta: { fontSize: 12, color: C.text3 },
  actKcal: { fontSize: 14, fontWeight: '700', color: C.accent },

  nutritionSummary: { alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.divider, marginBottom: 8 },
  nutritionAvg: { fontSize: 32, fontWeight: '800', color: C.accent },
  nutritionAvgLabel: { fontSize: 12, color: C.text3, fontWeight: '600' },
  foodRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderTopWidth: 1, borderTopColor: C.divider },
  foodName: { flex: 1, fontSize: 13, color: C.text1 },
  foodKcal: { fontSize: 13, fontWeight: '600', color: C.text2 },

  mealRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.divider },
  mealTime: { fontSize: 13, color: C.text3, width: 46 },
  mealName: { flex: 1, fontSize: 13, color: C.text1 },

  noteRow: {
    borderLeftWidth: 3, paddingLeft: 10, marginBottom: 10,
    paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  noteHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  noteTag: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 },
  noteDate: { fontSize: 11, color: C.text4 },
  noteContent: { fontSize: 13, color: C.text1, lineHeight: 18 },

  noteInput: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 10,
    padding: 12, fontSize: 14, color: C.text1, minHeight: 90,
    marginBottom: 12, lineHeight: 20, backgroundColor: C.surface,
  },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.accent, borderRadius: 10, paddingVertical: 12,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: C.white, fontWeight: '700', fontSize: 15 },

  noDataText: { fontSize: 13, color: C.text4, fontStyle: 'italic' },

  // Scheduled workouts
  schedRow: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.divider },
  schedDateBox: { width: 80, flexDirection: 'row', alignItems: 'center', gap: 4 },
  schedDate: { fontSize: 11, fontWeight: '700', color: C.text3 },
  schedSport: { fontSize: 13, fontWeight: '700', color: C.text1, marginBottom: 2 },
  schedDesc: { fontSize: 12, color: C.text2, lineHeight: 17, marginBottom: 2 },
  schedMeta: { fontSize: 11, color: C.text3 },

  // Workout form fields
  fieldLabel: { fontSize: 11, fontWeight: '700', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  dropdownBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surface2, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 2,
  },
  dropdownBtnText: { fontSize: 14, fontWeight: '600', color: C.text1, flex: 1, marginRight: 8 },
  dropdownList: {
    backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    marginBottom: 4, overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.divider,
  },
  dropdownItemText: { fontSize: 14, color: C.text1, flex: 1 },
})
