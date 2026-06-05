import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CREDITS_BY_ENTITLEMENT: Record<string, number> = {
  starter: parseInt(Deno.env.get('STARTER_CREDITS') ?? '30'),
  pro:     parseInt(Deno.env.get('PRO_CREDITS')     ?? '100'),
}

// Resolve credits + tier from a RevenueCat event.
// Prefers entitlement_ids (stable) over product_id (fragile across store renames).
function creditsForEvent(event: any): { credits: number; tier: string } | null {
  const entitlements: string[] = event.entitlement_ids ?? []
  if (entitlements.includes('pro'))     return { credits: CREDITS_BY_ENTITLEMENT.pro,     tier: 'pro'     }
  if (entitlements.includes('starter')) return { credits: CREDITS_BY_ENTITLEMENT.starter, tier: 'starter' }
  const productId: string = event.product_id ?? ''
  if (productId.includes('pro'))     return { credits: CREDITS_BY_ENTITLEMENT.pro,     tier: 'pro'     }
  if (productId.includes('starter')) return { credits: CREDITS_BY_ENTITLEMENT.starter, tier: 'starter' }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // RevenueCat sends the shared secret as the Authorization header value
    const authHeader = req.headers.get('authorization')
    const webhookSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')
    if (!webhookSecret || authHeader !== webhookSecret) {
      return new Response('Unauthorized', { status: 401 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json()
    const event = body.event
    if (!event) return new Response('No event', { status: 400 })

    const userId: string = event.app_user_id  // set via Purchases.logIn(userId)
    const eventType: string = event.type

    // Grant credits on first purchase or monthly renewal
    if (eventType === 'INITIAL_PURCHASE' || eventType === 'RENEWAL') {
      const result = creditsForEvent(event)
      if (!result) {
        console.error('Unknown entitlement/product:', event.entitlement_ids, event.product_id)
        return new Response('Unknown product', { status: 400 })
      }

      await supabase.from('credit_transactions').insert({
        user_id: userId,
        amount: result.credits,
        reason: 'subscription_monthly',
      })

      await supabase.from('users').update({ subscription_tier: result.tier }).eq('id', userId)
    }

    // On cancellation/expiry, clear the subscription tier (credits already granted stay)
    if (eventType === 'CANCELLATION' || eventType === 'EXPIRATION') {
      await supabase.from('users').update({ subscription_tier: 'free' }).eq('id', userId)
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
