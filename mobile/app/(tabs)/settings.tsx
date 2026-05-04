import { useEffect, useState } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { supabase } from '../../lib/supabase'
import type { UserProfile, HeartRateZone } from '../../types'

const STRAVA_CLIENT_ID = process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID!
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/strava-callback`

type SettingsTab = 'profile' | 'zones'
type SportMode = 'standard' | 'custom' | 'linked'
interface SportConfig { mode: SportMode; linkedTo: string | null }

export default function SettingsScreen() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')
  const [userId, setUserId] = useState<string | null>(null)

  // Profile
  const [savedProfile, setSavedProfile] = useState<Partial<UserProfile>>({})
  const [editedProfile, setEditedProfile] = useState<Partial<UserProfile>>({})
  const [savingProfile, setSavingProfile] = useState(false)

  // Zones
  const [zones, setZones] = useState<HeartRateZone[]>([])
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)

  // Sport energy
  const [sports, setSports] = useState<string[]>([])
  const [sportConfigs, setSportConfigs] = useState<Record<string, SportConfig>>({})
  const [savingConfig, setSavingConfig] = useState<string | null>(null)

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

    const [profileRes, zonesRes, activitiesRes, settingsRes] = await Promise.all([
      supabase.from('users').select('*').eq('id', user.id).single(),
      supabase.from('heart_rate_zones').select('*').eq('user_id', user.id).order('zone_number'),
      supabase.from('activities').select('type').eq('user_id', user.id),
      supabase.from('sport_energy_settings').select('*').eq('user_id', user.id),
    ])

    if (profileRes.data) {
      setSavedProfile(profileRes.data)
      setEditedProfile(profileRes.data)
    }
    setZones(zonesRes.data ?? [])

    const sportSet = new Set<string>(
      (activitiesRes.data ?? []).map((a: { type: string }) => a.type).filter(Boolean),
    )
    setSports([...sportSet].sort())

    const configs: Record<string, SportConfig> = {}
    for (const s of (settingsRes.data ?? [])) {
      const mode: SportMode = s.linked_sport_type
        ? 'linked'
        : s.method === 'custom' ? 'custom' : 'standard'
      configs[s.sport_type] = { mode, linkedTo: s.linked_sport_type ?? null }
    }
    setSportConfigs(configs)
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
        {(['profile', 'zones'] as const).map(tab => (
          <Pressable
            key={tab}
            style={[styles.segBtn, activeTab === tab && styles.segBtnActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.segText, activeTab === tab && styles.segTextActive]}>
              {tab === 'profile' ? 'Personal Info' : 'Heart Rate Zones'}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* ── Personal Info ──────────────────────────────── */}
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

            <Pressable
              style={[styles.saveBtn, (!isDirty || savingProfile) && styles.saveBtnDisabled]}
              onPress={saveProfile}
              disabled={!isDirty || savingProfile}
            >
              <Text style={styles.saveBtnText}>{savingProfile ? 'Saving…' : 'Save'}</Text>
            </Pressable>

            <Pressable style={styles.signOutBtn} onPress={() => supabase.auth.signOut()}>
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
          </>
        )}

        {/* ── Heart Rate Zones ───────────────────────────── */}
        {activeTab === 'zones' && (
          <>
            {/* Zone editing */}
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

            {/* Energy per sport */}
            {sports.length > 0 && (
              <>
                <Text style={[styles.sectionHeader, { marginTop: 32 }]}>Energy method per sport</Text>
                <Text style={styles.sectionNote}>
                  Standard uses MET × weight. Custom uses your HR → kcal/hr burn schema.
                  "Same as" shares another sport's schema.
                </Text>

                {sports.map(sport => {
                  const config = sportConfigs[sport] ?? { mode: 'standard', linkedTo: null }
                  const isSaving = savingConfig === sport
                  const otherSports = sports.filter(s => s !== sport)

                  return (
                    <View key={sport} style={styles.sportCard}>
                      <Text style={styles.sportName}>{sport}</Text>

                      {/* Mode selector */}
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

                      {/* Custom: navigate to schema editor */}
                      {config.mode === 'custom' && (
                        <Pressable
                          style={styles.editSchemaBtn}
                          onPress={() => router.push(`/energy/${encodeURIComponent(sport)}`)}
                        >
                          <Text style={styles.editSchemaBtnText}>Edit burn schema →</Text>
                        </Pressable>
                      )}

                      {/* Linked: pick which sport */}
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

  // Segmented control
  segRow: {
    flexDirection: 'row', margin: 16, marginBottom: 0,
    backgroundColor: '#f0f0f0', borderRadius: 10, padding: 3,
  },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segText: { fontSize: 13, fontWeight: '600', color: '#888' },
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

  // Sport cards
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
  editSchemaBtn: {
    backgroundColor: '#FFF0EB', borderRadius: 8, padding: 11, alignItems: 'center',
  },
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
})
