import { View, Text, Pressable, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { W as C } from '../../lib/themeWarm'

export default function WelcomeScreen() {
  const router = useRouter()

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.top}>
        <Text style={styles.title}>StravaEat</Text>
        <Text style={styles.subtitle}>
          Understand exactly how much energy your training costs — zone by zone.
        </Text>
      </View>

      <View style={styles.bottom}>
        <Pressable style={styles.primaryBtn} onPress={() => router.push('/(auth)/signup')}>
          <Text style={styles.primaryBtnText}>Create account</Text>
        </Pressable>

        <Pressable style={styles.secondaryBtn} onPress={() => router.push('/(auth)/signin')}>
          <Text style={styles.secondaryBtnText}>Sign in</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, justifyContent: 'space-between', padding: 32 },
  top: { flex: 1, justifyContent: 'center' },
  title: { fontSize: 42, fontWeight: '800', color: C.accent, marginBottom: 16 },
  subtitle: { fontSize: 17, color: C.text2, lineHeight: 26 },
  bottom: { gap: 12 },
  primaryBtn: {
    backgroundColor: C.accent,
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: C.white, fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    borderWidth: 1.5,
    borderColor: C.accent,
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryBtnText: { color: C.accent, fontSize: 16, fontWeight: '700' },
})
