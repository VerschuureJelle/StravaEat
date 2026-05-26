import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, Pressable, ScrollView, StyleSheet, Modal,
  ActivityIndicator, RefreshControl, TextInput, Switch, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { getAppleCalEvents, createAppleCalEvent, updateAppleCalEvent, isAppleCalConnected, deleteAppleCalEventById } from '../../lib/appleCalAuth'
import { W as C } from '../../lib/themeWarm'
import { AppDrawer, HamburgerBtn } from '../../components/DrawerNav'

interface CalEvent {
  id: string
  title: string
  date: string
  startTime: string | null
  endTime: string | null
  isAllDay: boolean
  provider: 'google' | 'microsoft' | 'apple'
  isOurs: boolean
}

// ─── date helpers ─────────────────────────────────────────────────────────────

function toStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toDisplay(yyyy: string): string {
  const [y, m, d] = yyyy.split('-')
  return `${d}-${m}-${y}`
}

function fromDisplay(dd: string): string | null {
  const parts = dd.replace(/\//g, '-').split('-')
  if (parts.length !== 3 || parts[2].length !== 4) return null
  const [d, m, y] = parts
  const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d))
  if (isNaN(date.getTime()) || date.getMonth() !== parseInt(m) - 1) return null
  return toStr(date)
}

function parse(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}

function startOfWeek(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7))
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function buildMonthGrid(year: number, month: number): string[][] {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7
  const total = daysInMonth(year, month)
  const cells: string[] = []
  for (let i = 0; i < firstDow; i++) cells.push('')
  for (let d = 1; d <= total; d++)
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push('')
  const rows: string[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  return rows
}

const DOW    = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']

function rangeLabel(start: string, end: string | null): string {
  if (!end || start === end) {
    const today = toStr(new Date())
    if (start === today) return 'Today'
    return parse(start).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  }
  const lo = start < end ? start : end
  const hi = start < end ? end   : start
  return `${parse(lo).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${parse(hi).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

const provColor = (p: 'google' | 'microsoft' | 'apple') =>
  p === 'google' ? '#EA4335' : p === 'microsoft' ? '#0078D4' : '#1C8EF9'

// ─── screen ──────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const today = toStr(new Date())

  const [current, setCurrent]         = useState(new Date())
  const [selStart, setSelStart]       = useState<string>(today)
  const [selEnd, setSelEnd]           = useState<string | null>(null)
  const [pickingRange, setPickingRange] = useState(false)
  const [dropdown, setDropdown]       = useState(false)
  const [events, setEvents]           = useState<CalEvent[]>([])
  const [fetchedRange, setFetchedRange] = useState<{ start: string; end: string } | null>(null)
  const [loading, setLoading]         = useState(true)
  const [refreshing, setRefreshing]   = useState(false)
  const [noCalendars, setNoCalendars] = useState(false)

  // Connected providers (set during init)
  const [connectedProviders, setConnectedProviders] = useState<Set<'google' | 'microsoft' | 'apple'>>(new Set())

  // Create / edit event modal — editingEvent non-null means edit mode
  const [createModal, setCreateModal]     = useState(false)
  const [editingEvent, setEditingEvent]   = useState<CalEvent | null>(null)
  const [evTitle, setEvTitle]             = useState('')
  const [evDate, setEvDate]               = useState(today)
  const [evDateDisplay, setEvDateDisplay] = useState(toDisplay(today))
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [datePickerMonth, setDatePickerMonth] = useState(new Date())
  const [evIsAllDay, setEvIsAllDay]       = useState(true)
  const [evStartTime, setEvStartTime]     = useState('09:00')
  const [evEndTime, setEvEndTime]         = useState('10:00')
  const [evNotes, setEvNotes]             = useState('')
  const [evProviders, setEvProviders]     = useState<Set<'google' | 'microsoft' | 'apple'>>(new Set())
  const [evSaving, setEvSaving]           = useState(false)
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null)

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('users').select('google_cal_refresh_token, microsoft_cal_refresh_token')
      .eq('id', user.id).single()

    const providers = new Set<'google' | 'microsoft' | 'apple'>()
    if (data?.google_cal_refresh_token) providers.add('google')
    if (data?.microsoft_cal_refresh_token) providers.add('microsoft')
    const appleOk = await isAppleCalConnected()
    if (appleOk) providers.add('apple')

    setConnectedProviders(providers)

    if (providers.size === 0) {
      setNoCalendars(true); setLoading(false); return
    }
    await fetchForMonth(new Date())
    setLoading(false)
  }

  function openCreateModal() {
    setEditingEvent(null)
    setEvTitle('')
    setEvDate(selStart)
    setEvDateDisplay(toDisplay(selStart))
    setShowDatePicker(false)
    setDatePickerMonth(parse(selStart))
    setEvIsAllDay(true)
    setEvStartTime('09:00')
    setEvEndTime('10:00')
    setEvNotes('')
    setEvProviders(new Set(connectedProviders))
    setCreateModal(true)
  }

  function openEditModal(event: CalEvent) {
    setEditingEvent(event)
    setEvTitle(event.title)
    setEvDate(event.date)
    setEvDateDisplay(toDisplay(event.date))
    setShowDatePicker(false)
    setDatePickerMonth(parse(event.date))
    setEvIsAllDay(event.isAllDay)
    setEvStartTime(event.startTime ?? '09:00')
    setEvEndTime(event.endTime ?? '10:00')
    setEvNotes('')
    setEvProviders(new Set([event.provider]))
    setCreateModal(true)
  }

  async function saveEvent() {
    if (!evTitle.trim()) { Alert.alert('Missing title', 'Please enter an event title.'); return }
    setEvSaving(true)
    try {
      const eventOpts = {
        title: evTitle.trim(),
        date: evDate,
        startTime: evIsAllDay ? undefined : evStartTime,
        endTime: evIsAllDay ? undefined : evEndTime,
        isAllDay: evIsAllDay,
        notes: evNotes.trim() || undefined,
      }

      if (editingEvent) {
        // ── Edit mode ──────────────────────────────────────────────────────────
        if (editingEvent.provider === 'apple') {
          const rawId = editingEvent.id.replace(/^apple_/, '')
          await updateAppleCalEvent(rawId, eventOpts)
        } else {
          const rawId = editingEvent.id.replace(/^(google_|microsoft_)/, '')
          await supabase.functions.invoke('cal-update-event', {
            body: { event_id: rawId, provider: editingEvent.provider, ...eventOpts },
          })
        }
        // Update in local state immediately without re-fetching
        setEvents(prev => prev.map(e =>
          e.id === editingEvent.id
            ? { ...e, title: eventOpts.title, date: eventOpts.date, isAllDay: eventOpts.isAllDay, startTime: eventOpts.startTime ?? null, endTime: eventOpts.endTime ?? null }
            : e,
        ))
      } else {
        // ── Create mode ────────────────────────────────────────────────────────
        const cloudProviders = [...evProviders].filter((p): p is 'google' | 'microsoft' => p !== 'apple')
        const ops: Promise<any>[] = []
        if (cloudProviders.length > 0) {
          ops.push(supabase.functions.invoke('cal-create-event', {
            body: { ...eventOpts, providers: cloudProviders },
          }))
        }
        if (evProviders.has('apple')) {
          ops.push(createAppleCalEvent(eventOpts))
        }
        await Promise.all(ops)
        setFetchedRange(null)
        await fetchForMonth(current)
      }

      setCreateModal(false)
    } catch {
      Alert.alert('Error', `Could not ${editingEvent ? 'update' : 'save'} the event. Try again.`)
    } finally {
      setEvSaving(false)
    }
  }

  async function fetchForMonth(d: Date) {
    const start = toStr(new Date(d.getFullYear(), d.getMonth() - 1, 1))
    const end   = toStr(new Date(d.getFullYear(), d.getMonth() + 2, 0))
    if (fetchedRange && start >= fetchedRange.start && end <= fetchedRange.end) return

    const [cloudResult, appleEvents] = await Promise.all([
      supabase.functions.invoke('cal-get-events', { body: { startDate: start, endDate: end } })
        .catch(() => ({ data: null, error: true })),
      getAppleCalEvents(new Date(start), new Date(end)),
    ])

    const cloudEvents: CalEvent[] = (!cloudResult.error && cloudResult.data) ? cloudResult.data as CalEvent[] : []
    const appleFormatted: CalEvent[] = appleEvents.map(e => ({ ...e, provider: 'apple' as const, isOurs: false }))
    const allNew = [...cloudEvents, ...appleFormatted]

    if (allNew.length > 0 || !cloudResult.error) {
      setEvents(prev => {
        const ids = new Set(allNew.map(e => e.id))
        return [...prev.filter(e => !ids.has(e.id)), ...allNew]
      })
      setFetchedRange(prev =>
        prev
          ? { start: prev.start < start ? prev.start : start, end: prev.end > end ? prev.end : end }
          : { start, end },
      )
    }
  }

  function confirmDeleteEvent(event: CalEvent) {
    Alert.alert(
      'Delete event?',
      `"${event.title}" will be permanently removed from your calendar.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteEvent(event) },
      ],
    )
  }

  async function deleteEvent(event: CalEvent) {
    setDeletingEventId(event.id)
    try {
      if (event.provider === 'apple') {
        const rawId = event.id.replace(/^apple_/, '')
        await deleteAppleCalEventById(rawId)
      } else {
        const rawId = event.id.replace(/^(google_|microsoft_)/, '')
        await supabase.functions.invoke('cal-delete-event', {
          body: { event_id: rawId, provider: event.provider },
        })
      }
      setEvents(prev => prev.filter(e => e.id !== event.id))
    } catch {
      Alert.alert('Error', 'Could not delete the event. Try again.')
    } finally {
      setDeletingEventId(null)
    }
  }

  function navigate(dir: 1 | -1) {
    const next = new Date(current)
    next.setMonth(next.getMonth() + dir)
    setCurrent(next)
    fetchForMonth(next)
  }

  function handleDayPress(dateStr: string) {
    if (!dateStr) return
    if (pickingRange) {
      // second tap — set end of range
      setSelEnd(dateStr)
      setPickingRange(false)
    } else {
      setSelStart(dateStr)
      setSelEnd(null)
      setCurrent(parse(dateStr))
    }
  }

  function applyRangeOption(option: string) {
    setDropdown(false)
    setPickingRange(false)
    const now = new Date()
    if (option === 'today') {
      setSelStart(today); setSelEnd(null)
      setCurrent(now)
    } else if (option === 'week') {
      const mon = startOfWeek(now)
      setSelStart(toStr(mon)); setSelEnd(toStr(addDays(mon, 6)))
      setCurrent(now)
    } else if (option === 'month') {
      setSelStart(toStr(new Date(now.getFullYear(), now.getMonth(), 1)))
      setSelEnd(toStr(new Date(now.getFullYear(), now.getMonth() + 1, 0)))
      setCurrent(now)
    } else if (option === 'next7') {
      setSelStart(today); setSelEnd(toStr(addDays(now, 6)))
      setCurrent(now)
    } else if (option === 'custom') {
      setSelStart(today); setSelEnd(null)
      setPickingRange(true) // next two taps = start then end
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    setFetchedRange(null)
    await fetchForMonth(current)
    setRefreshing(false)
  }, [current])

  function eventsFor(date: string): CalEvent[] {
    return events.filter(e => e.date === date)
  }

  function selectedEvents(): CalEvent[] {
    const lo = selEnd && selStart > selEnd ? selEnd : selStart
    const hi = selEnd && selStart > selEnd ? selStart : (selEnd ?? selStart)
    return events
      .filter(e => e.date >= lo && e.date <= hi)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.isAllDay ? -1 : 1) || (a.startTime ?? '').localeCompare(b.startTime ?? ''))
  }

  const grid  = buildMonthGrid(current.getFullYear(), current.getMonth())
  const shown = selectedEvents()
  const lo    = selEnd && selStart > selEnd ? selEnd : selStart
  const hi    = selEnd && selStart > selEnd ? selStart : (selEnd ?? selStart)

  return (
    <AppDrawer>
      {openDrawer => (
        <SafeAreaView style={s.safe} edges={['top', 'bottom']}>

          {/* Header */}
          <View style={s.topBar}>
            <HamburgerBtn onPress={openDrawer} />
            <Text style={s.title}>Calendar</Text>
            <View style={s.topBarRight}>
              <Pressable onPress={() => { setSelStart(today); setSelEnd(null); setCurrent(new Date()); setPickingRange(false) }}>
                <Text style={s.todayBtn}>Today</Text>
              </Pressable>
              {!noCalendars && (
                <Pressable style={s.addBtn} onPress={openCreateModal}>
                  <Ionicons name="add" size={22} color={C.accent} />
                </Pressable>
              )}
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
          >
            {loading ? (
              <View style={s.center}><ActivityIndicator color={C.accent} size="large" /></View>
            ) : noCalendars ? (
              <View style={s.center}>
                <Ionicons name="calendar-outline" size={52} color={C.text3} style={{ marginBottom: 12 }} />
                <Text style={s.emptyTitle}>No calendars connected</Text>
                <Text style={s.emptySub}>Connect Google, Outlook, or Apple Calendar in Settings → Calendars</Text>
              </View>
            ) : (
              <>
                {/* Month navigation */}
                <View style={s.navRow}>
                  <Pressable style={s.navBtn} onPress={() => navigate(-1)}>
                    <Ionicons name="chevron-back" size={22} color={C.text1} />
                  </Pressable>
                  <Text style={s.navLabel}>{MONTHS[current.getMonth()]} {current.getFullYear()}</Text>
                  <Pressable style={s.navBtn} onPress={() => navigate(1)}>
                    <Ionicons name="chevron-forward" size={22} color={C.text1} />
                  </Pressable>
                </View>

                {/* Calendar grid */}
                <View style={s.calBox}>
                  <View style={s.dowRow}>
                    {DOW.map(d => <Text key={d} style={s.dowLabel}>{d}</Text>)}
                  </View>

                  {grid.map((row, ri) => (
                    <View key={ri} style={s.weekRow}>
                      {row.map((dateStr, ci) => {
                        if (!dateStr) return <View key={ci} style={s.cell} />
                        const evs       = eventsFor(dateStr)
                        const isToday   = dateStr === today
                        const isSel     = dateStr === selStart || dateStr === selEnd
                        const inRange   = selEnd != null && dateStr > lo && dateStr < hi
                        const isRangeStart = dateStr === lo && selEnd != null
                        const isRangeEnd   = dateStr === hi && selEnd != null
                        return (
                          <Pressable
                            key={ci}
                            style={[
                              s.cell,
                              inRange && s.cellInRange,
                              isRangeStart && s.cellRangeStart,
                              isRangeEnd   && s.cellRangeEnd,
                            ]}
                            onPress={() => handleDayPress(dateStr)}
                          >
                            <View style={[
                              s.numCircle,
                              isToday && !isSel && s.numToday,
                              isSel && s.numSel,
                            ]}>
                              <Text style={[
                                s.numText,
                                isToday && !isSel && s.numTextToday,
                                isSel && s.numTextSel,
                              ]}>
                                {parseInt(dateStr.split('-')[2])}
                              </Text>
                            </View>
                            <View style={s.dots}>
                              {evs.slice(0, 3).map((e, i) => (
                                <View key={i} style={[s.dot, { backgroundColor: provColor(e.provider) }]} />
                              ))}
                            </View>
                          </Pressable>
                        )
                      })}
                    </View>
                  ))}
                </View>

                {/* Range bar */}
                <View style={s.rangeBar}>
                  <View style={s.rangeBarLeft}>
                    {pickingRange
                      ? <Text style={s.rangeHint}>Tap a day to start your range, then tap another to end it</Text>
                      : <Text style={s.rangeLabel}>{rangeLabel(selStart, selEnd)}</Text>
                    }
                  </View>
                  <Pressable style={s.rangeDropBtn} onPress={() => setDropdown(true)}>
                    <Text style={s.rangeDropBtnText}>Range</Text>
                    <Ionicons name="chevron-down" size={13} color={C.accent} />
                  </Pressable>
                </View>

                {/* Events */}
                <View style={s.eventsSection}>
                  {shown.length === 0 ? (
                    <Text style={s.noEvents}>No events</Text>
                  ) : (
                    shown.map(event => (
                      <Pressable key={event.id} style={s.eventCard} onPress={() => openEditModal(event)}>
                        <View style={[s.eventBar, { backgroundColor: provColor(event.provider) }]} />
                        <View style={s.eventBody}>
                          <Text style={s.eventTitle} numberOfLines={2}>{event.title}</Text>
                          <View style={s.eventMeta}>
                            <Text style={s.eventTime}>
                              {event.isAllDay ? 'All day' : `${event.startTime}${event.endTime ? ` – ${event.endTime}` : ''}`}
                            </Text>
                            {selEnd && selStart !== selEnd && (
                              <Text style={s.eventDateChip}>
                                {parse(event.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                              </Text>
                            )}
                            {event.isOurs && <View style={s.ours}><Text style={s.oursText}>StravaEat</Text></View>}
                          </View>
                        </View>
                        <View style={[s.provBadge, { backgroundColor: provColor(event.provider) + '22' }]}>
                          <Text style={[s.provLetter, { color: provColor(event.provider) }]}>
                            {event.provider === 'google' ? 'G' : event.provider === 'microsoft' ? 'M' : 'A'}
                          </Text>
                        </View>
                        <Pressable
                          style={s.deleteBtn}
                          onPress={(e) => { e.stopPropagation?.(); confirmDeleteEvent(event) }}
                          disabled={deletingEventId === event.id}
                          hitSlop={8}
                        >
                          {deletingEventId === event.id
                            ? <ActivityIndicator size="small" color={C.text3} />
                            : <Ionicons name="trash-outline" size={16} color={C.text3} />
                          }
                        </Pressable>
                      </Pressable>
                    ))
                  )}
                </View>
              </>
            )}
          </ScrollView>

          {/* Create event modal */}
          <Modal visible={createModal} transparent animationType="slide" onRequestClose={() => setCreateModal(false)}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
              <Pressable style={s.backdrop} onPress={() => setCreateModal(false)}>
                <Pressable style={s.createSheet} onPress={e => e.stopPropagation()}>
                  <View style={s.createHandle} />
                  <Text style={s.createTitle}>{editingEvent ? 'Edit Event' : 'New Event'}</Text>

                  <Text style={s.createLabel}>Title</Text>
                  <TextInput
                    style={s.createInput}
                    placeholder="Event title"
                    placeholderTextColor={C.text3}
                    value={evTitle}
                    onChangeText={setEvTitle}
                    autoFocus
                  />

                  <Text style={s.createLabel}>Date</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <TextInput
                      style={[s.createInput, { flex: 1, marginBottom: 0 }]}
                      placeholder="DD-MM-YYYY"
                      placeholderTextColor={C.text3}
                      value={evDateDisplay}
                      onChangeText={v => {
                        setEvDateDisplay(v)
                        const parsed = fromDisplay(v)
                        if (parsed) { setEvDate(parsed); setDatePickerMonth(parse(parsed)) }
                      }}
                      keyboardType="numbers-and-punctuation"
                    />
                    <Pressable
                      style={{ padding: 10, backgroundColor: C.surface2, borderRadius: 10, borderWidth: 1, borderColor: showDatePicker ? C.accent : C.border }}
                      onPress={() => setShowDatePicker(v => !v)}
                    >
                      <Ionicons name="calendar-outline" size={20} color={showDatePicker ? C.accent : C.text2} />
                    </Pressable>
                  </View>

                  {showDatePicker && (() => {
                    const grid = buildMonthGrid(datePickerMonth.getFullYear(), datePickerMonth.getMonth())
                    return (
                      <View style={s.miniCal}>
                        <View style={s.miniCalNav}>
                          <Pressable hitSlop={10} onPress={() => setDatePickerMonth(p => new Date(p.getFullYear(), p.getMonth() - 1, 1))}>
                            <Ionicons name="chevron-back" size={18} color={C.text1} />
                          </Pressable>
                          <Text style={s.miniCalTitle}>
                            {MONTHS[datePickerMonth.getMonth()]} {datePickerMonth.getFullYear()}
                          </Text>
                          <Pressable hitSlop={10} onPress={() => setDatePickerMonth(p => new Date(p.getFullYear(), p.getMonth() + 1, 1))}>
                            <Ionicons name="chevron-forward" size={18} color={C.text1} />
                          </Pressable>
                        </View>
                        <View style={s.miniCalDowRow}>
                          {DOW.map(d => <Text key={d} style={s.miniCalDow}>{d}</Text>)}
                        </View>
                        {grid.map((week, wi) => (
                          <View key={wi} style={s.miniCalWeekRow}>
                            {week.map((cell, di) => {
                              const isSelected = cell === evDate
                              const isToday = cell === toStr(new Date())
                              return (
                                <Pressable
                                  key={di}
                                  style={[s.miniCalCell, isSelected && s.miniCalCellSel]}
                                  onPress={() => {
                                    if (!cell) return
                                    setEvDate(cell)
                                    setEvDateDisplay(toDisplay(cell))
                                    setShowDatePicker(false)
                                  }}
                                  disabled={!cell}
                                >
                                  <Text style={[s.miniCalCellText, isToday && !isSelected && s.miniCalCellToday, isSelected && s.miniCalCellSelText]}>
                                    {cell ? parseInt(cell.split('-')[2]) : ''}
                                  </Text>
                                </Pressable>
                              )
                            })}
                          </View>
                        ))}
                      </View>
                    )
                  })()}

                  <View style={s.createRow}>
                    <Text style={s.createLabel}>All day</Text>
                    <Switch
                      value={evIsAllDay}
                      onValueChange={setEvIsAllDay}
                      trackColor={{ false: C.surface2, true: C.accent + '88' }}
                      thumbColor={evIsAllDay ? C.accent : C.text3}
                    />
                  </View>

                  {!evIsAllDay && (
                    <View style={s.timeRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.createLabel}>Start</Text>
                        <TextInput
                          style={s.createInput}
                          placeholder="09:00"
                          placeholderTextColor={C.text3}
                          value={evStartTime}
                          onChangeText={setEvStartTime}
                          keyboardType="numbers-and-punctuation"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.createLabel}>End</Text>
                        <TextInput
                          style={s.createInput}
                          placeholder="10:00"
                          placeholderTextColor={C.text3}
                          value={evEndTime}
                          onChangeText={setEvEndTime}
                          keyboardType="numbers-and-punctuation"
                        />
                      </View>
                    </View>
                  )}

                  <Text style={s.createLabel}>Notes (optional)</Text>
                  <TextInput
                    style={[s.createInput, { height: 64, textAlignVertical: 'top' }]}
                    placeholder="Add a note…"
                    placeholderTextColor={C.text3}
                    value={evNotes}
                    onChangeText={setEvNotes}
                    multiline
                  />

                  {connectedProviders.size > 1 && !editingEvent && (
                    <>
                      <Text style={s.createLabel}>Add to</Text>
                      <View style={s.provRow}>
                        {(['google', 'microsoft', 'apple'] as const).filter(p => connectedProviders.has(p)).map(p => {
                          const sel = evProviders.has(p)
                          const label = p === 'google' ? 'Google' : p === 'microsoft' ? 'Outlook' : 'Apple'
                          const color = provColor(p)
                          return (
                            <Pressable
                              key={p}
                              style={[s.provChip, sel && { backgroundColor: color + '22', borderColor: color }]}
                              onPress={() => {
                                setEvProviders(prev => {
                                  const next = new Set(prev)
                                  next.has(p) ? next.delete(p) : next.add(p)
                                  return next
                                })
                              }}
                            >
                              <View style={[s.provDot, { backgroundColor: color }]} />
                              <Text style={[s.provChipText, sel && { color }]}>{label}</Text>
                            </Pressable>
                          )
                        })}
                      </View>
                    </>
                  )}

                  <Pressable
                    style={[s.createSaveBtn, evSaving && { opacity: 0.6 }]}
                    onPress={saveEvent}
                    disabled={evSaving}
                  >
                    {evSaving
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={s.createSaveBtnText}>{editingEvent ? 'Save Changes' : 'Save Event'}</Text>
                    }
                  </Pressable>
                </Pressable>
              </Pressable>
            </KeyboardAvoidingView>
          </Modal>

          {/* Range dropdown modal */}
          <Modal visible={dropdown} transparent animationType="fade" onRequestClose={() => setDropdown(false)}>
            <Pressable style={s.backdrop} onPress={() => setDropdown(false)}>
              <View style={s.sheet}>
                <Text style={s.sheetTitle}>Select range</Text>
                {[
                  { key: 'today',  label: 'Today' },
                  { key: 'week',   label: 'This week  (Mon – Sun)' },
                  { key: 'month',  label: 'This month' },
                  { key: 'next7',  label: 'Next 7 days' },
                  { key: 'custom', label: 'Custom range…' },
                ].map(opt => (
                  <Pressable key={opt.key} style={s.sheetRow} onPress={() => applyRangeOption(opt.key)}>
                    <Text style={s.sheetRowText}>{opt.label}</Text>
                  </Pressable>
                ))}
                <Pressable style={s.sheetCancel} onPress={() => setDropdown(false)}>
                  <Text style={s.sheetCancelText}>Cancel</Text>
                </Pressable>
              </View>
            </Pressable>
          </Modal>

        </SafeAreaView>
      )}
    </AppDrawer>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: C.bg },
  topBar:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  title:          { fontSize: 18, fontWeight: '700', color: C.text1 },
  todayBtn:       { fontSize: 14, fontWeight: '600', color: C.accent },

  center:         { alignItems: 'center', paddingTop: 100, gap: 10 },
  emptyTitle:     { fontSize: 17, fontWeight: '700', color: C.text1 },
  emptySub:       { fontSize: 13, color: C.text3, textAlign: 'center' },

  navRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, marginBottom: 4 },
  navBtn:         { padding: 10 },
  navLabel:       { fontSize: 16, fontWeight: '700', color: C.text1 },

  calBox:         { marginHorizontal: 14, backgroundColor: C.surface, borderRadius: 16, padding: 10, marginBottom: 0 },
  dowRow:         { flexDirection: 'row', marginBottom: 2 },
  dowLabel:       { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: C.text3, textTransform: 'uppercase', paddingVertical: 4 },
  weekRow:        { flexDirection: 'row' },

  cell:           { flex: 1, alignItems: 'center', paddingVertical: 3 },
  cellInRange:    { backgroundColor: C.accent + '15' },
  cellRangeStart: { backgroundColor: C.accent + '15', borderTopLeftRadius: 20, borderBottomLeftRadius: 20 },
  cellRangeEnd:   { backgroundColor: C.accent + '15', borderTopRightRadius: 20, borderBottomRightRadius: 20 },
  numCircle:      { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  numToday:       { borderWidth: 1.5, borderColor: C.accent },
  numSel:         { backgroundColor: C.accent },
  numText:        { fontSize: 13, fontWeight: '500', color: C.text1 },
  numTextToday:   { color: C.accent, fontWeight: '700' },
  numTextSel:     { color: '#fff', fontWeight: '700' },
  dots:           { flexDirection: 'row', gap: 2, height: 5, marginTop: 1 },
  dot:            { width: 4, height: 4, borderRadius: 2 },

  rangeBar:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 14, marginTop: 10, marginBottom: 6, backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  rangeBarLeft:   { flex: 1 },
  rangeLabel:     { fontSize: 14, fontWeight: '600', color: C.text1 },
  rangeHint:      { fontSize: 12, color: C.accent, fontStyle: 'italic' },
  rangeDropBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: C.surface2, borderRadius: 8 },
  rangeDropBtnText: { fontSize: 12, fontWeight: '600', color: C.accent },

  eventsSection:  { marginHorizontal: 14, marginTop: 2, marginBottom: 40 },
  noEvents:       { textAlign: 'center', color: C.text3, fontSize: 13, paddingVertical: 24 },

  eventCard:      { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 12, padding: 12, marginBottom: 6, gap: 10 },
  eventBar:       { width: 4, height: 38, borderRadius: 2 },
  eventBody:      { flex: 1 },
  eventTitle:     { fontSize: 14, fontWeight: '600', color: C.text1, marginBottom: 3 },
  eventMeta:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eventTime:      { fontSize: 12, color: C.text3 },
  eventDateChip:  { fontSize: 12, color: C.text3 },
  ours:           { backgroundColor: C.accent + '22', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  oursText:       { fontSize: 10, fontWeight: '700', color: C.accent },
  provBadge:      { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  provLetter:     { fontSize: 11, fontWeight: '800' },
  deleteBtn:      { padding: 6, marginLeft: 2 },

  topBarRight:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addBtn:         { padding: 4 },

  backdrop:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },

  createSheet:    { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 36, paddingTop: 12, paddingHorizontal: 20 },
  createHandle:   { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  createTitle:    { fontSize: 18, fontWeight: '700', color: C.text1, marginBottom: 16 },
  createLabel:    { fontSize: 12, fontWeight: '600', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5, marginTop: 12 },
  createInput:    { backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.text1 },
  createRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  timeRow:        { flexDirection: 'row', gap: 10, marginTop: 4 },
  provRow:        { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  provChip:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: C.surface2, borderWidth: 1.5, borderColor: 'transparent' },
  provDot:        { width: 8, height: 8, borderRadius: 4 },
  provChipText:   { fontSize: 13, fontWeight: '600', color: C.text2 },
  createSaveBtn:  { backgroundColor: C.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  createSaveBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  sheet:          { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32, paddingTop: 20, paddingHorizontal: 20 },
  sheetTitle:     { fontSize: 13, fontWeight: '700', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  sheetRow:       { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  sheetRowText:   { fontSize: 16, fontWeight: '500', color: C.text1 },
  sheetCancel:    { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  sheetCancelText: { fontSize: 15, color: C.text3, fontWeight: '600' },

  miniCal:        { backgroundColor: C.surface2, borderRadius: 14, padding: 12, marginBottom: 12 },
  miniCalNav:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  miniCalTitle:   { fontSize: 14, fontWeight: '700', color: C.text1 },
  miniCalDowRow:  { flexDirection: 'row', marginBottom: 4 },
  miniCalDow:     { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: C.text3 },
  miniCalWeekRow: { flexDirection: 'row', marginBottom: 2 },
  miniCalCell:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 5, borderRadius: 20 },
  miniCalCellSel: { backgroundColor: C.accent },
  miniCalCellText:{ fontSize: 13, color: C.text1 },
  miniCalCellToday: { color: C.accent, fontWeight: '700' },
  miniCalCellSelText: { color: '#fff', fontWeight: '700' },
})
