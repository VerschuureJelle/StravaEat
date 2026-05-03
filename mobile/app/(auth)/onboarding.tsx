import { useState, useEffect } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { supabase } from '../../lib/supabase'
import { generateZonesFromMaxHR } from '../../constants/zones'
import type { SportHistory, Sex } from '../../types'

const STRAVA_CLIENT_ID = process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID!
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/strava-callback`

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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const params = new URLSearchParams({
      client_id: STRAVA_CLIENT_ID,
      redirect_uri: CALLBACK_URL,
      response_type: 'code',
      scope: 'activity:read_all',
      approval_prompt: 'auto',
      state: user.id,   // pass user ID so callback links to existing account
    })
    await WebBrowser.openAuthSessionAsync(
      `https://www.strava.com/oauth/authorize?${params}`,
      'stravaeat://auth',
    )
  }

  const maxHRNum = parseInt(data.max_hr)
  const previewZones = maxHRNum > 0 ? generateZonesFromMaxHR(maxHRNum) : null

  const handleComplete = async () => {
    if (!data.weight_kg || !data.max_hr) {
      Alert.alert('Required', 'Weight and max heart rate are required to calculate zones.')
      return
    }

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')

      // Save profile
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

      // Create zones from max HR
      const zones = generateZonesFromMaxHR(parseInt(data.max_hr)).map((z) => ({
        ...z,
        user_id: user.id,
      }))

      const { error: zonesError } = await supabase
        .from('heart_rate_zones')
        .upsert(zones, { onConflict: 'user_id,zone_number' })
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
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Set up your profile</Text>
        <Text style={styles.subtitle}>We'll use this to calculate your heart rate zones and energy expenditure.</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={data.name}
          onChangeText={(v) => setData((d) => ({ ...d, name: v }))}
          placeholder="Your name"
        />

        <Text style={styles.label}>Age</Text>
        <TextInput
          style={styles.input}
          value={data.age}
          onChangeText={(v) => setData((d) => ({ ...d, age: v }))}
          keyboardType="numeric"
          placeholder="e.g. 30"
        />

        <Text style={styles.label}>Weight (kg) *</Text>
        <TextInput
          style={styles.input}
          value={data.weight_kg}
          onChangeText={(v) => setData((d) => ({ ...d, weight_kg: v }))}
          keyboardType="numeric"
          placeholder="e.g. 75"
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
          onChangeText={(v) => setData((d) => ({ ...d, max_hr: v }))}
          keyboardType="numeric"
          placeholder="e.g. 190  (or use 220 − age as estimate)"
        />

        <Text style={styles.label}>Resting Heart Rate (bpm)</Text>
        <TextInput
          style={styles.input}
          value={data.resting_hr}
          onChangeText={(v) => setData((d) => ({ ...d, resting_hr: v }))}
          keyboardType="numeric"
          placeholder="e.g. 55"
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
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Get started</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  stravaScreen: { flex: 1, padding: 32, justifyContent: 'center' },
  stravaBtn: {
    backgroundColor: '#FC4C02',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 32,
  },
  stravaBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  skipText: { textAlign: 'center', marginTop: 16, color: '#999', fontSize: 14 },
  content: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6, marginTop: 16 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16 },
  optionRow: { flexDirection: 'row', gap: 8 },
  optionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  optionBtnActive: { borderColor: '#FC4C02', backgroundColor: '#FFF0EB' },
  optionText: { fontSize: 14, color: '#666' },
  optionTextActive: { color: '#FC4C02', fontWeight: '600' },
  zonePreview: {
    marginTop: 24,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 16,
  },
  zonePreviewTitle: { fontSize: 14, fontWeight: '700', marginBottom: 12 },
  zoneRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  zoneName: { fontSize: 14, color: '#333' },
  zoneBpm: { fontSize: 14, color: '#666' },
  zoneNote: { fontSize: 12, color: '#999', marginTop: 12 },
  button: {
    backgroundColor: '#FC4C02',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 32,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
