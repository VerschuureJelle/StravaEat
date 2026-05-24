import { useState, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  Alert, ActivityIndicator, Animated, Dimensions, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { supabase } from '../../lib/supabase'
import { initiateStravaOAuth } from '../../lib/stravaAuth'
import { setOnboardingDone } from '../../lib/onboardingCache'
import { W as C } from '../../lib/themeWarm'
import { generateZonesFromMaxHR } from '../../constants/zones'
import type { SportHistory, Sex } from '../../types'

const SCREEN_WIDTH = Dimensions.get('window').width

// ─── Mifflin-St Jeor ─────────────────────────────────────────────────────────

function calcMifflinBMR(weight_kg: number, height_cm: number, age: number, sex: Sex | ''): number {
  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age
  const offset = sex === 'female' ? -161 : sex === 'male' ? 5 : -78
  return Math.round(base + offset)
}

// ─── question definitions ─────────────────────────────────────────────────────

interface QuestionOption { label: string; value: string; note?: string; emoji?: string }
interface Question {
  key: string
  question: string
  subtitle?: string
  type: 'single' | 'multi'
  optional?: boolean
  options: QuestionOption[]
}

const QUESTIONS: Question[] = [
  {
    key: 'training_goal',
    question: 'What are you training for?',
    subtitle: 'Pick the option that fits best right now',
    type: 'single',
    options: [
      { label: '5K', value: 'running_5k', emoji: '🏃' },
      { label: '10K', value: 'running_10k', emoji: '🏃' },
      { label: 'Half marathon', value: 'running_half', emoji: '🏅' },
      { label: 'Marathon', value: 'running_marathon', emoji: '🏆' },
      { label: 'Cycling', value: 'cycling', emoji: '🚴' },
      { label: 'Swimming', value: 'swimming', emoji: '🏊' },
      { label: 'Triathlon', value: 'triathlon', emoji: '⚡' },
      { label: 'Strength training', value: 'strength', emoji: '💪' },
      { label: 'General fitness', value: 'fitness', emoji: '✨' },
    ],
  },
  {
    key: 'training_frequency',
    question: 'How often do you train?',
    type: 'single',
    options: [
      { label: '1–2× a week', value: '1_2' },
      { label: '3–4× a week', value: '3_4' },
      { label: '5–6× a week', value: '5_6' },
      { label: 'Every day', value: 'daily' },
    ],
  },
  {
    key: 'training_time',
    question: 'When do you usually train?',
    type: 'single',
    options: [
      { label: 'Morning', value: 'morning', emoji: '🌅' },
      { label: 'Around lunch', value: 'lunch', emoji: '☀️' },
      { label: 'Afternoon / evening', value: 'evening', emoji: '🌆' },
      { label: 'It varies a lot', value: 'varies', emoji: '🔄' },
    ],
  },
  {
    key: 'app_goals',
    question: 'What do you want the app to help with?',
    subtitle: 'Select all that apply',
    type: 'multi',
    options: [
      { label: 'Fueling training properly', value: 'fueling' },
      { label: 'Eating at the right times', value: 'timing' },
      { label: 'Planning workouts', value: 'planning' },
      { label: 'Keeping energy levels up', value: 'energy' },
      { label: 'Supporting recovery', value: 'recovery' },
      { label: 'Managing trainingsload around my period', value: 'period' },
      { label: 'Building a healthier food relationship', value: 'food_relationship' },
    ],
  },
  {
    key: 'nutrition_pref',
    question: 'How do you prefer to see nutrition information?',
    type: 'single',
    options: [
      { label: 'Full metrics', value: 'full', note: 'kcal, macros, the works' },
      { label: 'Simplified fueling', value: 'simplified', note: 'Focus on what to eat and when' },
      { label: 'Minimal numbers', value: 'minimal', note: 'Just guide me — no calorie counts' },
    ],
  },
  {
    key: 'metrics_stress',
    question: 'Do calorie numbers or body metrics ever feel stressful or triggering for you?',
    type: 'single',
    optional: true,
    options: [
      { label: 'Never', value: 'never' },
      { label: 'Sometimes', value: 'sometimes' },
      { label: 'Often', value: 'often' },
      { label: 'Prefer not to say', value: 'no_answer' },
    ],
  },
  {
    key: 'underfueling_history',
    question: 'Have you ever intentionally underfueled training sessions?',
    subtitle: 'To influence weight or body composition',
    type: 'single',
    optional: true,
    options: [
      { label: 'Never', value: 'never' },
      { label: 'Occasionally', value: 'occasionally' },
      { label: 'Frequently', value: 'frequently' },
      { label: 'Prefer not to say', value: 'no_answer' },
    ],
  },
  {
    key: 'app_focus',
    question: 'Would you prefer the app to focus more on…',
    type: 'single',
    options: [
      { label: 'Performance fueling', value: 'performance', emoji: '⚡' },
      { label: 'Energy & recovery', value: 'energy', emoji: '🔋' },
      { label: 'Change in body composition', value: 'composition', emoji: '⚖️' },
      { label: 'A balanced mix', value: 'balanced', emoji: '☯️' },
    ],
  },
  {
    key: 'dietary_prefs',
    question: 'Any dietary preferences?',
    subtitle: 'Select all that apply',
    type: 'multi',
    options: [
      { label: 'No restrictions', value: 'none' },
      { label: 'High protein', value: 'high_protein' },
      { label: 'Vegetarian', value: 'vegetarian' },
      { label: 'Vegan', value: 'vegan' },
      { label: 'Gluten-free', value: 'gluten_free' },
      { label: 'Dairy-free', value: 'dairy_free' },
    ],
  },
  {
    key: 'food_relationship',
    question: 'How would you describe your current relationship with food?',
    type: 'single',
    optional: true,
    options: [
      { label: 'Healthy & positive', value: 'healthy' },
      { label: 'Working on it', value: 'improving' },
      { label: "It's complicated", value: 'complicated' },
      { label: 'Prefer not to say', value: 'no_answer' },
    ],
  },
]

// ─── types ────────────────────────────────────────────────────────────────────

type Step = 'profile' | 'questions' | 'strava'
type WeightMode = 'fixed' | 'estimate'

interface ProfileData {
  name: string
  age: string
  weight_kg: string
  weight_lower: string
  weight_upper: string
  height_cm: string
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

const SPORT_OPTIONS: { label: string; value: SportHistory; note: string }[] = [
  { label: 'Beginner', value: 'beginner', note: 'Less than 2 years of regular training' },
  { label: 'Intermediate', value: 'intermediate', note: '2–5 years, training consistently' },
  { label: 'Advanced', value: 'advanced', note: '5+ years, high-volume or competitive' },
]

// ─── screen ──────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const router = useRouter()

  const [step, setStep]           = useState<Step>('profile')
  const [stravaConnected, setStravaConnected] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [weightMode, setWeightMode] = useState<WeightMode>('fixed')

  const [profile, setProfile] = useState<ProfileData>({
    name: '', age: '', weight_kg: '', weight_lower: '', weight_upper: '',
    height_cm: '', sex: '', sport_history: '', max_hr: '', resting_hr: '',
  })

  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const slideX = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const sub = Linking.addEventListener('url', handleStravaLink)
    return () => sub.remove()
  }, [])

  function handleStravaLink(e: { url: string }) {
    if (!e.url.startsWith('stravaeat://auth')) return
    const parsed = Linking.parse(e.url)
    if (parsed.queryParams?.error) { Alert.alert('Strava connection failed', parsed.queryParams.error as string); return }
    if (parsed.queryParams?.linked === 'true') { setStravaConnected(true) }
  }

  // ── weight validation ──────────────────────────────────────────────────────

  function resolvedWeight(): number | null {
    if (weightMode === 'fixed') {
      const v = parseFloat(profile.weight_kg)
      return isNaN(v) ? null : v
    }
    const lo = parseFloat(profile.weight_lower)
    const hi = parseFloat(profile.weight_upper)
    if (isNaN(lo) || isNaN(hi)) return null
    return (lo + hi) / 2
  }

  function weightError(): string | null {
    if (weightMode === 'estimate') {
      const lo = parseFloat(profile.weight_lower)
      const hi = parseFloat(profile.weight_upper)
      if (!isNaN(lo) && !isNaN(hi)) {
        if (hi <= lo) return 'Upper bound must be greater than lower bound.'
        if (hi - lo > 5) return 'Difference between bounds may not exceed 5 kg.'
      }
    }
    return null
  }

  // ── profile save ───────────────────────────────────────────────────────────

  async function saveProfile() {
    const wkg = resolvedWeight()
    const wErr = weightError()
    if (wErr) { Alert.alert('Weight', wErr); return }
    if (!wkg || !profile.max_hr) {
      Alert.alert('Required', 'Weight and max heart rate are needed to calculate your heart rate zones.')
      return
    }

    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')

      const age = profile.age ? parseInt(profile.age) : null
      const height = profile.height_cm ? parseFloat(profile.height_cm) : null

      // Auto-calculate daily calorie target using Mifflin-St Jeor (moderate activity factor 1.55)
      let daily_kcal_target: number | null = null
      if (age && height) {
        const bmr = calcMifflinBMR(wkg, height, age, profile.sex)
        daily_kcal_target = Math.round(bmr * 1.2)
      }

      await supabase.from('users').upsert({
        id: user.id,
        name: profile.name || null,
        age,
        weight_kg: wkg,
        height_cm: height,
        sex: profile.sex || null,
        sport_history: profile.sport_history || null,
        max_hr: parseInt(profile.max_hr),
        resting_hr: profile.resting_hr ? parseInt(profile.resting_hr) : null,
        ...(daily_kcal_target != null ? { daily_kcal_target } : {}),
      })

      const zones = generateZonesFromMaxHR(parseInt(profile.max_hr)).map(z => ({ ...z, user_id: user.id }))
      await supabase.from('heart_rate_zones').upsert(zones, { onConflict: 'user_id,zone_number' })

      setStep('questions')
      setQIndex(0)
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  // ── question navigation ────────────────────────────────────────────────────

  function slideToIndex(next: number, direction: 1 | -1) {
    Animated.timing(slideX, { toValue: -direction * SCREEN_WIDTH, duration: 220, useNativeDriver: true }).start(() => {
      setQIndex(next)
      slideX.setValue(direction * SCREEN_WIDTH)
      Animated.timing(slideX, { toValue: 0, duration: 220, useNativeDriver: true }).start()
    })
  }

  function handleNext() {
    if (qIndex < QUESTIONS.length - 1) slideToIndex(qIndex + 1, 1)
    else finishOnboarding()
  }

  function handleBack() {
    if (qIndex > 0) slideToIndex(qIndex - 1, -1)
    else setStep('profile')
  }

  function toggleAnswer(q: Question, value: string) {
    if (q.type === 'single') {
      setAnswers(a => ({ ...a, [q.key]: value }))
    } else {
      setAnswers(a => {
        const prev = (a[q.key] as string[] | undefined) ?? []
        const next = prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
        return { ...a, [q.key]: next }
      })
    }
  }

  function isSelected(q: Question, value: string): boolean {
    const ans = answers[q.key]
    if (q.type === 'single') return ans === value
    return Array.isArray(ans) && ans.includes(value)
  }

  function canProceed(q: Question): boolean {
    if (q.optional) return true
    const ans = answers[q.key]
    if (q.type === 'single') return !!ans
    return Array.isArray(ans) && ans.length > 0
  }

  // ── finish ─────────────────────────────────────────────────────────────────

  async function finishOnboarding() {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')

      const hideCalories = answers.nutrition_pref === 'minimal' || answers.metrics_stress === 'often'

      await supabase.from('users').update({
        onboarding_data: answers,
        onboarding_complete: true,
        hide_calories: hideCalories || undefined,
      }).eq('id', user.id)

      setOnboardingDone(user.id)  // cache so startup skips the DB query next time
      setStep('strava')
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not save your answers')
    } finally {
      setSaving(false)
    }
  }

  const maxHRNum = parseInt(profile.max_hr)
  const previewZones = maxHRNum > 0 ? generateZonesFromMaxHR(maxHRNum) : null

  // ─────────────────────────────────────────────────────────────────────────────
  // STRAVA step
  // ─────────────────────────────────────────────────────────────────────────────

  if (step === 'strava') {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.stravaScreen}>
          <Text style={s.heroEmoji}>🏃</Text>
          <Text style={s.stravaTitle}>One last thing</Text>
          <Text style={s.stravaSub}>
            Connect Strava so StravaEat can read your heart rate data and calculate exactly how much energy you burned — per zone, per sport.
          </Text>
          {stravaConnected ? (
            <>
              <View style={[s.stravaBtn, { backgroundColor: '#4CAF50' }]}>
                <Text style={s.stravaBtnText}>✓ Strava connected</Text>
              </View>
              <Pressable style={s.primaryBtn} onPress={() => router.replace('/(tabs)/today')}>
                <Text style={s.primaryBtnText}>Let's go →</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              style={s.stravaBtn}
              onPress={() => initiateStravaOAuth()}
              hitSlop={4}
            >
              <Text style={s.stravaBtnText}>Connect with Strava</Text>
            </Pressable>
          )}
          <Pressable style={s.ghostBtn} onPress={() => router.replace('/(tabs)/today')}>
            <Text style={s.ghostBtnText}>Skip for now</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PROFILE step
  // ─────────────────────────────────────────────────────────────────────────────

  if (step === 'profile') {
    const wErr = weightError()
    return (
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.profileScroll} keyboardShouldPersistTaps="handled">
          <Text style={s.stepLabel}>Your profile</Text>
          <Text style={s.profileTitle}>A few basics</Text>
          <Text style={s.profileSub}>Used to calculate heart rate zones and calorie burn.</Text>

          <Text style={s.label}>Name</Text>
          <TextInput style={s.input} value={profile.name} onChangeText={v => setProfile(p => ({ ...p, name: v }))} placeholder="Your name" placeholderTextColor={C.text3} />

          <Text style={s.label}>Age</Text>
          <TextInput style={s.input} value={profile.age} onChangeText={v => setProfile(p => ({ ...p, age: v }))} keyboardType="numeric" placeholder="e.g. 30" placeholderTextColor={C.text3} />

          <Text style={s.label}>Height (cm)</Text>
          <TextInput style={s.input} value={profile.height_cm} onChangeText={v => setProfile(p => ({ ...p, height_cm: v }))} keyboardType="numeric" placeholder="e.g. 175" placeholderTextColor={C.text3} />

          {/* Weight — fixed or estimate */}
          <Text style={s.label}>Weight (kg) *</Text>
          <View style={s.weightToggleRow}>
            <Pressable style={[s.weightToggleBtn, weightMode === 'fixed' && s.weightToggleBtnActive]} onPress={() => setWeightMode('fixed')}>
              <Text style={[s.weightToggleText, weightMode === 'fixed' && s.weightToggleTextActive]}>Fixed</Text>
            </Pressable>
            <Pressable style={[s.weightToggleBtn, weightMode === 'estimate' && s.weightToggleBtnActive]} onPress={() => setWeightMode('estimate')}>
              <Text style={[s.weightToggleText, weightMode === 'estimate' && s.weightToggleTextActive]}>Estimate</Text>
            </Pressable>
          </View>
          {weightMode === 'fixed' ? (
            <TextInput style={s.input} value={profile.weight_kg} onChangeText={v => setProfile(p => ({ ...p, weight_kg: v }))} keyboardType="numeric" placeholder="e.g. 75" placeholderTextColor={C.text3} />
          ) : (
            <View style={s.weightEstimateRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.weightBoundLabel}>Lower bound</Text>
                <TextInput style={s.input} value={profile.weight_lower} onChangeText={v => setProfile(p => ({ ...p, weight_lower: v }))} keyboardType="numeric" placeholder="e.g. 73" placeholderTextColor={C.text3} />
              </View>
              <Text style={s.weightDash}>–</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.weightBoundLabel}>Upper bound</Text>
                <TextInput style={s.input} value={profile.weight_upper} onChangeText={v => setProfile(p => ({ ...p, weight_upper: v }))} keyboardType="numeric" placeholder="e.g. 77" placeholderTextColor={C.text3} />
              </View>
            </View>
          )}
          {weightMode === 'estimate' && (
            <Text style={wErr ? s.weightErrText : s.weightHint}>
              {wErr ?? 'Max 5 kg difference. Average will be used for calculations.'}
            </Text>
          )}

          <Text style={s.label}>Sex</Text>
          <View style={s.chipRow}>
            {SEX_OPTIONS.map(o => (
              <Pressable key={o.value} style={[s.chip, profile.sex === o.value && s.chipActive]} onPress={() => setProfile(p => ({ ...p, sex: o.value }))}>
                <Text style={[s.chipText, profile.sex === o.value && s.chipTextActive]}>{o.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={s.label}>Sport experience</Text>
          <View style={s.sportOptionList}>
            {SPORT_OPTIONS.map(o => (
              <Pressable key={o.value} style={[s.sportOption, profile.sport_history === o.value && s.sportOptionActive]} onPress={() => setProfile(p => ({ ...p, sport_history: o.value }))}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.sportOptionLabel, profile.sport_history === o.value && s.sportOptionLabelActive]}>{o.label}</Text>
                  <Text style={s.sportOptionNote}>{o.note}</Text>
                </View>
                <View style={[s.optionCheck, profile.sport_history === o.value && s.optionCheckSel]}>
                  {profile.sport_history === o.value && <Text style={s.optionCheckMark}>✓</Text>}
                </View>
              </Pressable>
            ))}
          </View>

          <Text style={s.label}>Max Heart Rate (bpm) *</Text>
          <TextInput style={s.input} value={profile.max_hr} onChangeText={v => setProfile(p => ({ ...p, max_hr: v }))} keyboardType="numeric" placeholder="e.g. 190  (estimate: 220 − age)" placeholderTextColor={C.text3} />

          <Text style={s.label}>Resting Heart Rate (bpm)</Text>
          <TextInput style={s.input} value={profile.resting_hr} onChangeText={v => setProfile(p => ({ ...p, resting_hr: v }))} keyboardType="numeric" placeholder="e.g. 55" placeholderTextColor={C.text3} />

          {previewZones && (
            <View style={s.zoneBox}>
              <Text style={s.zoneBoxTitle}>Your zones (auto-generated)</Text>
              {previewZones.map(z => (
                <View key={z.zone_number} style={s.zoneRow}>
                  <Text style={s.zoneName}>{z.name}</Text>
                  <Text style={s.zoneBpm}>{z.min_bpm}–{z.max_bpm} bpm</Text>
                </View>
              ))}
              <Text style={s.zoneNote}>You can adjust these anytime in Settings.</Text>
            </View>
          )}

          <Pressable style={[s.primaryBtn, saving && s.btnDisabled]} onPress={saveProfile} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Continue →</Text>}
          </Pressable>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // QUESTIONS step — flashcard
  // ─────────────────────────────────────────────────────────────────────────────

  const q = QUESTIONS[qIndex]
  const progress = (qIndex + 1) / QUESTIONS.length
  const isLast = qIndex === QUESTIONS.length - 1

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.qTopBar}>
        <Pressable onPress={handleBack} hitSlop={12}>
          <Text style={s.backArrow}>←</Text>
        </Pressable>
        <Text style={s.qCounter}>{qIndex + 1} / {QUESTIONS.length}</Text>
        <Pressable onPress={handleNext} hitSlop={12}>
          <Text style={s.skipText}>Skip</Text>
        </Pressable>
      </View>

      <View style={s.progressTrack}>
        <Animated.View style={[s.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      <Animated.View style={[s.qCard, { transform: [{ translateX: slideX }] }]}>
        <ScrollView contentContainerStyle={s.qCardInner} showsVerticalScrollIndicator={false}>
          <Text style={s.qQuestion}>{q.question}</Text>
          {q.subtitle && <Text style={s.qSubtitle}>{q.subtitle}</Text>}

          <View style={s.optionList}>
            {q.options.map(opt => {
              const sel = isSelected(q, opt.value)
              return (
                <Pressable
                  key={opt.value}
                  style={[s.optionRow, sel && s.optionRowSel]}
                  onPress={() => toggleAnswer(q, opt.value)}
                >
                  <View style={s.optionLeft}>
                    {opt.emoji && <Text style={s.optionEmoji}>{opt.emoji}</Text>}
                    <View>
                      <Text style={[s.optionLabel, sel && s.optionLabelSel]}>{opt.label}</Text>
                      {opt.note && <Text style={s.optionNote}>{opt.note}</Text>}
                    </View>
                  </View>
                  <View style={[s.optionCheck, sel && s.optionCheckSel]}>
                    {sel && <Text style={s.optionCheckMark}>✓</Text>}
                  </View>
                </Pressable>
              )
            })}
          </View>
        </ScrollView>
      </Animated.View>

      <View style={s.qFooter}>
        <Pressable
          style={[s.primaryBtn, !canProceed(q) && s.btnDisabled, { marginHorizontal: 24 }]}
          onPress={handleNext}
          disabled={!canProceed(q) || saving}
        >
          {saving && isLast
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.primaryBtnText}>{isLast ? 'Finish' : 'Next'}</Text>
          }
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: C.bg },

  // Strava step
  stravaScreen:     { flex: 1, padding: 32, justifyContent: 'center', alignItems: 'center' },
  heroEmoji:        { fontSize: 64, marginBottom: 24 },
  stravaTitle:      { fontSize: 28, fontWeight: '800', color: C.text1, marginBottom: 10, textAlign: 'center' },
  stravaSub:        { fontSize: 15, color: C.text2, textAlign: 'center', lineHeight: 22, marginBottom: 40 },
  stravaBtn:        { backgroundColor: C.accent, paddingVertical: 16, paddingHorizontal: 28, borderRadius: 14, alignItems: 'center', marginTop: 8, alignSelf: 'stretch' },
  stravaBtnText:    { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },

  // Profile step
  profileScroll:    { padding: 24, paddingBottom: 48 },
  stepLabel:        { fontSize: 12, fontWeight: '700', color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  profileTitle:     { fontSize: 26, fontWeight: '800', color: C.text1, marginBottom: 6 },
  profileSub:       { fontSize: 14, color: C.text2, marginBottom: 24, lineHeight: 20 },
  label:            { fontSize: 13, fontWeight: '600', color: C.text2, marginBottom: 6, marginTop: 18 },
  input:            { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 13, fontSize: 16, backgroundColor: C.surface, color: C.text1 },
  chipRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:             { borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.surface },
  chipActive:       { borderColor: C.accent, backgroundColor: C.accent + '18' },
  chipText:         { fontSize: 14, color: C.text2 },
  chipTextActive:   { color: C.accent, fontWeight: '600' },

  // Weight toggle
  weightToggleRow:      { flexDirection: 'row', gap: 8, marginBottom: 10 },
  weightToggleBtn:      { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 9, alignItems: 'center', backgroundColor: C.surface },
  weightToggleBtnActive:{ borderColor: C.accent, backgroundColor: C.accent + '18' },
  weightToggleText:     { fontSize: 14, color: C.text2, fontWeight: '500' },
  weightToggleTextActive:{ color: C.accent, fontWeight: '700' },
  weightEstimateRow:    { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  weightBoundLabel:     { fontSize: 11, color: C.text3, marginBottom: 4 },
  weightDash:           { fontSize: 18, color: C.text3, paddingBottom: 12 },
  weightHint:           { fontSize: 11, color: C.text3, marginTop: 6 },
  weightErrText:        { fontSize: 11, color: C.danger, marginTop: 6 },

  // Sport experience
  sportOptionList:       { gap: 8 },
  sportOption:           { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 12, padding: 14, borderWidth: 1.5, borderColor: 'transparent' },
  sportOptionActive:     { borderColor: C.accent, backgroundColor: C.accent + '10' },
  sportOptionLabel:      { fontSize: 15, fontWeight: '500', color: C.text1 },
  sportOptionLabelActive:{ color: C.accent, fontWeight: '700' },
  sportOptionNote:       { fontSize: 12, color: C.text3, marginTop: 2 },

  zoneBox:          { marginTop: 20, backgroundColor: C.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.border },
  zoneBoxTitle:     { fontSize: 13, fontWeight: '700', color: C.text1, marginBottom: 10 },
  zoneRow:          { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  zoneName:         { fontSize: 13, color: C.text1 },
  zoneBpm:          { fontSize: 13, color: C.text2 },
  zoneNote:         { fontSize: 11, color: C.text3, marginTop: 10 },

  // Shared buttons
  primaryBtn:       { backgroundColor: C.accent, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 28 },
  primaryBtnText:   { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghostBtn:         { alignItems: 'center', marginTop: 16, padding: 10 },
  ghostBtnText:     { color: C.text3, fontSize: 14 },
  btnDisabled:      { opacity: 0.4 },

  // Questions step
  qTopBar:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  backArrow:        { fontSize: 22, color: C.text1 },
  qCounter:         { fontSize: 13, fontWeight: '600', color: C.text3 },
  skipText:         { fontSize: 14, color: C.text3 },

  progressTrack:    { height: 3, backgroundColor: C.surface2, marginHorizontal: 20, borderRadius: 2, marginBottom: 8 },
  progressFill:     { height: 3, backgroundColor: C.accent, borderRadius: 2 },

  qCard:            { flex: 1 },
  qCardInner:       { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
  qQuestion:        { fontSize: 24, fontWeight: '800', color: C.text1, lineHeight: 32, marginBottom: 6 },
  qSubtitle:        { fontSize: 14, color: C.text3, marginBottom: 24, lineHeight: 20 },

  optionList:       { gap: 10, marginTop: 8 },
  optionRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: 'transparent' },
  optionRowSel:     { borderColor: C.accent, backgroundColor: C.accent + '10' },
  optionLeft:       { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  optionEmoji:      { fontSize: 22 },
  optionLabel:      { fontSize: 15, fontWeight: '500', color: C.text1 },
  optionLabelSel:   { color: C.accent, fontWeight: '700' },
  optionNote:       { fontSize: 12, color: C.text3, marginTop: 2 },
  optionCheck:      { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  optionCheckSel:   { backgroundColor: C.accent, borderColor: C.accent },
  optionCheckMark:  { fontSize: 12, color: '#fff', fontWeight: '700' },

  qFooter:          { paddingBottom: 16 },
})
