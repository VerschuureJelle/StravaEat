import { useState, useEffect, useRef } from 'react'
import {
  Modal, View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { W as C } from '../lib/themeWarm'
import { COMMON_FOOD_CATEGORIES } from '../lib/commonFoods'

export type FoodPickResult = {
  name: string
  amount_label: string | null
  kcal: number
  protein_g: number | null
  fat_g: number | null
  carb_g: number | null
}

interface CustomFood {
  id: string; name: string; kcal: number
  protein_g: number | null; fat_g: number | null; carb_g: number | null
  category: string | null
}

interface ScannedProduct {
  name: string
  kcalPer100: number
  proteinPer100: number | null
  fatPer100: number | null
  carbPer100: number | null
}

interface Props {
  visible: boolean
  userId: string
  onSelect: (food: FoodPickResult) => void
  onClose: () => void
}

interface PendingItem {
  name: string
  kcalBase: number
  proteinBase: number | null
  fatBase: number | null
  carbBase: number | null
  baseAmount: number
  unit: string
}

function parseBaseAmount(name: string): { amount: number; unit: string } {
  const m = name.match(/\((\d+(?:\.\d+)?)\s*(g|ml|kg|l)\b/i)
  if (m) return { amount: parseFloat(m[1]), unit: m[2].toLowerCase() }
  return { amount: 1, unit: 'serving' }
}

const FOOD_CATEGORIES = ['Fruit', 'Drinks', 'Bread & Grains', 'Dairy & Eggs', 'Meat & Fish',
  'Vegetables', 'Snacks & Sweets', 'Fats & Oils', 'Other']

export default function FoodPickerModal({ visible, userId, onSelect, onClose }: Props) {
  const [mode, setMode] = useState<'browse' | 'scan'>('browse')
  const [search, setSearch] = useState('')
  const [customFoods, setCustomFoods] = useState<CustomFood[]>([])
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [loadingFoods, setLoadingFoods] = useState(false)

  // Pending browse selection (quantity step)
  const [pendingItem, setPendingItem] = useState<PendingItem | null>(null)
  const [pendingAmountStr, setPendingAmountStr] = useState('')

  // Scan state
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [scanLoading, setScanLoading] = useState(false)
  const [scanned, setScanned] = useState<ScannedProduct | null>(null)
  const [scanAmount, setScanAmount] = useState('')
  const [saveToMyFoods, setSaveToMyFoods] = useState(false)
  const [saveCategory, setSaveCategory] = useState<string | null>(null)
  const [showCatPicker, setShowCatPicker] = useState(false)
  const lastScannedRef = useRef<string | null>(null)

  useEffect(() => {
    if (visible) {
      loadCustomFoods()
      setMode('browse')
      setSearch('')
      setScanned(null)
      setScanAmount('')
      setSaveToMyFoods(false)
      setSaveCategory(null)
      setShowCatPicker(false)
      setPendingItem(null)
      lastScannedRef.current = null
    }
  }, [visible])

  async function loadCustomFoods() {
    setLoadingFoods(true)
    const { data } = await supabase.from('custom_foods').select('id, name, kcal, protein_g, fat_g, carb_g, category').eq('user_id', userId).order('name')
    setCustomFoods(data ?? [])
    setLoadingFoods(false)
  }

  async function handleBarcodeScan({ data }: { data: string }) {
    if (lastScannedRef.current === data) return
    lastScannedRef.current = data
    setScanLoading(true)
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v3/product/${data}.json`)
      const json = await res.json()
      const p = json.product
      if (!p) {
        Alert.alert('Not found', 'Product not found in Open Food Facts.')
        lastScannedRef.current = null
        return
      }
      const kcal = p.nutriments?.['energy-kcal_100g'] ?? p.nutriments?.['energy-kcal'] ?? null
      if (!kcal) {
        Alert.alert('No data', 'This product has no calorie data.')
        lastScannedRef.current = null
        return
      }
      setScanned({
        name: p.product_name ?? p.abbreviated_product_name ?? 'Unknown product',
        kcalPer100: Math.round(kcal),
        proteinPer100: p.nutriments?.proteins_100g != null ? Math.round(p.nutriments.proteins_100g * 10) / 10 : null,
        fatPer100: p.nutriments?.fat_100g != null ? Math.round(p.nutriments.fat_100g * 10) / 10 : null,
        carbPer100: p.nutriments?.carbohydrates_100g != null ? Math.round(p.nutriments.carbohydrates_100g * 10) / 10 : null,
      })
    } catch {
      Alert.alert('Error', 'Could not fetch product data.')
      lastScannedRef.current = null
    } finally {
      setScanLoading(false)
    }
  }

  function computedFromScan() {
    if (!scanned) return null
    const g = parseFloat(scanAmount)
    if (isNaN(g) || g <= 0) return null
    const ratio = g / 100
    return {
      kcal: Math.round(scanned.kcalPer100 * ratio),
      protein_g: scanned.proteinPer100 != null ? Math.round(scanned.proteinPer100 * ratio * 10) / 10 : null,
      fat_g: scanned.fatPer100 != null ? Math.round(scanned.fatPer100 * ratio * 10) / 10 : null,
      carb_g: scanned.carbPer100 != null ? Math.round(scanned.carbPer100 * ratio * 10) / 10 : null,
    }
  }

  async function applyScan() {
    const c = computedFromScan()
    if (!c || !scanned) return
    if (saveToMyFoods) {
      await supabase.from('custom_foods').insert({
        user_id: userId,
        name: scanned.name,
        kcal: scanned.kcalPer100,
        protein_g: scanned.proteinPer100,
        fat_g: scanned.fatPer100,
        carb_g: scanned.carbPer100,
        category: saveCategory,
      })
      loadCustomFoods()
    }
    onSelect({
      name: scanned.name,
      amount_label: `${scanAmount}g`,
      ...c,
    })
  }

  function openPending(item: { name: string; kcal: number; protein_g?: number | null; fat_g?: number | null; carb_g?: number | null }) {
    const { amount, unit } = parseBaseAmount(item.name)
    setPendingItem({
      name: item.name,
      kcalBase: item.kcal,
      proteinBase: item.protein_g ?? null,
      fatBase: item.fat_g ?? null,
      carbBase: item.carb_g ?? null,
      baseAmount: amount,
      unit,
    })
    setPendingAmountStr(String(amount))
  }

  function computedFromPending() {
    if (!pendingItem) return null
    const amt = parseFloat(pendingAmountStr)
    if (isNaN(amt) || amt <= 0) return null
    const ratio = pendingItem.unit === 'serving' ? amt : amt / pendingItem.baseAmount
    return {
      kcal: Math.round(pendingItem.kcalBase * ratio),
      protein_g: pendingItem.proteinBase != null ? Math.round(pendingItem.proteinBase * ratio * 10) / 10 : null,
      fat_g: pendingItem.fatBase != null ? Math.round(pendingItem.fatBase * ratio * 10) / 10 : null,
      carb_g: pendingItem.carbBase != null ? Math.round(pendingItem.carbBase * ratio * 10) / 10 : null,
    }
  }

  function confirmPending() {
    const c = computedFromPending()
    if (!c || !pendingItem) return
    const amt = parseFloat(pendingAmountStr)
    onSelect({
      name: pendingItem.name,
      amount_label: pendingItem.unit === 'serving'
        ? (amt === 1 ? '1 serving' : `${amt}×`)
        : `${pendingAmountStr}${pendingItem.unit}`,
      ...c,
    })
    setPendingItem(null)
  }

  const q = search.toLowerCase()
  const uncategorizedCustom = customFoods.filter(f => !f.category && (!q || f.name.toLowerCase().includes(q)))

  // Merge custom foods with category into common food categories
  const allCategories: { category: string; items: { name: string; kcal: number; protein_g?: number | null; fat_g?: number | null; carb_g?: number | null; isCustom?: boolean }[]; hasCustom?: boolean }[] =
    COMMON_FOOD_CATEGORIES.map(cat => {
      const custom = customFoods.filter(f => f.category === cat.category && (!q || f.name.toLowerCase().includes(q)))
      const common = cat.items.filter(it => !q || it.name.toLowerCase().includes(q))
      return { ...cat, items: [...custom.map(c => ({ ...c, isCustom: true })), ...common], hasCustom: custom.length > 0 }
    }).filter(cat => cat.items.length > 0)

  // Custom foods in categories not in COMMON_FOOD_CATEGORIES
  const knownCats = new Set(COMMON_FOOD_CATEGORIES.map(c => c.category))
  const extraCats = [...new Set(customFoods.filter(f => f.category && !knownCats.has(f.category)).map(f => f.category!))]
  for (const cat of extraCats) {
    const items = customFoods.filter(f => f.category === cat && (!q || f.name.toLowerCase().includes(q)))
    if (items.length > 0) allCategories.unshift({ category: cat, items: items.map(c => ({ ...c, isCustom: true })), hasCustom: true })
  }

  const computed = computedFromScan()

  if (!visible) return null

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={fp.container}>
        {/* Header */}
        <View style={fp.header}>
          <View style={fp.modeTabs}>
            <Pressable
              style={[fp.modeTab, mode === 'browse' && fp.modeTabActive]}
              onPress={() => { setMode('browse'); setScanned(null); lastScannedRef.current = null }}
            >
              <Ionicons name="search-outline" size={14} color={mode === 'browse' ? C.accent : C.text2} />
              <Text style={[fp.modeTabText, mode === 'browse' && fp.modeTabTextActive]}>Browse</Text>
            </Pressable>
            <Pressable
              style={[fp.modeTab, mode === 'scan' && fp.modeTabActive]}
              onPress={async () => {
                if (!cameraPermission?.granted) await requestCameraPermission()
                setMode('scan')
              }}
            >
              <Ionicons name="barcode-outline" size={14} color={mode === 'scan' ? C.accent : C.text2} />
              <Text style={[fp.modeTabText, mode === 'scan' && fp.modeTabTextActive]}>Scan</Text>
            </Pressable>
          </View>
          <Pressable onPress={onClose} hitSlop={12} style={fp.closeBtn}>
            <Ionicons name="close" size={22} color={C.text1} />
          </Pressable>
        </View>

        {/* BROWSE MODE */}
        {mode === 'browse' && (
          <>
            <View style={fp.searchRow}>
              <Ionicons name="search-outline" size={16} color={C.text3} style={{ marginRight: 8 }} />
              <TextInput
                style={fp.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Search foods…"
                placeholderTextColor={C.text3}
                autoCapitalize="none"
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={C.text3} />
                </Pressable>
              )}
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
              {/* Uncategorized My Foods */}
              {(uncategorizedCustom.length > 0 || (!q && customFoods.filter(f => !f.category).length === 0 && customFoods.length === 0)) && (
                <View style={fp.section}>
                  <Text style={fp.sectionTitle}>My Foods</Text>
                  {loadingFoods && <ActivityIndicator color={C.accent} style={{ marginVertical: 8 }} />}
                  {!loadingFoods && customFoods.length === 0 && (
                    <Text style={fp.emptyNote}>No saved foods yet. Save items via the barcode scanner.</Text>
                  )}
                  {uncategorizedCustom.map(food => (
                    <Pressable key={food.id} style={fp.foodRow} onPress={() => openPending(food)}>
                      <View style={{ flex: 1 }}>
                        <Text style={fp.foodName}>{food.name}</Text>
                        <Text style={fp.foodMeta}>
                          {food.kcal} kcal
                          {food.protein_g != null ? ` · P ${food.protein_g}g` : ''}
                          {food.fat_g != null ? ` · F ${food.fat_g}g` : ''}
                          {food.carb_g != null ? ` · C ${food.carb_g}g` : ''}
                        </Text>
                      </View>
                      <Ionicons name="add-circle-outline" size={20} color={C.accent} />
                    </Pressable>
                  ))}
                </View>
              )}

              {/* Categories (common foods + categorized custom foods merged) */}
              <View style={fp.section}>
                <Text style={fp.sectionTitle}>Browse by category</Text>
                {allCategories.map(cat => {
                  const isOpen = expandedCategories.has(cat.category) || !!q
                  return (
                    <View key={cat.category}>
                      {!q && (
                        <Pressable
                          style={fp.catHeader}
                          onPress={() => setExpandedCategories(prev => {
                            const next = new Set(prev)
                            isOpen ? next.delete(cat.category) : next.add(cat.category)
                            return next
                          })}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={fp.catLabel}>{cat.category}</Text>
                            {cat.hasCustom && <View style={fp.catDot} />}
                          </View>
                          <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color={C.text3} />
                        </Pressable>
                      )}
                      {isOpen && cat.items.map((item, i) => (
                        <Pressable
                          key={i}
                          style={[fp.foodRow, i < cat.items.length - 1 && fp.foodRowBorder]}
                          onPress={() => openPending(item)}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={fp.foodName}>{item.name}{(item as any).isCustom ? ' ★' : ''}</Text>
                            <Text style={fp.foodMeta}>
                              {item.kcal} kcal
                              {item.protein_g != null ? ` · P ${item.protein_g}g` : ''}
                              {item.fat_g != null ? ` · F ${item.fat_g}g` : ''}
                              {item.carb_g != null ? ` · C ${item.carb_g}g` : ''}
                            </Text>
                          </View>
                          <Ionicons name="add-circle-outline" size={20} color={C.accent} />
                        </Pressable>
                      ))}
                    </View>
                  )
                })}
              </View>
            </ScrollView>
          </>
        )}

        {/* SCAN MODE */}
        {mode === 'scan' && (
          <View style={{ flex: 1 }}>
            {!cameraPermission?.granted ? (
              <View style={fp.permBox}>
                <Ionicons name="camera-outline" size={48} color={C.text3} />
                <Text style={fp.permText}>Camera access is needed to scan barcodes.</Text>
                <Pressable style={fp.permBtn} onPress={requestCameraPermission}>
                  <Text style={fp.permBtnText}>Grant camera access</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <CameraView
                  style={StyleSheet.absoluteFillObject}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'qr'] }}
                  onBarcodeScanned={!scanLoading && !scanned ? handleBarcodeScan : undefined}
                />
                {/* Scan frame overlay */}
                <View style={fp.scanOverlay} pointerEvents="none">
                  <View style={fp.scanFrame} />
                </View>

                {/* Bottom sheet lifted by keyboard */}
                <KeyboardAvoidingView style={fp.scanKav} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                <View style={fp.scanSheet}>
                  {scanLoading && (
                    <View style={fp.scanSheetCenter}>
                      <ActivityIndicator color={C.accent} size="large" />
                      <Text style={fp.scanHint}>Looking up product…</Text>
                    </View>
                  )}
                  {!scanLoading && !scanned && (
                    <View style={fp.scanSheetCenter}>
                      <Ionicons name="barcode-outline" size={32} color={C.text3} />
                      <Text style={fp.scanHint}>Point the camera at a barcode</Text>
                    </View>
                  )}
                  {!scanLoading && scanned && (
                    <View>
                      <Text style={fp.scanProductName} numberOfLines={2}>{scanned.name}</Text>
                      <Text style={fp.scanPer100}>per 100g: {scanned.kcalPer100} kcal
                        {scanned.proteinPer100 != null ? ` · P ${scanned.proteinPer100}g` : ''}
                        {scanned.fatPer100 != null ? ` · F ${scanned.fatPer100}g` : ''}
                        {scanned.carbPer100 != null ? ` · C ${scanned.carbPer100}g` : ''}
                      </Text>

                      <View style={fp.amountRow}>
                        <Text style={fp.amountLabel}>Amount (g)</Text>
                        <TextInput
                          style={fp.amountInput}
                          value={scanAmount}
                          onChangeText={setScanAmount}
                          keyboardType="decimal-pad"
                          returnKeyType="done"
                          placeholder="e.g. 30"
                          placeholderTextColor={C.text3}
                          autoFocus
                        />
                        {computed
                          ? <Text style={fp.amountComputed}>= {computed.kcal} kcal</Text>
                          : <Text style={fp.amountHint}>Enter amount</Text>
                        }
                      </View>

                      <Pressable
                        style={fp.saveToggle}
                        onPress={() => { setSaveToMyFoods(v => !v); setShowCatPicker(false); setSaveCategory(null) }}
                      >
                        <View style={[fp.checkbox, saveToMyFoods && fp.checkboxChecked]}>
                          {saveToMyFoods && <Ionicons name="checkmark" size={12} color={C.white} />}
                        </View>
                        <Text style={fp.saveToggleText}>Save to My Foods</Text>
                      </Pressable>

                      {saveToMyFoods && (
                        <View style={fp.catPickerRow}>
                          <Text style={fp.catPickerLabel}>Category (optional)</Text>
                          <View style={fp.catChipsRow}>
                            {FOOD_CATEGORIES.map(cat => (
                              <Pressable
                                key={cat}
                                style={[fp.catChip, saveCategory === cat && fp.catChipActive]}
                                onPress={() => setSaveCategory(prev => prev === cat ? null : cat)}
                              >
                                <Text style={[fp.catChipText, saveCategory === cat && fp.catChipTextActive]}>{cat}</Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      )}

                      <View style={fp.scanBtns}>
                        <Pressable
                          style={fp.retryBtn}
                          onPress={() => { setScanned(null); lastScannedRef.current = null }}
                        >
                          <Ionicons name="refresh-outline" size={16} color={C.text2} />
                          <Text style={fp.retryText}>Scan again</Text>
                        </Pressable>
                        <Pressable
                          style={[fp.applyBtn, !computed && { opacity: 0.4 }]}
                          onPress={applyScan}
                          disabled={!computed}
                        >
                          <Ionicons name="add-circle-outline" size={16} color={C.white} />
                          <Text style={fp.applyText}>Add ingredient</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                </View>
                </KeyboardAvoidingView>
              </>
            )}
          </View>
        )}
      {/* Quantity step overlay */}
      {pendingItem && (() => {
        const c = computedFromPending()
        const isServing = pendingItem.unit === 'serving'
        return (
          <KeyboardAvoidingView style={fp.pendingOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <Pressable style={fp.pendingBackdrop} onPress={() => setPendingItem(null)} />
            <View style={fp.pendingSheet}>
              <Text style={fp.pendingName} numberOfLines={2}>{pendingItem.name}</Text>
              <Text style={fp.pendingBase}>
                Base: {pendingItem.baseAmount}{isServing ? ' serving' : pendingItem.unit} = {pendingItem.kcalBase} kcal
                {pendingItem.proteinBase != null ? ` · P ${pendingItem.proteinBase}g` : ''}
                {pendingItem.fatBase != null ? ` · F ${pendingItem.fatBase}g` : ''}
                {pendingItem.carbBase != null ? ` · C ${pendingItem.carbBase}g` : ''}
              </Text>

              <View style={fp.pendingAmountRow}>
                <Text style={fp.amountLabel}>
                  {isServing ? 'Servings' : `Amount (${pendingItem.unit})`}
                </Text>
                <TextInput
                  style={fp.amountInput}
                  value={pendingAmountStr}
                  onChangeText={setPendingAmountStr}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  autoFocus
                />
                {c && (
                  <Text style={fp.amountComputed}>= {c.kcal} kcal</Text>
                )}
              </View>

              <View style={fp.scanBtns}>
                <Pressable style={fp.retryBtn} onPress={() => setPendingItem(null)}>
                  <Ionicons name="arrow-back-outline" size={16} color={C.text2} />
                  <Text style={fp.retryText}>Back</Text>
                </Pressable>
                <Pressable
                  style={[fp.applyBtn, !c && { opacity: 0.4 }]}
                  onPress={confirmPending}
                  disabled={!c}
                >
                  <Ionicons name="add-circle-outline" size={16} color={C.white} />
                  <Text style={fp.applyText}>Add ingredient</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        )
      })()}
      </View>
    </Modal>
  )
}

const fp = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  modeTabs: {
    flexDirection: 'row', backgroundColor: C.surface2,
    borderRadius: 10, padding: 3, gap: 2,
  },
  modeTab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  modeTabActive: { backgroundColor: C.accent },
  modeTabText: { fontSize: 13, fontWeight: '700', color: C.text2 },
  modeTabTextActive: { color: C.white },
  closeBtn: { padding: 4 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface2, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    margin: 12, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 15, color: C.text1 },
  section: { paddingHorizontal: 16, marginBottom: 8 },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: C.text2, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  emptyNote: { fontSize: 13, color: C.text3, marginBottom: 8 },
  catHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  catLabel: { fontSize: 14, fontWeight: '700', color: C.text1 },
  foodRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10,
  },
  foodRowBorder: { borderBottomWidth: 1, borderBottomColor: C.divider },
  foodName: { fontSize: 14, color: C.text1 },
  foodMeta: { fontSize: 12, color: C.text3, marginTop: 1 },
  // Scan
  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  permText: { fontSize: 15, color: C.text2, textAlign: 'center', lineHeight: 22 },
  permBtn: { backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  permBtnText: { fontSize: 14, fontWeight: '700', color: C.white },
  scanOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanFrame: {
    width: 240, height: 160, borderRadius: 16,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)',
  },
  scanKav: { justifyContent: 'flex-end' },
  scanSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 48, minHeight: 140,
  },
  scanSheetCenter: { alignItems: 'center', gap: 10, paddingVertical: 16 },
  scanHint: { fontSize: 14, color: C.text3 },
  scanProductName: { fontSize: 16, fontWeight: '800', color: C.text1, marginBottom: 4 },
  scanPer100: { fontSize: 12, color: C.text3, marginBottom: 12 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  amountLabel: { fontSize: 14, color: C.text2, fontWeight: '600' },
  amountInput: {
    backgroundColor: C.surface2, borderRadius: 8, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, fontWeight: '700', color: C.text1,
    minWidth: 72, textAlign: 'center',
  },
  amountComputed: { fontSize: 14, fontWeight: '700', color: C.accent },
  amountHint: { fontSize: 13, color: C.text3, fontStyle: 'italic' },
  saveToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: C.accent, borderColor: C.accent },
  saveToggleText: { fontSize: 14, color: C.text2 },
  scanBtns: { flexDirection: 'row', gap: 10 },
  retryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border,
  },
  retryText: { fontSize: 14, fontWeight: '600', color: C.text2 },
  applyBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 10, backgroundColor: C.accent,
  },
  applyText: { fontSize: 14, fontWeight: '700', color: C.white },
  // Pending quantity overlay
  pendingOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  pendingBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  pendingSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48, gap: 12,
  },
  pendingName: { fontSize: 17, fontWeight: '800', color: C.text1 },
  pendingBase: { fontSize: 12, color: C.text3, lineHeight: 18 },
  pendingAmountRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  catDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent },
  catPickerRow: { gap: 4, marginBottom: 4 },
  catPickerLabel: { fontSize: 11, color: C.text3, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  catChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
  },
  catChipActive: { backgroundColor: C.accent, borderColor: C.accent },
  catChipText: { fontSize: 12, fontWeight: '600', color: C.text2 },
  catChipTextActive: { color: C.white },
})
