import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Linking from 'expo-linking'
import { supabase } from '../../lib/supabase'
import { initiateStravaOAuth } from '../../lib/stravaAuth'
import { C } from '../../lib/theme'
import type { UserProfile } from '../../types'

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

  const handleConnectStrava = () => initiateStravaOAuth()

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
        placeholderTextColor={C.text3}
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
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 24 },
  header: { fontSize: 28, fontWeight: '700', color: C.text1, marginBottom: 24 },
  stravaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: C.surface2,
    borderRadius: 10,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  stravaLabel: { fontSize: 14, fontWeight: '700', color: C.text1 },
  stravaStatus: { fontSize: 13, color: C.text2, marginTop: 2 },
  stravaBtn: {
    backgroundColor: C.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  stravaBtnText: { color: C.white, fontWeight: '700', fontSize: 13 },
  label: { fontSize: 14, fontWeight: '600', color: C.text2, marginBottom: 6, marginTop: 16 },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 8,
    padding: 12, fontSize: 16, backgroundColor: C.surface, color: C.text1,
  },
  button: {
    backgroundColor: C.accent,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 32,
  },
  buttonText: { color: C.white, fontSize: 16, fontWeight: '600' },
  signOutBtn: { padding: 16, alignItems: 'center', marginTop: 12 },
  signOutText: { color: C.text3, fontSize: 14 },
})
