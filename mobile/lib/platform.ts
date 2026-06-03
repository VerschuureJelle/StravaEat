import { Platform } from 'react-native'
import type { ViewStyle } from 'react-native'

export const isIOS     = Platform.OS === 'ios'
export const isAndroid = Platform.OS === 'android'

// KeyboardAvoidingView behavior — use instead of inline Platform.OS checks
export const KAV_BEHAVIOR = Platform.OS === 'ios' ? 'padding' as const : 'height' as const

// KeyboardAvoidingView behavior for screens where Android should not adjust
// (e.g. signup/onboarding where the layout shifts differently)
export const KAV_BEHAVIOR_IOS_ONLY = Platform.OS === 'ios' ? 'padding' as const : undefined

// Card elevation/shadow — works on both platforms
export function cardShadow(level: 1 | 2 | 3 | 4 = 2): ViewStyle {
  if (isAndroid) return { elevation: level * 2 }
  const r = level * 3
  return { shadowColor: '#000', shadowOpacity: 0.05 + level * 0.01, shadowRadius: r, shadowOffset: { width: 0, height: level } }
}

// Bottom-sheet / modal shadow (rises upward)
export function sheetShadow(): ViewStyle {
  if (isAndroid) return { elevation: 8 }
  return { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: -4 } }
}

// Accent glow (used on CTA cards)
export function accentShadow(color: string): ViewStyle {
  if (isAndroid) return { elevation: 4 }
  return { shadowColor: color, shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } }
}
