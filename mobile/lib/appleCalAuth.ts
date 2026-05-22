import * as Calendar from 'expo-calendar'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'

const EVENTS_KEY = 'apple_cal_events'
const CONNECTED_KEY = 'apple_cal_connected'

export async function requestAppleCalPermission(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false
  const { status } = await Calendar.requestCalendarPermissionsAsync()
  if (status === 'granted') {
    await AsyncStorage.setItem(CONNECTED_KEY, 'true')
    return true
  }
  return false
}

export async function isAppleCalConnected(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false
  const stored = await AsyncStorage.getItem(CONNECTED_KEY)
  if (stored !== 'true') return false
  const { status } = await Calendar.getCalendarPermissionsAsync()
  return status === 'granted'
}

export async function disconnectAppleCal(): Promise<void> {
  await AsyncStorage.removeItem(CONNECTED_KEY)
  // Permission stays granted system-wide; we just stop using it
}

async function getOrCreateStravaEatCalendarId(): Promise<string | null> {
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)
    const existing = calendars.find(c => c.title === 'StravaEat')
    if (existing) return existing.id

    const defaultCal = await Calendar.getDefaultCalendarAsync()
    const newId = await Calendar.createCalendarAsync({
      title: 'StravaEat',
      color: '#F5A623',
      entityType: Calendar.EntityTypes.EVENT,
      sourceId: (defaultCal as any)?.source?.id,
      source: (defaultCal as any)?.source,
      name: 'StravaEat',
      ownerAccount: 'personal',
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    })
    return newId
  } catch {
    return null
  }
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toTimeStr(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export async function createAppleCalEvent(opts: {
  title: string
  date: string
  startTime?: string
  endTime?: string
  isAllDay: boolean
  notes?: string
}): Promise<void> {
  if (!(await isAppleCalConnected())) return
  try {
    const calId = await getOrCreateStravaEatCalendarId()
    if (!calId) return
    const [y, m, d] = opts.date.split('-').map(Number)

    let startDate: Date
    let endDate: Date
    if (opts.isAllDay || !opts.startTime) {
      startDate = new Date(y, m - 1, d, 9, 0, 0)
      endDate   = new Date(y, m - 1, d, 10, 0, 0)
    } else {
      const [sh, sm] = opts.startTime.split(':').map(Number)
      const [eh, em] = (opts.endTime ?? opts.startTime).split(':').map(Number)
      startDate = new Date(y, m - 1, d, sh, sm, 0)
      endDate   = new Date(y, m - 1, d, eh, em, 0)
      if (endDate <= startDate) endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
    }

    await Calendar.createEventAsync(calId, {
      title: opts.title,
      startDate,
      endDate,
      allDay: opts.isAllDay && !opts.startTime,
      notes: opts.notes,
    })
  } catch {
    // Non-critical
  }
}

export async function updateAppleCalEvent(eventId: string, opts: {
  title: string
  date: string
  startTime?: string
  endTime?: string
  isAllDay: boolean
  notes?: string
}): Promise<void> {
  try {
    const [y, m, d] = opts.date.split('-').map(Number)
    let startDate: Date
    let endDate: Date
    if (opts.isAllDay || !opts.startTime) {
      startDate = new Date(y, m - 1, d, 9, 0, 0)
      endDate   = new Date(y, m - 1, d, 10, 0, 0)
    } else {
      const [sh, sm] = opts.startTime.split(':').map(Number)
      const [eh, em] = (opts.endTime ?? opts.startTime).split(':').map(Number)
      startDate = new Date(y, m - 1, d, sh, sm, 0)
      endDate   = new Date(y, m - 1, d, eh, em, 0)
      if (endDate <= startDate) endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
    }
    await Calendar.updateEventAsync(eventId, {
      title: opts.title,
      startDate,
      endDate,
      allDay: opts.isAllDay && !opts.startTime,
      notes: opts.notes,
    })
  } catch {
    // Non-critical
  }
}

export async function deleteAppleCalEventById(eventId: string): Promise<void> {
  try {
    await Calendar.deleteEventAsync(eventId)
  } catch {
    // Non-critical
  }
}

export async function addWorkoutToAppleCal(
  workoutId: string,
  title: string,
  date: string,
  durationMin?: number,
  preferredTime?: string,
): Promise<void> {
  if (!(await isAppleCalConnected())) return
  try {
    const calId = await getOrCreateStravaEatCalendarId()
    if (!calId) return
    const [y, m, d] = date.split('-').map(Number)
    const dur = durationMin ?? 60
    const [sh, sm] = (preferredTime ?? '07:00').split(':').map(Number)
    const totalEnd = sh * 60 + sm + dur
    const startDate = new Date(y, m - 1, d, sh, sm, 0)
    const endDate   = new Date(y, m - 1, d, Math.floor(totalEnd / 60) % 24, totalEnd % 60, 0)
    const eventId = await Calendar.createEventAsync(calId, {
      title,
      startDate,
      endDate,
      notes: 'Created by StravaEat',
    })
    const raw = await AsyncStorage.getItem(EVENTS_KEY)
    const map: Record<string, string> = raw ? JSON.parse(raw) : {}
    map[workoutId] = eventId
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(map))
  } catch {
    // Non-critical — don't block the user
  }
}

export async function removeWorkoutFromAppleCal(workoutId: string): Promise<void> {
  if (!(await isAppleCalConnected())) return
  try {
    const raw = await AsyncStorage.getItem(EVENTS_KEY)
    if (!raw) return
    const map: Record<string, string> = JSON.parse(raw)
    const eventId = map[workoutId]
    if (!eventId) return
    await Calendar.deleteEventAsync(eventId)
    delete map[workoutId]
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(map))
  } catch {
    // Non-critical
  }
}

export interface AppleCalEvent {
  id: string
  title: string
  date: string
  startTime: string | null
  endTime: string | null
  isAllDay: boolean
}

export async function getAppleCalEvents(startDate: Date, endDate: Date): Promise<AppleCalEvent[]> {
  if (!(await isAppleCalConnected())) return []
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)
    const events = await Calendar.getEventsAsync(
      calendars.map(c => c.id),
      startDate,
      endDate,
    )
    return events.map(e => {
      const start = new Date(e.startDate as string)
      const end = new Date(e.endDate as string)
      return {
        id: `apple_${e.id}`,
        title: e.title,
        date: toDateStr(start),
        startTime: e.allDay ? null : toTimeStr(start),
        endTime: e.allDay ? null : toTimeStr(end),
        isAllDay: e.allDay ?? false,
      }
    })
  } catch {
    return []
  }
}
