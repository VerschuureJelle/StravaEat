import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type AppMode = 'athlete' | 'coach'

const KEY = '@stravaeat_app_mode'

interface AppModeContextValue {
  mode: AppMode
  setMode: (m: AppMode) => Promise<void>
  isCoach: boolean
}

const AppModeContext = createContext<AppModeContextValue>({
  mode: 'athlete',
  setMode: async () => {},
  isCoach: false,
})

export function AppModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>('athlete')

  useEffect(() => {
    AsyncStorage.getItem(KEY).then(v => {
      if (v === 'coach') setModeState('coach')
    })
  }, [])

  async function setMode(m: AppMode) {
    setModeState(m)
    await AsyncStorage.setItem(KEY, m)
  }

  return (
    <AppModeContext.Provider value={{ mode, setMode, isCoach: mode === 'coach' }}>
      {children}
    </AppModeContext.Provider>
  )
}

export function useAppMode() {
  return useContext(AppModeContext)
}
