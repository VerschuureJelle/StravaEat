import { useState } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, Alert, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { supabase } from '../../lib/supabase'
import { W as C } from '../../lib/themeWarm'

const TERMS_URL = 'https://verschuurejelle.github.io/StravaEat/terms.html'

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

  // Re-format the date-of-birth input on every keystroke so the user only
  // needs to type digits — hyphens get inserted automatically at the right
  // positions for DD-MM-YYYY.
  const formatDob = (input: string): string => {
    const digits = input.replace(/\D/g, '').slice(0, 8)
    if (digits.length <= 2) return digits
    if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`
    return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`
  }

  // Parse "DD-MM-YYYY" → "YYYY-MM-DD" (ISO) or null if not a real date.
  // Uses the (year, monthIndex, day) constructor and local getters so the
  // round-trip check isn't affected by the user's timezone offset.
  const parseDobToIso = (dob: string): string | null => {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dob)
    if (!m) return null
    const [, dd, mm, yyyy] = m
    const y = Number(yyyy), mo = Number(mm), d = Number(dd)
    const dt = new Date(y, mo - 1, d)
    if (dt.getFullYear() !== y || dt.getMonth() + 1 !== mo || dt.getDate() !== d) return null
    return `${yyyy}-${mm}-${dd}`
  }

  const validate = () => {
    if (!form.username.trim()) return 'Username is required.'
    if (form.username.length < 3) return 'Username must be at least 3 characters.'
    if (!form.email.trim()) return 'Email is required.'
    if (!form.password) return 'Password is required.'
    if (form.password.length < 8) return 'Password must be at least 8 characters.'
    if (form.password !== form.confirmPassword) return 'Passwords do not match.'
    if (!form.dateOfBirth) return 'Date of birth is required.'
    if (!/^\d{2}-\d{2}-\d{4}$/.test(form.dateOfBirth)) return 'Use format DD-MM-YYYY (e.g. 15-03-1990).'
    if (!parseDobToIso(form.dateOfBirth)) return 'That doesn\'t look like a real date.'
    if (!form.termsAccepted) return 'You must accept the terms and conditions.'
    return null
  }

  const handleSignUp = async () => {
    const validationError = validate()
    if (validationError) { Alert.alert('Check your input', validationError); return }

    setLoading(true)
    try {
      const isoDob = parseDobToIso(form.dateOfBirth)!  // validate() guarantees this is non-null
      const { data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            username: form.username,
            date_of_birth: isoDob,
            terms_accepted_at: new Date().toISOString(),
          },
        },
      })
      if (error) throw error
      if (!data.user) throw new Error('Sign up failed — no user returned.')

      if (data.session) {
        router.replace('/(auth)/onboarding')
      } else {
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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
      >
      <ScrollView
        style={{ backgroundColor: C.bg }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Create account</Text>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          value={form.username}
          onChangeText={set('username')}
          placeholder="e.g. StravaFan123"
          placeholderTextColor={C.text3}
          autoCapitalize="none"
          autoComplete="username"
        />

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={form.email}
          onChangeText={set('email')}
          placeholder="you@example.com"
          placeholderTextColor={C.text3}
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
          placeholderTextColor={C.text3}
          secureTextEntry
          autoComplete="new-password"
        />

        <Text style={styles.label}>Confirm password</Text>
        <TextInput
          style={styles.input}
          value={form.confirmPassword}
          onChangeText={set('confirmPassword')}
          placeholder="Repeat your password"
          placeholderTextColor={C.text3}
          secureTextEntry
          autoComplete="new-password"
        />

        <Text style={styles.label}>Date of birth</Text>
        <TextInput
          style={styles.input}
          value={form.dateOfBirth}
          onChangeText={(v) => set('dateOfBirth')(formatDob(v))}
          placeholder="DD-MM-YYYY"
          placeholderTextColor={C.text3}
          keyboardType="numeric"
          maxLength={10}
        />

        <View style={styles.termsRow}>
          <Pressable onPress={() => set('termsAccepted')(!form.termsAccepted)}>
            <View style={[styles.checkbox, form.termsAccepted && styles.checkboxChecked]}>
              {form.termsAccepted && <Text style={styles.checkmark}>✓</Text>}
            </View>
          </Pressable>
          <Text style={styles.termsText}>
            I accept the{' '}
            <Text
              style={styles.termsLink}
              onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)}
            >
              terms and conditions
            </Text>
          </Text>
        </View>

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignUp}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={C.white} />
            : <Text style={styles.buttonText}>Create account</Text>}
        </Pressable>

        <Pressable onPress={() => router.replace('/(auth)/signin')}>
          <Text style={styles.switchText}>
            Already have an account? <Text style={styles.switchLink}>Sign in</Text>
          </Text>
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  back: { padding: 16 },
  backText: { fontSize: 16, color: C.accent, fontWeight: '600' },
  content: { padding: 24, paddingTop: 8, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '800', color: C.text1, marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', color: C.text2, marginBottom: 6, marginTop: 16 },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 14, fontSize: 16, backgroundColor: C.surface, color: C.text1,
  },
  termsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 24, gap: 12 },
  checkbox: {
    width: 22, height: 22, borderRadius: 5,
    borderWidth: 1.5, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface,
  },
  checkboxChecked: { backgroundColor: C.accent, borderColor: C.accent },
  checkmark: { color: C.white, fontSize: 13, fontWeight: '700' },
  termsText: { flex: 1, fontSize: 14, color: C.text2 },
  termsLink: { color: C.accent, fontWeight: '600' },
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
