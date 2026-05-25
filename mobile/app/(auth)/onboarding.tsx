import { useState, useEffect } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { supabase } from '../../lib/supabase'
import { initiateStravaOAuth } from '../../lib/stravaAuth'
import { W as C } from '../../lib/themeWarm'
import { generateZonesFromMaxHR } from '../../constants/zones'
import type { SportHistory, Sex } from '../../types'

type OnboardingStep = 'strava' | 'profile'

interface OnboardingData {
  name: string
  age: string
  weight_kg: string
  sex: Sex | ''
  sport_history: SportHistory | ''
  max_hr: string
  resting_hr: string
}

const SEX_OPTIONS: { label: string; value: Sex }[] = [
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
  { label: 'Other', value: 'other' },
]

const SPORT_OPTIONS: { label: string; value: SportHistory }[] = [
  { label: 'Beginner', value: 'beginner' },
  { label: 'Intermediate', value: 'intermediate' },
  { label: 'Advanced', value: 'advanced' },
]

export default function OnboardingScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<OnboardingStep>('strava')
  const [stravaConnected, setStravaConnected] = useState(false)
  const [data, setData] = useState<OnboardingData>({
    name: '',
    age: '',
    weight_kg: '',
    sex: '',
    sport_history: '',
    max_hr: '',
    resting_hr: '',
  })

  useEffect(() => {
    const subscription = Linking.addEventListener('url', handleStravaDeepLink)
    return () => subscription.remove()
  }, [])

  const handleStravaDeepLink = async (event: { url: string }) => {
    const url = event.url
    if (!url.startsWith('stravaeat://auth')) return
    const parsed = Linking.parse(url)
    const error = parsed.queryParams?.error as string
    const linked = parsed.queryParams?.linked as string
    if (error) {
      Alert.alert('Strava connection failed', error)
      return
    }
    if (linked === 'true') {
      setStravaConnected(true)
      setStep('profile')
    }
  }

  const handleConnectStrava = async () => {
    try {
      const result = await initiateStravaOAuth()
      if (result === 'linked') {
        setStravaConnected(true)
        setStep('profile')
      }
    } catch (e: any) {
      Alert.alert('Strava connection failed', e.message ?? 'Something went wrong')
    }
  }

  const maxHRNum = parseInt(data.max_hr)
  const previewZones = maxHRNum > 0 ? generateZonesFromMaxHR(maxHRNum) : null

  const handleComplete = async () => {
    if (!data.weight_kg || !data.max_hr) {
      Alert.alert('Required', 'Weight and max heart rate are required to calculate zones.')
      return
    }

    // Range validation — catches mistyped values (e.g. weight in grams, HR in
    // wrong units) before we try to persist them and generate zones from them.
    const ageNum = data.age ? parseInt(data.age) : null
    const weightNum = parseFloat(data.weight_kg)
    const maxHrNum = parseInt(data.max_hr)
    const restingHrNum = data.resting_hr ? parseInt(data.resting_hr) : null

    if (ageNum != null && (isNaN(ageNum) || ageNum < 1 || ageNum > 100)) {
      Alert.alert('Check your age', 'Age must be between 1 and 100.')
      return
    }
    if (isNaN(weightNum) || weightNum < 20 || weightNum > 250) {
      Alert.alert('Check your weight', 'Please enter your real weight.')
      return
    }
    if (isNaN(maxHrNum) || maxHrNum < 35 || maxHrNum > 230) {
      Alert.alert('Check your max heart rate', 'Max heart rate must be between 35 and 230 bpm.')
      return
    }
    if (restingHrNum != null && (isNaN(restingHrNum) || restingHrNum < 35 || restingHrNum > 230)) {
      Alert.alert('Check your resting heart rate', 'Resting heart rate must be between 35 and 230 bpm.')
      return
    }
    if (restingHrNum != null && restingHrNum >= maxHrNum) {
      Alert.alert('Heart rate values', 'Resting heart rate must be lower than max heart rate.')
      return
    }

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')

      const { error: profileError } = await supabase.from('users').upsert({
        id: user.id,
        name: data.name || null,
        age: data.age ? parseInt(data.age) : null,
        weight_kg: parseFloat(data.weight_kg),
        sex: data.sex || null,
        sport_history: data.sport_history || null,
        max_hr: parseInt(data.max_hr),
        resting_hr: data.resting_hr ? parseInt(data.resting_hr) : null,
      })
      if (profileError) throw profileError

      // sport_type='default' applies the zones to all sports without overrides.
      // The unique constraint is (user_id, zone_number, sport_type), so the
      // onConflict spec must list all three columns to match.
      const zones = generateZonesFromMaxHR(parseInt(data.max_hr)).map((z) => ({
        ...z,
        user_id: user.id,
        sport_type: 'default',
      }))

      const { error: zonesError } = await supabase
        .from('heart_rate_zones')
        .upsert(zones, { onConflict: 'user_id,zone_number,sport_type' })
      if (zonesError) throw zonesError

      router.replace('/(tabs)/')
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'strava') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.stravaScreen}>
          <Text style={styles.title}>Connect Strava</Text>
          <Text style={styles.subtitle}>
            StravaEat reads your activity heart rate data to calculate energy expenditure.
            Connect your Strava account to get started.
          </Text>
          <Pressable style={styles.stravaBtn} onPress={handleConnectStrava}>
            <Text style={styles.stravaBtnText}>Connect with Strava</Text>
          </Pressable>
          <Pressable onPress={() => setStep('profile')}>
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Set up your profile</Text>
        <Text style={styles.subtitle}>We'll use this to calculate your heart rate zones and energy expenditure.</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={data.name}
          onChangeText={(v) => setData((d) => ({ ...d, name: v }))}
          placeholder="Your name"
          placeholderTextColor={C.text3}
        />

        <Text style={styles.label}>Age</Text>
        <TextInput
          style={styles.input}
          value={data.age}
          onChangeText={(v) => setData((d) => ({ ...d, age: v.replace(/\D/g, '').slice(0, 3) }))}
          keyboardType="numeric"
          placeholder="e.g. 30  (max 100)"
          placeholderTextColor={C.text3}
          maxLength={3}
        />

        <Text style={styles.label}>Weight (kg) *</Text>
        <TextInput
          style={styles.input}
          value={data.weight_kg}
          onChangeText={(v) => setData((d) => ({ ...d, weight_kg: v.replace(/[^0-9.]/g, '').slice(0, 6) }))}
          keyboardType="decimal-pad"
          placeholder="e.g. 75"
          placeholderTextColor={C.text3}
          maxLength={6}
        />

        <Text style={styles.label}>Sex</Text>
        <View style={styles.optionRow}>
          {SEX_OPTIONS.map((o) => (
            <Pressable
              key={o.value}
              style={[styles.optionBtn, data.sex === o.value && styles.optionBtnActive]}
              onPress={() => setData((d) => ({ ...d, sex: o.value }))}
            >
              <Text style={[styles.optionText, data.sex === o.value && styles.optionTextActive]}>
                {o.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Sport experience</Text>
        <View style={styles.optionRow}>
          {SPORT_OPTIONS.map((o) => (
            <Pressable
              key={o.value}
              style={[styles.optionBtn, data.sport_history === o.value && styles.optionBtnActive]}
              onPress={() => setData((d) => ({ ...d, sport_history: o.value }))}
            >
              <Text style={[styles.optionText, data.sport_history === o.value && styles.optionTextActive]}>
                {o.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Max Heart Rate (bpm) *</Text>
        <TextInput
          style={styles.input}
          value={data.max_hr}
          onChangeText={(v) => setData((d) => ({ ...d, max_hr: v.replace(/\D/g, '').slice(0, 3) }))}
          keyboardType="numeric"
          placeholder="e.g. 190  (35–230)"
          placeholderTextColor={C.text3}
          maxLength={3}
        />

        <Text style={styles.label}>Resting Heart Rate (bpm)</Text>
        <TextInput
          style={styles.input}
          value={data.resting_hr}
          onChangeText={(v) => setData((d) => ({ ...d, resting_hr: v.replace(/\D/g, '').slice(0, 3) }))}
          keyboardType="numeric"
          placeholder="e.g. 55  (35–230)"
          placeholderTextColor={C.text3}
          maxLength={3}
        />

        {previewZones && (
          <View style={styles.zonePreview}>
            <Text style={styles.zonePreviewTitle}>Your zones (auto-generated)</Text>
            {previewZones.map((z) => (
              <View key={z.zone_number} style={styles.zoneRow}>
                <Text style={styles.zoneName}>{z.name}</Text>
                <Text style={styles.zoneBpm}>{z.min_bpm}–{z.max_bpm} bpm</Text>
              </View>
            ))}
            <Text style={styles.zoneNote}>You can adjust these anytime in the Zones tab.</Text>
          </View>
        )}

        <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={handleComplete} disabled={loading}>
          {loading ? <ActivityIndicator color={C.white} /> : <Text style={styles.buttonText}>Get started</Text>}
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  stravaScreen: { flex: 1, padding: 32, justifyContent: 'center' },
  stravaBtn: {
    backgroundColor: C.accent,
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 32,
  },
  stravaBtnText: { color: C.white, fontSize: 16, fontWeight: '700' },
  skipText: { textAlign: 'center', marginTop: 16, color: C.text3, fontSize: 14 },
  content: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '700', color: C.text1, marginBottom: 8 },
  subtitle: { fontSize: 14, color: C.text2, marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', color: C.text2, marginBottom: 6, marginTop: 16 },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 8,
    padding: 12, fontSize: 16, backgroundColor: C.surface, color: C.text1,
  },
  optionRow: { flexDirection: 'row', gap: 8 },
  optionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    backgroundColor: C.surface,
  },
  optionBtnActive: { borderColor: C.accent, backgroundColor: C.accentBg },
  optionText: { fontSize: 14, color: C.text2 },
  optionTextActive: { color: C.accent, fontWeight: '600' },
  zonePreview: {
    marginTop: 24,
    backgroundColor: C.surface2,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  zonePreviewTitle: { fontSize: 14, fontWeight: '700', color: C.text1, marginBottom: 12 },
  zoneRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  zoneName: { fontSize: 14, color: C.text1 },
  zoneBpm: { fontSize: 14, color: C.text2 },
  zoneNote: { fontSize: 12, color: C.text3, marginTop: 12 },
  button: {
    backgroundColor: C.accent,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 32,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: C.white, fontSize: 16, fontWeight: '600' },
})
