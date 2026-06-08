import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { W as C } from '../../lib/themeWarm'

export default function ResetPasswordScreen() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleReset = async () => {
    if (password.length < 8) {
      Alert.alert('Too short', 'Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      Alert.alert('Password updated', 'You can now sign in with your new password.', [
        { text: 'Sign in', onPress: () => router.replace('/(auth)/signin') },
      ])
    } catch (err: any) {
      Alert.alert('Failed', err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Set new password</Text>
        <Text style={styles.subtitle}>Choose a new password for your StravaEat account.</Text>

        <Text style={styles.label}>New password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Min. 8 characters"
          placeholderTextColor={C.text3}
          secureTextEntry
          autoComplete="new-password"
          autoFocus
        />

        <Text style={styles.label}>Confirm password</Text>
        <TextInput
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Repeat your password"
          placeholderTextColor={C.text3}
          secureTextEntry
          autoComplete="new-password"
        />

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleReset}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={C.white} />
            : <Text style={styles.buttonText}>Update password</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { flex: 1, padding: 24, paddingTop: 48 },
  title: { fontSize: 28, fontWeight: '800', color: C.text1, marginBottom: 8 },
  subtitle: { fontSize: 14, color: C.text2, marginBottom: 32 },
  label: { fontSize: 14, fontWeight: '600', color: C.text2, marginBottom: 6, marginTop: 16 },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 14, fontSize: 16, backgroundColor: C.surface, color: C.text1,
  },
  button: {
    backgroundColor: C.accent, padding: 16, borderRadius: 10,
    alignItems: 'center', marginTop: 32,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: C.white, fontSize: 16, fontWeight: '700' },
})
