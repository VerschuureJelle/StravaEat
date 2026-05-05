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

function localDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function registerForNotifications(): Promise<void> {
  const { status: existing } = await Notifications.getPermissionsAsync()
  let finalStatus = existing
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }
  if (finalStatus !== 'granted') return

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'StravaEat',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    })
    await Notifications.setNotificationChannelAsync('meals', {
      name: 'Meal reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    })
  }

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

// Schedule overdue-meal notifications for a list of meals.
// Each unchecked meal gets a notification at scheduled_time + 1h.
// Cancels any existing notification for that meal index before rescheduling.
export async function scheduleMealNotifications(meals: Array<{
  meal_index: number
  name: string
  scheduled_time: string  // HH:MM
  date: string            // YYYY-MM-DD
  checked: boolean
}>): Promise<void> {
  const now = Date.now()

  for (const meal of meals) {
    const notifId = `meal-overdue-${meal.meal_index}`

    // Always cancel the existing one first so we start clean
    await Notifications.cancelScheduledNotificationAsync(notifId).catch(() => {})

    if (meal.checked) continue

    const [hh, mm] = meal.scheduled_time.split(':').map(Number)
    if (isNaN(hh) || isNaN(mm)) continue

    const [y, mo, d] = meal.date.split('-').map(Number)
    // Fire 1 hour after scheduled time
    const triggerMs = new Date(y, mo - 1, d, hh + 1, mm, 0, 0).getTime()
    const secondsUntil = Math.round((triggerMs - now) / 1000)

    if (secondsUntil <= 0) continue  // already past — don't schedule

    await Notifications.scheduleNotificationAsync({
      identifier: notifId,
      content: {
        title: `${meal.name} overdue`,
        body: `Your ${meal.name} was scheduled for ${meal.scheduled_time} and is now more than an hour overdue. Don't forget to eat!`,
        ...(Platform.OS === 'android' && { channelId: 'meals' }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsUntil,
        repeats: false,
      },
    })
  }
}

export async function cancelMealNotification(meal_index: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(`meal-overdue-${meal_index}`).catch(() => {})
}

// Called on app startup to schedule today's meal notifications without opening the Meals tab.
export async function scheduleDailyMealNotificationsForUser(userId: string): Promise<void> {
  try {
    const todayStr = localDate()
    const [templatesRes, checksRes] = await Promise.all([
      supabase.from('meal_templates').select('meal_index, name, scheduled_time').eq('user_id', userId).order('meal_index'),
      supabase.from('meal_checks').select('meal_index').eq('user_id', userId).eq('date', todayStr),
    ])
    const templates = templatesRes.data ?? []
    const checkedSet = new Set<number>((checksRes.data ?? []).map((c: any) => c.meal_index as number))
    if (templates.length === 0) return

    await scheduleMealNotifications(templates.map((t: any) => ({
      meal_index: t.meal_index,
      name: t.name,
      scheduled_time: t.scheduled_time,
      date: todayStr,
      checked: checkedSet.has(t.meal_index),
    })))
  } catch {
    // Non-critical — don't crash startup if this fails
  }
}
