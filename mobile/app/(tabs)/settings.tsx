import { useEffect, useState } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, Alert, Switch,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { supabase } from '../../lib/supabase'
import { useAppMode } from '../../contexts/AppModeContext'
import type { UserProfile, HeartRateZone, MealTemplate, UserSport } from '../../types'

const STRAVA_CLIENT_ID = process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID!
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/strava-callback`

const COMMON_SPORTS = [
  'Run', 'Ride', 'Swim', 'Walk', 'Strength Training',
  'Yoga', 'Rowing', 'Hiking', 'Nordic Ski', 'Kayaking',
]

const MEAL_DEFAULTS: { name: string; time: string }[] = [
  { name: 'Breakfast', time: '07:00' },
  { name: 'Morning snack', time: '10:00' },
  { name: 'Lunch', time: '12:30' },
  { name: 'Afternoon snack', time: '15:30' },
  { name: 'Dinner', time: '18:30' },
  { name: 'Evening snack', time: '20:30' },
  { name: 'Late snack', time: '21:30' },
  { name: 'Snack', time: '12:00' },
]

type SettingsTab = 'profile' | 'zones' | 'meals'
type SportMode = 'standard' | 'custom' | 'linked'
interface SportConfig { mode: SportMode; linkedTo: string | null }
interface DraftMeal { meal_index: number; name: string; scheduled_time: string }

function normalizeType(type: string): string {
  if (type === 'VirtualRide') return 'Ride'
  if (type === 'VirtualRun') return 'Run'
  return type
}

export default function SettingsScreen() {
  const router = useRouter()
  const { mode, setMode } = useAppMode()
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')
  const [userId, setUserId] = useState<string | null>(null)

  // Profile
  const [savedProfile, setSavedProfile] = useState<Partial<UserProfile>>({})
  const [editedProfile, setEditedProfile] = useState<Partial<UserProfile>>({})
  const [savingProfile, setSavingProfile] = useState(false)

  // Zones
  const [zones, setZones] = useState<HeartRateZone[]>([])
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)

  // Sport energy (based on actual activity types from Strava)
  const [activitySports, setActivitySports] = useState<string[]>([])
  const [sportConfigs, setSportConfigs] = useState<Record<string, SportConfig>>({})
  const [savingConfig, setSavingConfig] = useState<string | null>(null)

  // Planner sports
  const [userSports, setUserSports] = useState<UserSport[]>([])
  const [newSportInput, setNewSportInput] = useState('')

  // Meal plan
  const [draftMeals, setDraftMeals] = useState<DraftMeal[]>([
    { meal_index: 0, name: 'Breakfast', scheduled_time: '07:00' },
  ])
  const [savingMeals, setSavingMeals] = useState(false)

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

    const [profileRes, zonesRes, activitiesRes, settingsRes, mealRes, userSportsRes] = await Promise.all([
      supabase.from('users').select('*').eq('id', user.id).single(),
      supabase.from('heart_rate_zones').select('*').eq('user_id', user.id).order('zone_number'),
      supabase.from('activities').select('type').eq('user_id', user.id),
      supabase.from('sport_energy_settings').select('*').eq('user_id', user.id),
      supabase.from('meal_templates').select('*').eq('user_id', user.id).order('meal_index'),
      supabase.from('user_sports').select('*').eq('user_id', user.id).order('sort_order'),
    ])

    if (profileRes.data) {
      setSavedProfile(profileRes.data)
      setEditedProfile(profileRes.data)
    }
    setZones(zonesRes.data ?? [])

    // Activity sports for energy method section (keep actual Strava types)
    const sportSet = new Set<string>(
      (activitiesRes.data ?? []).map((a: { type: string }) => a.type).filter(Boolean),
    )
    setActivitySports([...sportSet].sort())

    const configs: Record<string, SportConfig> = {}
    for (const s of (settingsRes.data ?? [])) {
      const mode: SportMode = s.linked_sport_type
        ? 'linked'
        : s.method === 'custom' ? 'custom' : 'standard'
      configs[s.sport_type] = { mode, linkedTo: s.linked_sport_type ?? null }
    }
    setSportConfigs(configs)

    // Meal templates
    const meals = (mealRes.data ?? []) as MealTemplate[]
    if (meals.length > 0) {
      setDraftMeals(meals.map(m => ({ meal_index: m.meal_index, name: m.name, scheduled_time: m.scheduled_time })))
    }

    // Planner sports — auto-populate from activities (normalized, no Virtual*) if empty
    let sportsList = (userSportsRes.data ?? []) as UserSport[]
    if (sportsList.length === 0 && (activitiesRes.data ?? []).length > 0) {
      const actTypes = [...new Set<string>(
        (activitiesRes.data ?? [])
          .map((a: { type: string }) => normalizeType(a.type))
          .filter((t: string) => t.length > 0 && !t.startsWith('Virtual')),
      )].sort()
      if (actTypes.length > 0) {
        const toInsert = actTypes.map((name, i) => ({ user_id: user.id, sport_name: name, sort_order: i }))
        const { data: inserted } = await supabase.from('user_sports')
          .upsert(toInsert, { onConflict: 'user_id,sport_name' })
          .select()
        sportsList = (inserted ?? []) as UserSport[]
      }
    }
    setUserSports(sportsList)
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

  async function saveZone(zone: HeartRateZone) {
    const { error } = await supabase.from('heart_rate_zones')
      .update({ name: zone.name, min_bpm: zone.min_bpm, max_bpm: zone.max_bpm })
      .eq('id', zone.id)
    if (error) Alert.alert('Error', error.message)
    else setEditingZoneId(null)
  }

  async function saveSportConfig(sport: string, mode: SportMode, linkedTo: string | null) {
    if (!userId) return
    setSavingConfig(sport)
    const method = mode === 'standard' ? 'standard' : 'custom'
    const linked_sport_type = mode === 'linked' ? linkedTo : null
    const { error } = await supabase.from('sport_energy_settings').upsert(
      { user_id: userId, sport_type: sport, method, linked_sport_type },
      { onConflict: 'user_id,sport_type' },
    )
    setSavingConfig(null)
    if (error) { Alert.alert('Error', error.message); return }
    setSportConfigs(prev => ({ ...prev, [sport]: { mode, linkedTo: linked_sport_type } }))
  }

  async function addPlannerSport(name: string) {
    const trimmed = name.trim()
    if (!userId || !trimmed || userSports.some(s => s.sport_name === trimmed)) return
    const { data, error } = await supabase.from('user_sports').insert({
      user_id: userId,
      sport_name: trimmed,
      sort_order: userSports.length,
    }).select().single()
    if (error) { Alert.alert('Error', error.message); return }
    setUserSports(prev => [...prev, data as UserSport])
    setNewSportInput('')
  }

  async function removePlannerSport(id: string) {
    await supabase.from('user_sports').delete().eq('id', id)
    setUserSports(prev => prev.filter(s => s.id !== id))
  }

  async function saveMeals() {
    if (!userId) return
    setSavingMeals(true)
    const toSave = draftMeals.map((m, i) => ({
      user_id: userId!,
      meal_index: i,
      name: m.name || `Meal ${i + 1}`,
      scheduled_time: m.scheduled_time || '12:00',
    }))
    await supabase.from('meal_templates').delete().eq('user_id', userId).gte('meal_index', draftMeals.length)
    const { error } = await supabase.from('meal_templates').upsert(toSave, { onConflict: 'user_id,meal_index' })
    setSavingMeals(false)
    if (error) { Alert.alert('Error', error.message); return }
    Alert.alert('Saved', 'Meal plan saved.')
  }

  function addMeal() {
    if (draftMeals.length >= 8) return
    const i = draftMeals.length
    const def = MEAL_DEFAULTS[i] ?? { name: `Meal ${i + 1}`, time: '12:00' }
    setDraftMeals(prev => [...prev, { meal_index: i, name: def.name, scheduled_time: def.time }])
  }

  function removeMeal() {
    if (draftMeals.length <= 1) return
    setDraftMeals(prev => prev.slice(0, -1))
  }

  function updateDraftMeal(index: number, field: 'name' | 'scheduled_time', value: string) {
    setDraftMeals(prev => prev.map((m, i) => i === index ? { ...m, [field]: value } : m))
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

  return (
    <SafeAreaView style={styles.container}>
      {/* Segmented control */}
      <View style={styles.segRow}>
        {([
          { key: 'profile', label: 'Profile' },
          { key: 'zones', label: 'HR Zones' },
          { key: 'meals', label: 'Meal Plan' },
        ] as const).map(tab => (
          <Pressable
            key={tab.key}
            style={[styles.segBtn, activeTab === tab.key && styles.segBtnActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.segText, activeTab === tab.key && styles.segTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* ── Profile ──────────────────────────────────────── */}
        {activeTab === 'profile' && (
          <>
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
            {profileField('Daily calorie target (kcal)', 'daily_kcal_target', true)}
            {profileField('FTP (watts, cycling)', 'ftp_watts', true)}

            <Pressable
              style={[styles.saveBtn, (!isDirty || savingProfile) && styles.saveBtnDisabled]}
              onPress={saveProfile}
              disabled={!isDirty || savingProfile}
            >
              <Text style={styles.saveBtnText}>{savingProfile ? 'Saving…' : 'Save'}</Text>
            </Pressable>

            <Pressable style={styles.coachRow} onPress={() => router.push('/coach')}>
              <Ionicons name="people-outline" size={20} color="#FC4C02" />
              <View style={{ flex: 1 }}>
                <Text style={styles.coachRowTitle}>Coach connections</Text>
                <Text style={styles.coachRowNote}>Connect with a coach or manage your athletes</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#ccc" />
            </Pressable>

            {/* App mode switcher */}
            <View style={styles.modeCard}>
              <View style={styles.modeCardLeft}>
                <Ionicons
                  name={mode === 'coach' ? 'people' : 'person'}
                  size={22}
                  color={mode === 'coach' ? '#5C6BC0' : '#FC4C02'}
                />
                <View>
                  <Text style={styles.modeCardTitle}>
                    {mode === 'coach' ? 'Coach Mode' : 'Athlete Mode'}
                  </Text>
                  <Text style={styles.modeCardNote}>
                    {mode === 'coach'
                      ? 'Viewing as coach — managing athletes'
                      : 'Viewing as athlete — tracking your own data'}
                  </Text>
                </View>
              </View>
              <Switch
                value={mode === 'coach'}
                onValueChange={v => setMode(v ? 'coach' : 'athlete')}
                trackColor={{ true: '#5C6BC0', false: '#e0e0e0' }}
                thumbColor="#fff"
              />
            </View>

            <Pressable style={styles.signOutBtn} onPress={() => supabase.auth.signOut()}>
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
          </>
        )}

        {/* ── HR Zones ─────────────────────────────────────── */}
        {activeTab === 'zones' && (
          <>
            <Text style={styles.sectionHeader}>Zones</Text>
            <Text style={styles.sectionNote}>Changes apply to future syncs only.</Text>

            {zones.map(zone => (
              <ZoneCard
                key={zone.id}
                zone={zone}
                isEditing={editingZoneId === zone.id}
                onEdit={() => setEditingZoneId(zone.id)}
                onSave={saveZone}
                onCancel={() => setEditingZoneId(null)}
                onChange={updated => setZones(prev => prev.map(z => z.id === updated.id ? updated : z))}
              />
            ))}

            {/* Energy method per sport */}
            {activitySports.length > 0 && (
              <>
                <Text style={[styles.sectionHeader, { marginTop: 32 }]}>Energy method per sport</Text>
                <Text style={styles.sectionNote}>
                  Standard uses MET × weight. Custom uses your HR → kcal/hr burn schema.
                  "Same as" shares another sport's schema.
                </Text>

                {activitySports.map(sport => {
                  const config = sportConfigs[sport] ?? { mode: 'standard', linkedTo: null }
                  const isSaving = savingConfig === sport
                  const otherSports = activitySports.filter(s => s !== sport)

                  return (
                    <View key={sport} style={styles.sportCard}>
                      <Text style={styles.sportName}>{sport}</Text>

                      <View style={styles.modeRow}>
                        {(['standard', 'custom', 'linked'] as SportMode[]).map(mode => (
                          <Pressable
                            key={mode}
                            style={[styles.modeBtn, config.mode === mode && styles.modeBtnActive]}
                            onPress={() => saveSportConfig(sport, mode, mode === 'linked' ? (otherSports[0] ?? null) : null)}
                            disabled={isSaving}
                          >
                            <Text style={[styles.modeBtnText, config.mode === mode && styles.modeBtnTextActive]}>
                              {mode === 'linked' ? 'Same as…' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>

                      {config.mode === 'custom' && (
                        <Pressable
                          style={styles.editSchemaBtn}
                          onPress={() => router.push(`/energy/${encodeURIComponent(sport)}`)}
                        >
                          <Text style={styles.editSchemaBtnText}>Edit burn schema →</Text>
                        </Pressable>
                      )}

                      {config.mode === 'linked' && otherSports.length > 0 && (
                        <>
                          <Text style={styles.linkLabel}>Link to:</Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                            {otherSports.map(s => (
                              <Pressable
                                key={s}
                                style={[styles.chip, config.linkedTo === s && styles.chipActive]}
                                onPress={() => saveSportConfig(sport, 'linked', s)}
                                disabled={isSaving}
                              >
                                <Text style={[styles.chipText, config.linkedTo === s && styles.chipTextActive]}>
                                  {s}
                                </Text>
                              </Pressable>
                            ))}
                          </ScrollView>
                          {config.linkedTo && (
                            <Pressable
                              style={styles.viewSchemaBtn}
                              onPress={() => router.push(`/energy/${encodeURIComponent(config.linkedTo!)}`)}
                            >
                              <Text style={styles.viewSchemaBtnText}>View {config.linkedTo}'s schema →</Text>
                            </Pressable>
                          )}
                        </>
                      )}
                    </View>
                  )
                })}
              </>
            )}

            {/* Planner sports */}
            <Text style={[styles.sectionHeader, { marginTop: 32 }]}>Planner sports</Text>
            <Text style={styles.sectionNote}>
              Choose which sports appear in the workout planner dropdown.
            </Text>

            <View style={styles.tagRow}>
              {userSports.map(us => (
                <View key={us.id} style={styles.sportTag}>
                  <Text style={styles.sportTagText}>{us.sport_name}</Text>
                  <Pressable onPress={() => removePlannerSport(us.id)} hitSlop={8}>
                    <Ionicons name="close" size={14} color="#888" />
                  </Pressable>
                </View>
              ))}
              {userSports.length === 0 && (
                <Text style={[styles.sectionNote, { marginBottom: 0 }]}>No sports yet. Add from presets below.</Text>
              )}
            </View>

            <Text style={styles.addLabel}>Add from presets:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8, paddingRight: 8 }}>
                {COMMON_SPORTS.filter(s => !userSports.some(us => us.sport_name === s)).map(sport => (
                  <Pressable key={sport} style={styles.presetChip} onPress={() => addPlannerSport(sport)}>
                    <Ionicons name="add" size={13} color="#FC4C02" />
                    <Text style={styles.presetChipText}>{sport}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <View style={styles.addSportRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={newSportInput}
                onChangeText={setNewSportInput}
                placeholder="Custom sport name…"
                returnKeyType="done"
                onSubmitEditing={() => addPlannerSport(newSportInput)}
              />
              <Pressable style={styles.addSportBtn} onPress={() => addPlannerSport(newSportInput)}>
                <Text style={styles.addSportBtnText}>Add</Text>
              </Pressable>
            </View>
          </>
        )}

        {/* ── Meal Plan ────────────────────────────────────── */}
        {activeTab === 'meals' && (
          <>
            <Text style={styles.sectionHeader}>Meal plan</Text>
            <Text style={styles.sectionNote}>
              Set your daily meal schedule. These names and times will be used to organize your food log.
            </Text>

            {/* Meal count control */}
            <View style={styles.mealCountRow}>
              <Text style={styles.mealCountLabel}>Meals per day</Text>
              <View style={styles.mealCountControl}>
                <Pressable
                  style={[styles.mealCountBtn, draftMeals.length <= 1 && styles.mealCountBtnDisabled]}
                  onPress={removeMeal}
                  disabled={draftMeals.length <= 1}
                >
                  <Ionicons name="remove" size={20} color={draftMeals.length <= 1 ? '#ccc' : '#333'} />
                </Pressable>
                <Text style={styles.mealCountNum}>{draftMeals.length}</Text>
                <Pressable
                  style={[styles.mealCountBtn, draftMeals.length >= 8 && styles.mealCountBtnDisabled]}
                  onPress={addMeal}
                  disabled={draftMeals.length >= 8}
                >
                  <Ionicons name="add" size={20} color={draftMeals.length >= 8 ? '#ccc' : '#333'} />
                </Pressable>
              </View>
            </View>

            {draftMeals.map((meal, i) => (
              <View key={i} style={styles.mealCard}>
                <Text style={styles.mealCardTitle}>Meal {i + 1}</Text>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Name</Text>
                  <TextInput
                    style={styles.input}
                    value={meal.name}
                    onChangeText={v => updateDraftMeal(i, 'name', v)}
                    placeholder={MEAL_DEFAULTS[i]?.name ?? `Meal ${i + 1}`}
                  />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Time (HH:MM)</Text>
                  <TextInput
                    style={[styles.input, { marginBottom: 0 }]}
                    value={meal.scheduled_time}
                    onChangeText={v => updateDraftMeal(i, 'scheduled_time', v)}
                    placeholder={MEAL_DEFAULTS[i]?.time ?? '12:00'}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
              </View>
            ))}

            <Pressable
              style={[styles.saveBtn, savingMeals && styles.saveBtnDisabled]}
              onPress={saveMeals}
              disabled={savingMeals}
            >
              <Text style={styles.saveBtnText}>{savingMeals ? 'Saving…' : 'Save meal plan'}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function ZoneCard({
  zone, isEditing, onEdit, onSave, onCancel, onChange,
}: {
  zone: HeartRateZone
  isEditing: boolean
  onEdit: () => void
  onSave: (z: HeartRateZone) => void
  onCancel: () => void
  onChange: (z: HeartRateZone) => void
}) {
  if (!isEditing) {
    return (
      <Pressable style={styles.zoneCard} onPress={onEdit}>
        <View>
          <Text style={styles.zoneName}>{zone.name}</Text>
          <Text style={styles.zoneMeta}>{zone.min_bpm}–{zone.max_bpm} bpm</Text>
        </View>
        <Text style={styles.editHint}>Edit</Text>
      </Pressable>
    )
  }
  return (
    <View style={[styles.zoneCard, styles.zoneCardEditing]}>
      <TextInput
        style={styles.input}
        value={zone.name}
        onChangeText={v => onChange({ ...zone, name: v })}
      />
      <View style={styles.inputRow}>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Min BPM</Text>
          <TextInput style={styles.input} value={String(zone.min_bpm)} keyboardType="numeric"
            onChangeText={v => onChange({ ...zone, min_bpm: parseInt(v) || 0 })} />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Max BPM</Text>
          <TextInput style={styles.input} value={String(zone.max_bpm)} keyboardType="numeric"
            onChangeText={v => onChange({ ...zone, max_bpm: parseInt(v) || 0 })} />
        </View>
      </View>
      <View style={styles.inputRow}>
        <Pressable style={styles.zoneSaveBtn} onPress={() => onSave(zone)}>
          <Text style={styles.zoneSaveBtnText}>Save</Text>
        </Pressable>
        <Pressable style={styles.zoneCancelBtn} onPress={onCancel}>
          <Text style={styles.zoneCancelBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  segRow: {
    flexDirection: 'row', margin: 16, marginBottom: 0,
    backgroundColor: '#f0f0f0', borderRadius: 10, padding: 3,
  },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segText: { fontSize: 12, fontWeight: '600', color: '#888' },
  segTextActive: { color: '#111' },

  content: { padding: 16, paddingBottom: 60 },

  sectionHeader: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  sectionNote: { fontSize: 12, color: '#999', marginBottom: 14, lineHeight: 17 },

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
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#888', marginBottom: 5, textTransform: 'uppercase' },
  saveBtn: { backgroundColor: '#FC4C02', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 24 },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  coachRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginTop: 8,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  coachRowTitle: { fontSize: 15, fontWeight: '700', color: '#111' },
  coachRowNote: { fontSize: 12, color: '#aaa', marginTop: 1 },
  modeCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#f8f8f8', borderRadius: 14, padding: 14, marginTop: 8,
  },
  modeCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  modeCardTitle: { fontSize: 15, fontWeight: '700', color: '#111' },
  modeCardNote: { fontSize: 12, color: '#aaa', marginTop: 1, maxWidth: 220 },
  signOutBtn: { padding: 20, alignItems: 'center' },
  signOutText: { color: '#bbb', fontSize: 14 },

  // Zone cards
  zoneCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14, marginBottom: 8, borderRadius: 10, backgroundColor: '#f5f5f5',
  },
  zoneCardEditing: { flexDirection: 'column', alignItems: 'stretch' },
  zoneName: { fontSize: 15, fontWeight: '600' },
  zoneMeta: { fontSize: 13, color: '#666', marginTop: 2 },
  editHint: { fontSize: 13, color: '#FC4C02', fontWeight: '600' },
  zoneSaveBtn: { flex: 1, backgroundColor: '#FC4C02', padding: 11, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  zoneSaveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  zoneCancelBtn: { flex: 1, padding: 11, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  zoneCancelBtnText: { color: '#666', fontSize: 14 },
  inputRow: { flexDirection: 'row', gap: 10 },
  inputGroup: { flex: 1, marginBottom: 10 },
  inputLabel: { fontSize: 10, fontWeight: '700', color: '#aaa', marginBottom: 4, textTransform: 'uppercase' },
  input: {
    borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8,
    padding: 10, fontSize: 14, backgroundColor: '#fff', marginBottom: 10,
  },

  // Sport energy cards
  sportCard: {
    borderWidth: 1, borderColor: '#ececec', borderRadius: 12,
    padding: 14, marginBottom: 10,
  },
  sportName: { fontSize: 15, fontWeight: '700', marginBottom: 10 },
  modeRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  modeBtn: {
    flex: 1, paddingVertical: 7, borderRadius: 8,
    borderWidth: 1, borderColor: '#ddd', alignItems: 'center',
  },
  modeBtnActive: { backgroundColor: '#FC4C02', borderColor: '#FC4C02' },
  modeBtnText: { fontSize: 12, fontWeight: '600', color: '#888' },
  modeBtnTextActive: { color: '#fff' },
  editSchemaBtn: { backgroundColor: '#FFF0EB', borderRadius: 8, padding: 11, alignItems: 'center' },
  editSchemaBtnText: { color: '#FC4C02', fontWeight: '700', fontSize: 13 },
  linkLabel: { fontSize: 11, fontWeight: '700', color: '#aaa', marginBottom: 8, textTransform: 'uppercase' },
  chipRow: { marginBottom: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: '#ddd', marginRight: 8, backgroundColor: '#fafafa',
  },
  chipActive: { backgroundColor: '#FC4C02', borderColor: '#FC4C02' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#666' },
  chipTextActive: { color: '#fff' },
  viewSchemaBtn: { paddingTop: 4 },
  viewSchemaBtnText: { color: '#FC4C02', fontSize: 13, fontWeight: '600' },

  // Planner sports
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  sportTag: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#f5f5f5', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#ebebeb',
  },
  sportTagText: { fontSize: 13, fontWeight: '600', color: '#444' },
  addLabel: { fontSize: 11, fontWeight: '700', color: '#aaa', marginBottom: 8, textTransform: 'uppercase' },
  presetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFF0EB', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#FC4C02',
  },
  presetChipText: { fontSize: 13, fontWeight: '600', color: '#FC4C02' },
  addSportRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addSportBtn: { backgroundColor: '#FC4C02', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8 },
  addSportBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Meal plan
  mealCountRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#f8f8f8', borderRadius: 12, padding: 16, marginBottom: 20,
  },
  mealCountLabel: { fontSize: 15, fontWeight: '600', color: '#333' },
  mealCountControl: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  mealCountBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#e8e8e8',
    alignItems: 'center', justifyContent: 'center',
  },
  mealCountBtnDisabled: { opacity: 0.35 },
  mealCountNum: { fontSize: 22, fontWeight: '800', color: '#111', minWidth: 24, textAlign: 'center' },
  mealCard: { backgroundColor: '#f8f8f8', borderRadius: 12, padding: 14, marginBottom: 12 },
  mealCardTitle: {
    fontSize: 11, fontWeight: '700', color: '#aaa',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
  },
})
