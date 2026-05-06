import { useState, useCallback } from 'react'
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'

interface Athlete {
  athlete_id: string
  athlete_name: string | null
}

export default function CoachTab() {
  const router = useRouter()
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
      <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
        <View style={st.headerRow}>
          <Text style={st.title}>Coach</Text>
          <Pressable onPress={() => router.push('/coach' as any)} style={st.manageBtn}>
            <Ionicons name="settings-outline" size={15} color="#FC4C02" />
            <Text style={st.manageBtnText}>Manage</Text>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color="#FC4C02" style={{ marginTop: 48 }} />
        ) : athletes.length === 0 ? (
          <View style={st.emptyState}>
            <View style={st.emptyIcon}>
              <Ionicons name="people-outline" size={44} color="#FC4C02" />
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
                  <Ionicons name="person" size={22} color="#FC4C02" />
                </View>
                <View style={st.athleteInfo}>
                  <Text style={st.athleteName}>{a.athlete_name ?? 'Athlete'}</Text>
                  <Text style={st.athleteSub}>Activities · Nutrition · Stats</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#ddd" />
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f9' },
  content: { padding: 20, paddingBottom: 48 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
  title: { fontSize: 26, fontWeight: '800', color: '#111', flex: 1 },
  manageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#FFF3EE', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
  },
  manageBtnText: { fontSize: 13, fontWeight: '700', color: '#FC4C02' },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#aaa',
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12,
  },

  athleteCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: '#FFF3EE', alignItems: 'center', justifyContent: 'center',
  },
  athleteInfo: { flex: 1 },
  athleteName: { fontSize: 16, fontWeight: '700', color: '#111' },
  athleteSub: { fontSize: 13, color: '#aaa', marginTop: 2 },

  emptyState: { alignItems: 'center', paddingTop: 56, paddingHorizontal: 28, gap: 14 },
  emptyIcon: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#FFF3EE', alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#222', textAlign: 'center' },
  emptyNote: { fontSize: 14, color: '#aaa', textAlign: 'center', lineHeight: 21 },
  setupBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FC4C02', borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 13, marginTop: 4,
  },
  setupBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
})
