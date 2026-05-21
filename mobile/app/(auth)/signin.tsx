import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { W as C } from '../../lib/themeWarm'

export default function SignInScreen() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSignIn = async () => {
    if (!email || !password) {
      Alert.alert('Required', 'Please fill in your email and password.')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error

      const { data: { user } } = await supabase.auth.getUser()
      const { data: profile } = await supabase
        .from('users')
        .select('weight_kg, max_hr, strava_id')
        .eq('id', user!.id)
        .single()

      if (!profile?.strava_id || !profile?.weight_kg || !profile?.max_hr) {
        router.replace('/(auth)/onboarding')
      } else {
        router.replace('/(tabs)/')
      }
    } catch (err: any) {
      const msg = err.message ?? ''
      if (msg.includes('Invalid login credentials')) {
        Alert.alert('Incorrect email or password', 'Please check your details and try again.')
      } else if (msg.includes('Email not confirmed')) {
        Alert.alert('Email not confirmed', 'Please click the confirmation link we sent to your inbox first.')
      } else {
        Alert.alert('Sign in failed', msg || 'Something went wrong')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Pressable style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      <View style={styles.content}>
        <Text style={styles.title}>Welcome back</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={C.text3}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          placeholderTextColor={C.text3}
          secureTextEntry
          autoComplete="password"
        />

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignIn}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={C.white} />
            : <Text style={styles.buttonText}>Sign in</Text>}
        </Pressable>

        <Pressable onPress={() => router.replace('/(auth)/signup')}>
          <Text style={styles.switchText}>No account yet? <Text style={styles.switchLink}>Sign up</Text></Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  back: { padding: 16 },
  backText: { fontSize: 16, color: C.accent, fontWeight: '600' },
  content: { flex: 1, padding: 24, paddingTop: 8 },
  title: { fontSize: 28, fontWeight: '800', color: C.text1, marginBottom: 32 },
  label: { fontSize: 14, fontWeight: '600', color: C.text2, marginBottom: 6, marginTop: 16 },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 14, fontSize: 16, backgroundColor: C.surface, color: C.text1,
  },
  button: {
    backgroundColor: C.accent,
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 32,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: C.white, fontSize: 16, fontWeight: '700' },
  switchText: { textAlign: 'center', marginTop: 20, color: C.text2, fontSize: 14 },
  switchLink: { color: C.accent, fontWeight: '600' },
})
