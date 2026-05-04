import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { supabase } from './supabase'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export async function registerForNotifications(): Promise<void> {
  const { status: existing } = await Notifications.getPermissionsAsync()
  let finalStatus = existing
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }
  if (finalStatus !== 'granted') return

  // Android needs a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'StravaEat',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    })
  }

  // Get Expo push token and save to DB (used for server-side push when built with EAS)
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync()
    const { data: { user } } = await supabase.auth.getUser()
    if (user && token) {
      await supabase.from('users').update({ push_token: token }).eq('id', user.id)
    }
  } catch {
    // Push token unavailable in Expo Go without EAS project ID — local notifications still work
  }
}

export async function notifyWorkoutSynced(
  burnedKcal: number,
  newTargetKcal: number | null,
): Promise<void> {
  const body = newTargetKcal
    ? `You burned ${Math.round(burnedKcal)} kcal. Your nutrition target is now ${newTargetKcal.toLocaleString()} kcal today — time to refuel!`
    : `You burned ${Math.round(burnedKcal)} kcal. Don't forget to refuel!`

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Workout synced!',
      body,
    },
    trigger: null, // immediate
  })
}
