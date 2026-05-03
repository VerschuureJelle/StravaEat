import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'
import type { HeartRateZone } from '../../types'

export default function ZonesScreen() {
  const [zones, setZones] = useState<HeartRateZone[]>([])
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    fetchZones()
  }, [])

  async function fetchZones() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('heart_rate_zones')
      .select('*')
      .eq('user_id', user.id)
      .order('zone_number')
    setZones(data ?? [])
  }

  async function saveZone(zone: HeartRateZone) {
    const { error } = await supabase
      .from('heart_rate_zones')
      .update({
        name: zone.name,
        min_bpm: zone.min_bpm,
        max_bpm: zone.max_bpm,
        met_value: zone.met_value,
      })
      .eq('id', zone.id)
    if (error) Alert.alert('Error', error.message)
    else setEditing(null)
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Heart Rate Zones</Text>
      <Text style={styles.note}>Changes apply to future activities only.</Text>
      <FlatList
        data={zones}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <ZoneCard
            zone={item}
            isEditing={editing === item.id}
            onEdit={() => setEditing(item.id)}
            onSave={saveZone}
            onCancel={() => setEditing(null)}
            onChange={(updated) =>
              setZones((prev) => prev.map((z) => (z.id === updated.id ? updated : z)))
            }
          />
        )}
      />
    </SafeAreaView>
  )
}

function ZoneCard({
  zone,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  onChange,
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
      <Pressable style={styles.card} onPress={onEdit}>
        <View>
          <Text style={styles.zoneName}>{zone.name}</Text>
          <Text style={styles.zoneMeta}>{zone.min_bpm}–{zone.max_bpm} bpm · MET {zone.met_value}</Text>
        </View>
        <Text style={styles.editHint}>Edit</Text>
      </Pressable>
    )
  }

  return (
    <View style={[styles.card, styles.cardEditing]}>
      <TextInput
        style={styles.input}
        value={zone.name}
        onChangeText={(v) => onChange({ ...zone, name: v })}
      />
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.inputSmall]}
          value={String(zone.min_bpm)}
          keyboardType="numeric"
          onChangeText={(v) => onChange({ ...zone, min_bpm: parseInt(v) || 0 })}
          placeholder="Min BPM"
        />
        <TextInput
          style={[styles.input, styles.inputSmall]}
          value={String(zone.max_bpm)}
          keyboardType="numeric"
          onChangeText={(v) => onChange({ ...zone, max_bpm: parseInt(v) || 0 })}
          placeholder="Max BPM"
        />
        <TextInput
          style={[styles.input, styles.inputSmall]}
          value={String(zone.met_value)}
          keyboardType="numeric"
          onChangeText={(v) => onChange({ ...zone, met_value: parseFloat(v) || 0 })}
          placeholder="MET"
        />
      </View>
      <View style={styles.row}>
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
  container: { flex: 1, backgroundColor: '#fff' },
  header: { fontSize: 28, fontWeight: '700', padding: 16, paddingBottom: 4 },
  note: { fontSize: 13, color: '#999', paddingHorizontal: 16, marginBottom: 8 },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  cardEditing: { flexDirection: 'column', alignItems: 'stretch' },
  zoneName: { fontSize: 15, fontWeight: '600' },
  zoneMeta: { fontSize: 13, color: '#666', marginTop: 2 },
  editHint: { fontSize: 13, color: '#FC4C02', fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 8,
    fontSize: 14,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  inputSmall: { flex: 1, marginRight: 8 },
  row: { flexDirection: 'row' },
  saveBtn: {
    flex: 1,
    backgroundColor: '#FC4C02',
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginRight: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '600' },
  cancelBtn: { flex: 1, padding: 10, borderRadius: 6, alignItems: 'center' },
  cancelBtnText: { color: '#666' },
})
