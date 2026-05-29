import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { W as C } from '../../lib/themeWarm'
import {
  getOfferings, purchasePackage, restorePurchases, getCreditBalance,
} from '../../lib/purchases'
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases'

const CREDITS_STARTER = parseInt(process.env.EXPO_PUBLIC_CREDITS_STARTER ?? '30')
const CREDITS_PRO     = parseInt(process.env.EXPO_PUBLIC_CREDITS_PRO     ?? '100')
const CREDITS_SIGNUP  = parseInt(process.env.EXPO_PUBLIC_CREDITS_SIGNUP  ?? '10')

const TIERS = [
  {
    entitlement: 'starter',
    label: 'Starter',
    credits: CREDITS_STARTER,
    description: `${CREDITS_STARTER} credits per month`,
    highlight: false,
  },
  {
    entitlement: 'pro',
    label: 'Pro',
    credits: CREDITS_PRO,
    description: `${CREDITS_PRO} credits per month`,
    highlight: true,
  },
]

export default function PaywallScreen() {
  const router = useRouter()
  const [offering, setOffering] = useState<PurchasesOffering | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [purchasing, setPurchasing] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    Promise.all([getOfferings(), getCreditBalance()])
      .then(([offerings, credits]) => {
        setOffering(offerings?.current ?? null)
        setBalance(credits)
      })
      .finally(() => setLoading(false))
  }, [])

  async function handlePurchase(pkg: PurchasesPackage) {
    setPurchasing(pkg.identifier)
    try {
      await purchasePackage(pkg)
      Alert.alert('Subscribed!', 'Your credits will appear shortly.')
      router.back()
    } catch (e: any) {
      if (!e.userCancelled) Alert.alert('Purchase failed', e.message)
    } finally {
      setPurchasing(null)
    }
  }

  async function handleRestore() {
    setRestoring(true)
    try {
      await restorePurchases()
      Alert.alert('Restored', 'Your purchases have been restored.')
      router.back()
    } catch (e: any) {
      Alert.alert('Restore failed', e.message)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={24} color={C.text1} />
        </Pressable>
      </View>

      <View style={s.hero}>
        <Ionicons name="sparkles" size={36} color={C.accent} />
        <Text style={s.heroTitle}>Coach credits</Text>
        <Text style={s.heroSub}>Each Coach response costs 1 credit — workout plans, skip advice, coaching notes.</Text>
        {balance != null && (
          <View style={s.balancePill}>
            <Text style={s.balanceText}>{balance} credit{balance !== 1 ? 's' : ''} remaining</Text>
          </View>
        )}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={C.accent} />
      ) : offering == null ? (
        <Text style={s.unavailable}>Subscriptions unavailable — check back soon.</Text>
      ) : (
        <View style={s.tiers}>
          {TIERS.map(tier => {
            const pkg = offering.availablePackages.find(p =>
              p.packageType === 'MONTHLY' &&
              p.product.identifier.includes(tier.entitlement),
            )
            if (!pkg) return null
            const price = pkg.product.priceString

            return (
              <View key={tier.entitlement} style={[s.tierCard, tier.highlight && s.tierCardHighlight]}>
                {tier.highlight && (
                  <View style={s.popularBadge}><Text style={s.popularText}>MOST POPULAR</Text></View>
                )}
                <Text style={s.tierLabel}>{tier.label}</Text>
                <Text style={s.tierCredits}>{tier.credits} credits / month</Text>
                <Text style={s.tierDesc}>{tier.description}</Text>
                <Text style={s.tierPrice}>{price}<Text style={s.tierPriceSub}> / month</Text></Text>
                <Pressable
                  style={[s.buyBtn, tier.highlight && s.buyBtnHighlight]}
                  onPress={() => handlePurchase(pkg)}
                  disabled={purchasing != null}
                >
                  {purchasing === pkg.identifier
                    ? <ActivityIndicator size="small" color={tier.highlight ? '#fff' : C.accent} />
                    : <Text style={[s.buyBtnText, tier.highlight && s.buyBtnTextHighlight]}>
                        Subscribe
                      </Text>
                  }
                </Pressable>
              </View>
            )
          })}
        </View>
      )}

      <View style={s.footer}>
        <Text style={s.footerNote}>Credits are added at the start of each billing cycle. Unused credits do not roll over.</Text>
        <Pressable onPress={handleRestore} disabled={restoring} style={s.restoreBtn}>
          {restoring
            ? <ActivityIndicator size="small" color={C.text3} />
            : <Text style={s.restoreText}>Restore purchases</Text>
          }
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20 },
  header: { paddingTop: 8, paddingBottom: 4, alignItems: 'flex-end' },

  hero: { alignItems: 'center', paddingVertical: 28, gap: 8 },
  heroTitle: { fontSize: 24, fontWeight: '800', color: C.text1 },
  heroSub: { fontSize: 14, color: C.text2, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  balancePill: { marginTop: 4, backgroundColor: C.accentBg, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5 },
  balanceText: { fontSize: 13, fontWeight: '700', color: C.accent },

  unavailable: { fontSize: 14, color: C.text3, textAlign: 'center', marginTop: 40 },

  tiers: { gap: 12 },
  tierCard: {
    borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 18,
    backgroundColor: C.surface,
  },
  tierCardHighlight: { borderColor: C.accent, backgroundColor: C.accentBg },
  popularBadge: { backgroundColor: C.accent, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start', marginBottom: 8 },
  popularText: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 0.8 },
  tierLabel: { fontSize: 18, fontWeight: '800', color: C.text1, marginBottom: 2 },
  tierCredits: { fontSize: 14, fontWeight: '600', color: C.accent, marginBottom: 4 },
  tierDesc: { fontSize: 13, color: C.text3, marginBottom: 12 },
  tierPrice: { fontSize: 22, fontWeight: '800', color: C.text1, marginBottom: 14 },
  tierPriceSub: { fontSize: 13, fontWeight: '400', color: C.text3 },
  buyBtn: {
    borderWidth: 1, borderColor: C.accent, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  buyBtnHighlight: { backgroundColor: C.accent, borderColor: C.accent },
  buyBtnText: { fontSize: 15, fontWeight: '700', color: C.accent },
  buyBtnTextHighlight: { color: '#fff' },

  footer: { flex: 1, justifyContent: 'flex-end', paddingBottom: 16, gap: 12, alignItems: 'center' },
  footerNote: { fontSize: 11, color: C.text3, textAlign: 'center', lineHeight: 16 },
  restoreBtn: { paddingVertical: 8 },
  restoreText: { fontSize: 13, color: C.text3 },
})
