import { useRef, useState, useEffect } from 'react'
import { View, Text, Pressable, StyleSheet, Image } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { DrawerLayout } from 'react-native-gesture-handler'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'
import { W as C } from '../lib/themeWarm'
import { useLanguage, LANGUAGES } from '../lib/i18n'

const NAV_ITEMS = [
  { label: 'Calendar', icon: 'calendar-clear-outline' as const, route: '/(tabs)/calendar' },
  { label: 'HR Zones', icon: 'pulse-outline'          as const, route: '/(tabs)/zones'    },
  { label: 'Profile',  icon: 'person-outline'         as const, route: '/(tabs)/profile'  },
]

function DrawerContent({ userName, avatarUrl, onNav, onClose }: {
  userName: string | null
  avatarUrl: string | null
  onNav: (route: string) => void
  onClose: () => void
}) {
  const { lang, setLang } = useLanguage()

  return (
    <SafeAreaView style={dr.container} edges={['top', 'bottom']}>
      <View style={dr.header}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={dr.avatarImg} />
        ) : (
          <View style={dr.avatar}>
            <Ionicons name="person-outline" size={26} color={C.accent2} />
          </View>
        )}
        <Text style={dr.userName}>{userName ?? 'Athlete'}</Text>
        <Text style={dr.appName}>StravaEat</Text>
      </View>

      <View style={dr.divider} />

      {NAV_ITEMS.map(item => (
        <Pressable key={item.route} style={dr.navItem} onPress={() => onNav(item.route)}>
          <Ionicons name={item.icon} size={20} color="rgba(255,255,255,0.65)" />
          <Text style={dr.navLabel}>{item.label}</Text>
        </Pressable>
      ))}

      <View style={dr.sectionDivider} />
      <View style={dr.langRow}>
        {LANGUAGES.map(l => (
          <Pressable
            key={l.code}
            style={[dr.langBtn, lang === l.code && dr.langBtnActive]}
            onPress={() => setLang(l.code)}
          >
            <Text style={dr.langFlag}>{l.flag}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flex: 1 }} />

      <Pressable style={dr.signOut} onPress={async () => { onClose(); await supabase.auth.signOut() }}>
        <Ionicons name="log-out-outline" size={18} color="rgba(255,255,255,0.35)" />
        <Text style={dr.signOutText}>Sign out</Text>
      </Pressable>
    </SafeAreaView>
  )
}

// ─── Hamburger button (warm light-bg variant) ─────────────────────────────────

export function HamburgerBtn({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} style={dr.hamburger}>
      <View style={dr.hamLine} />
      <View style={[dr.hamLine, { width: 16 }]} />
      <View style={dr.hamLine} />
    </Pressable>
  )
}

// ─── Wrapper component ────────────────────────────────────────────────────────

export function AppDrawer({ children }: { children: (openDrawer: () => void) => React.ReactNode }) {
  const router = useRouter()
  const drawerRef = useRef<DrawerLayout>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('users').select('name, avatar_url').eq('id', user.id).single().then(({ data }) => {
        if (data) { setUserName(data.name); setAvatarUrl(data.avatar_url ?? null) }
      })
    })
  }, [])

  function handleNav(route: string) {
    drawerRef.current?.closeDrawer()
    setTimeout(() => router.navigate(route as any), 180)
  }

  return (
    <DrawerLayout
      ref={drawerRef}
      drawerWidth={280}
      drawerPosition="left"
      drawerBackgroundColor={C.drawerBg}
      renderNavigationView={() => (
        <DrawerContent
          userName={userName}
          avatarUrl={avatarUrl}
          onNav={handleNav}
          onClose={() => drawerRef.current?.closeDrawer()}
        />
      )}
    >
      {children(() => drawerRef.current?.openDrawer())}
    </DrawerLayout>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const dr = StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.drawerBg, paddingHorizontal: 24 },
  header:      { paddingTop: 24, paddingBottom: 28, alignItems: 'flex-start' },
  avatar:      { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarImg:   { width: 56, height: 56, borderRadius: 28, marginBottom: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  userName:    { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 2 },
  appName:     { fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
  divider:        { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 10 },
  sectionDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 10, marginBottom: 14 },

  navItem:     { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  navLabel:    { fontSize: 17, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  signOut:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16, marginBottom: 8 },
  signOutText: { fontSize: 15, color: 'rgba(255,255,255,0.35)', fontWeight: '500' },
  hamburger:   { gap: 5, padding: 6 },
  hamLine:     { width: 22, height: 2.5, backgroundColor: C.text1, borderRadius: 1.5 },
  langRow:     { flexDirection: 'row', gap: 8, marginTop: 6 },
  langBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.06)' },
  langBtnActive: { borderColor: 'rgba(255,255,255,0.45)', backgroundColor: 'rgba(255,255,255,0.14)' },
  langFlag:    { fontSize: 18 },

})
