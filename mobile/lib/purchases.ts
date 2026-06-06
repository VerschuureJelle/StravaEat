import { Platform, NativeModules } from 'react-native'
import { supabase } from './supabase'

// react-native-purchases requires native code — not available in Expo Go.
// All functions below are no-ops when the module is absent.
const isAvailable = !!NativeModules.RNPurchases

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RC = isAvailable ? require('react-native-purchases') : null
const Purchases = RC?.default ?? null

const RC_API_KEY_IOS     = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS ?? ''
const RC_API_KEY_ANDROID = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID ?? ''

export const ENTITLEMENT_STARTER = 'starter'
export const ENTITLEMENT_PRO     = 'pro'

export async function initPurchases(userId: string) {
  if (!Purchases) return
  const apiKey = Platform.OS === 'ios' ? RC_API_KEY_IOS : RC_API_KEY_ANDROID
  if (!apiKey) return
  Purchases.setLogLevel(RC.LOG_LEVEL.ERROR)
  Purchases.configure({ apiKey })
  await Purchases.logIn(userId)
}

export async function getOfferings() {
  if (!Purchases) return null
  // Retry up to 3x with 1s delay — initPurchases is fire-and-forget so configure()
  // may not have run yet when the paywall mounts immediately after login.
  for (let i = 0; i < 3; i++) {
    try {
      const result = await Purchases.getOfferings()
      if (result?.current) return result
    } catch { /* not configured yet */ }
    await new Promise(r => setTimeout(r, 1000))
  }
  return null
}

export async function purchasePackage(pkg: any) {
  if (!Purchases) throw new Error('Purchases not available')
  const { customerInfo } = await Purchases.purchasePackage(pkg)
  return customerInfo
}

export async function restorePurchases() {
  if (!Purchases) return null
  return Purchases.restorePurchases()
}

export async function getCreditBalance(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0
  const { data } = await supabase.rpc('get_credit_balance', { p_user_id: user.id })
  return (data as number) ?? 0
}

export async function getActiveEntitlement(): Promise<'pro' | 'starter' | 'free'> {
  if (!Purchases) return 'free'
  try {
    const info = await Purchases.getCustomerInfo()
    if (info.entitlements.active[ENTITLEMENT_PRO]) return 'pro'
    if (info.entitlements.active[ENTITLEMENT_STARTER]) return 'starter'
  } catch { /* not configured */ }
  return 'free'
}
