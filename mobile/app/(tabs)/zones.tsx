import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'
import { C } from '../../lib/theme'
import type { HeartRateZone } from '../../types'

export default function ZonesScreen() {
  const [zones, setZones] = useState<HeartRateZone[]>([])
  const [editingZone, setEditingZone] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('heart_rate_zones').select('*').eq('user_id', user.id).order('zone_number')
    setZones(data ?? [])
  }

  async function saveZone(zone: HeartRateZone) {
    const { error } = await supabase.from('heart_rate_zones')
      .update({ name: zone.name, min_bpm: zone.min_bpm, max_bpm: zone.max_bpm })
      .eq('id', zone.id)
    if (error) Alert.alert('Error', error.message)
    else setEditingZone(null)
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Heart Rate Zones</Text>
        <Text style={styles.note}>Changes only apply to future syncs.</Text>

        {zones.map(zone => (
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
          <TextInput style={styles.input} value={String(zone.min_bpm)} keyboardType="numeric"
            placeholderTextColor={C.text3}
            onChangeText={v => onChange({ ...zone, min_bpm: parseInt(v) || 0 })} />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Max BPM</Text>
          <TextInput style={styles.input} value={String(zone.max_bpm)} keyboardType="numeric"
            placeholderTextColor={C.text3}
            onChangeText={v => onChange({ ...zone, max_bpm: parseInt(v) || 0 })} />
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
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cancelBtn: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  cancelBtnText: { color: C.text2, fontSize: 14 },
})
