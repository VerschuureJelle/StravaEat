import { useState, useEffect } from 'react'
import {
  Modal, View, Text, TextInput, Pressable, FlatList,
  StyleSheet, KeyboardAvoidingView, ScrollView,
} from 'react-native'
import { KAV_BEHAVIOR } from '../lib/platform'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { W as C } from '../lib/themeWarm'
import type { Ingredient } from '../types'

export interface IngredientPickResult {
  ingredient_id: string
  ingredient_name: string
  amount_g: number
  kcal: number
  protein_g: number | null
  fat_g: number | null
  carb_g: number | null
}

interface Props {
  visible: boolean
  userId: string
  onSelect: (result: IngredientPickResult) => void
  onClose: () => void
}

function scale(per100: number | null | undefined, amount: number): number | null {
  if (per100 == null) return null
  return Math.round((per100 / 100) * amount * 10) / 10
}

export default function IngredientPickerModal({ visible, userId, onSelect, onClose }: Props) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Ingredient | null>(null)
  const [amountStr, setAmountStr] = useState('100')
  const [creating, setCreating] = useState(false)

  // New ingredient form state
  const [newName, setNewName] = useState('')
  const [newKcal, setNewKcal] = useState('')
  const [newProtein, setNewProtein] = useState('')
  const [newFat, setNewFat] = useState('')
  const [newCarb, setNewCarb] = useState('')

  useEffect(() => {
    if (visible) {
      loadIngredients()
      setSearch('')
      setSelected(null)
      setAmountStr('100')
      setCreating(false)
    }
  }, [visible])

  async function loadIngredients() {
    const { data } = await supabase
      .from('ingredients')
      .select('*')
      .eq('user_id', userId)
      .order('name')
    setIngredients((data ?? []) as Ingredient[])
  }

  async function saveNewIngredient() {
    const kcal = parseFloat(newKcal)
    if (!newName.trim() || isNaN(kcal)) return
    const { data } = await supabase.from('ingredients').insert({
      user_id: userId,
      name: newName.trim(),
      kcal_per_100g: kcal,
      protein_per_100g: newProtein ? parseFloat(newProtein) : null,
      fat_per_100g: newFat ? parseFloat(newFat) : null,
      carb_per_100g: newCarb ? parseFloat(newCarb) : null,
    }).select('*').single()
    if (data) {
      setIngredients(prev => [...prev, data as Ingredient].sort((a, b) => a.name.localeCompare(b.name)))
      setSelected(data as Ingredient)
      setCreating(false)
      setNewName(''); setNewKcal(''); setNewProtein(''); setNewFat(''); setNewCarb('')
    }
  }

  async function deleteIngredient(id: string) {
    setIngredients(prev => prev.filter(i => i.id !== id))
    await supabase.from('ingredients').delete().eq('id', id)
  }

  const filtered = ingredients.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
  const amount = parseFloat(amountStr) || 0

  function confirmSelection() {
    if (!selected || amount <= 0) return
    onSelect({
      ingredient_id: selected.id,
      ingredient_name: selected.name,
      amount_g: amount,
      kcal: Math.round((selected.kcal_per_100g / 100) * amount),
      protein_g: scale(selected.protein_per_100g, amount),
      fat_g: scale(selected.fat_per_100g, amount),
      carb_g: scale(selected.carb_per_100g, amount),
    })
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={KAV_BEHAVIOR}>

          {/* Header */}
          <View style={s.header}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={C.text2} />
            </Pressable>
            <Text style={s.title}>
              {creating ? 'New ingredient' : selected ? 'Set amount' : 'Ingredient library'}
            </Text>
            <Pressable onPress={() => { setCreating(true); setSelected(null) }} hitSlop={12}>
              <Ionicons name="add" size={24} color={C.accent} />
            </Pressable>
          </View>

          {creating ? (
            /* ── Create new ingredient ── */
            <ScrollView style={{ flex: 1 }} contentContainerStyle={s.createForm} keyboardShouldPersistTaps="handled">
              <Text style={s.createNote}>Values per 100g</Text>
              {[
                { label: 'Name', value: newName, set: setNewName, numeric: false },
                { label: 'Kcal per 100g', value: newKcal, set: setNewKcal, numeric: true },
                { label: 'Protein (g)', value: newProtein, set: setNewProtein, numeric: true },
                { label: 'Fat (g)', value: newFat, set: setNewFat, numeric: true },
                { label: 'Carbs (g)', value: newCarb, set: setNewCarb, numeric: true },
              ].map(f => (
                <View key={f.label} style={s.formRow}>
                  <Text style={s.formLabel}>{f.label}</Text>
                  <TextInput
                    style={s.formInput}
                    value={f.value}
                    onChangeText={f.set}
                    keyboardType={f.numeric ? 'decimal-pad' : 'default'}
                    placeholderTextColor={C.text3}
                    placeholder={f.numeric ? '0' : ''}
                  />
                </View>
              ))}
              <View style={s.createBtns}>
                <Pressable style={s.cancelBtn} onPress={() => setCreating(false)}>
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable style={[s.saveBtn, (!newName.trim() || !newKcal) && s.saveBtnDisabled]} onPress={saveNewIngredient} disabled={!newName.trim() || !newKcal}>
                  <Text style={s.saveBtnText}>Save ingredient</Text>
                </Pressable>
              </View>
            </ScrollView>

          ) : selected ? (
            /* ── Amount selector ── */
            <View style={{ flex: 1, padding: 24, gap: 16 }}>
              <View style={s.selectedHeader}>
                <Pressable onPress={() => setSelected(null)} hitSlop={8}>
                  <Ionicons name="arrow-back" size={20} color={C.text2} />
                </Pressable>
                <Text style={s.selectedName}>{selected.name}</Text>
              </View>
              <Text style={s.baseNote}>Per 100g: {selected.kcal_per_100g} kcal
                {selected.protein_per_100g != null ? ` · ${selected.protein_per_100g}g protein` : ''}
                {selected.fat_per_100g != null ? ` · ${selected.fat_per_100g}g fat` : ''}
                {selected.carb_per_100g != null ? ` · ${selected.carb_per_100g}g carbs` : ''}
              </Text>
              <View style={s.amountRow}>
                <TextInput
                  style={s.amountInput}
                  value={amountStr}
                  onChangeText={setAmountStr}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  placeholderTextColor={C.text3}
                />
                <Text style={s.amountUnit}>g</Text>
              </View>
              {amount > 0 && (
                <View style={s.previewCard}>
                  <Text style={s.previewKcal}>{Math.round((selected.kcal_per_100g / 100) * amount)} kcal</Text>
                  <View style={s.previewMacros}>
                    {selected.protein_per_100g != null && <Text style={s.previewMacro}>P {scale(selected.protein_per_100g, amount)}g</Text>}
                    {selected.fat_per_100g != null && <Text style={s.previewMacro}>F {scale(selected.fat_per_100g, amount)}g</Text>}
                    {selected.carb_per_100g != null && <Text style={s.previewMacro}>C {scale(selected.carb_per_100g, amount)}g</Text>}
                  </View>
                </View>
              )}
              <Pressable style={[s.saveBtn, amount <= 0 && s.saveBtnDisabled]} onPress={confirmSelection} disabled={amount <= 0}>
                <Text style={s.saveBtnText}>Add to preset</Text>
              </Pressable>
            </View>

          ) : (
            /* ── Ingredient list ── */
            <>
              <View style={s.searchRow}>
                <Ionicons name="search-outline" size={16} color={C.text3} style={{ marginLeft: 12 }} />
                <TextInput
                  style={s.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search ingredients..."
                  placeholderTextColor={C.text3}
                />
              </View>
              {filtered.length === 0 ? (
                <View style={s.emptyState}>
                  <Ionicons name="nutrition-outline" size={36} color={C.text3} />
                  <Text style={s.emptyText}>No ingredients yet</Text>
                  <Text style={s.emptyNote2}>Tap + to add your first ingredient</Text>
                </View>
              ) : (
                <FlatList
                  data={filtered}
                  keyExtractor={i => i.id}
                  contentContainerStyle={{ paddingBottom: 32 }}
                  renderItem={({ item }) => (
                    <Pressable style={s.ingredientRow} onPress={() => { setSelected(item); setAmountStr('100') }}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.ingredientName}>{item.name}</Text>
                        <Text style={s.ingredientMeta}>
                          {item.kcal_per_100g} kcal/100g
                          {item.protein_per_100g != null ? ` · P ${item.protein_per_100g}g` : ''}
                          {item.fat_per_100g != null ? ` · F ${item.fat_per_100g}g` : ''}
                          {item.carb_per_100g != null ? ` · C ${item.carb_per_100g}g` : ''}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => deleteIngredient(item.id)}
                        hitSlop={10}
                        style={s.deleteBtn}
                      >
                        <Ionicons name="trash-outline" size={16} color={C.text3} />
                      </Pressable>
                      <Ionicons name="chevron-forward" size={16} color={C.text3} />
                    </Pressable>
                  )}
                />
              )}
            </>
          )}

        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

const s = StyleSheet.create({
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  title:          { fontSize: 17, fontWeight: '700', color: C.text1 },
  searchRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 16, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  searchInput:    { flex: 1, padding: 12, fontSize: 15, color: C.text1 },
  ingredientRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  ingredientName: { fontSize: 15, fontWeight: '600', color: C.text1, marginBottom: 2 },
  ingredientMeta: { fontSize: 12, color: C.text3 },
  deleteBtn:      { padding: 6 },
  emptyState:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40 },
  emptyText:      { fontSize: 17, fontWeight: '600', color: C.text2 },
  emptyNote2:     { fontSize: 13, color: C.text3 },
  createForm:     { padding: 24, gap: 16 },
  createNote:     { fontSize: 13, color: C.text3, marginBottom: 4 },
  formRow:        { gap: 6 },
  formLabel:      { fontSize: 13, fontWeight: '600', color: C.text2 },
  formInput:      { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, fontSize: 16, color: C.text1 },
  createBtns:     { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn:      { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  cancelBtnText:  { fontSize: 15, color: C.text2, fontWeight: '600' },
  saveBtn:        { flex: 1, padding: 14, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center' },
  saveBtnDisabled:{ opacity: 0.4 },
  saveBtnText:    { fontSize: 15, color: C.white, fontWeight: '700' },
  selectedHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectedName:   { fontSize: 18, fontWeight: '700', color: C.text1 },
  baseNote:       { fontSize: 13, color: C.text3 },
  amountRow:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  amountInput:    { flex: 1, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, fontSize: 28, fontWeight: '700', color: C.text1, textAlign: 'center' },
  amountUnit:     { fontSize: 20, color: C.text2, fontWeight: '600' },
  previewCard:    { backgroundColor: C.surface, borderRadius: 14, padding: 16, alignItems: 'center', gap: 6 },
  previewKcal:    { fontSize: 28, fontWeight: '800', color: C.text1 },
  previewMacros:  { flexDirection: 'row', gap: 12 },
  previewMacro:   { fontSize: 13, color: C.text3 },
})
