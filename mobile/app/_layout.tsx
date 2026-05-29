import { useEffect, useState } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { supabase } from '../lib/supabase'
import { registerForNotifications, scheduleDailyMealNotificationsForUser } from '../lib/notifications'
import { initPurchases } from '../lib/purchases'
import { callSyncRecent } from '../lib/stravaSync'
import { AppModeProvider } from '../contexts/AppModeContext'
import { LanguageContext, AppLanguage, translations, loadLanguage, saveLanguage } from '../lib/i18n'

export default function RootLayout() {
  const router = useRouter()
  const segments = useSegments()
  const [ready, setReady] = useState(false)
  const [lang, setLangState] = useState<AppLanguage>('en')

  useEffect(() => { loadLanguage().then(setLangState) }, [])

  function setLang(l: AppLanguage) {
    setLangState(l)
    saveLanguage(l)
  }

  useEffect(() => {
    // Check for an existing persisted session on app start
    supabase.auth.getSession().then(({ data: { session } }) => {
      redirect(session != null)
      if (session) {
        registerForNotifications()
        scheduleDailyMealNotificationsForUser(session.user.id)
        initPurchases(session.user.id).catch(() => {})
        // Route via callSyncRecent so the cooldown + in-flight flag dedupe
        // the second invocation triggered by [ready] re-running the effect.
        callSyncRecent().catch(() => {})
      }
      setReady(true)
    })

    // Then keep listening for sign-in / sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (ready) redirect(session != null)
      if (session) { registerForNotifications(); scheduleDailyMealNotificationsForUser(session.user.id) }
    })

    return () => subscription.unsubscribe()
  }, [ready])

  function redirect(isSignedIn: boolean) {
    const inAuthGroup = segments[0] === '(auth)'
    if (!isSignedIn && !inAuthGroup) router.replace('/(auth)/')
    else if (isSignedIn && inAuthGroup) router.replace('/(tabs)/today')
  }

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LanguageContext.Provider value={{ lang, setLang, t: (key) => translations[lang][key] }}>
        <AppModeProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </AppModeProvider>
      </LanguageContext.Provider>
    </GestureHandlerRootView>
  )
}
