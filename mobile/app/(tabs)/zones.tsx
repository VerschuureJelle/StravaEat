import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'
import { W as C } from '../../lib/themeWarm'
import type { HeartRateZone } from '../../types'

function sportColor(sport: string): string {
  if (/swim/i.test(sport)) return C.swim
  if (/run|jog/i.test(sport)) return C.run
  if (/walk|hike/i.test(sport)) return C.walk
  if (/ride|bike|cycling|virtual/i.test(sport)) return C.ride
  return C.sport
}

function sportLabel(sport: string): string {
  return sport === 'default' ? 'Default' : sport
}

export default function ZonesScreen() {
  const [zones, setZones] = useState<HeartRateZone[]>([])
  const [editingZone, setEditingZone] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('heart_rate_zones').select('*').eq('user_id', user.id)
      .order('sport_type').order('zone_number')
    setZones(data ?? [])
  }

  async function saveZone(zone: HeartRateZone) {
    const sport = zone.sport_type ?? 'default'
    const sportZones = zones
      .filter(z => (z.sport_type ?? 'default') === sport)
      .sort((a, b) => a.zone_number - b.zone_number)
    const idx = sportZones.findIndex(z => z.id === zone.id)
    const prev = sportZones[idx - 1] ?? null
    const next = sportZones[idx + 1] ?? null

    // Validate: max can't swallow the entire next zone
    if (next && zone.max_bpm >= next.max_bpm) {
      Alert.alert(
        'Range too large',
        `Zone ${zone.zone_number} max (${zone.max_bpm}) must stay below Zone ${next.zone_number} max (${next.max_bpm} bpm).`,
      )
      return
    }

    // Validate: min can't swallow the entire previous zone
    if (prev && zone.min_bpm <= prev.min_bpm) {
      Alert.alert(
        'Range too small',
        `Zone ${zone.zone_number} min (${zone.min_bpm}) must stay above Zone ${prev.zone_number} min (${prev.min_bpm} bpm).`,
      )
      return
    }

    // Save this zone
    const { error } = await supabase.from('heart_rate_zones')
      .update({ name: zone.name, min_bpm: zone.min_bpm, max_bpm: zone.max_bpm })
      .eq('id', zone.id)
    if (error) { Alert.alert('Error', error.message); return }

    let updated = zones.map(z => z.id === zone.id ? zone : z)

    // Auto-adjust next zone's min to stay contiguous
    if (next && zone.max_bpm + 1 !== next.min_bpm) {
      const newMin = zone.max_bpm + 1
      const { error: e2 } = await supabase.from('heart_rate_zones')
        .update({ min_bpm: newMin }).eq('id', next.id)
      if (!e2) updated = updated.map(z => z.id === next.id ? { ...z, min_bpm: newMin } : z)
    }

    // Auto-adjust previous zone's max to stay contiguous
    if (prev && zone.min_bpm - 1 !== prev.max_bpm) {
      const newMax = zone.min_bpm - 1
      const { error: e3 } = await supabase.from('heart_rate_zones')
        .update({ max_bpm: newMax }).eq('id', prev.id)
      if (!e3) updated = updated.map(z => z.id === prev.id ? { ...z, max_bpm: newMax } : z)
    }

    setZones(updated)
    setEditingZone(null)
  }

  async function clearSportZones(sport: string) {
    Alert.alert(
      `Clear all ${sportLabel(sport)} zones?`,
      'All zones for this sport will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear all', style: 'destructive', onPress: async () => {
            const ids = zones
              .filter(z => (z.sport_type ?? 'default') === sport)
              .map(z => z.id)
            await Promise.all(ids.map(id =>
              supabase.from('heart_rate_zones').delete().eq('id', id),
            ))
            setZones(prev => prev.filter(z => (z.sport_type ?? 'default') !== sport))
          },
        },
      ],
    )
  }

  // Group zones by sport_type, preserving DB order
  const groups: { sport: string; zones: HeartRateZone[] }[] = []
  for (const zone of zones) {
    const sport = zone.sport_type ?? 'default'
    const existing = groups.find(g => g.sport === sport)
    if (existing) existing.zones.push(zone)
    else groups.push({ sport, zones: [zone] })
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Heart Rate Zones</Text>
        <Text style={styles.note}>Changes only apply to future syncs.</Text>

        {groups.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No zones configured</Text>
            <Text style={styles.emptyBody}>
              Set up your heart rate zones in Settings → Heart Rate Zones. Zones are used to calculate calories burned per activity.
            </Text>
          </View>
        )}

        {groups.map(group => (
          <View key={group.sport} style={styles.sportGroup}>
            <View style={styles.sportHeaderRow}>
              <View style={[styles.sportHeaderAccent, { backgroundColor: sportColor(group.sport) }]} />
              <Text style={[styles.sportLabel, { color: sportColor(group.sport) }]}>
                {sportLabel(group.sport)}
              </Text>
              <Pressable
                style={styles.clearBtn}
                onPress={() => clearSportZones(group.sport)}
              >
                <Text style={styles.clearBtnText}>Clear all</Text>
              </Pressable>
            </View>

            {group.zones.map(zone => (
              <ZoneCard
                key={zone.id}
                zone={zone}
                isEditing={editingZone === zone.id}
                onEdit={() => setEditingZone(zone.id)}
                onSave={saveZone}
                onCancel={() => setEditingZone(null)}
                onChange={updated => setZones(prev => prev.map(z => z.id === updated.id ? updated : z))}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

function ZoneCard({
  zone, isEditing, onEdit, onSave, onCancel, onChange,
}: {
  zone: HeartRateZone
  isEditing: boolean
  onEdit: () => void
  onSave: (z: HeartRateZone) => void
  onCancel: () => void
  onChange: (z: HeartRateZone) => void
}) {
  if (!isEditing) {
    return (
      <Pressable style={styles.zoneCard} onPress={onEdit}>
        <View>
          <Text style={styles.zoneName}>{zone.name}</Text>
          <Text style={styles.zoneMeta}>{zone.min_bpm}–{zone.max_bpm} bpm</Text>
        </View>
        <Text style={styles.editHint}>Edit</Text>
      </Pressable>
    )
  }
  return (
    <View style={[styles.zoneCard, styles.zoneCardEditing]}>
      <TextInput
        style={styles.input}
        value={zone.name}
        onChangeText={v => onChange({ ...zone, name: v })}
        placeholderTextColor={C.text3}
      />
      <View style={styles.inputRow}>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Min BPM</Text>
          <TextInput
            style={styles.input}
            value={String(zone.min_bpm)}
            keyboardType="numeric"
            placeholderTextColor={C.text3}
            onChangeText={v => onChange({ ...zone, min_bpm: parseInt(v) || 0 })}
          />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Max BPM</Text>
          <TextInput
            style={styles.input}
            value={String(zone.max_bpm)}
            keyboardType="numeric"
            placeholderTextColor={C.text3}
            onChangeText={v => onChange({ ...zone, max_bpm: parseInt(v) || 0 })}
          />
        </View>
      </View>
      <View style={styles.inputRow}>
        <Pressable style={styles.saveBtn} onPress={() => onSave(zone)}>
          <Text style={styles.saveBtnText}>Save</Text>
        </Pressable>
        <Pressable style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 48 },
  header: { fontSize: 22, fontWeight: '700', color: C.text1, marginBottom: 4 },
  note: { fontSize: 13, color: C.text3, marginBottom: 16 },
  sportGroup: { marginBottom: 24 },
  sportHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8,
  },
  sportHeaderAccent: { width: 3, height: 16, borderRadius: 2 },
  sportLabel: { fontSize: 14, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, flex: 1 },
  clearBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: C.danger + '66' },
  clearBtnText: { fontSize: 12, fontWeight: '600', color: C.danger },
  zoneCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14, marginBottom: 8, borderRadius: 10, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
  },
  zoneCardEditing: { flexDirection: 'column', alignItems: 'stretch' },
  zoneName: { fontSize: 15, fontWeight: '600', color: C.text1 },
  zoneMeta: { fontSize: 13, color: C.text2, marginTop: 2 },
  editHint: { fontSize: 13, color: C.accent, fontWeight: '600' },
  inputRow: { flexDirection: 'row', gap: 10, marginBottom: 0 },
  inputGroup: { flex: 1, marginBottom: 10 },
  inputLabel: { fontSize: 11, fontWeight: '600', color: C.text3, marginBottom: 4, textTransform: 'uppercase' },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 8,
    padding: 10, fontSize: 14, backgroundColor: C.surface2,
    color: C.text1, marginBottom: 10,
  },
  saveBtn: {
    flex: 1, backgroundColor: C.accent, padding: 12,
    borderRadius: 8, alignItems: 'center', marginTop: 4,
  },
  saveBtnText: { color: C.white, fontWeight: '700', fontSize: 14 },
  cancelBtn: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  cancelBtnText: { color: C.text2, fontSize: 14 },
  emptyState: { marginTop: 32, alignItems: 'center', paddingHorizontal: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.text1, marginBottom: 8 },
  emptyBody:  { fontSize: 13, color: C.text3, textAlign: 'center', lineHeight: 20 },
})
