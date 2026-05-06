import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PROGRAM_LABELS: Record<string, string> = {
  '5k':            '5K (5 kilometers)',
  '10k':           '10K (10 kilometers)',
  'half_marathon': 'Half Marathon (21.1 kilometers)',
  'marathon':      'Marathon (42.2 kilometers)',
}

const SESSION_PREFIXES: Record<string, string> = {
  '5k':            '5k Program',
  '10k':           '10k Program',
  'half_marathon': 'Half Marathon Program',
  'marathon':      'Marathon Program',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) throw new Error('No authorization header')

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) throw new Error('Unauthorized')

    const { program_type, weeks, starting_km, starting_pace_sec_km, calibration_notes } = await req.json()

    if (!program_type || !weeks || !starting_km || !starting_pace_sec_km) {
      throw new Error('Missing required fields: program_type, weeks, starting_km, starting_pace_sec_km')
    }

    const { data: profile } = await supabase
      .from('users')
      .select('weight_kg, age, sex, sport_history')
      .eq('id', user.id)
      .single()

    const weight = profile?.weight_kg ?? 70
    const age = profile?.age ?? 30
    const sportHistory = profile?.sport_history ?? 'intermediate'

    const paceMin = Math.floor(starting_pace_sec_km / 60)
    const paceSec = starting_pace_sec_km % 60
    const paceFormatted = `${paceMin}:${String(paceSec).padStart(2, '0')}/km`

    const programLabel = PROGRAM_LABELS[program_type] ?? program_type
    const sessionPrefix = SESSION_PREFIXES[program_type] ?? `${program_type} Program`

    const prompt = `You are an expert running coach creating a personalized ${programLabel} training plan.

Athlete profile:
- Weight: ${weight}kg
- Age: ${age} years
- Experience level: ${sportHistory}
- Current longest comfortable run: ${starting_km}km at ${paceFormatted} pace

Training plan parameters:
- Goal race: ${programLabel}
- Program duration: ${weeks} weeks
- Start date: ${new Date().toISOString().split('T')[0]}

Special instructions from athlete:
${calibration_notes?.trim() || 'None provided.'}

Create a complete ${weeks}-week running training plan. Return ONLY valid JSON — no markdown fences, no explanation text, just the raw JSON object:

{
  "sessions": [
    {
      "week": 1,
      "day": 1,
      "session_name": "${sessionPrefix} w1d1",
      "description": "Detailed description with warm-up, main set, cool-down, and purpose of the session.",
      "target_km": 4.0,
      "target_pace_sec_km": 360,
      "estimated_kcal": 320
    }
  ]
}

Rules:
- session_name MUST follow pattern "${sessionPrefix} w{WEEK}d{DAY}" exactly (e.g. "${sessionPrefix} w2d3")
- Include 3–5 sessions per week spread across non-consecutive days
- Day numbers within a week are 1–7 (1=Monday … 7=Sunday); put long run on day 6 or 7
- Progressive overload: increase volume ≤10% per week
- First week starts 10–15% below current fitness; peak volume 2 weeks before end; final 1–2 weeks taper
- Session mix: easy runs, tempo, intervals, long run each week as appropriate for the goal distance
- Description: include effort level (e.g. "conversational pace"), purpose, warm-up (5–10 min easy), main set, cool-down (5 min easy)
- target_pace_sec_km guidance:
    easy = current + 45–90s
    moderate = current + 15–45s
    tempo = current − 15–30s
    interval rep = current − 30–60s
- estimated_kcal ≈ ${weight} × target_km × effort_factor (1.0 easy, 1.1 moderate, 1.2 tempo/intervals)
- Do NOT include rest days — only training sessions
- All numbers must be valid JSON numbers, not strings`

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text()
      throw new Error(`Anthropic API error: ${err}`)
    }

    const anthropicData = await anthropicRes.json()
    const text: string = anthropicData.content?.[0]?.text ?? ''

    // Extract JSON — strip any accidental markdown fences
    const stripped = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const jsonStart = stripped.indexOf('{')
    const jsonEnd = stripped.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON found in AI response')

    const parsed = JSON.parse(stripped.slice(jsonStart, jsonEnd + 1))
    if (!Array.isArray(parsed.sessions) || parsed.sessions.length === 0) {
      throw new Error('AI returned no sessions')
    }

    return new Response(
      JSON.stringify({ sessions: parsed.sessions }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
