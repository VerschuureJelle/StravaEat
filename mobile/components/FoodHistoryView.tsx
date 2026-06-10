import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, Modal, ActivityIndicator, useWindowDimensions,
} from 'react-native'
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { W as C } from '../lib/themeWarm'

interface DayItem {
  name: string
  kcal: number
  protein_g: number | null
  fat_g: number | null
  carb_g: number | null
}

interface DayData {
  dateStr: string
  dayLabel: string
  fullDate: string
  isToday: boolean
  isFuture: boolean
  consumed: number
  burned: number
  target: number | null
  protein_g: number
  fat_g: number
  carb_g: number
  items: DayItem[]
}

type NutriPeriod = 'total' | 'week' | 'month' | 'year' | 'custom'

const NUTRI_PERIOD_OPTIONS: { label: string; value: NutriPeriod }[] = [
  { label: 'All history', value: 'total' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
  { label: 'Year', value: 'year' },
  { label: 'Custom range…', value: 'custom' },
]

function localDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nStartOf(period: Exclude<NutriPeriod, 'total' | 'custom'>, anchor: Date): Date {
  const d = new Date(anchor)
  switch (period) {
    case 'week': { const dow = d.getDay(); d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); d.setHours(0, 0, 0, 0); return d }
    case 'month': d.setDate(1); d.setHours(0, 0, 0, 0); return d
    case 'year': d.setMonth(0, 1); d.setHours(0, 0, 0, 0); return d
  }
}
function nEndOf(period: Exclude<NutriPeriod, 'total' | 'custom'>, start: Date): Date {
  const d = new Date(start)
  switch (period) {
    case 'week': d.setDate(d.getDate() + 6); d.setHours(23, 59, 59, 999); return d
    case 'month': d.setMonth(d.getMonth() + 1, 0); d.setHours(23, 59, 59, 999); return d
    case 'year': d.setMonth(11, 31); d.setHours(23, 59, 59, 999); return d
  }
}
function nAdvance(period: Exclude<NutriPeriod, 'total' | 'custom'>, anchor: Date, delta: number): Date {
  const d = new Date(anchor)
  switch (period) {
    case 'week': d.setDate(d.getDate() + delta * 7); break
    case 'month': d.setMonth(d.getMonth() + delta); break
    case 'year': d.setFullYear(d.getFullYear() + delta); break
  }
  return d
}
function nNavLabel(period: Exclude<NutriPeriod, 'total' | 'custom'>, anchor: Date): string {
  const start = nStartOf(period, anchor), end = nEndOf(period, start)
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-GB', o)
  switch (period) {
    case 'week': return `${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short', year: 'numeric' })}`
    case 'month': return fmt(start, { month: 'long', year: 'numeric' })
    case 'year': return String(start.getFullYear())
  }
}
function parseDDMMYYYYNutri(s: string): string | null {
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d))
  if (isNaN(date.getTime())) return null
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}
function generateDays(startStr: string, endStr: string): DayData[] {
  const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const todayStr = localDate()
  const result: DayData[] = []
  const cur = new Date(startStr + 'T12:00:00')
  const end = new Date(endStr + 'T12:00:00')
  while (cur <= end) {
    const dateStr = toDateStr(cur)
    result.push({
      dateStr,
      dayLabel: SHORT_DAYS[cur.getDay()],
      fullDate: cur.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      isToday: dateStr === todayStr,
      isFuture: dateStr > todayStr,
      consumed: 0, burned: 0, target: null, protein_g: 0, fat_g: 0, carb_g: 0, items: [],
    })
    cur.setDate(cur.getDate() + 1)
  }
  return result
}

// ─── Kcal bar chart ────────────────────────────────────────────────────────

function KcalBarChart({ days }: { days: DayData[] }) {
  const { width: screenWidth } = useWindowDimensions()
  const chartWidth = screenWidth - 32 - 32
  const chartHeight = 140
  const padLeft = 40
  const padRight = 8
  const padTop = 12
  const padBottom = 24
  const plotW = chartWidth - padLeft - padRight
  const plotH = chartHeight - padTop - padBottom

  const pastDays = days.filter(d => !d.isFuture)
  if (pastDays.length === 0) return null

  const maxRaw = Math.max(...pastDays.filter(d => d.consumed > 0).map(d => Math.max(d.consumed, d.target ?? 0)))
  const maxY = Math.max(maxRaw * 1.1, 1000)

  const barCount = days.length
  const barW = Math.max(2, Math.floor((plotW / barCount) * 0.6))
  const barSpacing = plotW / barCount

  // Average target line
  const daysWithTarget = days.filter(d => d.target != null)
  const avgTarget = daysWithTarget.length > 0
    ? daysWithTarget.reduce((s, d) => s + d.target!, 0) / daysWithTarget.length
    : null
  const targetLineY = avgTarget != null ? padTop + plotH - (avgTarget / maxY) * plotH : null

  // Y axis ticks
  const ticks = [0, Math.round(maxY / 2), Math.round(maxY)]

  return (
    <Svg width={chartWidth} height={chartHeight}>
      {/* Y axis ticks */}
      {ticks.map(tick => {
        const y = padTop + plotH - (tick / maxY) * plotH
        return (
          <SvgText
            key={tick}
            x={padLeft - 4}
            y={y + 4}
            textAnchor="end"
            fontSize={9}
            fill={C.text3}
          >
            {tick === 0 ? '0' : tick >= 1000 ? `${Math.round(tick / 100) / 10}k` : String(tick)}
          </SvgText>
        )
      })}

      {/* Bars */}
      {days.map((d, i) => {
        const ratio = d.target && d.consumed > 0 ? d.consumed / d.target : 0
        const isMet = ratio >= 0.9 && ratio <= 1.15
        const isOver = ratio > 1.15
        const isUnder = !d.isFuture && d.consumed > 0 && ratio < 0.9
        const barColor = d.isFuture ? C.surface3
          : d.isToday ? C.accent
          : isMet ? C.success
          : isOver ? C.danger
          : isUnder ? C.warning
          : C.surface3

        const barH = d.consumed > 0 ? Math.max(1, (d.consumed / maxY) * plotH) : 0
        const x = padLeft + i * barSpacing + (barSpacing - barW) / 2
        const y = padTop + plotH - barH

        // X label
        const showLabel = barCount <= 7
          ? true
          : d.fullDate.startsWith('1 ') || i % 7 === 0

        return (
          <React.Fragment key={d.dateStr}>
            {barH > 0 && (
              <Rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={2}
                fill={barColor}
              />
            )}
            {barH === 0 && (
              <Rect
                x={x}
                y={padTop + plotH - 2}
                width={barW}
                height={2}
                rx={1}
                fill={C.surface3}
              />
            )}
            {showLabel && (
              <SvgText
                x={x + barW / 2}
                y={chartHeight - 4}
                textAnchor="middle"
                fontSize={9}
                fill={d.isToday ? C.accent : C.text3}
              >
                {d.dayLabel}
              </SvgText>
            )}
          </React.Fragment>
        )
      })}

      {/* Target dashed line */}
      {targetLineY != null && (
        <Line
          x1={padLeft}
          y1={targetLineY}
          x2={chartWidth - padRight}
          y2={targetLineY}
          stroke={C.text3}
          strokeWidth={1}
          strokeDasharray="4,3"
        />
      )}
    </Svg>
  )
}

// ─── History view ──────────────────────────────────────────────────────────

function DayRow({ day, last, hideCalories, expanded, onPress }: {
  day: DayData; last: boolean; hideCalories: boolean
  expanded: boolean; onPress: () => void
}) {
  const ratio = day.target && day.consumed > 0 ? day.consumed / day.target : 0
  const isMet = ratio >= 0.9 && ratio <= 1.15
  const isOver = ratio > 1.15
  const isUnder = !day.isFuture && day.consumed > 0 && ratio < 0.9
  const barColor = day.isFuture ? C.surface3
    : day.isToday ? C.accent
    : isMet ? C.success
    : isOver ? C.danger
    : isUnder ? C.warning
    : C.surface3
  const fillPct = day.isFuture ? 0 : Math.min(ratio, 1) * 100
  const hasMacros = !day.isFuture && day.consumed > 0 && (day.protein_g > 0 || day.fat_g > 0 || day.carb_g > 0)
  const canExpand = !hideCalories && !day.isFuture && day.consumed > 0 && (day.items.length > 0 || hasMacros)
  return (
    <Pressable
      onPress={canExpand ? onPress : undefined}
      style={[hv.dayRow, !last && { borderBottomWidth: 1, borderBottomColor: C.divider }]}
    >
      <View style={hv.dayLabelCol}>
        <Text style={[hv.dayName, day.isToday && { color: C.accent, fontWeight: '800' }]}>{day.dayLabel}</Text>
        <Text style={hv.dayDate}>{day.fullDate}</Text>
      </View>
      <View style={hv.dayBarCol}>
        <View style={hv.barTrack}>
          <View style={[hv.barFill, { width: `${fillPct}%` as any, backgroundColor: barColor }]} />
          {isOver && <View style={[hv.barOverflow, { backgroundColor: C.danger }]} />}
        </View>
        {!hideCalories ? (
          <>
            <View style={hv.dayNumbers}>
              <Text style={[hv.dayConsumed, (day.isFuture || day.consumed === 0) && { color: C.text3 }]}>
                {day.isFuture || day.consumed === 0 ? '—' : day.consumed.toLocaleString()}
              </Text>
              {day.target != null && <Text style={hv.dayTarget}>/ {day.target.toLocaleString()} kcal</Text>}
            </View>
            {expanded && (hasMacros || day.items.length > 0) && (
              <>
                {hasMacros && (
                  <View style={hv.dayMacros}>
                    <Text style={hv.dayMacroChip}>{Math.round(day.protein_g)} P</Text>
                    <Text style={hv.dayMacroDot}>·</Text>
                    <Text style={hv.dayMacroChip}>{Math.round(day.fat_g)} F</Text>
                    <Text style={hv.dayMacroDot}>·</Text>
                    <Text style={hv.dayMacroChip}>{Math.round(day.carb_g)} C</Text>
                  </View>
                )}
                {day.items.length > 0 && (
                  <View style={hv.itemsList}>
                    {day.items.map((item, idx) => (
                      <View key={idx} style={[hv.itemRow, idx > 0 && hv.itemRowBorder]}>
                        <Text style={hv.itemName} numberOfLines={1}>{item.name}</Text>
                        <View style={hv.itemRight}>
                          <Text style={hv.itemKcal}>{item.kcal} kcal</Text>
                          {(item.protein_g != null || item.fat_g != null || item.carb_g != null) && (
                            <Text style={hv.itemMacros}>
                              {[
                                item.protein_g != null ? `P${Math.round(item.protein_g)}` : null,
                                item.fat_g != null ? `F${Math.round(item.fat_g)}` : null,
                                item.carb_g != null ? `C${Math.round(item.carb_g)}` : null,
                              ].filter(Boolean).join('  ')}
                            </Text>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </>
        ) : (
          !day.isFuture && day.consumed > 0 ? (
            <Text style={[hv.hideCalStatus, { color: (isMet || isOver) ? C.success : C.warning }]}>
              {(isMet || isOver) ? 'You reached your minimum' : 'You did not reach your minimum'}
            </Text>
          ) : null
        )}
      </View>
      <View style={hv.statusCol}>
        {day.isToday && <View style={[hv.statusDot, { backgroundColor: C.accent }]} />}
        {!day.isToday && isMet && day.consumed > 0 && <Ionicons name="checkmark-circle" size={18} color={C.success} />}
        {!day.isToday && isOver && <Ionicons name="arrow-up-circle" size={18} color={C.danger} />}
        {!day.isToday && isUnder && <Ionicons name="remove-circle" size={18} color={C.warning} />}
        {!day.isToday && !isMet && !isOver && !isUnder && <Ionicons name="ellipse-outline" size={18} color={C.text3} />}
      </View>
    </Pressable>
  )
}

function HistoryView() {
  const [userId, setUserId] = useState<string | null>(null)
  const [period, setPeriod] = useState<NutriPeriod>('week')
  const [anchor, setAnchor] = useState(new Date())
  const [monthsBack, setMonthsBack] = useState(3)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [customStartText, setCustomStartText] = useState('')
  const [customEndText, setCustomEndText] = useState('')
  const [customStart, setCustomStart] = useState<string | null>(null)
  const [customEnd, setCustomEnd] = useState<string | null>(null)
  const [days, setDays] = useState<DayData[]>([])
  const [loading, setLoading] = useState(false)
  const [hideCalories, setHideCalories] = useState(false)
  const [expandedDate, setExpandedDate] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => user && setUserId(user.id))
  }, [])

  useEffect(() => {
    if (!userId) return
    load()
  }, [userId, period, anchor, monthsBack, customStart, customEnd])

  async function load() {
    setLoading(true)
    const todayStr = localDate()
    let startStr: string, endStr: string
    if (period === 'total') {
      const s = new Date(); s.setMonth(s.getMonth() - monthsBack); s.setDate(1)
      startStr = toDateStr(s); endStr = todayStr
    } else if (period === 'custom') {
      if (!customStart || !customEnd) { setDays([]); setLoading(false); return }
      startStr = customStart; endStr = customEnd
    } else {
      const s = nStartOf(period, anchor)
      startStr = toDateStr(s); endStr = toDateStr(nEndOf(period, s))
    }
    const [profileRes, foodRes, actsRes] = await Promise.all([
      supabase.from('users').select('daily_kcal_target, hide_calories').eq('id', userId!).single(),
      supabase.from('food_logs').select('date, name, kcal, protein_g, fat_g, carb_g, logged_at').eq('user_id', userId!)
        .gte('date', startStr).lte('date', endStr).order('logged_at'),
      supabase.from('activities').select('date, total_kcal').eq('user_id', userId!)
        .gte('date', `${startStr}T00:00:00`).lte('date', `${endStr}T23:59:59`)
        .not('total_kcal', 'is', null),
    ])
    const baseline: number | null = profileRes.data?.daily_kcal_target ?? null
    setHideCalories(profileRes.data?.hide_calories ?? false)
    const foodByDate: Record<string, { kcal: number; protein: number; fat: number; carb: number }> = {}
    const itemsByDate: Record<string, DayItem[]> = {}
    for (const row of (foodRes.data ?? [])) {
      if (!foodByDate[row.date]) foodByDate[row.date] = { kcal: 0, protein: 0, fat: 0, carb: 0 }
      foodByDate[row.date].kcal += row.kcal
      foodByDate[row.date].protein += row.protein_g ?? 0
      foodByDate[row.date].fat += row.fat_g ?? 0
      foodByDate[row.date].carb += row.carb_g ?? 0
      if (!itemsByDate[row.date]) itemsByDate[row.date] = []
      itemsByDate[row.date].push({
        name: row.name,
        kcal: row.kcal,
        protein_g: row.protein_g ?? null,
        fat_g: row.fat_g ?? null,
        carb_g: row.carb_g ?? null,
      })
    }
    const burnedByDate: Record<string, number> = {}
    for (const row of (actsRes.data ?? [])) {
      const d = (row.date as string).slice(0, 10)
      burnedByDate[d] = (burnedByDate[d] ?? 0) + (row.total_kcal ?? 0)
    }
    const result = generateDays(startStr, endStr).map(day => {
      const burned = Math.round(burnedByDate[day.dateStr] ?? 0)
      const fd = foodByDate[day.dateStr]
      return {
        ...day,
        consumed: Math.round(fd?.kcal ?? 0),
        burned,
        target: baseline != null ? baseline + burned : null,
        protein_g: Math.round((fd?.protein ?? 0) * 10) / 10,
        fat_g: Math.round((fd?.fat ?? 0) * 10) / 10,
        carb_g: Math.round((fd?.carb ?? 0) * 10) / 10,
        items: itemsByDate[day.dateStr] ?? [],
      }
    })
    setDays(result)
    setLoading(false)
  }

  function selectPeriod(p: NutriPeriod) {
    setPeriod(p); setAnchor(new Date())
    if (p !== 'custom') { setCustomStart(null); setCustomEnd(null) }
    setDropdownOpen(false)
  }

  function applyCustom() {
    const s = parseDDMMYYYYNutri(customStartText), e = parseDDMMYYYYNutri(customEndText)
    if (s && e && s <= e) { setCustomStart(s); setCustomEnd(e) }
  }

  function periodLabel(): string {
    if (period === 'total') return 'All history'
    if (period === 'custom') {
      if (customStart && customEnd) {
        const fmt = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        return `${fmt(customStart)} – ${fmt(customEnd)}`
      }
      return 'Custom range'
    }
    return nNavLabel(period, anchor)
  }

  const isFixed = period !== 'total' && period !== 'custom'
  const daysWithData = days.filter(d => !d.isFuture && d.consumed > 0)
  const metCount = daysWithData.filter(d => {
    if (!d.target) return false
    const r = d.consumed / d.target
    return r >= 0.9 && r <= 1.15
  }).length
  const n = daysWithData.length
  const avgConsumed = n > 0 ? Math.round(daysWithData.reduce((s, d) => s + d.consumed, 0) / n) : null
  const daysWithTarget = daysWithData.filter(d => d.target != null)
  const avgTarget = daysWithTarget.length > 0
    ? Math.round(daysWithTarget.reduce((s, d) => s + d.target!, 0) / daysWithTarget.length)
    : null
  const avgProtein = n > 0 ? Math.round(daysWithData.reduce((s, d) => s + d.protein_g, 0) / n) : null
  const avgFat     = n > 0 ? Math.round(daysWithData.reduce((s, d) => s + d.fat_g, 0) / n) : null
  const avgCarb    = n > 0 ? Math.round(daysWithData.reduce((s, d) => s + d.carb_g, 0) / n) : null

  // Group by month for total / custom views
  const monthGroups: { key: string; label: string; days: DayData[] }[] = []
  if (period === 'total' || period === 'custom') {
    const map = new Map<string, DayData[]>()
    for (const d of days) {
      const mk = d.dateStr.slice(0, 7)
      if (!map.has(mk)) map.set(mk, [])
      map.get(mk)!.push(d)
    }
    for (const [mk, mDays] of map) {
      const [y, mo] = mk.split('-').map(Number)
      monthGroups.push({
        key: mk,
        label: new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
        days: mDays,
      })
    }
  }

  return (
    <ScrollView contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingBottom: 24 }}>
      {/* Period selector */}
      <Pressable style={hv.selectorBtn} onPress={() => setDropdownOpen(true)}>
        <Text style={hv.selectorText} numberOfLines={1}>{periodLabel()}</Text>
        <Ionicons name="chevron-down" size={14} color={C.text2} style={{ marginLeft: 6 }} />
      </Pressable>

      {/* Custom range inputs */}
      {period === 'custom' && (
        <View style={hv.customRange}>
          <View style={hv.customField}>
            <Text style={hv.customLabel}>FROM</Text>
            <TextInput style={hv.customInput} placeholder="DD-MM-YYYY" placeholderTextColor={C.text3}
              value={customStartText} onChangeText={setCustomStartText} onBlur={applyCustom} keyboardType="numbers-and-punctuation" />
          </View>
          <Text style={hv.customSep}>–</Text>
          <View style={hv.customField}>
            <Text style={hv.customLabel}>TO</Text>
            <TextInput style={hv.customInput} placeholder="DD-MM-YYYY" placeholderTextColor={C.text3}
              value={customEndText} onChangeText={setCustomEndText} onBlur={applyCustom} keyboardType="numbers-and-punctuation" />
          </View>
          <Pressable style={hv.applyBtn} onPress={applyCustom}><Text style={hv.applyBtnText}>Go</Text></Pressable>
        </View>
      )}

      {/* Nav arrows */}
      {isFixed && (
        <View style={hv.navRow}>
          <Pressable style={hv.navBtn} onPress={() => setAnchor(a => nAdvance(period, a, -1))}>
            <Text style={hv.navArrow}>‹</Text>
          </Pressable>
          <Pressable style={hv.navBtn} onPress={() => setAnchor(a => nAdvance(period, a, 1))}>
            <Text style={hv.navArrow}>›</Text>
          </Pressable>
        </View>
      )}

      {loading && <ActivityIndicator color={C.accent} style={{ marginVertical: 24 }} />}

      {!loading && (
        <>
          {/* Summary */}
          {daysWithData.length > 0 && (
            <View style={hv.summaryCard}>
              {hideCalories ? (
                <Text style={hv.summaryHiddenMsg}>
                  {metCount === daysWithData.length
                    ? `Great week — you hit your target all ${daysWithData.length} logged day${daysWithData.length !== 1 ? 's' : ''}.`
                    : metCount === 0
                      ? `You logged ${daysWithData.length} day${daysWithData.length !== 1 ? 's' : ''} this period. Keep going — consistency is key.`
                      : `You hit your target ${metCount} out of ${daysWithData.length} logged day${daysWithData.length !== 1 ? 's' : ''} this period.`}
                </Text>
              ) : (
                <>
                  <View style={hv.summaryRow}>
                    <View style={hv.summaryItem}>
                      <Text style={hv.summaryNum}>{metCount}/{daysWithData.length}</Text>
                      <Text style={hv.summaryLabel}>days on target</Text>
                    </View>
                    <View style={hv.summaryDivider} />
                    <View style={hv.summaryItem}>
                      <Text style={hv.summaryNum}>{avgConsumed?.toLocaleString() ?? '—'}</Text>
                      <Text style={hv.summaryLabel}>avg eaten/day</Text>
                    </View>
                    <View style={hv.summaryDivider} />
                    <View style={hv.summaryItem}>
                      <Text style={hv.summaryNum}>{avgTarget?.toLocaleString() ?? '—'}</Text>
                      <Text style={hv.summaryLabel}>avg target/day</Text>
                    </View>
                  </View>
                  {(avgProtein != null || avgFat != null || avgCarb != null) && (
                    <>
                      <View style={hv.summaryMacroDivider} />
                      <View style={hv.summaryRow}>
                        <View style={hv.summaryItem}>
                          <Text style={hv.summaryNum}>{avgProtein ?? '—'}</Text>
                          <Text style={hv.summaryLabel}>average grams of protein per day</Text>
                        </View>
                        <View style={hv.summaryDivider} />
                        <View style={hv.summaryItem}>
                          <Text style={hv.summaryNum}>{avgFat ?? '—'}</Text>
                          <Text style={hv.summaryLabel}>average grams of fat per day</Text>
                        </View>
                        <View style={hv.summaryDivider} />
                        <View style={hv.summaryItem}>
                          <Text style={hv.summaryNum}>{avgCarb ?? '—'}</Text>
                          <Text style={hv.summaryLabel}>average grams of carbs per day</Text>
                        </View>
                      </View>
                    </>
                  )}
                </>
              )}
            </View>
          )}

          {/* Bar chart */}
          {days.length > 0 && days.length <= 31 && (
            <View style={hv.chartContainer}>
              <KcalBarChart days={days} />
            </View>
          )}

          {/* Day rows — flat for week/month/year, grouped by month for total/custom */}
          {isFixed && days.length > 0 && (
            <View style={hv.daysCard}>
              {days.map((d, i) => <DayRow key={d.dateStr} day={d} last={i === days.length - 1} hideCalories={hideCalories} expanded={expandedDate === d.dateStr} onPress={() => setExpandedDate(p => p === d.dateStr ? null : d.dateStr)} />)}
            </View>
          )}
          {!isFixed && monthGroups.map(g => (
            <View key={g.key}>
              <Text style={hv.monthHeader}>{g.label}</Text>
              <View style={hv.daysCard}>
                {g.days.map((d, i) => <DayRow key={d.dateStr} day={d} last={i === g.days.length - 1} hideCalories={hideCalories} expanded={expandedDate === d.dateStr} onPress={() => setExpandedDate(p => p === d.dateStr ? null : d.dateStr)} />)}
              </View>
            </View>
          ))}

          {/* Load more */}
          {period === 'total' && (
            <Pressable style={hv.loadMoreBtn} onPress={() => setMonthsBack(n => n + 3)}>
              <Text style={hv.loadMoreText}>Load earlier months</Text>
            </Pressable>
          )}

          {/* Legend */}
          {days.length > 0 && (
            <View style={hv.legend}>
              <View style={hv.legendItem}><Ionicons name="checkmark-circle" size={13} color={C.success} /><Text style={hv.legendText}>On target (90–115%)</Text></View>
              <View style={hv.legendItem}><Ionicons name="remove-circle" size={13} color={C.warning} /><Text style={hv.legendText}>Under (&lt;90%)</Text></View>
              <View style={hv.legendItem}><Ionicons name="arrow-up-circle" size={13} color={C.danger} /><Text style={hv.legendText}>Over (&gt;115%)</Text></View>
            </View>
          )}

          {period === 'custom' && !customStart && (
            <Text style={hv.emptyNote}>Enter a date range above.</Text>
          )}
        </>
      )}

      {/* Period dropdown */}
      <Modal visible={dropdownOpen} transparent animationType="fade">
        <Pressable style={hv.modalOverlay} onPress={() => setDropdownOpen(false)}>
          <Pressable style={hv.dropdownSheet} onPress={e => e.stopPropagation()}>
            <Text style={hv.dropdownTitle}>View period</Text>
            {NUTRI_PERIOD_OPTIONS.map(opt => (
              <Pressable key={opt.value} style={hv.dropdownRow} onPress={() => selectPeriod(opt.value)}>
                <Text style={[hv.dropdownRowText, period === opt.value && hv.dropdownRowActive]}>{opt.label}</Text>
                {period === opt.value && <Ionicons name="checkmark" size={16} color={C.accent} />}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  )
}

const hv = StyleSheet.create({
  selectorBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: C.surface2, borderRadius: 10, borderWidth: 1, borderColor: C.border,
  },
  selectorText: { fontSize: 15, fontWeight: '700', color: C.text1, flex: 1 },
  customRange: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  customField: { flex: 1 },
  customLabel: { fontSize: 10, fontWeight: '700', color: C.text3, marginBottom: 4, textTransform: 'uppercase' },
  customInput: { borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 9, fontSize: 13, backgroundColor: C.surface2, color: C.text1 },
  customSep: { fontSize: 18, color: C.text3, marginBottom: 10 },
  applyBtn: { backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 1 },
  applyBtnText: { color: C.white, fontWeight: '700', fontSize: 13 },
  navRow: { flexDirection: 'row', gap: 4 },
  navBtn: { padding: 6 },
  navArrow: { fontSize: 26, color: C.text2, lineHeight: 30 },
  summaryCard: {
    backgroundColor: C.surface, borderRadius: 18,
    padding: 18, borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
    gap: 0,
  },
  summaryRow: { flexDirection: 'row' },
  summaryMacroDivider: { height: 1, backgroundColor: C.divider, marginVertical: 14 },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, backgroundColor: C.border, marginHorizontal: 8 },
  summaryNum: { fontSize: 22, fontWeight: '800', color: C.text1, marginBottom: 2 },
  summaryLabel:     { fontSize: 11, color: C.text3, textAlign: 'center' },
  summaryHiddenMsg: { fontSize: 14, color: C.text2, lineHeight: 22, textAlign: 'center', paddingVertical: 4 },
  monthHeader: { fontSize: 16, fontWeight: '800', color: C.text1, paddingVertical: 4 },
  daysCard: {
    backgroundColor: C.surface, borderRadius: 18, paddingHorizontal: 18,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 10 },
  dayLabelCol: { width: 40 },
  dayName: { fontSize: 13, fontWeight: '700', color: C.text1 },
  dayDate: { fontSize: 11, color: C.text3, marginTop: 1 },
  dayBarCol: { flex: 1 },
  barTrack: { height: 7, backgroundColor: C.surface3, borderRadius: 4, overflow: 'hidden', marginBottom: 5 },
  barFill: { height: 7, borderRadius: 4 },
  barOverflow: { position: 'absolute', right: 0, top: 0, width: 4, height: 7, borderRadius: 2 },
  dayNumbers: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  hideCalStatus: { fontSize: 11, fontWeight: '700', marginTop: 3 },
  dayConsumed: { fontSize: 13, fontWeight: '700', color: C.text1 },
  dayTarget: { fontSize: 11, color: C.text3 },
  dayMacros: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  dayMacroChip: { fontSize: 11, fontWeight: '600' },
  dayMacroDot: { fontSize: 11, color: C.text3 },
  statusCol: { width: 22, alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  chartContainer: { backgroundColor: C.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: C.border, alignItems: 'center', overflow: 'hidden' },
  loadMoreBtn: { padding: 14, borderRadius: 10, backgroundColor: C.surface2, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  loadMoreText: { fontSize: 14, color: C.text2, fontWeight: '600' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { fontSize: 11, color: C.text3 },
  itemsList: { marginTop: 8, borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 6 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 5, gap: 8 },
  itemRowBorder: { borderTopWidth: 1, borderTopColor: C.divider },
  itemName: { flex: 1, fontSize: 12, color: C.text2, fontWeight: '500' },
  itemRight: { alignItems: 'flex-end', gap: 1 },
  itemKcal: { fontSize: 12, fontWeight: '700', color: C.text1 },
  itemMacros: { fontSize: 10, color: C.text3 },
  emptyNote: { fontSize: 13, color: C.text3, textAlign: 'center', paddingVertical: 24, fontStyle: 'italic' },
  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  dropdownSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8, paddingBottom: 40,
  },
  dropdownTitle: { fontSize: 12, fontWeight: '700', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8, paddingHorizontal: 20, paddingVertical: 12 },
  dropdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderTopWidth: 1, borderTopColor: C.divider },
  dropdownRowText: { fontSize: 16, color: C.text1 },
  dropdownRowActive: { color: C.accent, fontWeight: '700' },
})

export { HistoryView }
