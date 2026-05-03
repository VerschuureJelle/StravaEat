import { useState } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

export default function SignUpScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    dateOfBirth: '',
    termsAccepted: false,
  })

  const set = (key: keyof typeof form) => (value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }))

  const validate = () => {
    if (!form.username.trim()) return 'Username is required.'
    if (form.username.length < 3) return 'Username must be at least 3 characters.'
    if (!form.email.trim()) return 'Email is required.'
    if (!form.password) return 'Password is required.'
    if (form.password.length < 8) return 'Password must be at least 8 characters.'
    if (form.password !== form.confirmPassword) return 'Passwords do not match.'
    if (!form.dateOfBirth) return 'Date of birth is required.'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth)) return 'Use format YYYY-MM-DD.'
    if (!form.termsAccepted) return 'You must accept the terms and conditions.'
    return null
  }

  const handleSignUp = async () => {
    const validationError = validate()
    if (validationError) { Alert.alert('Check your input', validationError); return }

    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          // All profile fields stored in user_metadata so the DB trigger
          // can persist them regardless of whether email confirmation is on
          data: {
            username: form.username,
            date_of_birth: form.dateOfBirth,
            terms_accepted_at: new Date().toISOString(),
          },
        },
      })
      if (error) throw error
      if (!data.user) throw new Error('Sign up failed — no user returned.')

      if (data.session) {
        // Email confirmation is disabled — user is signed in immediately
        router.replace('/(auth)/onboarding')
      } else {
        // Email confirmation is enabled — ask them to check their inbox
        Alert.alert(
          'Check your email',
          `We sent a confirmation link to ${form.email}. Click it to activate your account, then sign in.`,
          [{ text: 'OK', onPress: () => router.replace('/(auth)/signin') }],
        )
      }
    } catch (err: any) {
      Alert.alert('Sign up failed', err.message ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Pressable style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Create account</Text>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          value={form.username}
          onChangeText={set('username')}
          placeholder="e.g. jellerun"
          autoCapitalize="none"
          autoComplete="username"
        />

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={form.email}
          onChangeText={set('email')}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={form.password}
          onChangeText={set('password')}
          placeholder="Min. 8 characters"
          secureTextEntry
          autoComplete="new-password"
        />

        <Text style={styles.label}>Confirm password</Text>
        <TextInput
          style={styles.input}
          value={form.confirmPassword}
          onChangeText={set('confirmPassword')}
          placeholder="Repeat your password"
          secureTextEntry
          autoComplete="new-password"
        />

        <Text style={styles.label}>Date of birth</Text>
        <TextInput
          style={styles.input}
          value={form.dateOfBirth}
          onChangeText={set('dateOfBirth')}
          placeholder="YYYY-MM-DD"
          keyboardType="numeric"
        />

        <Pressable
          style={styles.termsRow}
          onPress={() => set('termsAccepted')(!form.termsAccepted)}
        >
          <View style={[styles.checkbox, form.termsAccepted && styles.checkboxChecked]}>
            {form.termsAccepted && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.termsText}>
            I accept the <Text style={styles.termsLink}>terms and conditions</Text>
          </Text>
        </Pressable>

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignUp}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Create account</Text>}
        </Pressable>

        <Pressable onPress={() => router.replace('/(auth)/signin')}>
          <Text style={styles.switchText}>
            Already have an account? <Text style={styles.switchLink}>Sign in</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  back: { padding: 16 },
  backText: { fontSize: 16, color: '#FC4C02', fontWeight: '600' },
  content: { padding: 24, paddingTop: 8, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '800', marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6, marginTop: 16 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 14, fontSize: 16 },
  termsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 24, gap: 12 },
  checkbox: {
    width: 22, height: 22, borderRadius: 5,
    borderWidth: 1.5, borderColor: '#ddd',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#FC4C02', borderColor: '#FC4C02' },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  termsText: { flex: 1, fontSize: 14, color: '#555' },
  termsLink: { color: '#FC4C02', fontWeight: '600' },
  button: {
    backgroundColor: '#FC4C02',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 32,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  switchText: { textAlign: 'center', marginTop: 20, color: '#888', fontSize: 14 },
  switchLink: { color: '#FC4C02', fontWeight: '600' },
})
