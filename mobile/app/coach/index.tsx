import { useState, useCallback } from 'react'
import {
  View, Text, Pressable, ScrollView, StyleSheet,
  TextInput, Alert, ActivityIndicator, Share, Switch,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!

interface CoachRow {
  coach_id: string
  coach_name: string | null
  see_activities: boolean
  see_nutrition: boolean
  see_meals: boolean
  see_weight: boolean
}

interface AthleteRow {
  athlete_id: string
  athlete_name: string | null
}

interface InviteState {
  code: string
  expires_at: string
}

export default function CoachHubScreen() {
  const router = useRouter()

  const [userId, setUserId] = useState<string | null>(null)
  const [myCoaches, setMyCoaches] = useState<CoachRow[]>([])
  const [myAthletes, setMyAthletes] = useState<AthleteRow[]>([])
  const [invite, setInvite] = useState<InviteState | null>(null)
  const [codeInput, setCodeInput] = useState('')

  const [loadingInvite, setLoadingInvite] = useState(false)
  const [loadingAccept, setLoadingAccept] = useState(false)
  const [loading, setLoading] = useState(true)

  useFocusEffect(useCallback(() => { load() }, []))

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  async function load() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    setUserId(user.id)

    const [coachesRes, athletesRes, privacyRes] = await Promise.all([
      // Coaches I've connected with (as athlete)
      supabase.from('coach_athletes')
        .select('coach_id')
        .eq('athlete_id', user.id)
        .eq('active', true),
      // Athletes I coach
      supabase.from('coach_athletes')
        .select('athlete_id')
        .eq('coach_id', user.id)
        .eq('active', true),
      // Privacy settings I've set for my coaches
      supabase.from('coach_privacy_settings')
        .select('*')
        .eq('athlete_id', user.id),
    ])

    const coachIds: string[] = (coachesRes.data ?? []).map((r: any) => r.coach_id)
    const athleteIds: string[] = (athletesRes.data ?? []).map((r: any) => r.athlete_id)
    const privacyMap: Record<string, any> = {}
    for (const p of privacyRes.data ?? []) privacyMap[p.coach_id] = p

    // Fetch names for coaches
    if (coachIds.length > 0) {
      const { data: coachUsers } = await supabase
        .from('users').select('id, name').in('id', coachIds)
      const nameMap: Record<string, string> = {}
      for (const u of coachUsers ?? []) nameMap[u.id] = u.name
      setMyCoaches(coachIds.map(id => ({
        coach_id: id,
        coach_name: nameMap[id] ?? null,
        see_activities: privacyMap[id]?.see_activities ?? true,
        see_nutrition: privacyMap[id]?.see_nutrition ?? false,
        see_meals: privacyMap[id]?.see_meals ?? false,
        see_weight: privacyMap[id]?.see_weight ?? false,
      })))
    } else {
      setMyCoaches([])
    }

    // Fetch names for athletes
    if (athleteIds.length > 0) {
      const { data: athleteUsers } = await supabase
        .from('users').select('id, name').in('id', athleteIds)
      const nameMap: Record<string, string> = {}
      for (const u of athleteUsers ?? []) nameMap[u.id] = u.name
      setMyAthletes(athleteIds.map(id => ({ athlete_id: id, athlete_name: nameMap[id] ?? null })))
    } else {
      setMyAthletes([])
    }

    setLoading(false)
  }

  async function generateInvite() {
    setLoadingInvite(true)
    try {
      const token = await getToken()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/coach-invite`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to generate code')
      setInvite({ code: json.code, expires_at: json.expires_at })
    } catch (err: any) {
      Alert.alert('Error', err.message)
    } finally {
      setLoadingInvite(false)
    }
  }

  async function shareInvite() {
    if (!invite) return
    const expires = new Date(invite.expires_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    await Share.share({
      message: `Join me on StravaEat! Enter this code in the Coach section to connect: ${invite.code}\n(expires at ${expires})`,
    })
  }

  async function acceptInvite() {
    const code = codeInput.trim().toUpperCase()
    if (!code) return
    setLoadingAccept(true)
    try {
      const token = await getToken()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/coach-invite`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', code }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to connect')
      Alert.alert('Connected!', `You are now coaching ${json.athlete_name ?? 'this athlete'}.`)
      setCodeInput('')
      load()
    } catch (err: any) {
      Alert.alert('Error', err.message)
    } finally {
      setLoadingAccept(false)
    }
  }

  async function revokeCoach(coachId: string, coachName: string | null) {
    Alert.alert(
      'Remove coach',
      `Remove ${coachName ?? 'this coach'} from your account?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            const token = await getToken()
            await fetch(`${SUPABASE_URL}/functions/v1/coach-invite`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'revoke', coach_id: coachId }),
            })
            load()
          },
        },
      ],
    )
  }

  async function updatePrivacy(coachId: string, field: keyof Omit<CoachRow, 'coach_id' | 'coach_name'>, value: boolean) {
    if (!userId) return
    setMyCoaches(prev => prev.map(c => c.coach_id === coachId ? { ...c, [field]: value } : c))
    await supabase.from('coach_privacy_settings')
      .update({ [field]: value })
      .eq('athlete_id', userId)
      .eq('coach_id', coachId)
  }

  const expiresLabel = invite
    ? `Expires ${new Date(invite.expires_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : ''

  return (
    <SafeAreaView style={st.container}>
      <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={st.headerRow}>
          <Pressable onPress={() => router.back()} style={st.backBtn}>
            <Ionicons name="chevron-back" size={22} color="#333" />
          </Pressable>
          <Text style={st.title}>Coach</Text>
        </View>

        {loading ? (
          <ActivityIndicator color="#FC4C02" style={{ marginTop: 32 }} />
        ) : (
          <>
            {/* ── MY COACH (athlete view) ──────────────────────── */}
            <Text style={st.sectionTitle}>My Coach</Text>

            {myCoaches.length === 0 ? (
              <View style={st.emptyCard}>
                <Ionicons name="people-outline" size={40} color="#e0e0e0" />
                <Text style={st.emptyText}>No coach connected yet</Text>
                <Text style={st.emptyNote}>Generate an invite code and share it with your coach.</Text>
              </View>
            ) : (
              myCoaches.map(c => (
                <View key={c.coach_id} style={st.coachCard}>
                  <View style={st.coachCardHeader}>
                    <View style={st.coachAvatar}>
                      <Ionicons name="person" size={20} color="#FC4C02" />
                    </View>
                    <Text style={st.coachName}>{c.coach_name ?? 'Coach'}</Text>
                    <Pressable onPress={() => revokeCoach(c.coach_id, c.coach_name)} style={st.revokeBtn}>
                      <Text style={st.revokeBtnText}>Remove</Text>
                    </Pressable>
                  </View>

                  <Text style={st.privacyLabel}>What your coach can see:</Text>
                  {(
                    [
                      ['see_activities', 'Activities'],
                      ['see_nutrition', 'Nutrition log'],
                      ['see_meals', 'Meal plan'],
                      ['see_weight', 'Weight'],
                    ] as const
                  ).map(([field, label]) => (
                    <View key={field} style={st.privacyRow}>
                      <Text style={st.privacyRowLabel}>{label}</Text>
                      <Switch
                        value={c[field]}
                        onValueChange={v => updatePrivacy(c.coach_id, field, v)}
                        trackColor={{ true: '#FC4C02', false: '#e0e0e0' }}
                        thumbColor="#fff"
                      />
                    </View>
                  ))}
                </View>
              ))
            )}

            {/* Invite code generator */}
            <View style={st.card}>
              <Text style={st.cardTitle}>Generate invite code</Text>
              <Text style={st.cardNote}>Share the code with your coach. It expires after 48 hours.</Text>

              {invite ? (
                <View style={st.codeBox}>
                  <Text style={st.codeText}>{invite.code}</Text>
                  <Text style={st.codeExpiry}>{expiresLabel}</Text>
                  <Pressable style={st.shareBtn} onPress={shareInvite}>
                    <Ionicons name="share-outline" size={16} color="#fff" />
                    <Text style={st.shareBtnText}>Share code</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={[st.actionBtn, loadingInvite && st.actionBtnDisabled]}
                  onPress={generateInvite}
                  disabled={loadingInvite}
                >
                  {loadingInvite
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={st.actionBtnText}>Generate code</Text>
                  }
                </Pressable>
              )}
            </View>

            {/* ── MY ATHLETES (coach view) ──────────────────────── */}
            <Text style={[st.sectionTitle, { marginTop: 28 }]}>My Athletes</Text>

            {/* Enter invite code */}
            <View style={st.card}>
              <Text style={st.cardTitle}>Connect an athlete</Text>
              <Text style={st.cardNote}>Ask your athlete to generate a code, then enter it here.</Text>
              <View style={st.codeInputRow}>
                <TextInput
                  style={st.codeInput}
                  placeholder="Enter code (e.g. AB3D7XYZ)"
                  value={codeInput}
                  onChangeText={t => setCodeInput(t.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={8}
                />
                <Pressable
                  style={[st.goBtn, (!codeInput.trim() || loadingAccept) && st.goBtnDisabled]}
                  onPress={acceptInvite}
                  disabled={!codeInput.trim() || loadingAccept}
                >
                  {loadingAccept
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={st.goBtnText}>Connect</Text>
                  }
                </Pressable>
              </View>
            </View>

            {myAthletes.length === 0 ? (
              <View style={st.emptyCard}>
                <Ionicons name="fitness-outline" size={40} color="#e0e0e0" />
                <Text style={st.emptyText}>No athletes yet</Text>
              </View>
            ) : (
              myAthletes.map(a => (
                <Pressable
                  key={a.athlete_id}
                  style={st.athleteRow}
                  onPress={() => router.push(`/coach/athlete/${a.athlete_id}`)}
                >
                  <View style={st.coachAvatar}>
                    <Ionicons name="person" size={18} color="#666" />
                  </View>
                  <Text style={st.athleteName}>{a.athlete_name ?? 'Athlete'}</Text>
                  <Ionicons name="chevron-forward" size={18} color="#ccc" />
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f9' },
  content: { padding: 16, paddingBottom: 48 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 8 },
  backBtn: { padding: 4 },
  title: { fontSize: 24, fontWeight: '800', color: '#111' },

  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },

  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#111', marginBottom: 4 },
  cardNote: { fontSize: 13, color: '#aaa', marginBottom: 14, lineHeight: 18 },

  emptyCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24,
    alignItems: 'center', gap: 8, marginBottom: 12,
  },
  emptyText: { fontSize: 15, fontWeight: '600', color: '#aaa' },
  emptyNote: { fontSize: 13, color: '#ccc', textAlign: 'center', maxWidth: 240, lineHeight: 18 },

  coachCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  coachCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  coachAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FFF3EE', alignItems: 'center', justifyContent: 'center',
  },
  coachName: { flex: 1, fontSize: 16, fontWeight: '700', color: '#111' },
  revokeBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: '#FFF0F0' },
  revokeBtnText: { fontSize: 12, fontWeight: '700', color: '#EF5350' },

  privacyLabel: { fontSize: 12, fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  privacyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f5f5f5' },
  privacyRowLabel: { fontSize: 14, color: '#333' },

  codeBox: { alignItems: 'center', gap: 8, paddingTop: 4 },
  codeText: { fontSize: 36, fontWeight: '900', color: '#FC4C02', letterSpacing: 6, fontVariant: ['tabular-nums'] },
  codeExpiry: { fontSize: 12, color: '#aaa' },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FC4C02', borderRadius: 10,
    paddingHorizontal: 20, paddingVertical: 10, marginTop: 4,
  },
  shareBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  actionBtn: {
    backgroundColor: '#FC4C02', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  codeInputRow: { flexDirection: 'row', gap: 10 },
  codeInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 10,
    padding: 11, fontSize: 16, fontWeight: '700', letterSpacing: 3, color: '#111',
    backgroundColor: '#fafafa',
  },
  goBtn: {
    backgroundColor: '#FC4C02', borderRadius: 10,
    paddingHorizontal: 18, justifyContent: 'center',
  },
  goBtnDisabled: { opacity: 0.4 },
  goBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  athleteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  athleteName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#111' },
})
