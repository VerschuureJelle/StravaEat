import { useState } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, Alert, ScrollView, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { W as C } from '../../lib/themeWarm'

function formatDOBInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`
}

function dobToISO(dob: string): string {
  const [dd, mm, yyyy] = dob.split('-')
  return `${yyyy}-${mm}-${dd}`
}

function TermsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={tm.container}>
        <View style={tm.header}>
          <Text style={tm.title}>Terms & Conditions</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={tm.closeBtn}>Done</Text>
          </Pressable>
        </View>
        <ScrollView style={tm.body} contentContainerStyle={{ paddingBottom: 48 }}>
          <Text style={tm.updated}>Last updated: May 2026</Text>

          <Text style={tm.heading}>1. Who We Are</Text>
          <Text style={tm.para}>StravaEat ("we", "us", "our") is a mobile application that helps athletes track nutrition and plan training by connecting to Strava and analysing activity data.</Text>

          <Text style={tm.heading}>2. Data We Collect</Text>
          <Text style={tm.para}>By creating an account and using StravaEat you agree that we may collect and process the following data:</Text>
          <Text style={tm.bullet}>• Account information: name, email address, date of birth.</Text>
          <Text style={tm.bullet}>• Body metrics: weight, height, age, biological sex (used for calorie calculations only).</Text>
          <Text style={tm.bullet}>• Strava activity data: workouts, heart-rate streams, lap data, and GPS routes imported via the Strava API.</Text>
          <Text style={tm.bullet}>• Nutrition logs: food items, calorie and macro entries you record in the app.</Text>
          <Text style={tm.bullet}>• Heart-rate zones and custom energy-burn settings you configure.</Text>

          <Text style={tm.heading}>3. How We Use Your Data</Text>
          <Text style={tm.para}>Your data is used exclusively to provide and improve the StravaEat service:</Text>
          <Text style={tm.bullet}>• Calculating calorie expenditure from your Strava activities.</Text>
          <Text style={tm.bullet}>• Generating personalised daily nutrition targets and workout plans.</Text>
          <Text style={tm.bullet}>• Displaying your nutrition history and progress.</Text>
          <Text style={tm.para}>We do not sell your personal data to third parties. We do not use your data for advertising.</Text>

          <Text style={tm.heading}>4. Third-Party Services</Text>
          <Text style={tm.para}>StravaEat connects to the following third-party services. By using the app you also agree to their terms:</Text>
          <Text style={tm.bullet}>• Strava (strava.com/legal) — activity data.</Text>
          <Text style={tm.bullet}>• Supabase — secure cloud database and authentication.</Text>
          <Text style={tm.bullet}>• Open-Meteo — anonymous weather data (no personal data sent).</Text>
          <Text style={tm.bullet}>• Anthropic Claude API — AI coaching features (your message and anonymised profile data are sent to generate a plan).</Text>

          <Text style={tm.heading}>5. Data Storage & Security</Text>
          <Text style={tm.para}>Your data is stored in a secured Supabase (PostgreSQL) database. Access is protected by row-level security — you can only access your own data. Strava tokens are stored encrypted and refreshed automatically.</Text>

          <Text style={tm.heading}>6. Your Rights</Text>
          <Text style={tm.para}>You may request a copy of your data or deletion of your account at any time by contacting us at verschuure.jelle@gmail.com. On deletion all personal data and activity records are permanently removed.</Text>

          <Text style={tm.heading}>7. Children</Text>
          <Text style={tm.para}>StravaEat is not intended for users under 16 years of age. By creating an account you confirm you are at least 16 years old.</Text>

          <Text style={tm.heading}>8. Changes to These Terms</Text>
          <Text style={tm.para}>We may update these terms from time to time. Continued use of the app after changes are posted constitutes acceptance of the updated terms.</Text>

          <Text style={tm.heading}>9. Contact</Text>
          <Text style={tm.para}>Questions about these terms? Email verschuure.jelle@gmail.com.</Text>
        </ScrollView>
      </View>
    </Modal>
  )
}

export default function SignUpScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [termsVisible, setTermsVisible] = useState(false)
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
    if (!/^\d{2}-\d{2}-\d{4}$/.test(form.dateOfBirth)) return 'Use format DD-MM-YYYY.'
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
          data: {
            username: form.username,
            date_of_birth: dobToISO(form.dateOfBirth),
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

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Create account</Text>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          value={form.username}
          onChangeText={set('username')}
          placeholder="e.g. jellerun"
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
          onChangeText={v => set('dateOfBirth')(formatDOBInput(v))}
          placeholder="DD-MM-YYYY"
          placeholderTextColor={C.text3}
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
            I accept the{' '}
            <Text style={styles.termsLink} onPress={() => setTermsVisible(true)}>terms and conditions</Text>
          </Text>
        </Pressable>

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
      <TermsModal visible={termsVisible} onClose={() => setTermsVisible(false)} />
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

const tm = StyleSheet.create({
  container:  { flex: 1, backgroundColor: C.bg },
  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  title:      { fontSize: 18, fontWeight: '800', color: C.text1 },
  closeBtn:   { fontSize: 16, color: C.accent, fontWeight: '600' },
  body:       { paddingHorizontal: 20, paddingTop: 20 },
  updated:    { fontSize: 12, color: C.text3, marginBottom: 20 },
  heading:    { fontSize: 15, fontWeight: '800', color: C.text1, marginTop: 20, marginBottom: 6 },
  para:       { fontSize: 14, color: C.text2, lineHeight: 22, marginBottom: 6 },
  bullet:     { fontSize: 14, color: C.text2, lineHeight: 22, paddingLeft: 8 },
})
