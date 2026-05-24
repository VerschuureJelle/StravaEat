import AsyncStorage from '@react-native-async-storage/async-storage'

const key = (userId: string) => `onboarding_done:${userId}`

export async function getOnboardingDone(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key(userId))) === 'true'
  } catch {
    return false
  }
}

export async function setOnboardingDone(userId: string): Promise<void> {
  AsyncStorage.setItem(key(userId), 'true').catch(() => {})
}
