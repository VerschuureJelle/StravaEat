import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Credits granted per subscription tier per renewal — configured via Supabase secrets
function getCreditsByProduct(): Record<string, number> {
  return {
    straveat_starter_monthly: parseInt(Deno.env.get('STARTER_CREDITS') ?? '30'),
    straveat_pro_monthly:     parseInt(Deno.env.get('PRO_CREDITS')     ?? '100'),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Verify RevenueCat webhook authorization
    const authHeader = req.headers.get('authorization')
    const webhookSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')
    if (!authHeader || authHeader !== webhookSecret) {
      return new Response('Unauthorized', { status: 401 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json()
    const event = body.event

    if (!event) return new Response('No event', { status: 400 })

    // app_user_id is the Supabase user ID (set via Purchases.logIn)
    const userId: string = event.app_user_id
    const productId: string = event.product_id ?? ''
    const eventType: string = event.type

    // Grant credits on purchase or renewal
    if (eventType === 'INITIAL_PURCHASE' || eventType === 'RENEWAL') {
      const credits = getCreditsByProduct()[productId]
      if (!credits) {
        console.error(`Unknown product_id: ${productId}`)
        return new Response('Unknown product', { status: 400 })
      }

      await supabase.from('credit_transactions').insert({
        user_id: userId,
        amount: credits,
        reason: 'subscription_monthly',
      })

      // Track subscription tier on users table for display purposes
      const tier = productId.includes('pro') ? 'pro' : 'starter'
      await supabase.from('users').update({ subscription_tier: tier }).eq('id', userId)
    }

    // On cancellation/expiry, clear the tier
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
