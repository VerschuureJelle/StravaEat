import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { supabase } from '../../lib/supabase'
import type { UserProfile } from '../../types'

const STRAVA_CLIENT_ID = process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID!
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/strava-callback`

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Partial<UserProfile>>({})

  useEffect(() => {
    fetchProfile()
    const subscription = Linking.addEventListener('url', handleStravaDeepLink)
    return () => subscription.remove()
  }, [])

  async function fetchProfile() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('users').select('*').eq('id', user.id).single()
    if (data) setProfile(data)
  }

  const handleStravaDeepLink = async (event: { url: string }) => {
    if (!event.url.startsWith('stravaeat://auth')) return
    const parsed = Linking.parse(event.url)
    if (parsed.queryParams?.linked === 'true') {
      await fetchProfile()
      Alert.alert('Connected', 'Strava account linked successfully.')
    } else if (parsed.queryParams?.error) {
      Alert.alert('Connection failed', parsed.queryParams.error as string)
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
      approval_prompt: 'force',
      state: user.id,
    })
    await WebBrowser.openAuthSessionAsync(
      `https://www.strava.com/oauth/authorize?${params}`,
      'stravaeat://auth',
    )
  }

  async function save() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('users').upsert({ id: user.id, ...profile })
    if (error) Alert.alert('Error', error.message)
    else Alert.alert('Saved')
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const field = (label: string, key: keyof UserProfile, numeric?: boolean) => (
    <View key={key}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={profile[key] != null ? String(profile[key]) : ''}
        keyboardType={numeric ? 'numeric' : 'default'}
        onChangeText={(v) =>
          setProfile((p) => ({ ...p, [key]: numeric ? (v ? parseFloat(v) : null) : v }))
        }
      />
    </View>
  )

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Profile</Text>

        {/* Strava connection status */}
        <View style={styles.stravaRow}>
          <View>
            <Text style={styles.stravaLabel}>Strava</Text>
            <Text style={styles.stravaStatus}>
              {profile.strava_id ? `Connected (ID: ${profile.strava_id})` : 'Not connected'}
            </Text>
          </View>
          <Pressable style={styles.stravaBtn} onPress={handleConnectStrava}>
            <Text style={styles.stravaBtnText}>
              {profile.strava_id ? 'Reconnect' : 'Connect'}
            </Text>
          </Pressable>
        </View>

        {field('Name', 'name')}
        {field('Age', 'age', true)}
        {field('Weight (kg)', 'weight_kg', true)}
        {field('Max Heart Rate (bpm)', 'max_hr', true)}
        {field('Resting Heart Rate (bpm)', 'resting_hr', true)}

        <Pressable style={styles.button} onPress={save}>
          <Text style={styles.buttonText}>Save</Text>
        </Pressable>
        <Pressable style={styles.signOutBtn} onPress={signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24 },
  header: { fontSize: 28, fontWeight: '700', marginBottom: 24 },
  stravaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8f8f8',
    borderRadius: 10,
    padding: 16,
    marginBottom: 8,
  },
  stravaLabel: { fontSize: 14, fontWeight: '700' },
  stravaStatus: { fontSize: 13, color: '#888', marginTop: 2 },
  stravaBtn: {
    backgroundColor: '#FC4C02',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  stravaBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6, marginTop: 16 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16 },
  button: {
    backgroundColor: '#FC4C02',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 32,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  signOutBtn: { padding: 16, alignItems: 'center', marginTop: 12 },
  signOutText: { color: '#999', fontSize: 14 },
})
