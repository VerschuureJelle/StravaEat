import { useEffect, useRef, useState } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView, Image,
  StyleSheet, Alert, Switch, Modal, InputAccessoryView, Keyboard, Platform, KeyboardAvoidingView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Linking from 'expo-linking'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../../lib/supabase'
import { initiateStravaOAuth } from '../../lib/stravaAuth'
import { useAppMode } from '../../contexts/AppModeContext'
import { W as C } from '../../lib/themeWarm'
import { AppDrawer, HamburgerBtn } from '../../components/DrawerNav'
import { SEVERITY_LABELS, SEVERITY_DESCRIPTIONS } from '../../lib/periodConfig'
import type { UserProfile, HeartRateZone, MealTemplate, MealPreset, MealPresetItem, UserSport, PeriodSeverity } from '../../types'
import FoodPickerModal from '../../components/FoodPickerModal'

const COMMON_SPORTS = [
  'Run', 'Ride', 'Swim', 'Walk', 'Strength Training',
  'Yoga', 'Rowing', 'Hiking', 'Nordic Ski', 'Kayaking',
]

const MEAL_DEFAULTS: { name: string; time: string }[] = [
  { name: 'Breakfast', time: '07:00' },
  { name: 'Morning snack', time: '10:00' },
  { name: 'Lunch', time: '12:30' },
  { name: 'Afternoon snack', time: '15:30' },
  { name: 'Dinner', time: '18:30' },
  { name: 'Evening snack', time: '20:30' },
  { name: 'Late snack', time: '21:30' },
  { name: 'Snack', time: '12:00' },
]

type SettingsTab = 'profile' | 'zones' | 'meals' | 'fueling'
type SportMode = 'standard' | 'custom' | 'linked'
interface SportConfig { mode: SportMode; linkedTo: string | null }
interface DraftMeal {
  meal_index: number; name: string; scheduled_time: string
  kcal: number | null; protein_g: number | null; fat_g: number | null; carb_g: number | null
}
interface FuelingConfig { threshold_min: number; carbs_per_interval_g: number; interval_min: number }
interface DraftItem {
  name: string
  amount: string       // numeric only, e.g. "100"
  unit: string         // e.g. "g", "ml", "×"
  kcal: string
  protein: string
  fat: string
  carb: string
  // Per-unit rates for auto-scaling (set from food picker or derived from stored data)
  kcalPerUnit: number | null
  proteinPerUnit: number | null
  fatPerUnit: number | null
  carbPerUnit: number | null
}

function normalizeType(type: string): string {
  if (type === 'VirtualRide') return 'Ride'
  if (type === 'VirtualRun') return 'Run'
  return type
}

export default function SettingsScreen() {
  const router = useRouter()
  const { mode, setMode } = useAppMode()
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')
  const [userId, setUserId] = useState<string | null>(null)

  // Profile
  const [savedProfile, setSavedProfile] = useState<Partial<UserProfile>>({})
  const [editedProfile, setEditedProfile] = useState<Partial<UserProfile>>({})
  const [savingProfile, setSavingProfile] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)

  // Zones
  const [zones, setZones] = useState<HeartRateZone[]>([])
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)

  // Sport energy (based on actual activity types from Strava)
  const [activitySports, setActivitySports] = useState<string[]>([])
  const [sportConfigs, setSportConfigs] = useState<Record<string, SportConfig>>({})
  const [savingConfig, setSavingConfig] = useState<string | null>(null)

  // Planner sports
  const [userSports, setUserSports] = useState<UserSport[]>([])
  const [newSportInput, setNewSportInput] = useState('')

  // Meal plan
  const [draftMeals, setDraftMeals] = useState<DraftMeal[]>([
    { meal_index: 0, name: 'Breakfast', scheduled_time: '07:00', kcal: null, protein_g: null, fat_g: null, carb_g: null },
  ])
  const [savingMeals, setSavingMeals] = useState(false)
  const [timePickerMealIdx, setTimePickerMealIdx] = useState<number | null>(null)

  // Meal presets (global)
  const [allPresets, setAllPresets] = useState<MealPreset[]>([])
  const [presetLinks, setPresetLinks] = useState<Record<number, string[]>>({})  // meal_index → preset_id[]
  const [presetDraft, setPresetDraft] = useState<{ id?: string; autoLinkMealIndex?: number; name: string; items: DraftItem[] } | null>(null)
  const [linkPickerMeal, setLinkPickerMeal] = useState<number | null>(null)
  const [foodPickerTargetIdx, setFoodPickerTargetIdx] = useState<number | null>(null)
  const [expandedPresets, setExpandedPresets] = useState<Set<string>>(new Set())

  function togglePreset(id: string) {
    setExpandedPresets(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Fueling
  const [fuelingConfigs, setFuelingConfigs] = useState<Record<string, FuelingConfig>>({})
  const [draftFueling, setDraftFueling] = useState<Record<string, FuelingConfig>>({})
  const [savingFueling, setSavingFueling] = useState<string | null>(null)

  // Period tracking
  const [onPeriod, setOnPeriod] = useState(false)
  const [periodSeverity, setPeriodSeverity] = useState<PeriodSeverity>('minor')

  // Display preferences
  const [hideCalories, setHideCalories] = useState(false)

  const isDirty = JSON.stringify(editedProfile) !== JSON.stringify(savedProfile)

  useEffect(() => {
    load()
    const sub = Linking.addEventListener('url', handleStravaDeepLink)
    return () => sub.remove()
  }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)

    const [profileRes, zonesRes, activitiesRes, settingsRes, mealRes, userSportsRes, fuelingRes, presetsRes, slotPresetsRes] = await Promise.all([
      supabase.from('users').select('*').eq('id', user.id).single(),
      supabase.from('heart_rate_zones').select('*').eq('user_id', user.id).order('zone_number'),
      supabase.from('activities').select('type').eq('user_id', user.id),
      supabase.from('sport_energy_settings').select('*').eq('user_id', user.id),
      supabase.from('meal_templates').select('*').eq('user_id', user.id).order('meal_index'),
      supabase.from('user_sports').select('*').eq('user_id', user.id).order('sort_order'),
      supabase.from('fueling_settings').select('sport_type, threshold_min, carbs_per_interval_g, interval_min').eq('user_id', user.id),
      supabase.from('meal_presets').select('*, items:meal_preset_items(*)').eq('user_id', user.id).order('sort_order'),
      supabase.from('meal_slot_presets').select('meal_index, preset_id').eq('user_id', user.id),
    ])

    if (profileRes.data) {
      setSavedProfile(profileRes.data)
      setEditedProfile(profileRes.data)
      setOnPeriod(profileRes.data.on_period ?? false)
      setPeriodSeverity(profileRes.data.period_severity ?? 'minor')
      setHideCalories(profileRes.data.hide_calories ?? false)
    }
    setZones(zonesRes.data ?? [])

    // Merge Strava activity types + planner user sports for energy section
    const sportSet = new Set<string>(
      (activitiesRes.data ?? []).map((a: { type: string }) => a.type).filter(Boolean),
    )
    // Also add user's planner sports (normalized, no Virtual*)
    for (const us of (userSportsRes.data ?? []) as UserSport[]) {
      if (us.sport_name && !us.sport_name.startsWith('Virtual')) {
        sportSet.add(us.sport_name)
      }
    }
    setActivitySports([...sportSet].sort())

    const configs: Record<string, SportConfig> = {}
    for (const s of (settingsRes.data ?? [])) {
      const mode: SportMode = s.linked_sport_type
        ? 'linked'
        : s.method === 'custom' ? 'custom' : 'standard'
      configs[s.sport_type] = { mode, linkedTo: s.linked_sport_type ?? null }
    }
    setSportConfigs(configs)

    // Meal templates
    const meals = (mealRes.data ?? []) as MealTemplate[]
    if (meals.length > 0) {
      setDraftMeals(meals.map(m => ({
        meal_index: m.meal_index, name: m.name, scheduled_time: m.scheduled_time,
        kcal: m.kcal ?? null, protein_g: m.protein_g ?? null, fat_g: m.fat_g ?? null, carb_g: m.carb_g ?? null,
      })))
    }

    // Planner sports — auto-populate from activities (normalized, no Virtual*) if empty
    let sportsList = (userSportsRes.data ?? []) as UserSport[]
    if (sportsList.length === 0 && (activitiesRes.data ?? []).length > 0) {
      const actTypes = [...new Set<string>(
        (activitiesRes.data ?? [])
          .map((a: { type: string }) => normalizeType(a.type))
          .filter((t: string) => t.length > 0 && !t.startsWith('Virtual')),
      )].sort()
      if (actTypes.length > 0) {
        const toInsert = actTypes.map((name, i) => ({ user_id: user.id, sport_name: name, sort_order: i }))
        const { data: inserted } = await supabase.from('user_sports')
          .upsert(toInsert, { onConflict: 'user_id,sport_name' })
          .select()
        sportsList = (inserted ?? []) as UserSport[]
      }
    }
    setUserSports(sportsList)

    const fConfigs: Record<string, FuelingConfig> = {}
    for (const f of (fuelingRes.data ?? [])) {
      fConfigs[f.sport_type] = {
        threshold_min: f.threshold_min,
        carbs_per_interval_g: f.carbs_per_interval_g,
        interval_min: f.interval_min,
      }
    }
    setFuelingConfigs(fConfigs)
    setDraftFueling(fConfigs)

    setAllPresets((presetsRes.data ?? []) as MealPreset[])
    const links: Record<number, string[]> = {}
    for (const row of (slotPresetsRes.data ?? []) as { meal_index: number; preset_id: string }[]) {
      if (!links[row.meal_index]) links[row.meal_index] = []
      links[row.meal_index].push(row.preset_id)
    }
    setPresetLinks(links)
  }

  async function handleStravaDeepLink(event: { url: string }) {
    if (!event.url.startsWith('stravaeat://auth')) return
    const parsed = Linking.parse(event.url)
    if (parsed.queryParams?.linked === 'true') {
      await load()
      Alert.alert('Connected', 'Strava account linked successfully.')
    } else if (parsed.queryParams?.error) {
      Alert.alert('Connection failed', parsed.queryParams.error as string)
    }
  }

  const handleConnectStrava = () => initiateStravaOAuth()

  async function savePeriodState(newOnPeriod: boolean, newSeverity: PeriodSeverity) {
    if (!userId) return
    await supabase.from('users').update({
      on_period: newOnPeriod,
      period_severity: newOnPeriod ? newSeverity : null,
    }).eq('id', userId)
  }

  async function saveProfile() {
    if (!userId || !isDirty) return
    setSavingProfile(true)
    const { error } = await supabase.from('users').update(editedProfile).eq('id', userId)
    setSavingProfile(false)
    if (error) { Alert.alert('Error', error.message); return }
    setSavedProfile(editedProfile)
  }

  async function uploadAvatar() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to upload a profile picture.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    })
    if (result.canceled || !result.assets[0] || !userId) return
    setAvatarUploading(true)
    try {
      const asset = result.assets[0]
      const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg'
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      const path = `${userId}/avatar.${ext}`
      const response = await fetch(asset.uri)
      const blob = await response.blob()
      const arrayBuffer = await blob.arrayBuffer()
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, arrayBuffer, { contentType: mime, upsert: true })
      if (uploadError) throw uploadError
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
      const url = `${publicUrl}?t=${Date.now()}`
      await supabase.from('users').update({ avatar_url: url }).eq('id', userId)
      setEditedProfile(p => ({ ...p, avatar_url: url }))
      setSavedProfile(p => ({ ...p, avatar_url: url }))
    } catch (e: any) {
      Alert.alert('Upload failed', e.message ?? 'Something went wrong.')
    } finally {
      setAvatarUploading(false)
    }
  }

  async function removeAvatar() {
    if (!userId) return
    setAvatarUploading(true)
    try {
      const { data: files } = await supabase.storage.from('avatars').list(userId)
      if (files?.length) {
        await supabase.storage.from('avatars').remove(files.map(f => `${userId}/${f.name}`))
      }
      await supabase.from('users').update({ avatar_url: null }).eq('id', userId)
      setEditedProfile(p => ({ ...p, avatar_url: null }))
      setSavedProfile(p => ({ ...p, avatar_url: null }))
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not remove photo.')
    } finally {
      setAvatarUploading(false)
    }
  }

  async function saveZone(zone: HeartRateZone) {
    const { error } = await supabase.from('heart_rate_zones')
      .update({ name: zone.name, min_bpm: zone.min_bpm, max_bpm: zone.max_bpm })
      .eq('id', zone.id)
    if (error) Alert.alert('Error', error.message)
    else setEditingZoneId(null)
  }

  async function saveSportConfig(sport: string, mode: SportMode, linkedTo: string | null) {
    if (!userId) return
    setSavingConfig(sport)
    const method = mode === 'standard' ? 'standard' : 'custom'
    const linked_sport_type = mode === 'linked' ? linkedTo : null
    const { error } = await supabase.from('sport_energy_settings').upsert(
      { user_id: userId, sport_type: sport, method, linked_sport_type },
      { onConflict: 'user_id,sport_type' },
    )
    setSavingConfig(null)
    if (error) { Alert.alert('Error', error.message); return }
    setSportConfigs(prev => ({ ...prev, [sport]: { mode, linkedTo: linked_sport_type } }))
  }

  async function addPlannerSport(name: string) {
    const trimmed = name.trim()
    if (!userId || !trimmed || userSports.some(s => s.sport_name === trimmed)) return
    const { data, error } = await supabase.from('user_sports').insert({
      user_id: userId,
      sport_name: trimmed,
      sort_order: userSports.length,
    }).select().single()
    if (error) { Alert.alert('Error', error.message); return }
    setUserSports(prev => [...prev, data as UserSport])
    setNewSportInput('')
  }

  async function removePlannerSport(id: string) {
    const sport = userSports.find(s => s.id === id)
    Alert.alert('Remove sport?', `Remove "${sport?.sport_name ?? 'this sport'}" from your planner?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        await supabase.from('user_sports').delete().eq('id', id)
        setUserSports(prev => prev.filter(s => s.id !== id))
      }},
    ])
  }

  async function saveFuelingConfig(sport: string) {
    if (!userId) return
    const config = draftFueling[sport] ?? { threshold_min: 60, carbs_per_interval_g: 30, interval_min: 30 }
    setSavingFueling(sport)
    const { error } = await supabase.from('fueling_settings').upsert(
      { user_id: userId, sport_type: sport, ...config },
      { onConflict: 'user_id,sport_type' },
    )
    setSavingFueling(null)
    if (error) { Alert.alert('Error', error.message); return }
    setFuelingConfigs(prev => ({ ...prev, [sport]: config }))
  }

  async function deleteFuelingConfig(sport: string) {
    if (!userId) return
    Alert.alert('Delete fueling config?', `Remove fueling settings for ${sport}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('fueling_settings').delete().eq('user_id', userId!).eq('sport_type', sport)
        setFuelingConfigs(prev => { const n = { ...prev }; delete n[sport]; return n })
        setDraftFueling(prev => { const n = { ...prev }; delete n[sport]; return n })
      }},
    ])
  }

  function updateDraftFueling(sport: string, field: keyof FuelingConfig, value: number) {
    setDraftFueling(prev => ({
      ...prev,
      [sport]: { ...(prev[sport] ?? { threshold_min: 60, carbs_per_interval_g: 30, interval_min: 30 }), [field]: value },
    }))
  }

  async function saveMeals() {
    if (!userId) return
    setSavingMeals(true)
    const toSave = draftMeals.map((m, i) => ({
      user_id: userId!,
      meal_index: i,
      name: m.name || `Meal ${i + 1}`,
      scheduled_time: m.scheduled_time || '12:00',
      kcal: m.kcal ?? null,
      protein_g: m.protein_g ?? null,
      fat_g: m.fat_g ?? null,
      carb_g: m.carb_g ?? null,
    }))
    await supabase.from('meal_templates').delete().eq('user_id', userId).gte('meal_index', draftMeals.length)
    const { error } = await supabase.from('meal_templates').upsert(toSave, { onConflict: 'user_id,meal_index' })
    setSavingMeals(false)
    if (error) { Alert.alert('Error', error.message); return }
    Alert.alert('Saved', 'Meal plan saved.')
  }

  function addMeal() {
    if (draftMeals.length >= 8) return
    const i = draftMeals.length
    const def = MEAL_DEFAULTS[i] ?? { name: `Meal ${i + 1}`, time: '12:00' }
    setDraftMeals(prev => [...prev, { meal_index: i, name: def.name, scheduled_time: def.time, kcal: null, protein_g: null, fat_g: null, carb_g: null }])
  }

  function removeMeal() {
    if (draftMeals.length <= 1) return
    const last = draftMeals[draftMeals.length - 1]
    Alert.alert('Remove meal?', `Remove "${last.name}" from your meal plan?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => setDraftMeals(prev => prev.slice(0, -1)) },
    ])
  }

  function updateDraftMeal(index: number, field: 'name' | 'scheduled_time', value: string) {
    setDraftMeals(prev => prev.map((m, i) => i === index ? { ...m, [field]: value } : m))
  }

  function updateDraftMealKcal(index: number, value: string) {
    const n = value ? parseInt(value) : null
    setDraftMeals(prev => prev.map((m, i) => i === index ? { ...m, kcal: (n != null && !isNaN(n) && n > 0) ? n : null } : m))
  }

  function updateDraftMealMacro(index: number, field: 'protein_g' | 'fat_g' | 'carb_g', value: string) {
    const n = value ? parseFloat(value) : null
    setDraftMeals(prev => prev.map((m, i) => i === index ? { ...m, [field]: (n != null && !isNaN(n) && n >= 0) ? n : null } : m))
  }

  function emptyDraftItem(): DraftItem {
    return {
      name: '', amount: '', unit: 'g', kcal: '', protein: '', fat: '', carb: '',
      kcalPerUnit: null, proteinPerUnit: null, fatPerUnit: null, carbPerUnit: null,
    }
  }

  function recalcItem(item: DraftItem, newAmount: string): DraftItem {
    const amt = parseFloat(newAmount)
    if (!isNaN(amt) && amt > 0 && item.kcalPerUnit != null) {
      return {
        ...item,
        amount: newAmount,
        kcal: String(Math.round(item.kcalPerUnit * amt)),
        protein: item.proteinPerUnit != null ? String(Math.round(item.proteinPerUnit * amt * 10) / 10) : item.protein,
        fat: item.fatPerUnit != null ? String(Math.round(item.fatPerUnit * amt * 10) / 10) : item.fat,
        carb: item.carbPerUnit != null ? String(Math.round(item.carbPerUnit * amt * 10) / 10) : item.carb,
      }
    }
    return { ...item, amount: newAmount }
  }

  function draftItemTotals(items: DraftItem[]) {
    return items.reduce((acc, it) => ({
      kcal: acc.kcal + (parseInt(it.kcal) || 0),
      protein: acc.protein + (parseFloat(it.protein) || 0),
      fat: acc.fat + (parseFloat(it.fat) || 0),
      carb: acc.carb + (parseFloat(it.carb) || 0),
    }), { kcal: 0, protein: 0, fat: 0, carb: 0 })
  }

  async function savePreset() {
    if (!userId || !presetDraft) return
    if (!presetDraft.name.trim()) {
      Alert.alert('Invalid preset', 'Please enter a preset name.')
      return
    }
    const validItems = presetDraft.items.filter(it => it.name.trim() && parseInt(it.kcal) > 0)
    if (validItems.length === 0) {
      Alert.alert('Invalid preset', 'Add at least one ingredient with a name and calories.')
      return
    }
    const itemRows = (presetId: string) => validItems.map((it, i) => ({
      preset_id: presetId,
      name: it.name.trim(),
      amount_label: it.amount.trim() ? `${it.amount.trim()}${it.unit}` : null,
      kcal: parseInt(it.kcal),
      protein_g: it.protein ? parseFloat(it.protein) : null,
      fat_g: it.fat ? parseFloat(it.fat) : null,
      carb_g: it.carb ? parseFloat(it.carb) : null,
      sort_order: i,
    }))

    if (presetDraft.id) {
      const { error } = await supabase.from('meal_presets')
        .update({ name: presetDraft.name.trim() })
        .eq('id', presetDraft.id)
      if (error) { Alert.alert('Error', error.message); return }
      await supabase.from('meal_preset_items').delete().eq('preset_id', presetDraft.id)
      const { data: items } = await supabase.from('meal_preset_items').insert(itemRows(presetDraft.id)).select()
      setAllPresets(prev => prev.map(p =>
        p.id === presetDraft.id
          ? { ...p, name: presetDraft.name.trim(), items: (items ?? []) as MealPresetItem[] }
          : p
      ))
    } else {
      const { data: preset, error } = await supabase.from('meal_presets').insert({
        user_id: userId,
        name: presetDraft.name.trim(),
        sort_order: allPresets.length,
      }).select().single()
      if (error || !preset) return
      const { data: items } = await supabase.from('meal_preset_items').insert(itemRows(preset.id)).select()
      const full: MealPreset = { ...preset, items: (items ?? []) as MealPresetItem[] }
      setAllPresets(prev => [...prev, full])
      if (presetDraft.autoLinkMealIndex != null) {
        const mealIdx = presetDraft.autoLinkMealIndex
        await supabase.from('meal_slot_presets').insert({
          user_id: userId,
          meal_index: mealIdx,
          preset_id: preset.id,
          sort_order: (presetLinks[mealIdx] ?? []).length,
        })
        setPresetLinks(prev => ({
          ...prev,
          [mealIdx]: [...(prev[mealIdx] ?? []), preset.id],
        }))
      }
    }
    setPresetDraft(null)
  }

  async function deletePreset(preset: MealPreset) {
    Alert.alert('Delete preset?', `Delete "${preset.name}"? It will be removed from all meals.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('meal_presets').delete().eq('id', preset.id)
        setAllPresets(prev => prev.filter(p => p.id !== preset.id))
        setPresetLinks(prev => {
          const next: Record<number, string[]> = {}
          for (const [k, ids] of Object.entries(prev)) {
            next[parseInt(k)] = ids.filter(id => id !== preset.id)
          }
          return next
        })
      }},
    ])
  }

  async function togglePresetLink(mealIdx: number, presetId: string) {
    if (!userId) return
    const linked = (presetLinks[mealIdx] ?? []).includes(presetId)
    if (linked) {
      await supabase.from('meal_slot_presets').delete()
        .eq('user_id', userId).eq('meal_index', mealIdx).eq('preset_id', presetId)
      setPresetLinks(prev => ({
        ...prev,
        [mealIdx]: (prev[mealIdx] ?? []).filter(id => id !== presetId),
      }))
    } else {
      await supabase.from('meal_slot_presets').insert({
        user_id: userId,
        meal_index: mealIdx,
        preset_id: presetId,
        sort_order: (presetLinks[mealIdx] ?? []).length,
      })
      setPresetLinks(prev => ({
        ...prev,
        [mealIdx]: [...(prev[mealIdx] ?? []), presetId],
      }))
    }
  }

  const profileField = (label: string, key: keyof UserProfile, numeric?: boolean) => (
    <View key={key} style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={editedProfile[key] != null ? String(editedProfile[key]) : ''}
        keyboardType={numeric ? 'numeric' : 'default'}
        placeholderTextColor={C.text3}
        onChangeText={v =>
          setEditedProfile(p => ({ ...p, [key]: numeric ? (v ? parseFloat(v) : null) : v }))
        }
      />
    </View>
  )

  return (
    <SafeAreaView style={styles.container}>
      <AppDrawer>
        {openDrawer => (
        <>
      {/* Top bar with hamburger */}
      <View style={styles.topBar}>
        <HamburgerBtn onPress={openDrawer} />
        <Text style={styles.topBarTitle}>Settings</Text>
        <View style={{ width: 34 }} />
      </View>

      {/* Segmented control */}
      <View style={styles.segRow}>
        {([
          { key: 'profile', label: 'Profile' },
          { key: 'zones', label: 'Zones' },
          { key: 'meals', label: 'Meals' },
          { key: 'fueling', label: 'Fueling' },
        ] as const).map(tab => (
          <Pressable
            key={tab.key}
            style={[styles.segBtn, activeTab === tab.key && styles.segBtnActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.segText, activeTab === tab.key && styles.segTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* ── Profile ──────────────────────────────────────── */}
        {activeTab === 'profile' && (
          <>
            {/* ── Avatar ── */}
            <View style={styles.avatarSection}>
              <Pressable onPress={uploadAvatar} disabled={avatarUploading} style={styles.avatarWrap}>
                {editedProfile.avatar_url ? (
                  <Image source={{ uri: editedProfile.avatar_url }} style={styles.avatarImg} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Ionicons name="person-outline" size={36} color={C.text3} />
                  </View>
                )}
                <View style={styles.avatarEditBadge}>
                  {avatarUploading
                    ? <Ionicons name="hourglass-outline" size={14} color="#fff" />
                    : <Ionicons name="camera-outline" size={14} color="#fff" />}
                </View>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.avatarName}>{editedProfile.name ?? 'Your name'}</Text>
                <Pressable onPress={uploadAvatar} disabled={avatarUploading}>
                  <Text style={styles.avatarChangeText}>{avatarUploading ? 'Uploading…' : 'Change photo'}</Text>
                </Pressable>
                {editedProfile.avatar_url && (
                  <Pressable onPress={() => Alert.alert('Remove photo?', '', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: removeAvatar },
                  ])}>
                    <Text style={styles.avatarRemoveText}>Remove photo</Text>
                  </Pressable>
                )}
              </View>
            </View>

            <View style={styles.stravaRow}>
              <View>
                <Text style={styles.stravaLabel}>Strava</Text>
                <Text style={styles.stravaStatus}>
                  {savedProfile.strava_id ? `Connected (ID: ${savedProfile.strava_id})` : 'Not connected'}
                </Text>
              </View>
              <Pressable style={styles.stravaBtn} onPress={handleConnectStrava}>
                <Text style={styles.stravaBtnText}>
                  {savedProfile.strava_id ? 'Reconnect' : 'Connect'}
                </Text>
              </Pressable>
            </View>

            {profileField('Name', 'name')}
            {profileField('Age', 'age', true)}
            {profileField('Weight (kg)', 'weight_kg', true)}
            {profileField('Height (cm)', 'height_cm', true)}
            {profileField('Max Heart Rate (bpm)', 'max_hr', true)}
            {profileField('Resting Heart Rate (bpm)', 'resting_hr', true)}
            {profileField('FTP (watts, cycling)', 'ftp_watts', true)}

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Daily calorie minimum (kcal)</Text>
              <TextInput
                style={styles.input}
                value={editedProfile.daily_kcal_target != null ? String(editedProfile.daily_kcal_target) : ''}
                keyboardType="numeric"
                placeholderTextColor={C.text3}
                placeholder="e.g. 2200"
                onChangeText={v =>
                  setEditedProfile(p => ({ ...p, daily_kcal_target: v ? parseFloat(v) : null }))
                }
              />
              <Text style={styles.prefNote}>Lower bound — workouts add on top. Use Nutrition → Estimate to calculate from your body stats.</Text>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Daily calorie maximum (kcal) — optional</Text>
              <TextInput
                style={styles.input}
                value={editedProfile.max_kcal_target != null ? String(editedProfile.max_kcal_target) : ''}
                keyboardType="numeric"
                placeholderTextColor={C.text3}
                placeholder="e.g. 3000"
                onChangeText={v =>
                  setEditedProfile(p => ({ ...p, max_kcal_target: v ? parseFloat(v) : null }))
                }
              />
              <Text style={styles.prefNote}>Upper bound — a warning is shown on the home screen if you go over this.</Text>
            </View>

            {/* Macro goals */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Macro goals</Text>
              {(() => {
                const kcal = editedProfile.daily_kcal_target
                const autoProtein = kcal ? Math.round(kcal * 0.2 / 4) : null
                const autoFat = kcal ? Math.round(kcal * 0.3 / 9) : null
                const autoCarb = kcal ? Math.round(kcal * 0.5 / 4) : null
                return (
                  <View style={styles.macroGoalRows}>
                    {([
                      { key: 'goal_protein_g' as const, label: 'Protein', color: C.accent, auto: autoProtein },
                      { key: 'goal_fat_g' as const, label: 'Fat', color: C.walk, auto: autoFat },
                      { key: 'goal_carb_g' as const, label: 'Carbs', color: C.accent2, auto: autoCarb },
                    ]).map(m => (
                      <View key={m.key} style={styles.macroGoalRow}>
                        <Text style={[styles.macroGoalLabel, { color: m.color }]}>{m.label}</Text>
                        <TextInput
                          style={styles.macroGoalInput}
                          value={editedProfile[m.key] != null ? String(editedProfile[m.key]) : ''}
                          keyboardType="numeric"
                          placeholder={m.auto != null ? `${m.auto} (auto)` : 'g/day'}
                          placeholderTextColor={C.text3}
                          onChangeText={v => setEditedProfile(p => ({ ...p, [m.key]: v ? parseInt(v) : null }))}
                        />
                        <Text style={styles.macroGoalUnit}>g</Text>
                      </View>
                    ))}
                    <Text style={styles.macroGoalNote}>Leave blank for auto targets (20% protein · 30% fat · 50% carbs of daily kcal).</Text>
                  </View>
                )
              })()}
            </View>

            <View style={[styles.fieldGroup, styles.prefRow]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Hide calorie numbers</Text>
                <Text style={styles.prefNote}>Show a progress bar instead of exact amounts on the home screen</Text>
              </View>
              <Switch
                value={hideCalories}
                onValueChange={async v => {
                  setHideCalories(v)
                  if (userId) await supabase.from('users').update({ hide_calories: v }).eq('id', userId)
                }}
                trackColor={{ true: C.accent, false: C.surface3 }}
                thumbColor={C.white}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Sex</Text>
              <View style={styles.sexRow}>
                {(['male', 'female', 'other'] as const).map(s => (
                  <Pressable
                    key={s}
                    style={[styles.sexBtn, editedProfile.sex === s && styles.sexBtnActive]}
                    onPress={() => setEditedProfile(p => ({ ...p, sex: s }))}
                  >
                    <Text style={[styles.sexBtnText, editedProfile.sex === s && styles.sexBtnTextActive]}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Pressable
              style={[styles.saveBtn, (!isDirty || savingProfile) && styles.saveBtnDisabled]}
              onPress={saveProfile}
              disabled={!isDirty || savingProfile}
            >
              <Text style={styles.saveBtnText}>{savingProfile ? 'Saving…' : 'Save'}</Text>
            </Pressable>

            <Pressable style={styles.coachRow} onPress={() => router.push('/coach')}>
              <Ionicons name="people-outline" size={20} color={C.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.coachRowTitle}>Coach connections</Text>
                <Text style={styles.coachRowNote}>Connect with a coach or manage your athletes</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={C.text3} />
            </Pressable>

            {/* App mode switcher */}
            <View style={styles.modeCard}>
              <View style={styles.modeCardLeft}>
                <Ionicons
                  name={mode === 'coach' ? 'people' : 'person'}
                  size={22}
                  color={mode === 'coach' ? C.ride : C.accent}
                />
                <View>
                  <Text style={styles.modeCardTitle}>
                    {mode === 'coach' ? 'Coach Mode' : 'Athlete Mode'}
                  </Text>
                  <Text style={styles.modeCardNote}>
                    {mode === 'coach'
                      ? 'Viewing as coach — managing athletes'
                      : 'Viewing as athlete — tracking your own data'}
                  </Text>
                </View>
              </View>
              <Switch
                value={mode === 'coach'}
                onValueChange={v => setMode(v ? 'coach' : 'athlete')}
                trackColor={{ true: C.ride, false: C.surface3 }}
                thumbColor={C.white}
              />
            </View>

            {/* Period tracking — only visible for female users */}
            {savedProfile.sex === 'female' && (
              <View style={styles.periodCard}>
                <View style={styles.periodToggleRow}>
                  <View style={styles.periodToggleLeft}>
                    <Ionicons name="rose-outline" size={20} color={C.run} />
                    <View>
                      <Text style={styles.periodToggleTitle}>On period</Text>
                      <Text style={styles.periodToggleNote}>Adjusts training intensity automatically</Text>
                    </View>
                  </View>
                  <Switch
                    value={onPeriod}
                    onValueChange={v => {
                      setOnPeriod(v)
                      savePeriodState(v, periodSeverity)
                    }}
                    trackColor={{ true: C.run, false: C.surface3 }}
                    thumbColor={C.white}
                  />
                </View>

                {onPeriod && (
                  <View style={styles.periodSeveritySection}>
                    <Text style={styles.periodSeverityLabel}>Symptom severity</Text>
                    {(['minor', 'medium', 'severe'] as PeriodSeverity[]).map(level => (
                      <Pressable
                        key={level}
                        style={[styles.periodSeverityBtn, periodSeverity === level && styles.periodSeverityBtnActive]}
                        onPress={() => {
                          setPeriodSeverity(level)
                          savePeriodState(true, level)
                        }}
                      >
                        <View style={styles.periodSeverityBtnInner}>
                          <Text style={[styles.periodSeverityBtnTitle, periodSeverity === level && styles.periodSeverityBtnTitleActive]}>
                            {SEVERITY_LABELS[level]}
                          </Text>
                          <Text style={[styles.periodSeverityBtnDesc, periodSeverity === level && styles.periodSeverityBtnDescActive]}>
                            {SEVERITY_DESCRIPTIONS[level]}
                          </Text>
                        </View>
                        {periodSeverity === level && (
                          <Ionicons name="checkmark-circle" size={18} color={C.run} />
                        )}
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )}

            <Pressable style={styles.signOutBtn} onPress={async () => {
              if (userId) {
                await supabase.from('users').update({ push_token: null }).eq('id', userId)
              }
              await supabase.auth.signOut()
            }}>
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
          </>
        )}

        {/* ── HR Zones ─────────────────────────────────────── */}
        {activeTab === 'zones' && (
          <>
            <Text style={styles.sectionHeader}>Zones</Text>
            <Text style={styles.sectionNote}>Changes apply to future syncs only.</Text>

            {zones.map(zone => (
              <ZoneCard
                key={zone.id}
                zone={zone}
                isEditing={editingZoneId === zone.id}
                onEdit={() => setEditingZoneId(zone.id)}
                onSave={saveZone}
                onCancel={() => setEditingZoneId(null)}
                onChange={updated => setZones(prev => prev.map(z => z.id === updated.id ? updated : z))}
              />
            ))}

            {/* Energy method per sport */}
            {activitySports.length > 0 && (
              <>
                <Text style={[styles.sectionHeader, { marginTop: 32 }]}>Energy method per sport</Text>
                <Text style={styles.sectionNote}>
                  Standard uses MET × weight. Custom uses your own HR → kcal/hr schema per sport (enter any HR values you like). "Same as" shares another sport's schema.
                </Text>

                {activitySports.map(sport => {
                  const config = sportConfigs[sport] ?? { mode: 'standard', linkedTo: null }
                  const isSaving = savingConfig === sport
                  const otherSports = activitySports.filter(s => s !== sport)

                  return (
                    <View key={sport} style={styles.sportCard}>
                      <Text style={styles.sportName}>{sport}</Text>

                      <View style={styles.modeRow}>
                        {(['standard', 'custom', 'linked'] as SportMode[]).map(mode => (
                          <Pressable
                            key={mode}
                            style={[styles.modeBtn, config.mode === mode && styles.modeBtnActive]}
                            onPress={() => saveSportConfig(sport, mode, mode === 'linked' ? (otherSports[0] ?? null) : null)}
                            disabled={isSaving}
                          >
                            <Text style={[styles.modeBtnText, config.mode === mode && styles.modeBtnTextActive]}>
                              {mode === 'linked' ? 'Same as…' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>

                      {config.mode === 'custom' && (
                        <Pressable
                          style={styles.editSchemaBtn}
                          onPress={() => router.push(`/energy/${encodeURIComponent(sport)}`)}
                        >
                          <Text style={styles.editSchemaBtnText}>Edit burn schema →</Text>
                        </Pressable>
                      )}

                      {config.mode === 'linked' && otherSports.length > 0 && (
                        <>
                          <Text style={styles.linkLabel}>Link to:</Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                            {otherSports.map(s => (
                              <Pressable
                                key={s}
                                style={[styles.chip, config.linkedTo === s && styles.chipActive]}
                                onPress={() => saveSportConfig(sport, 'linked', s)}
                                disabled={isSaving}
                              >
                                <Text style={[styles.chipText, config.linkedTo === s && styles.chipTextActive]}>
                                  {s}
                                </Text>
                              </Pressable>
                            ))}
                          </ScrollView>
                          {config.linkedTo && (
                            <Pressable
                              style={styles.viewSchemaBtn}
                              onPress={() => router.push(`/energy/${encodeURIComponent(config.linkedTo!)}`)}
                            >
                              <Text style={styles.viewSchemaBtnText}>View {config.linkedTo}'s schema →</Text>
                            </Pressable>
                          )}
                        </>
                      )}
                    </View>
                  )
                })}
              </>
            )}

            {/* Planner sports */}
            <Text style={[styles.sectionHeader, { marginTop: 32 }]}>Planner sports</Text>
            <Text style={styles.sectionNote}>
              Choose which sports appear in the workout planner dropdown.
            </Text>

            <View style={styles.tagRow}>
              {userSports.map(us => (
                <View key={us.id} style={styles.sportTag}>
                  <Text style={styles.sportTagText}>{us.sport_name}</Text>
                  <Pressable onPress={() => removePlannerSport(us.id)} hitSlop={8}>
                    <Ionicons name="close" size={14} color={C.text2} />
                  </Pressable>
                </View>
              ))}
              {userSports.length === 0 && (
                <Text style={[styles.sectionNote, { marginBottom: 0 }]}>No sports yet. Add from presets below.</Text>
              )}
            </View>

            <Text style={styles.addLabel}>Add from presets:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8, paddingRight: 8 }}>
                {COMMON_SPORTS.filter(s => !userSports.some(us => us.sport_name === s)).map(sport => (
                  <Pressable key={sport} style={styles.presetChip} onPress={() => addPlannerSport(sport)}>
                    <Ionicons name="add" size={13} color={C.accent} />
                    <Text style={styles.presetChipText}>{sport}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <View style={styles.addSportRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={newSportInput}
                onChangeText={setNewSportInput}
                placeholder="Custom sport name…"
                placeholderTextColor={C.text3}
                returnKeyType="done"
                onSubmitEditing={() => addPlannerSport(newSportInput)}
              />
              <Pressable style={styles.addSportBtn} onPress={() => addPlannerSport(newSportInput)}>
                <Text style={styles.addSportBtnText}>Add</Text>
              </Pressable>
            </View>
          </>
        )}

        {/* ── Meal Plan ────────────────────────────────────── */}
        {activeTab === 'meals' && (
          <>
            <Text style={styles.sectionHeader}>Meal plan</Text>
            <Text style={styles.sectionNote}>
              Set your daily meal schedule. These names and times will be used to organize your food log.
            </Text>

            <Pressable
              style={[styles.saveBtn, savingMeals && styles.saveBtnDisabled]}
              onPress={saveMeals}
              disabled={savingMeals}
            >
              <Text style={styles.saveBtnText}>{savingMeals ? 'Saving…' : 'Save meal plan'}</Text>
            </Pressable>

            {/* Meal count control */}
            <View style={styles.mealCountRow}>
              <Text style={styles.mealCountLabel}>Meals per day</Text>
              <View style={styles.mealCountControl}>
                <Pressable
                  style={[styles.mealCountBtn, draftMeals.length <= 1 && styles.mealCountBtnDisabled]}
                  onPress={removeMeal}
                  disabled={draftMeals.length <= 1}
                >
                  <Ionicons name="remove" size={20} color={draftMeals.length <= 1 ? C.text3 : C.text1} />
                </Pressable>
                <Text style={styles.mealCountNum}>{draftMeals.length}</Text>
                <Pressable
                  style={[styles.mealCountBtn, draftMeals.length >= 8 && styles.mealCountBtnDisabled]}
                  onPress={addMeal}
                  disabled={draftMeals.length >= 8}
                >
                  <Ionicons name="add" size={20} color={draftMeals.length >= 8 ? C.text3 : C.text1} />
                </Pressable>
              </View>
            </View>

            {draftMeals.map((meal, i) => (
              <View key={i} style={styles.mealCard}>
                <Text style={styles.mealCardTitle}>Meal {i + 1}</Text>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Name</Text>
                  <TextInput
                    style={styles.input}
                    value={meal.name}
                    onChangeText={v => updateDraftMeal(i, 'name', v)}
                    placeholder={MEAL_DEFAULTS[i]?.name ?? `Meal ${i + 1}`}
                    placeholderTextColor={C.text3}
                  />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Time</Text>
                  <Pressable
                    style={[styles.input, styles.timePickerBtn]}
                    onPress={() => setTimePickerMealIdx(i)}
                  >
                    <Ionicons name="time-outline" size={16} color={C.text3} />
                    <Text style={styles.timePickerBtnText}>{meal.scheduled_time || '–'}</Text>
                  </Pressable>
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Default kcal (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={meal.kcal != null ? String(meal.kcal) : ''}
                    onChangeText={v => updateDraftMealKcal(i, v)}
                    placeholder="e.g. 450"
                    placeholderTextColor={C.text3}
                    keyboardType="numeric"
                  />
                </View>
                <Text style={styles.fieldLabel}>Macros (optional)</Text>
                <View style={styles.mealMacroRow}>
                  {([
                    { field: 'protein_g' as const, label: 'Protein g', placeholder: 'e.g. 30' },
                    { field: 'fat_g' as const,     label: 'Fat g',     placeholder: 'e.g. 15' },
                    { field: 'carb_g' as const,    label: 'Carbs g',   placeholder: 'e.g. 60' },
                  ]).map(({ field, label, placeholder }) => (
                    <View key={field} style={styles.mealMacroField}>
                      <Text style={styles.mealMacroLabel}>{label}</Text>
                      <TextInput
                        style={[styles.input, { marginBottom: 0 }]}
                        value={meal[field] != null ? String(meal[field]) : ''}
                        onChangeText={v => updateDraftMealMacro(i, field, v)}
                        placeholder={placeholder}
                        placeholderTextColor={C.text3}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  ))}
                </View>

                {/* ── Meal presets ── */}
                <View style={styles.presetSection}>
                  <Text style={styles.presetSectionLabel}>Presets</Text>
                  <Text style={styles.presetSectionNote}>
                    Quick options shown when you log this meal.
                  </Text>

                  {allPresets.filter(p => (presetLinks[meal.meal_index] ?? []).includes(p.id)).map(preset => {
                    const items = preset.items ?? []
                    const total = items.reduce((acc, it) => ({
                      kcal: acc.kcal + it.kcal,
                      protein: acc.protein + (it.protein_g ?? 0),
                      fat: acc.fat + (it.fat_g ?? 0),
                      carb: acc.carb + (it.carb_g ?? 0),
                    }), { kcal: 0, protein: 0, fat: 0, carb: 0 })
                    const isExpanded = expandedPresets.has(preset.id)
                    return (
                      <View key={preset.id} style={styles.presetCard}>
                        <Pressable style={styles.presetCardHeader} onPress={() => togglePreset(preset.id)}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.presetName}>{preset.name}</Text>
                            {!isExpanded && (
                              <Text style={styles.presetCollapsedMeta}>
                                {hideCalories ? '' : `${total.kcal} kcal · `}{items.length} ingredient{items.length !== 1 ? 's' : ''}
                              </Text>
                            )}
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <Pressable onPress={() => togglePresetLink(meal.meal_index, preset.id)} hitSlop={10}>
                              <Ionicons name="close-circle-outline" size={16} color={C.danger} />
                            </Pressable>
                            <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={C.text3} />
                          </View>
                        </Pressable>

                        {isExpanded && (
                          <>
                            {items.map(item => (
                              <View key={item.id} style={styles.ingredientRow}>
                                <Text style={styles.ingredientLabel}>
                                  {item.amount_label ? `${item.amount_label}  ` : ''}{item.name}
                                </Text>
                                {!hideCalories && <Text style={styles.ingredientKcal}>{item.kcal} kcal</Text>}
                              </View>
                            ))}
                            {!hideCalories && (
                              <View style={styles.presetTotalRow}>
                                <Text style={styles.presetTotalLabel}>Total</Text>
                                <Text style={styles.presetTotalValue}>
                                  {total.kcal} kcal
                                  {total.protein > 0 ? ` · P ${total.protein.toFixed(0)}g` : ''}
                                  {total.fat > 0 ? ` · F ${total.fat.toFixed(0)}g` : ''}
                                  {total.carb > 0 ? ` · C ${total.carb.toFixed(0)}g` : ''}
                                </Text>
                              </View>
                            )}
                          </>
                        )}
                      </View>
                    )
                  })}

                  <View style={styles.presetBtnRow}>
                    {allPresets.length > 0 && (
                      <Pressable
                        style={styles.addPresetBtn}
                        onPress={() => setLinkPickerMeal(meal.meal_index)}
                      >
                        <Ionicons name="link-outline" size={16} color={C.accent2} />
                        <Text style={[styles.addPresetBtnText, { color: C.accent2 }]}>Link preset</Text>
                      </Pressable>
                    )}
                    <Pressable
                      style={styles.addPresetBtn}
                      onPress={() => setPresetDraft({ autoLinkMealIndex: meal.meal_index, name: '', items: [emptyDraftItem()] })}
                    >
                      <Ionicons name="add-circle-outline" size={16} color={C.accent} />
                      <Text style={styles.addPresetBtnText}>New preset</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}

            {/* ── Global preset management ── */}
            {allPresets.length > 0 && (
              <View style={[styles.presetSection, { marginTop: 8 }]}>
                <Text style={styles.presetSectionLabel}>All presets</Text>
                <Text style={styles.presetSectionNote}>
                  Edit or delete presets here. Link them to meals using the "Link preset" button on each meal card.
                </Text>
                {allPresets.map(preset => {
                  const items = preset.items ?? []
                  const total = items.reduce((acc, it) => ({
                    kcal: acc.kcal + it.kcal,
                    protein: acc.protein + (it.protein_g ?? 0),
                    fat: acc.fat + (it.fat_g ?? 0),
                    carb: acc.carb + (it.carb_g ?? 0),
                  }), { kcal: 0, protein: 0, fat: 0, carb: 0 })
                  const usedIn = draftMeals.filter(m => (presetLinks[m.meal_index] ?? []).includes(preset.id)).map(m => m.name)
                  return (
                    <View key={preset.id} style={styles.presetCard}>
                      <View style={styles.presetCardHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.presetName}>{preset.name}</Text>
                          <Text style={styles.presetCollapsedMeta}>
                            {hideCalories ? '' : `${total.kcal} kcal · `}{items.length} ingredient{items.length !== 1 ? 's' : ''}
                            {usedIn.length > 0 ? ` · linked to ${usedIn.join(', ')}` : ''}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <Pressable
                            onPress={() => setPresetDraft({
                              id: preset.id,
                              name: preset.name,
                              items: (preset.items ?? []).map(it => {
                                const m = (it.amount_label ?? '').match(/^(\d+(?:\.\d+)?)\s*(.*)$/)
                                const storedAmt = m ? parseFloat(m[1]) : null
                                const pu = (v: number | null) => (storedAmt && storedAmt > 0 && v != null) ? v / storedAmt : null
                                return {
                                  name: it.name,
                                  amount: m ? m[1] : (it.amount_label ?? ''),
                                  unit: m ? (m[2] || 'g') : 'g',
                                  kcal: String(it.kcal),
                                  protein: it.protein_g != null ? String(it.protein_g) : '',
                                  fat: it.fat_g != null ? String(it.fat_g) : '',
                                  carb: it.carb_g != null ? String(it.carb_g) : '',
                                  kcalPerUnit: pu(it.kcal),
                                  proteinPerUnit: pu(it.protein_g),
                                  fatPerUnit: pu(it.fat_g),
                                  carbPerUnit: pu(it.carb_g),
                                }
                              }),
                            })}
                            hitSlop={10}
                          >
                            <Ionicons name="pencil-outline" size={16} color={C.accent2} />
                          </Pressable>
                          <Pressable onPress={() => deletePreset(preset)} hitSlop={10}>
                            <Ionicons name="trash-outline" size={16} color={C.danger} />
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  )
                })}
              </View>
            )}

          </>
        )}
        {/* ── Fueling ──────────────────────────────────────── */}
        {activeTab === 'fueling' && (() => {
          const fuelingSports = [...new Set(activitySports.map(s => normalizeType(s)))].sort()
          const activeEntries = Object.entries(fuelingConfigs)

          return (
            <>
              <Text style={styles.sectionHeader}>During-workout fueling</Text>
              <Text style={styles.sectionNote}>
                Stel per sport in wanneer je tijdens een training begint te eten en hoeveel koolhydraten je per interval wil innemen.
              </Text>

              {/* Active overview */}
              {activeEntries.length > 0 && (
                <View style={styles.fuelingOverview}>
                  <Text style={styles.fuelingOverviewTitle}>Actief</Text>
                  {activeEntries.map(([sport, cfg]) => (
                    <View key={sport} style={styles.fuelingOverviewRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fuelingOverviewSport}>{sport}</Text>
                        <Text style={styles.fuelingOverviewDetail}>
                          {'>'}{cfg.threshold_min} min · {cfg.carbs_per_interval_g}g per {cfg.interval_min} min
                        </Text>
                      </View>
                      <Pressable onPress={() => deleteFuelingConfig(sport)} hitSlop={8} style={styles.fuelingDeleteBtn}>
                        <Ionicons name="close-circle" size={22} color={C.danger} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              {fuelingSports.length === 0 && (
                <Text style={styles.sectionNote}>Sync eerst een training via Strava om sporten te zien.</Text>
              )}

              {fuelingSports.map(sport => {
                const draft = draftFueling[sport] ?? { threshold_min: 60, carbs_per_interval_g: 30, interval_min: 30 }
                const saved = fuelingConfigs[sport]
                const isDirtyFueling = JSON.stringify(draft) !== JSON.stringify(saved ?? { threshold_min: 60, carbs_per_interval_g: 30, interval_min: 30 })
                const isSaving = savingFueling === sport

                return (
                  <View key={sport} style={styles.fuelingCard}>
                    <View style={styles.fuelingCardHeader}>
                      <Text style={styles.sportName}>{sport}</Text>
                      {saved && (
                        <View style={styles.fuelingActiveBadge}>
                          <Ionicons name="checkmark-circle" size={12} color={C.accent} />
                          <Text style={styles.fuelingActiveBadgeText}>Actief</Text>
                        </View>
                      )}
                    </View>

                    <Text style={styles.fuelingFieldLabel}>Training langer dan (minuten)</Text>
                    <TextInput
                      style={styles.input}
                      value={String(draft.threshold_min)}
                      keyboardType="numeric"
                      placeholderTextColor={C.text3}
                      onChangeText={v => updateDraftFueling(sport, 'threshold_min', parseInt(v) || 0)}
                    />

                    <View style={styles.fuelingRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fuelingFieldLabel}>Koolhydraten per interval (g)</Text>
                        <TextInput
                          style={[styles.input, { marginBottom: 0 }]}
                          value={String(draft.carbs_per_interval_g)}
                          keyboardType="numeric"
                          placeholderTextColor={C.text3}
                          onChangeText={v => updateDraftFueling(sport, 'carbs_per_interval_g', parseInt(v) || 0)}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fuelingFieldLabel}>Interval (minuten)</Text>
                        <TextInput
                          style={[styles.input, { marginBottom: 0 }]}
                          value={String(draft.interval_min)}
                          keyboardType="numeric"
                          placeholderTextColor={C.text3}
                          onChangeText={v => updateDraftFueling(sport, 'interval_min', parseInt(v) || 0)}
                        />
                      </View>
                    </View>

                    {draft.threshold_min > 0 && draft.interval_min > 0 && (
                      <View style={styles.fuelingPreview}>
                        <Ionicons name="information-circle-outline" size={13} color={C.accent2} />
                        <Text style={styles.fuelingPreviewText}>
                          Bij trainingen langer dan {draft.threshold_min} min: elke {draft.interval_min} min {draft.carbs_per_interval_g}g koolhydraten.
                        </Text>
                      </View>
                    )}

                    <Pressable
                      style={[styles.saveBtn, (!isDirtyFueling || isSaving) && styles.saveBtnDisabled]}
                      onPress={() => saveFuelingConfig(sport)}
                      disabled={!isDirtyFueling || isSaving}
                    >
                      <Text style={styles.saveBtnText}>{isSaving ? 'Opslaan…' : 'Opslaan'}</Text>
                    </Pressable>
                  </View>
                )
              })}
            </>
          )
        })()}

      </ScrollView>
      </KeyboardAvoidingView>
        </>
        )}
      </AppDrawer>

      {/* Full-screen preset editor */}
      <Modal visible={presetDraft !== null} animationType="slide" onRequestClose={() => setPresetDraft(null)}>
        <SafeAreaView style={styles.editorContainer}>
          {/* Header — back only, save is at the bottom */}
          <View style={styles.editorHeader}>
            <Pressable onPress={() => setPresetDraft(null)} hitSlop={12}>
              <Ionicons name="close" size={22} color={C.text1} />
            </Pressable>
            <Text style={styles.editorTitle}>{presetDraft?.id ? 'Edit preset' : 'New preset'}</Text>
            <View style={{ width: 22 }} />
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            contentContainerStyle={styles.editorScroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <TextInput
              style={[styles.input, { marginBottom: 16 }]}
              value={presetDraft?.name ?? ''}
              onChangeText={v => setPresetDraft(d => d ? { ...d, name: v } : d)}
              placeholder="Preset name (e.g. Yoghurt with granola)"
              placeholderTextColor={C.text3}
              returnKeyType="done"
            />

            <Text style={styles.presetSectionLabel}>Ingredients</Text>

            {(presetDraft?.items ?? []).map((item, idx) => (
              <View key={idx} style={styles.draftItemBlock}>
                <View style={styles.draftItemRow}>
                  <View style={styles.draftAmountWrap}>
                    <TextInput
                      style={[styles.input, styles.draftAmountInput]}
                      value={item.amount}
                      onChangeText={v => setPresetDraft(d => d ? {
                        ...d, items: d.items.map((it, j) => j === idx ? recalcItem(it, v) : it),
                      } : d)}
                      placeholder="100"
                      placeholderTextColor={C.text3}
                      keyboardType="decimal-pad"
                      inputAccessoryViewID={Platform.OS === 'ios' ? 'preset-done' : undefined}
                      returnKeyType="done"
                    />
                    <Text style={styles.draftUnitLabel}>{item.unit || 'g'}</Text>
                  </View>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    value={item.name}
                    onChangeText={v => setPresetDraft(d => d ? {
                      ...d, items: d.items.map((it, j) => j === idx ? { ...it, name: v } : it),
                    } : d)}
                    placeholder="Ingredient name"
                    placeholderTextColor={C.text3}
                    returnKeyType="done"
                  />
                  <TextInput
                    style={[styles.input, styles.draftKcalInput]}
                    value={item.kcal}
                    onChangeText={v => setPresetDraft(d => d ? {
                      ...d, items: d.items.map((it, j) => j === idx ? {
                        ...it, kcal: v,
                        kcalPerUnit: null, proteinPerUnit: null, fatPerUnit: null, carbPerUnit: null,
                      } : it),
                    } : d)}
                    placeholder="kcal"
                    placeholderTextColor={C.text3}
                    keyboardType="numeric"
                    inputAccessoryViewID={Platform.OS === 'ios' ? 'preset-done' : undefined}
                    returnKeyType="done"
                  />
                  <Pressable
                    onPress={() => setPresetDraft(d => d ? {
                      ...d, items: d.items.filter((_, j) => j !== idx),
                    } : d)}
                    hitSlop={8}
                    style={{ paddingBottom: 10 }}
                  >
                    <Ionicons name="close-circle-outline" size={20} color={C.danger} />
                  </Pressable>
                </View>
              </View>
            ))}

            <View style={styles.editorAddRow}>
              <Pressable
                style={styles.editorAddBtn}
                onPress={() => setPresetDraft(d => d ? { ...d, items: [...d.items, emptyDraftItem()] } : d)}
              >
                <Ionicons name="add-outline" size={16} color={C.accent2} />
                <Text style={styles.editorAddBtnText}>Add manually</Text>
              </Pressable>
              <Pressable
                style={[styles.editorAddBtn, { borderColor: C.accent }]}
                onPress={() => {
                  const newIdx = presetDraft?.items.length ?? 0
                  setPresetDraft(d => d ? { ...d, items: [...d.items, emptyDraftItem()] } : d)
                  setFoodPickerTargetIdx(newIdx)
                }}
              >
                <Ionicons name="search-outline" size={16} color={C.accent} />
                <Text style={[styles.editorAddBtnText, { color: C.accent }]}>Search food</Text>
              </Pressable>
            </View>

            {(presetDraft?.items.length ?? 0) > 0 && (() => {
              const t = draftItemTotals(presetDraft!.items)
              return (
                <View style={styles.draftTotalRow}>
                  <Text style={styles.draftTotalLabel}>Total</Text>
                  <Text style={styles.draftTotalValue}>
                    {t.kcal} kcal
                    {t.protein > 0 ? ` · P ${t.protein.toFixed(0)}g` : ''}
                    {t.fat > 0 ? ` · F ${t.fat.toFixed(0)}g` : ''}
                    {t.carb > 0 ? ` · C ${t.carb.toFixed(0)}g` : ''}
                  </Text>
                </View>
              )
            })()}
          </ScrollView>

          {/* Sticky save button */}
          <View style={styles.editorFooter}>
            <Pressable style={styles.editorSaveBtn} onPress={savePreset}>
              <Text style={styles.editorSaveBtnText}>Save preset</Text>
            </Pressable>
          </View>
          </KeyboardAvoidingView>
        </SafeAreaView>

        {/* iOS keyboard Done toolbar */}
        {Platform.OS === 'ios' && (
          <InputAccessoryView nativeID="preset-done">
            <View style={styles.keyboardDoneBar}>
              <Pressable onPress={() => Keyboard.dismiss()} style={styles.keyboardDoneBtn}>
                <Text style={styles.keyboardDoneBtnText}>Done</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
        )}

        {foodPickerTargetIdx !== null && userId && (
          <FoodPickerModal
            visible={true}
            userId={userId}
            onSelect={food => {
              const idx = foodPickerTargetIdx
              const m = (food.amount_label ?? '').match(/^(\d+(?:\.\d+)?)\s*(.*)$/)
              const amt = m ? parseFloat(m[1]) : null
              const unit = m ? (m[2] || 'g') : 'g'
              const pu = (v: number | null) => (amt && amt > 0 && v != null) ? v / amt : null
              setPresetDraft(d => d ? {
                ...d,
                items: d.items.map((it, j) => j === idx ? {
                  name: food.name,
                  amount: m ? m[1] : '',
                  unit,
                  kcal: String(food.kcal),
                  protein: food.protein_g != null ? String(food.protein_g) : '',
                  fat: food.fat_g != null ? String(food.fat_g) : '',
                  carb: food.carb_g != null ? String(food.carb_g) : '',
                  kcalPerUnit: pu(food.kcal),
                  proteinPerUnit: pu(food.protein_g),
                  fatPerUnit: pu(food.fat_g),
                  carbPerUnit: pu(food.carb_g),
                } : it),
              } : d)
              setFoodPickerTargetIdx(null)
            }}
            onClose={() => {
              // Remove the empty item that was pre-appended if user cancels
              setPresetDraft(d => d ? {
                ...d,
                items: d.items.filter((it, j) => j !== foodPickerTargetIdx || it.name.trim() !== ''),
              } : d)
              setFoodPickerTargetIdx(null)
            }}
          />
        )}
      </Modal>

      {timePickerMealIdx !== null && (
        <TimePickerModal
          value={draftMeals[timePickerMealIdx]?.scheduled_time ?? '12:00'}
          onChange={v => updateDraftMeal(timePickerMealIdx!, 'scheduled_time', v)}
          onClose={() => setTimePickerMealIdx(null)}
        />
      )}

      {/* Link preset picker */}
      <Modal
        visible={linkPickerMeal !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setLinkPickerMeal(null)}
      >
        <View style={styles.linkPickerOverlay}>
          <View style={styles.linkPickerSheet}>
            <View style={styles.linkPickerHeader}>
              <Text style={styles.linkPickerTitle}>
                Link presets to {draftMeals.find(m => m.meal_index === linkPickerMeal)?.name ?? 'meal'}
              </Text>
              <Pressable onPress={() => setLinkPickerMeal(null)} hitSlop={12}>
                <Ionicons name="close" size={20} color={C.text1} />
              </Pressable>
            </View>
            <ScrollView>
              {allPresets.map(preset => {
                const items = preset.items ?? []
                const total = items.reduce((acc, it) => acc + it.kcal, 0)
                const linked = linkPickerMeal !== null && (presetLinks[linkPickerMeal] ?? []).includes(preset.id)
                return (
                  <Pressable
                    key={preset.id}
                    style={styles.linkPickerRow}
                    onPress={() => linkPickerMeal !== null && togglePresetLink(linkPickerMeal, preset.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.linkPickerPresetName}>{preset.name}</Text>
                      {!hideCalories && (
                        <Text style={styles.linkPickerPresetMeta}>
                          {total} kcal · {items.length} ingredient{items.length !== 1 ? 's' : ''}
                        </Text>
                      )}
                    </View>
                    <View style={[styles.linkPickerCheck, linked && styles.linkPickerCheckActive]}>
                      {linked && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const ITEM_H = 48
const VISIBLE = 5

function TimePickerModal({ value, onChange, onClose }: {
  value: string
  onChange: (v: string) => void
  onClose: () => void
}) {
  const parts = value.match(/^(\d{1,2}):(\d{2})$/)
  const initH = parts ? parseInt(parts[1]) : 12
  const initM = parts ? parseInt(parts[2]) : 0

  const [selH, setSelH] = useState(initH)
  const [selM, setSelM] = useState(initM)
  const hRef = useRef<ScrollView>(null)
  const mRef = useRef<ScrollView>(null)

  const hours = Array.from({ length: 24 }, (_, i) => i)
  const minutes = Array.from({ length: 60 }, (_, i) => i)

  useEffect(() => {
    const t = setTimeout(() => {
      hRef.current?.scrollTo({ y: initH * ITEM_H, animated: false })
      mRef.current?.scrollTo({ y: initM * ITEM_H, animated: false })
    }, 100)
    return () => clearTimeout(t)
  }, [])

  // Update selection on every scroll event for live visual feedback
  function makeOnScroll(setter: (v: number) => void, max: number) {
    return (e: any) => {
      const v = Math.round(e.nativeEvent.contentOffset.y / ITEM_H)
      setter(Math.max(0, Math.min(max, v)))
    }
  }

  function confirm() {
    onChange(`${String(selH).padStart(2, '0')}:${String(selM).padStart(2, '0')}`)
    onClose()
  }

  function renderColumn(
    ref: React.RefObject<ScrollView | null>,
    data: number[],
    sel: number,
    max: number,
    setter: (v: number) => void,
  ) {
    const onScroll = makeOnScroll(setter, max)
    return (
      <View style={{ width: 72, height: ITEM_H * VISIBLE }}>
        {/* Highlight rendered FIRST — visually behind the ScrollView */}
        <View style={tp.selBar} />
        <ScrollView
          ref={ref}
          style={StyleSheet.absoluteFillObject}
          snapToInterval={ITEM_H}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onMomentumScrollEnd={onScroll}
          onScrollEndDrag={onScroll}
        >
          {data.map(v => (
            <View key={v} style={{ height: ITEM_H, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[tp.colItem, v === sel && tp.colItemSelected]}>
                {String(v).padStart(2, '0')}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
    )
  }

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      {/* Backdrop as absolute fill — tap outside sheet to close */}
      <Pressable style={[StyleSheet.absoluteFill, tp.backdrop]} onPress={onClose} />
      {/* Sheet as plain View — no Pressable wrapper that would steal scroll gestures */}
      <View style={tp.container}>
        <View style={tp.sheet}>
          <Text style={tp.title}>Select time</Text>
          <View style={tp.columns}>
            {renderColumn(hRef, hours, selH, 23, setSelH)}
            <Text style={tp.colon}>:</Text>
            {renderColumn(mRef, minutes, selM, 59, setSelM)}
          </View>
          <Pressable style={tp.confirmBtn} onPress={confirm}>
            <Text style={tp.confirmBtnText}>Confirm</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const tp = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  sheet: {
    backgroundColor: C.surface, borderRadius: 20,
    paddingHorizontal: 28, paddingTop: 20, paddingBottom: 24,
    width: 240, alignItems: 'center',
  },
  title: { fontSize: 16, fontWeight: '800', color: C.text1, marginBottom: 16 },
  columns: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  colon: { fontSize: 28, fontWeight: '800', color: C.text1, marginBottom: 4 },
  colItem: { fontSize: 20, fontWeight: '400', color: C.text3 },
  colItemSelected: { fontSize: 26, fontWeight: '800', color: C.text1 },
  selBar: {
    position: 'absolute',
    top: ITEM_H * 2, left: 6, right: 6, height: ITEM_H,
    borderTopWidth: 2, borderBottomWidth: 2, borderColor: C.accent,
    borderRadius: 4,
  },
  confirmBtn: {
    marginTop: 20, backgroundColor: C.accent, borderRadius: 12,
    paddingVertical: 13, paddingHorizontal: 40, alignItems: 'center',
  },
  confirmBtnText: { fontSize: 15, fontWeight: '800', color: C.white },
})

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
        placeholderTextColor={C.text3}
        onChangeText={v => onChange({ ...zone, name: v })}
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
        <Pressable style={styles.zoneSaveBtn} onPress={() => onSave(zone)}>
          <Text style={styles.zoneSaveBtnText}>Save</Text>
        </Pressable>
        <Pressable style={styles.zoneCancelBtn} onPress={onCancel}>
          <Text style={styles.zoneCancelBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  topBarTitle: { fontSize: 15, fontWeight: '700', color: C.text1 },

  avatarSection: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20, marginTop: 4 },
  avatarWrap: { position: 'relative' },
  avatarImg: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.surface2 },
  avatarPlaceholder: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  avatarEditBadge: { position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.surface },
  avatarName: { fontSize: 17, fontWeight: '800', color: C.text1, marginBottom: 4 },
  avatarChangeText: { fontSize: 13, color: C.accent2, fontWeight: '600', marginBottom: 2 },
  avatarRemoveText: { fontSize: 12, color: C.danger, fontWeight: '500', marginTop: 2 },

  segRow: {
    flexDirection: 'row', margin: 16, marginBottom: 0,
    backgroundColor: C.surface2, borderRadius: 10, padding: 3,
  },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segBtnActive: { backgroundColor: C.surface3 },
  segText: { fontSize: 12, fontWeight: '600', color: C.text3 },
  segTextActive: { color: C.text1 },

  content: { padding: 16, paddingBottom: 60 },

  sectionHeader: { fontSize: 18, fontWeight: '800', marginBottom: 4, color: C.text1 },
  sectionNote: { fontSize: 12, color: C.text3, marginBottom: 14, lineHeight: 17 },

  // Profile
  stravaRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 12, padding: 16, marginBottom: 4,
  },
  stravaLabel: { fontSize: 14, fontWeight: '700', color: C.text1 },
  stravaStatus: { fontSize: 13, color: C.text2, marginTop: 2 },
  stravaBtn: { backgroundColor: C.accent, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  stravaBtnText: { color: C.white, fontWeight: '700', fontSize: 13 },
  fieldGroup: { marginTop: 14 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: C.text2, marginBottom: 5, textTransform: 'uppercase' },
  saveBtn: { backgroundColor: C.accent, padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 24 },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { color: C.white, fontWeight: '700', fontSize: 15 },
  coachRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 14, padding: 14, marginTop: 8,
    borderWidth: 1, borderColor: C.border,
  },
  coachRowTitle: { fontSize: 15, fontWeight: '700', color: C.text1 },
  coachRowNote: { fontSize: 12, color: C.text3, marginTop: 1 },
  modeCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surface2, borderRadius: 14, padding: 14, marginTop: 8,
  },
  modeCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  modeCardTitle: { fontSize: 15, fontWeight: '700', color: C.text1 },
  modeCardNote: { fontSize: 12, color: C.text3, marginTop: 1, maxWidth: 220 },
  signOutBtn: { padding: 20, alignItems: 'center' },
  signOutText: { color: C.text3, fontSize: 14 },

  // Zone cards
  zoneCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14, marginBottom: 8, borderRadius: 10, backgroundColor: C.surface,
  },
  zoneCardEditing: { flexDirection: 'column', alignItems: 'stretch' },
  zoneName: { fontSize: 15, fontWeight: '600', color: C.text1 },
  zoneMeta: { fontSize: 13, color: C.text2, marginTop: 2 },
  editHint: { fontSize: 13, color: C.accent, fontWeight: '600' },
  zoneSaveBtn: { flex: 1, backgroundColor: C.accent, padding: 11, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  zoneSaveBtnText: { color: C.white, fontWeight: '700', fontSize: 14 },
  zoneCancelBtn: { flex: 1, padding: 11, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  zoneCancelBtnText: { color: C.text2, fontSize: 14 },
  inputRow: { flexDirection: 'row', gap: 10 },
  inputGroup: { flex: 1, marginBottom: 10 },
  inputLabel: { fontSize: 10, fontWeight: '700', color: C.text3, marginBottom: 4, textTransform: 'uppercase' },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 8,
    padding: 10, fontSize: 14, backgroundColor: C.surface2, marginBottom: 10,
    color: C.text1,
  },

  // Sport energy cards
  sportCard: {
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    padding: 14, marginBottom: 10, backgroundColor: C.surface,
  },
  sportName: { fontSize: 15, fontWeight: '700', marginBottom: 10, color: C.text1 },
  modeRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  modeBtn: {
    flex: 1, paddingVertical: 7, borderRadius: 8,
    borderWidth: 1, borderColor: C.border, alignItems: 'center',
  },
  modeBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  modeBtnText: { fontSize: 12, fontWeight: '600', color: C.text2 },
  modeBtnTextActive: { color: C.white },
  editSchemaBtn: { backgroundColor: C.accentBg, borderRadius: 8, padding: 11, alignItems: 'center' },
  editSchemaBtnText: { color: C.accent, fontWeight: '700', fontSize: 13 },
  linkLabel: { fontSize: 11, fontWeight: '700', color: C.text3, marginBottom: 8, textTransform: 'uppercase' },
  chipRow: { marginBottom: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, marginRight: 8, backgroundColor: C.surface2,
  },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { fontSize: 13, fontWeight: '600', color: C.text2 },
  chipTextActive: { color: C.white },
  viewSchemaBtn: { paddingTop: 4 },
  viewSchemaBtnText: { color: C.accent, fontSize: 13, fontWeight: '600' },

  // Planner sports
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  sportTag: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.surface2, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: C.border,
  },
  sportTagText: { fontSize: 13, fontWeight: '600', color: C.text1 },
  addLabel: { fontSize: 11, fontWeight: '700', color: C.text3, marginBottom: 8, textTransform: 'uppercase' },
  presetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.accentBg, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: C.accent,
  },
  presetChipText: { fontSize: 13, fontWeight: '600', color: C.accent },
  addSportRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addSportBtn: { backgroundColor: C.accent, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8 },
  addSportBtnText: { color: C.white, fontWeight: '700', fontSize: 14 },

  // Meal plan
  mealCountRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 12, padding: 16, marginBottom: 20,
  },
  mealCountLabel: { fontSize: 15, fontWeight: '600', color: C.text1 },
  mealCountControl: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  mealCountBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  mealCountBtnDisabled: { opacity: 0.35 },
  mealCountNum: { fontSize: 22, fontWeight: '800', color: C.text1, minWidth: 24, textAlign: 'center' },
  mealCard: { backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 12 },
  mealCardTitle: {
    fontSize: 11, fontWeight: '700', color: C.text3,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
  },
  mealMacroRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  mealMacroField: { flex: 1 },
  mealMacroLabel: { fontSize: 10, fontWeight: '600', color: C.text3, marginBottom: 4 },

  // Meal presets
  presetSection: {
    marginTop: 14, borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 12,
  },
  presetSectionLabel: { fontSize: 11, fontWeight: '700', color: C.text2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  presetSectionNote: { fontSize: 12, color: C.text3, marginBottom: 10 },
  presetCard: {
    backgroundColor: C.surface2, borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: C.border, marginBottom: 8,
  },
  presetCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  presetName: { fontSize: 13, fontWeight: '700', color: C.text1 },
  presetCollapsedMeta: { fontSize: 11, color: C.text3, marginTop: 2 },
  ingredientRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  ingredientLabel: { fontSize: 12, color: C.text2, flex: 1 },
  ingredientKcal: { fontSize: 12, color: C.text2, fontWeight: '600' },
  presetTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: C.divider, marginTop: 6, paddingTop: 6,
  },
  presetTotalLabel: { fontSize: 12, fontWeight: '800', color: C.text1 },
  presetTotalValue: { fontSize: 12, fontWeight: '700', color: C.accent },
  presetAddForm: {
    backgroundColor: C.surface2, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.border, marginTop: 4,
  },
  draftItemBlock: { marginBottom: 10 },
  draftItemRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  draftAmountWrap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  draftAmountInput: { width: 52, marginBottom: 0 },
  draftUnitLabel: { fontSize: 12, color: C.text3, fontWeight: '600', minWidth: 14 },
  draftKcalInput: { width: 64, marginBottom: 0 },
  draftMacroRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  draftMacroField: { flex: 1 },
  addIngredientBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  addIngredientBtnText: { fontSize: 13, fontWeight: '600', color: C.accent2 },
  draftTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 8, padding: 10, marginTop: 4, marginBottom: 4,
    borderWidth: 1, borderColor: C.border,
  },
  draftTotalLabel: { fontSize: 13, fontWeight: '800', color: C.text1 },
  draftTotalValue: { fontSize: 13, fontWeight: '700', color: C.accent },
  presetFormActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  presetCancelBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  presetCancelBtnText: { fontSize: 13, fontWeight: '700', color: C.text2 },
  presetSaveBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, backgroundColor: C.accent, alignItems: 'center' },
  presetSaveBtnText: { fontSize: 13, fontWeight: '700', color: C.white },
  addPresetBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  addPresetBtnText: { fontSize: 13, fontWeight: '600', color: C.accent },
  presetBtnRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },

  // Link picker modal
  linkPickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  linkPickerSheet: { backgroundColor: C.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70%' },
  linkPickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  linkPickerTitle: { fontSize: 15, fontWeight: '700', color: C.text1 },
  linkPickerRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.divider,
  },
  linkPickerPresetName: { fontSize: 14, fontWeight: '600', color: C.text1 },
  linkPickerPresetMeta: { fontSize: 12, color: C.text3, marginTop: 2 },
  linkPickerCheck: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.text3,
    alignItems: 'center', justifyContent: 'center',
  },
  linkPickerCheckActive: { backgroundColor: C.accent, borderColor: C.accent },

  // Preset editor full-screen modal
  editorContainer: { flex: 1, backgroundColor: C.bg },
  editorHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.divider, backgroundColor: C.surface,
  },
  editorTitle: { fontSize: 17, fontWeight: '800', color: C.text1 },
  editorScroll: { padding: 16, paddingBottom: 16 },
  editorAddRow: { flexDirection: 'row', gap: 10, marginTop: 6, marginBottom: 12 },
  editorAddBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: C.accent2, borderRadius: 10,
    paddingVertical: 10,
  },
  editorAddBtnText: { fontSize: 13, fontWeight: '700', color: C.accent2 },
  editorFooter: {
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: C.divider, backgroundColor: C.bg,
  },
  editorSaveBtn: {
    backgroundColor: C.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center',
  },
  editorSaveBtnText: { fontSize: 16, fontWeight: '800', color: C.white },
  keyboardDoneBar: {
    backgroundColor: C.surface2, borderTopWidth: 1, borderTopColor: C.divider,
    paddingHorizontal: 16, paddingVertical: 10, alignItems: 'flex-end',
  },
  keyboardDoneBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  keyboardDoneBtnText: { fontSize: 16, fontWeight: '700', color: C.accent },

  // Fueling
  fuelingCard: {
    borderWidth: 1, borderColor: C.border, borderRadius: 14,
    padding: 16, marginBottom: 14, backgroundColor: C.surface,
  },
  fuelingCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  fuelingActiveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.accentBg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
  },
  fuelingActiveBadgeText: { fontSize: 11, fontWeight: '700', color: C.accent },
  fuelingFieldLabel: { fontSize: 11, fontWeight: '700', color: C.text2, marginBottom: 5, textTransform: 'uppercase' },
  fuelingRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  fuelingPreview: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: C.surface2, borderRadius: 10, padding: 10, marginBottom: 14,
  },
  fuelingPreviewText: { flex: 1, fontSize: 12, color: C.text2, lineHeight: 17 },

  fuelingOverview: {
    backgroundColor: C.surface2, borderRadius: 12,
    padding: 12, marginBottom: 16,
    borderWidth: 1, borderColor: C.border,
  },
  fuelingOverviewTitle: {
    fontSize: 10, fontWeight: '700', color: C.text3,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8,
  },
  fuelingOverviewRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  fuelingOverviewSport: { fontSize: 14, fontWeight: '700', color: C.text1, flex: 1 },
  fuelingOverviewDetail: { fontSize: 12, color: C.text3, flex: 2, paddingRight: 8 },
  fuelingDeleteBtn: { padding: 4 },

  // Display preferences
  prefRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  prefNote: { fontSize: 11, color: C.text3, marginTop: 6, lineHeight: 15 },
  // Macro goals
  macroGoalRows: { gap: 10 },
  macroGoalRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  macroGoalLabel: { fontSize: 13, fontWeight: '700', width: 56 },
  macroGoalInput: {
    flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 14,
    backgroundColor: C.surface2, color: C.text1,
  },
  macroGoalUnit: { fontSize: 12, color: C.text3, width: 14 },
  macroGoalNote: { fontSize: 11, color: C.text3, lineHeight: 16, marginTop: 2 },

  // Sex selector
  sexRow: { flexDirection: 'row', gap: 8 },
  sexBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center',
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  sexBtnActive: { borderColor: C.accent, backgroundColor: C.accentBg },
  sexBtnText: { fontSize: 14, fontWeight: '600', color: C.text2 },
  sexBtnTextActive: { color: C.accent },

  // Period tracking
  periodCard: {
    borderWidth: 1, borderColor: C.border, borderRadius: 16,
    backgroundColor: C.surface, marginBottom: 12, overflow: 'hidden',
  },
  periodToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16,
  },
  periodToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  periodToggleTitle: { fontSize: 15, fontWeight: '700', color: C.text1 },
  periodToggleNote: { fontSize: 12, color: C.text3, marginTop: 1 },
  periodSeveritySection: {
    borderTopWidth: 1, borderTopColor: C.border,
    padding: 16, gap: 8,
  },
  periodSeverityLabel: {
    fontSize: 10, fontWeight: '700', color: C.text3,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4,
  },
  periodSeverityBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    padding: 12, backgroundColor: C.surface2,
  },
  periodSeverityBtnActive: { borderColor: C.run, backgroundColor: 'rgba(129,140,248,0.08)' },
  periodSeverityBtnInner: { flex: 1 },
  periodSeverityBtnTitle: { fontSize: 14, fontWeight: '700', color: C.text1 },
  periodSeverityBtnTitleActive: { color: C.run },
  periodSeverityBtnDesc: { fontSize: 12, color: C.text3, marginTop: 2 },
  periodSeverityBtnDescActive: { color: C.run },

  // Time picker button (replaces TextInput)
  timePickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10,
  },
  timePickerBtnText: { fontSize: 15, fontWeight: '600', color: C.text1 },
})
