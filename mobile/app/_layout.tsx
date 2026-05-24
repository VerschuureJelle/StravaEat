import { useEffect, useState, useMemo, useRef } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { supabase } from '../lib/supabase'
import { registerForNotifications, scheduleDailyMealNotificationsForUser } from '../lib/notifications'
import { callSyncRecent } from '../lib/stravaSync'
import { getOnboardingDone, setOnboardingDone } from '../lib/onboardingCache'
import { AppModeProvider } from '../contexts/AppModeContext'
import { LanguageContext, loadLanguage, saveLanguage, translations } from '../lib/i18n'
import type { AppLanguage } from '../lib/i18n'

export default function RootLayout() {
  const router = useRouter()
  const segments = useSegments()
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const [lang, setLangState] = useState<AppLanguage>('en')

  function setLang(l: AppLanguage) {
    setLangState(l)
    saveLanguage(l)
  }

  const langCtx = useMemo(() => ({
    lang,
    setLang,
    t: (key: keyof typeof translations['en']): string => translations[lang][key] ?? key,
  }), [lang])

  useEffect(() => {
    // Check for an existing persisted session on app start
    ;(async () => {
      try {
        // Run language load and session check in parallel — both are local reads
        const [lang, { data: { session } }] = await Promise.all([
          loadLanguage(),
          supabase.auth.getSession(),
        ])
        setLangState(lang)

        if (session) {
          registerForNotifications()
          scheduleDailyMealNotificationsForUser(session.user.id)
          callSyncRecent().catch(() => {})

          // Fast path: AsyncStorage cache hit — no DB round-trip needed
          const cached = await getOnboardingDone(session.user.id)
          if (cached) {
            router.replace('/(tabs)/today')
          } else {
            // Cache miss (first launch or new user): verify with DB
            const { data: profile } = await supabase.from('users')
              .select('onboarding_complete').eq('id', session.user.id).single()
            if (profile?.onboarding_complete) {
              setOnboardingDone(session.user.id)   // populate cache for next launch
              router.replace('/(tabs)/today')
            } else {
              router.replace('/(auth)/onboarding')
            }
          }
        } else {
          router.replace('/(auth)/')
        }
      } catch {
        router.replace('/(auth)/')
      } finally {
        readyRef.current = true
        setReady(true)
      }
    })()

    // Then keep listening for sign-in / sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!readyRef.current) return
      const inAuthGroup = segments[0] === '(auth)'
      const onOnboarding = (segments as string[])[1] === 'onboarding'
      if (!session && !inAuthGroup) router.replace('/(auth)/')
      if (session && inAuthGroup && !onOnboarding) router.replace('/(tabs)/today')
      if (session) { registerForNotifications(); scheduleDailyMealNotificationsForUser(session.user.id) }
    })

    return () => subscription.unsubscribe()
  }, [])  // runs once — readyRef avoids stale closure without re-triggering the effect

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LanguageContext.Provider value={langCtx}>
        <AppModeProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </AppModeProvider>
      </LanguageContext.Provider>
    </GestureHandlerRootView>
  )
}
