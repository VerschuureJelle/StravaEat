import { useState, useCallback } from 'react'
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAppMode } from '../../contexts/AppModeContext'
import { C } from '../../lib/theme'

interface Athlete {
  athlete_id: string
  athlete_name: string | null
}

export default function CoachTab() {
  const router = useRouter()
  const { mode, setMode, isCoach } = useAppMode()
  const [athletes, setAthletes] = useState<Athlete[]>([])
  const [loading, setLoading] = useState(true)

  useFocusEffect(useCallback(() => { load() }, []))

  async function load() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data: rows } = await supabase
      .from('coach_athletes')
      .select('athlete_id')
      .eq('coach_id', user.id)
      .eq('active', true)

    const ids: string[] = (rows ?? []).map((r: any) => r.athlete_id)

    if (ids.length === 0) { setAthletes([]); setLoading(false); return }

    const { data: userRows } = await supabase
      .from('users')
      .select('id, name')
      .in('id', ids)

    const nameMap: Record<string, string | null> = {}
    for (const u of userRows ?? []) nameMap[u.id] = u.name

    setAthletes(ids.map(id => ({ athlete_id: id, athlete_name: nameMap[id] ?? null })))
    setLoading(false)
  }

  return (
    <SafeAreaView style={st.container}>
      {/* Mode banner */}
      <Pressable
        style={[st.modeBanner, isCoach ? st.modeBannerCoach : st.modeBannerAthlete]}
        onPress={() => setMode(isCoach ? 'athlete' : 'coach')}
      >
        <Ionicons
          name={isCoach ? 'people' : 'person-outline'}
          size={15}
          color={isCoach ? '#fff' : C.accent2}
        />
        <Text style={[st.modeBannerText, isCoach && { color: '#fff' }]}>
          {isCoach ? 'Coach Mode — tap to switch to Athlete' : 'Athlete Mode — tap to switch to Coach'}
        </Text>
        <Ionicons name="swap-horizontal-outline" size={15} color={isCoach ? '#fff' : C.accent2} />
      </Pressable>

      <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
        <View style={st.headerRow}>
          <Text style={st.title}>Coach</Text>
          <Pressable onPress={() => router.push('/coach' as any)} style={st.manageBtn}>
            <Ionicons name="settings-outline" size={15} color={C.accent} />
            <Text style={st.manageBtnText}>Manage</Text>
          </Pressable>
        </View>

        {!isCoach && (
          <View style={st.athleteModeCard}>
            <Ionicons name="information-circle-outline" size={18} color={C.accent2} />
            <Text style={st.athleteModeText}>
              Switch to <Text style={{ fontWeight: '800', color: C.text1 }}>Coach Mode</Text> (tap banner above) to manage your athletes' plans and progress.
            </Text>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 48 }} />
        ) : athletes.length === 0 ? (
          <View style={st.emptyState}>
            <View style={st.emptyIcon}>
              <Ionicons name="people-outline" size={44} color={C.accent} />
            </View>
            <Text style={st.emptyTitle}>You are not coaching anyone currently</Text>
            <Text style={st.emptyNote}>
              Ask your athlete to generate an invite code in their app, then enter it via Manage to connect.
            </Text>
            <Pressable style={st.setupBtn} onPress={() => router.push('/coach' as any)}>
              <Ionicons name="person-add-outline" size={16} color="#fff" />
              <Text style={st.setupBtnText}>Connect an athlete</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={st.sectionLabel}>
              {athletes.length} Athlete{athletes.length !== 1 ? 's' : ''}
            </Text>
            {athletes.map(a => (
              <Pressable
                key={a.athlete_id}
                style={st.athleteCard}
                onPress={() => router.push(`/coach/athlete/${a.athlete_id}` as any)}
              >
                <View style={st.avatar}>
                  <Ionicons name="person" size={22} color={C.accent} />
                </View>
                <View style={st.athleteInfo}>
                  <Text style={st.athleteName}>{a.athlete_name ?? 'Athlete'}</Text>
                  <Text style={st.athleteSub}>Activities · Nutrition · Stats</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={C.text4} />
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, paddingBottom: 48 },

  modeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center',
    paddingVertical: 9, paddingHorizontal: 16,
  },
  modeBannerCoach: { backgroundColor: '#3F4691' },
  modeBannerAthlete: { backgroundColor: C.surface2 },
  modeBannerText: { fontSize: 13, fontWeight: '600', color: C.accent2, flex: 1, textAlign: 'center' },

  athleteModeCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: 'rgba(124,131,253,0.1)', borderRadius: 12, padding: 12, marginBottom: 20,
    borderWidth: 1, borderColor: 'rgba(124,131,253,0.2)',
  },
  athleteModeText: { flex: 1, fontSize: 13, color: C.text2, lineHeight: 18 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
  title: { fontSize: 26, fontWeight: '800', color: C.text1, flex: 1 },
  manageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.accentBg, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
  },
  manageBtnText: { fontSize: 13, fontWeight: '700', color: C.accent },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: C.text3,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12,
  },

  athleteCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.surface, borderRadius: 16, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: C.border,
  },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: C.accentBg, alignItems: 'center', justifyContent: 'center',
  },
  athleteInfo: { flex: 1 },
  athleteName: { fontSize: 16, fontWeight: '700', color: C.text1 },
  athleteSub: { fontSize: 13, color: C.text3, marginTop: 2 },

  emptyState: { alignItems: 'center', paddingTop: 56, paddingHorizontal: 28, gap: 14 },
  emptyIcon: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: C.accentBg, alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.text1, textAlign: 'center' },
  emptyNote: { fontSize: 14, color: C.text2, textAlign: 'center', lineHeight: 21 },
  setupBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.accent, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 13, marginTop: 4,
  },
  setupBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
})
