import { createContext, useContext } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type AppLanguage = 'en' | 'nl'

export const LANGUAGES: { code: AppLanguage; label: string; flag: string }[] = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
]

const STORAGE_KEY = 'app_language'

export async function loadLanguage(): Promise<AppLanguage> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY)
    return (v === 'nl' ? 'nl' : 'en') as AppLanguage
  } catch {
    return 'en'
  }
}

export async function saveLanguage(lang: AppLanguage): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, lang)
}

// ─── Translation dictionaries ─────────────────────────────────────────────────

const en = {
  // Drawer nav
  today:        'Today',
  history:      'History',
  planner:      'Planner',
  calendars:    'Calendars',
  settings:     'Settings',
  foodLogger:   'Food Logger',
  weekOverview: 'Week overview',
  signOut:      'Sign out',

  // Today tab
  goodMorning:  'Good morning',
  goodAfternoon:'Good afternoon',
  goodEvening:  'Good evening',

  // General
  save:         'Save',
  cancel:       'Cancel',
  done:         'Done',
  loading:      'Loading…',
  error:        'Error',
}

const nl: typeof en = {
  // Drawer nav
  today:        'Vandaag',
  history:      'Geschiedenis',
  planner:      'Planner',
  calendars:    'Agenda\'s',
  settings:     'Instellingen',
  foodLogger:   'Voedingsdagboek',
  weekOverview: 'Weekoverzicht',
  signOut:      'Uitloggen',

  // Today tab
  goodMorning:  'Goedemorgen',
  goodAfternoon:'Goedemiddag',
  goodEvening:  'Goedenavond',

  // General
  save:         'Opslaan',
  cancel:       'Annuleren',
  done:         'Klaar',
  loading:      'Laden…',
  error:        'Fout',
}

export const translations: Record<AppLanguage, typeof en> = { en, nl }

export type TranslationKey = keyof typeof en

export const LanguageContext = createContext<{
  lang: AppLanguage
  setLang: (l: AppLanguage) => void
  t: (key: TranslationKey) => string
}>({
  lang: 'en',
  setLang: () => {},
  t: (key) => en[key],
})

export function useLanguage() {
  return useContext(LanguageContext)
}
