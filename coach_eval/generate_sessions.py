"""
Generate 50 AI Coach training sessions for evaluation.
Profile: Jelle — 72kg, intermediate, runner/cyclist/swimmer.
HR zones: Z1 100-120, Z2 120-140, Z3 140-155, Z4 155-170, Z5 170-185 bpm
Paces: Run ~5:00/km easy, ~4:20/km threshold, ~3:50/km VO2max
       Swim ~1:55/100m easy, ~1:45/100m tempo, ~1:35/100m hard
       Cycling ~30 km/h avg, FTP ~270W (estimated)
"""

import csv

SESSIONS = [

    # ─── RUNNING (20) ────────────────────────────────────────────────────────────

    {
        "sport": "Run",
        "request": "45 minute easy recovery run, I'm feeling a bit tired from yesterday's intervals",
        "plan": (
            "EASY RECOVERY RUN — 45 min\n"
            "\n"
            "Goal: flush legs, NOT add fatigue.\n"
            "\n"
            "1. Warm-up (5 min)\n"
            "   – Walk 2 min, then ease into very easy jog\n"
            "   – Dynamic drills: leg swings, ankle circles, high knees (2×10 each)\n"
            "\n"
            "2. Main set (35 min)\n"
            "   – Zone 1-2 — 100–130 bpm — aim for 5:30–6:00/km or slower\n"
            "   – If HR creeps above 135 bpm → walk until it drops\n"
            "   – 'There is no such thing as too slow for a recovery run'\n"
            "\n"
            "3. Cool-down (5 min)\n"
            "   – Walk 2 min, then static stretch: calves, hamstrings, quads × 30 sec each side\n"
            "\n"
            "Nutrition: skip pre-run fuel (easy effort), drink 400–500 ml water post-run\n"
            "\n"
            "Estimated: ~250 kcal"
        ),
        "estimated_kcal": 250,
    },
    {
        "sport": "Run",
        "request": "60 minute easy aerobic run to build my base",
        "plan": (
            "BASE-BUILDING EASY RUN — 60 min (~12 km)\n"
            "\n"
            "1. Warm-up (10 min)\n"
            "   – 5 min walk/jog, then dynamic drills:\n"
            "   – High knees 2×20m, butt kicks 2×20m, leg swings 10 each side\n"
            "\n"
            "2. Main set (45 min)\n"
            "   – Zone 2 — 120–140 bpm — target pace ~5:00–5:30/km\n"
            "   – Run by feel and HR, not pace — if HR exceeds 142 bpm, slow down\n"
            "   – Aim for nose breathing the entire run as a quality check\n"
            "\n"
            "3. Cool-down (5 min)\n"
            "   – 2 min walk, stretch: calves (30s), hamstrings (30s), hip flexors (30s each)\n"
            "\n"
            "Nutrition: banana or rice cake 30 min before if running at tempo or later in the day\n"
            "\n"
            "Estimated: ~500 kcal"
        ),
        "estimated_kcal": 500,
    },
    {
        "sport": "Run",
        "request": "I want to do my weekly long run, I'm at 18 km training volume currently",
        "plan": (
            "LONG RUN — 18 km\n"
            "\n"
            "1. Warm-up (1 km)\n"
            "   – Walk 3 min, then build to easy Z2 jog over 1 km\n"
            "   – Drills: high knees, butt kicks, lateral hops (2×20m each)\n"
            "\n"
            "2. Main set (16 km)\n"
            "   – Zone 2 — 120–140 bpm — target pace 5:00–5:30/km\n"
            "   – Keep HR below 142 bpm throughout\n"
            "   – Split in 3: km 1–6 (settle in), km 7–12 (steady state), km 13–16 (hold form)\n"
            "\n"
            "3. Cool-down (1 km)\n"
            "   – Easy jog + walk, 5 min full stretch\n"
            "\n"
            "Nutrition during run:\n"
            "   – 60 min mark: 30g carbs (1 gel or 500 ml sports drink)\n"
            "   – Drink water at ~20 min intervals\n"
            "\n"
            "Estimated: ~1000 kcal"
        ),
        "estimated_kcal": 1000,
    },
    {
        "sport": "Run",
        "request": "Long run 25 km, I'm 10 weeks out from my marathon",
        "plan": (
            "PROGRESSIVE LONG RUN — 25 km (marathon block, 10 wks out)\n"
            "\n"
            "1. Warm-up (2 km)\n"
            "   – Easy jog Z1/Z2, drills: high knees, plyometrics\n"
            "\n"
            "2. Main set\n"
            "   – km 2–18 (16 km): Zone 2 — 120–140 bpm — ~5:00–5:20/km\n"
            "   – km 18–23 (5 km): Zone 3 tempo blocks — 140–155 bpm — ~4:30–4:45/km\n"
            "     (This simulates late-race fatigue; back off if HR exceeds 155)\n"
            "   – km 23–25: return to easy Z2 to finish strong\n"
            "\n"
            "3. Cool-down (2 min walk + 8 min stretch)\n"
            "\n"
            "Nutrition during:\n"
            "   – 30g carbs at 60 min, 60 min mark, 90 min mark (~gel or bar each time)\n"
            "   – Total: ~90g carbs during run\n"
            "\n"
            "Estimated: ~1400 kcal"
        ),
        "estimated_kcal": 1400,
    },
    {
        "sport": "Run",
        "request": "Interval session, I want to work on my speed, 10×400m",
        "plan": (
            "VO2MAX INTERVALS — 10×400m\n"
            "\n"
            "1. Warm-up (2 km)\n"
            "   – Easy jog Z1 (5:30/km), then dynamic drills:\n"
            "   – High knees 2×20m, plyometrics 2×10, 4×100m build-ups finishing at 3:50/km\n"
            "\n"
            "2. Main set: 10×(400m Z5 + 400m Z1 jog)\n"
            "   – Work: 400m at Zone 5 — 170–185 bpm — target ~3:50–4:00 per 400m\n"
            "   – Recovery: 400m easy jog Z1 — allow HR to drop to ~125 bpm before next rep\n"
            "   – Total interval distance: 4 km (= 50% of total → within the 30% rule)\n"
            "\n"
            "3. Cool-down (2 km)\n"
            "   – Easy jog 1.5 km + 5 min stretch (calves, quads, hamstrings)\n"
            "\n"
            "Total distance: ~12 km\n"
            "\n"
            "Nutrition: banana or energy bar 30 min before. No mid-session fuel needed (<75 min)\n"
            "\n"
            "Estimated: ~700 kcal"
        ),
        "estimated_kcal": 700,
    },
    {
        "sport": "Run",
        "request": "Threshold interval session, 5×5 min with 2.5 min recovery",
        "plan": (
            "THRESHOLD INTERVALS — 5×5min Z4\n"
            "\n"
            "1. Warm-up (15 min)\n"
            "   – 10 min easy jog Z2, then drills: high knees, leg swings, plyometrics\n"
            "   – 2×2 min build-up to threshold pace\n"
            "\n"
            "2. Main set: 5×(5 min Zone 4 + 2.5 min Zone 2 recovery)\n"
            "   – Work: Zone 4 — 155–170 bpm — target ~4:15–4:25/km\n"
            "   – Recovery: easy jog Z2 (120–135 bpm) for exactly 2.5 min\n"
            "   – Total quality work: 25 min at threshold\n"
            "\n"
            "3. Cool-down (10 min)\n"
            "   – Easy jog 8 min + static stretch calves/hamstrings/quads\n"
            "\n"
            "Nutrition: banana 30 min before. No mid-session carbs needed\n"
            "\n"
            "Estimated: ~620 kcal"
        ),
        "estimated_kcal": 620,
    },
    {
        "sport": "Run",
        "request": "Fartlek run 60 minutes, I want something fun and varied",
        "plan": (
            "FARTLEK RUN — 60 min\n"
            "\n"
            "1. Warm-up (10 min)\n"
            "   – Easy jog Z1/low Z2, dynamic drills: high knees, ankle circles, leg swings\n"
            "\n"
            "2. Main set (45 min fartlek)\n"
            "   – Base: Zone 2 jog between efforts (~5:00–5:20/km)\n"
            "   – Pick-ups by landmarks or feel (lamp posts, trees, corners):\n"
            "     × 6–8 surges of 30–90 sec at Z4 (155–170 bpm) during the run\n"
            "   – No set structure — respond to how you feel\n"
            "   – Every surge: recover fully at Z1 before the next one\n"
            "\n"
            "3. Cool-down (5 min)\n"
            "   – Walk/easy jog, 5 min full stretch\n"
            "\n"
            "Tip: put on a playlist and sprint every time the chorus hits — makes it fun!\n"
            "\n"
            "Estimated: ~540 kcal"
        ),
        "estimated_kcal": 540,
    },
    {
        "sport": "Run",
        "request": "Hill repeats session to build leg strength, I have a 200m hill nearby",
        "plan": (
            "HILL REPEATS — 8×200m\n"
            "\n"
            "1. Warm-up (2 km flat)\n"
            "   – Easy Z2 jog, then 2 hill strides at 50% effort to feel the gradient\n"
            "\n"
            "2. Main set: 8×200m hill (Z4–Z5 effort)\n"
            "   – Effort: Zone 4–5 (155–180 bpm) — strong but controlled\n"
            "   – Stride: high knees, drive arms, lean into hill — don't overstride\n"
            "   – Recovery: walk/easy jog back down (90–120 sec) — HR to ~130 bpm\n"
            "   – Treat as strength work, not pure speed\n"
            "\n"
            "3. Cool-down (1.5 km flat easy)\n"
            "   – Walk last 200m, extra calf and glute stretch today (hills stress these)\n"
            "\n"
            "Total: ~6 km\n"
            "\n"
            "Estimated: ~480 kcal"
        ),
        "estimated_kcal": 480,
    },
    {
        "sport": "Run",
        "request": "I'm preparing for a 5K race next Sunday, what should I do today (it's Tuesday)?",
        "plan": (
            "5K PREP — SHARPENING SESSION (race Sunday)\n"
            "\n"
            "Context: 5 days out — keep legs sharp but don't add fatigue\n"
            "\n"
            "1. Warm-up (2 km)\n"
            "   – 1 km easy Z2, then drills: high knees, plyometrics, leg swings\n"
            "   – 4×100m build-ups finishing at race pace (4:00/km feel)\n"
            "\n"
            "2. Main set\n"
            "   – 3×1000m at race pace (~3:55–4:05/km, Zone 4–5)\n"
            "   – Recovery: 2 min easy Z1 walk/jog between reps\n"
            "   – Focus on even splits and smooth form, not going all-out\n"
            "\n"
            "3. Cool-down (1.5 km easy + stretch)\n"
            "\n"
            "No long run or hard sessions Wednesday–Saturday.\n"
            "Saturday: 20 min easy jog + 4×100m strides. Then rest.\n"
            "\n"
            "Estimated: ~400 kcal"
        ),
        "estimated_kcal": 400,
    },
    {
        "sport": "Run",
        "request": "Long run 90 minutes, I want to practice fueling strategy for my marathon",
        "plan": (
            "FUELING LONG RUN — ~90 min (~17–18 km)\n"
            "\n"
            "Goal: practice taking carbs on the run — train the gut\n"
            "\n"
            "1. Warm-up (10 min)\n"
            "   – Easy jog, dynamic drills\n"
            "\n"
            "2. Main set (75 min, all Zone 2 — 120–140 bpm — ~5:00–5:20/km)\n"
            "\n"
            "   Fueling schedule:\n"
            "   – T+0 min: start run (nothing)\n"
            "   – T+30 min: 30g carbs → 1 gel or 500 ml isotonic drink\n"
            "   – T+60 min: 30g carbs → repeat\n"
            "   – Sip water every 20 min between gels\n"
            "\n"
            "   Notes:\n"
            "   – Take gel without slowing if possible — practice the motion\n"
            "   – Try the exact brand/flavour you plan to use on race day\n"
            "\n"
            "3. Cool-down (5 min)\n"
            "   – Eat 30g fast carbs + protein shake within 30 min of finishing\n"
            "\n"
            "Estimated: ~990 kcal (run) + gels ~120 kcal"
        ),
        "estimated_kcal": 990,
    },
    {
        "sport": "Run",
        "request": "3×2000m threshold run, I want to improve my lactate threshold",
        "plan": (
            "THRESHOLD INTERVALS — 3×2000m\n"
            "\n"
            "1. Warm-up (2 km)\n"
            "   – Easy jog Z2, dynamic drills, 2×200m build-ups\n"
            "\n"
            "2. Main set: 3×(2000m Zone 4 + 2 min Z2 recovery jog)\n"
            "   – Work: Zone 4 — 155–168 bpm — target ~4:15–4:25/km\n"
            "   – Recovery: 2 min easy jog (allow HR to 130–135 bpm)\n"
            "   – Rep 3: if HR climbs above 172 bpm, ease to Z3 — don't sacrifice form\n"
            "\n"
            "3. Cool-down (1.5 km easy)\n"
            "   – 5 min stretch: calves, hamstrings, IT band\n"
            "\n"
            "Total ~9 km | Quality volume: 6 km at threshold\n"
            "\n"
            "Estimated: ~580 kcal"
        ),
        "estimated_kcal": 580,
    },
    {
        "sport": "Run",
        "request": "Marathon long run 32 km, peak week, 4 weeks to race",
        "plan": (
            "PEAK LONG RUN — 32 km (4 weeks to marathon)\n"
            "\n"
            "1. Warm-up (2 km)\n"
            "   – Easy walk/jog, drills, leg swings\n"
            "\n"
            "2. Main set\n"
            "   – km 2–20 (18 km): Zone 2 — 120–140 bpm — 5:00–5:20/km\n"
            "   – km 20–27 (7 km): Zone 3 tempo — 140–152 bpm — 4:35–4:50/km\n"
            "     (simulate race-pace fatigue at 30 km equivalent)\n"
            "   – km 27–32 (5 km): back to Z2, focus on form not pace\n"
            "\n"
            "3. Cool-down\n"
            "   – Walk 5 min, full body stretch 10 min, ice bath or cold shower recommended\n"
            "\n"
            "Fueling (mandatory):\n"
            "   – Gel / 30g carbs at 30, 60, 90, 120, 150 min\n"
            "   – Minimum 500 ml water/hour\n"
            "\n"
            "After: eat within 30 min (fast carbs) + protein within 60 min\n"
            "\n"
            "Estimated: ~1900 kcal"
        ),
        "estimated_kcal": 1900,
    },
    {
        "sport": "Run",
        "request": "Pre-race activation run, marathon is tomorrow",
        "plan": (
            "PRE-MARATHON ACTIVATION — 20 min (race tomorrow!)\n"
            "\n"
            "Rule: never rest the day before a race. Light activation only.\n"
            "\n"
            "1. 5 min walk\n"
            "2. 10 min very easy jog — Zone 1 only (100–120 bpm) — 6:00–7:00/km\n"
            "3. 4×80m strides at ~marathon pace — smooth, relaxed, no effort\n"
            "4. Walk cool-down 3 min, gentle stretch\n"
            "\n"
            "Total: ~3 km | No intensity, no fatigue\n"
            "\n"
            "Evening: high-carb meal (pasta/rice, low fibre), hydrate well\n"
            "Morning: white bread + peanut butter + banana, coffee if habitual\n"
            "\n"
            "Estimated: ~150 kcal"
        ),
        "estimated_kcal": 150,
    },
    {
        "sport": "Run",
        "request": "6×800m interval session, I want to target Z5",
        "plan": (
            "VO2MAX INTERVALS — 6×800m\n"
            "\n"
            "1. Warm-up (2.5 km)\n"
            "   – 2 km easy Z2, drills, then 2×200m build-ups at race effort\n"
            "\n"
            "2. Main set: 6×(800m Zone 5 + 400m Zone 1 jog)\n"
            "   – Work: Zone 5 — 170–185 bpm — target ~3:50–4:05 per 800m\n"
            "   – Recovery: 400m very easy jog/walk — wait for HR to drop to ~128 bpm\n"
            "   – If HR doesn't drop below 130 bpm before rep 5–6: cut to 5 reps\n"
            "\n"
            "3. Cool-down (1.5 km)\n"
            "   – Easy jog 10 min + full stretch\n"
            "\n"
            "Total: ~12 km | VO2max volume: 4.8 km (40% → slightly high; OK for strong day)\n"
            "\n"
            "Estimated: ~680 kcal"
        ),
        "estimated_kcal": 680,
    },
    {
        "sport": "Run",
        "request": "I want to do a tempo run of 8 km at a comfortably hard effort",
        "plan": (
            "TEMPO RUN — 8 km at Z3\n"
            "\n"
            "1. Warm-up (2 km)\n"
            "   – Easy Z2 jog, dynamic drills, 1×1 km build to low Z3\n"
            "\n"
            "2. Main set — 8 km continuous at Zone 3 (140–152 bpm)\n"
            "   – Target pace: ~4:35–4:50/km\n"
            "   – 'Comfortably hard' — you can speak in short sentences\n"
            "   – If HR climbs above 155 after km 5: drop to 4:50/km\n"
            "   – Split: 4 km out, 4 km back (or a loop)\n"
            "\n"
            "3. Cool-down (1.5 km easy + stretch)\n"
            "\n"
            "Nutrition: banana 30–45 min before. No fuel needed during (< 75 min)\n"
            "\n"
            "Estimated: ~530 kcal"
        ),
        "estimated_kcal": 530,
    },
    {
        "sport": "Run",
        "request": "Describe a week 1 easy running session for someone starting a marathon training block",
        "plan": (
            "WEEK 1 MARATHON BLOCK — INTRODUCTORY EASY RUN — 40 min\n"
            "\n"
            "Week 1 goal: establish the habit, not build fitness. Keep everything very easy.\n"
            "\n"
            "1. Warm-up (5 min)\n"
            "   – Walk 3 min, then very gentle jog\n"
            "\n"
            "2. Main set (30 min)\n"
            "   – Zone 1–2 — 100–135 bpm — pace 5:30–6:30/km or walk/run intervals if needed\n"
            "   – Run 4 min, walk 1 min × 6 rounds if currently not running continuously\n"
            "   – Feel: you should finish feeling like you could run 30 more minutes\n"
            "\n"
            "3. Cool-down (5 min walk + stretch)\n"
            "\n"
            "Week 1 mantra: 'Slow down. Then slow down some more.'\n"
            "\n"
            "Estimated: ~280 kcal"
        ),
        "estimated_kcal": 280,
    },
    {
        "sport": "Run",
        "request": "Speed session with strides and short VO2max efforts, 10×200m",
        "plan": (
            "SPEED SESSION — Strides + 10×200m VO2max\n"
            "\n"
            "1. Warm-up (2 km)\n"
            "   – 1.5 km easy Z2 + drills: high knees, plyometrics, butt kicks\n"
            "   – 4×100m strides at 90% (smooth accelerations)\n"
            "\n"
            "2. Main set: 10×(200m Z5 + 200m Z1 walk/jog)\n"
            "   – Work: Zone 5 — 170–185 bpm — target ~48–52 sec per 200m (~3:50/km pace)\n"
            "   – Recovery: 200m walk/slow jog — full recovery, HR to ~125 bpm\n"
            "   – Focus: mechanics and turnover, not pure time\n"
            "\n"
            "3. Cool-down (1.5 km easy + 6 min stretch)\n"
            "\n"
            "Total: ~7 km | VO2max volume: 2 km (29% of total — within limit)\n"
            "\n"
            "Estimated: ~450 kcal"
        ),
        "estimated_kcal": 450,
    },
    {
        "sport": "Run",
        "request": "Easy trail run 75 minutes, I have a forest trail nearby",
        "plan": (
            "EASY TRAIL RUN — 75 min (~12–13 km)\n"
            "\n"
            "1. Warm-up (5 min)\n"
            "   – Walk on flat terrain, then easy jog; dynamic drills on flat section\n"
            "\n"
            "2. Main set (65 min trail)\n"
            "   – Zone 2 by HR — 120–140 bpm — adjust pace for terrain (climbs: 5:30–7:00/km)\n"
            "   – On descents: shorten stride, keep HR in Z2, don't blast quads\n"
            "   – Trail tip: run by effort/HR, not GPS pace — terrain changes pace naturally\n"
            "\n"
            "3. Cool-down (5 min)\n"
            "   – Walk back to car/home, stretch calves and hip flexors (trail stresses these)\n"
            "\n"
            "Nutrition: carry 500 ml water + 1 gel (precaution for any trail run > 60 min)\n"
            "\n"
            "Estimated: ~700 kcal"
        ),
        "estimated_kcal": 700,
    },
    {
        "sport": "Run",
        "request": "Half marathon prep — race pace intervals 4×3 km, race is in 3 weeks",
        "plan": (
            "HALF MARATHON RACE PACE INTERVALS — 4×3 km (3 weeks out)\n"
            "\n"
            "1. Warm-up (2 km)\n"
            "   – Easy Z2 jog + drills + 2×500m build to race pace\n"
            "\n"
            "2. Main set: 4×(3 km at HM race pace + 90 sec walk recovery)\n"
            "   – Target pace: ~4:15–4:25/km (Zone 4 — 155–168 bpm)\n"
            "   – Recovery: 90 sec easy walk → not full recovery, stress the transition\n"
            "   – Rep 4: if feeling strong, add a 500m surge at 4:05/km finish\n"
            "\n"
            "3. Cool-down (1.5 km easy + 8 min stretch)\n"
            "\n"
            "Total: ~18 km | Strong session — follow with easy run tomorrow, no intervals this week\n"
            "\n"
            "Estimated: ~1100 kcal"
        ),
        "estimated_kcal": 1100,
    },
    {
        "sport": "Run",
        "request": "Easy 30 minute run, I'm in a deload week",
        "plan": (
            "DELOAD EASY RUN — 30 min\n"
            "\n"
            "Deload week: lower volume, keep a little movement\n"
            "\n"
            "1. Warm-up (3 min walk)\n"
            "\n"
            "2. Main set (24 min)\n"
            "   – Zone 1 only — 100–120 bpm — 6:00–7:00/km or slower\n"
            "   – This is literally a 'legs loosener' — no HR targets, just move\n"
            "   – If you feel stiff, even shorter is fine\n"
            "\n"
            "3. Cool-down (3 min walk + 5 min gentle stretch)\n"
            "\n"
            "Deload rule: 40–50% of normal volume. Your body gets stronger this week.\n"
            "\n"
            "Estimated: ~190 kcal"
        ),
        "estimated_kcal": 190,
    },

    # ─── CYCLING (15) ────────────────────────────────────────────────────────────

    {
        "sport": "Ride",
        "request": "90 minute easy aerobic bike ride to build my base",
        "plan": (
            "BASE ENDURANCE RIDE — 90 min (~45 km)\n"
            "\n"
            "1. Warm-up (10 min)\n"
            "   – Easy Z1 spin, high cadence ~95 rpm, no resistance\n"
            "\n"
            "2. Main set (70 min)\n"
            "   – Zone 2 — 120–140 bpm / 56–75% FTP — ~30 km/h\n"
            "   – Cadence: 88–92 rpm throughout\n"
            "   – Keep it flat or rolling terrain — avoid big climbs today\n"
            "   – HR check: if above 143 bpm → drop to easier gear, not faster\n"
            "\n"
            "3. Cool-down (10 min)\n"
            "   – Easy spin Z1, then off bike: stretch quads, hip flexors, calves × 30s each\n"
            "\n"
            "Nutrition: 50g carbs/hour → gel + water at 45 min mark\n"
            "\n"
            "Estimated: ~750 kcal"
        ),
        "estimated_kcal": 750,
    },
    {
        "sport": "Ride",
        "request": "Sweet spot interval session, 5×8 minutes",
        "plan": (
            "SWEET SPOT INTERVALS — 5×8 min @ 88–92% FTP\n"
            "\n"
            "1. Warm-up (15 min)\n"
            "   – 10 min easy Z2 spin, then 3×1 min builds to sweet spot wattage\n"
            "   – Target FTP ~270W → sweet spot = 238–248W (88–92% FTP)\n"
            "\n"
            "2. Main set: 5×(8 min @ 88–92% FTP + 4 min Z1 recovery)\n"
            "   – Work: 238–248W / HR likely 148–162 bpm\n"
            "   – Recovery: 4 min easy spin, HR drops to ~130 bpm before next rep\n"
            "   – Cadence: 90–95 rpm during work intervals\n"
            "\n"
            "3. Cool-down (10 min easy Z1 spin)\n"
            "\n"
            "Total: ~55 min | 40 min quality work\n"
            "Nutrition: 50g carbs before, 50g/hr during (gel at mid-session)\n"
            "\n"
            "Estimated: ~650 kcal"
        ),
        "estimated_kcal": 650,
    },
    {
        "sport": "Ride",
        "request": "VO2max sprints, 8×30 seconds all-out",
        "plan": (
            "VO2MAX SPRINTS — 8×30 sec @ 110%+ FTP\n"
            "\n"
            "1. Warm-up (20 min)\n"
            "   – 15 min progressive Z2 build, then 3×20 sec @ 100% FTP with full recovery\n"
            "\n"
            "2. Main set: 8×(30 sec max sprint + 4 min easy Z1 recovery)\n"
            "   – Work: 110–130% FTP (~297–351W) — go as hard as possible each rep\n"
            "   – Cadence: 100–110 rpm during sprints (out of saddle OK for last 10 sec)\n"
            "   – Recovery: 4 min easy spin — full HR recovery to ~125 bpm\n"
            "   – Adjust down to 6 reps if form breaks or HR doesn't recover\n"
            "\n"
            "3. Cool-down (10 min easy Z1)\n"
            "\n"
            "Estimated: ~600 kcal"
        ),
        "estimated_kcal": 600,
    },
    {
        "sport": "Ride",
        "request": "Long aerobic ride 3 hours, steady endurance",
        "plan": (
            "LONG AEROBIC RIDE — 3 hr (~90 km)\n"
            "\n"
            "1. Warm-up (10 min)\n"
            "   – Easy Z1 spin, progressive build\n"
            "\n"
            "2. Main set (2:40)\n"
            "   – Zone 2 — 120–138 bpm / 56–72% FTP — ~28–32 km/h (depending on terrain)\n"
            "   – First 45 min: stay at LOW Z2 (120–130 bpm) — resist the urge to push\n"
            "   – Last 30 min: can drift to mid Z2 (132–138) if feeling strong\n"
            "   – Cadence goal: 88–92 rpm\n"
            "\n"
            "3. Cool-down (10 min easy + off-bike stretch)\n"
            "\n"
            "Nutrition (critical for 3 hr ride):\n"
            "   – Pre-ride: oatmeal or bread + peanut butter\n"
            "   – On bike: 50–60g carbs/hr → every 30 min: 1 gel or bar or banana\n"
            "   – Total: ~150–180g carbs on bike\n"
            "   – Hydration: 600–750 ml/hr (two bottles)\n"
            "\n"
            "Estimated: ~1500 kcal"
        ),
        "estimated_kcal": 1500,
    },
    {
        "sport": "Ride",
        "request": "FTP threshold intervals 4×4 minutes at 100% FTP",
        "plan": (
            "FTP THRESHOLD — 4×4 min @ 100% FTP\n"
            "\n"
            "1. Warm-up (15 min)\n"
            "   – 12 min progressive Z1→Z2 build, 3×30 sec at FTP to open legs\n"
            "\n"
            "2. Main set: 4×(4 min @ 100% FTP + 4 min Z1 recovery)\n"
            "   – Work: ~270W / HR ~162–170 bpm (Zone 4)\n"
            "   – Cadence: 90–95 rpm — hold wattage, don't grind a big gear\n"
            "   – Recovery: 4 min easy spin, HR fully to ~130 bpm\n"
            "   – Rep 4: if HR exceeds 174 bpm → drop to 95% FTP (~256W)\n"
            "\n"
            "3. Cool-down (10 min easy spin)\n"
            "\n"
            "Total: 45 min | 16 min at FTP\n"
            "\n"
            "Estimated: ~550 kcal"
        ),
        "estimated_kcal": 550,
    },
    {
        "sport": "Ride",
        "request": "Recovery spin, just want to move my legs after a hard day",
        "plan": (
            "ACTIVE RECOVERY SPIN — 40 min\n"
            "\n"
            "Pure recovery: high cadence, zero pressure on the legs.\n"
            "\n"
            "1. 5 min walk or off-bike mobility\n"
            "\n"
            "2. Main set (30 min spin)\n"
            "   – Zone 1 only — HR below 120 bpm — easy gear, high cadence ~95–100 rpm\n"
            "   – No climbs. No efforts. If you feel the urge to push → don't\n"
            "   – Flat route or indoor trainer on easiest setting\n"
            "\n"
            "3. Cool-down (5 min off-bike)\n"
            "   – Stretch: quads, hip flexors, calves\n"
            "\n"
            "Purpose: blood flow for recovery, not training stimulus\n"
            "\n"
            "Estimated: ~250 kcal"
        ),
        "estimated_kcal": 250,
    },
    {
        "sport": "Ride",
        "request": "Sweet spot pyramid session: 5+8+10+8+5 minutes",
        "plan": (
            "SWEET SPOT PYRAMID — 5+8+10+8+5 min\n"
            "\n"
            "1. Warm-up (15 min)\n"
            "   – Easy Z2 build, 2×2 min at sweet spot to open the legs\n"
            "\n"
            "2. Pyramid: each block @ 88–92% FTP (~238–248W)\n"
            "   – 5 min → 3 min Z1 → 8 min → 4 min Z1 → 10 min → 4 min Z1 → 8 min → 3 min Z1 → 5 min\n"
            "   – The 10-min block is the peak — go controlled, not all-out\n"
            "   – HR will likely land 148–165 bpm during work\n"
            "   – Cadence: 90–95 rpm throughout\n"
            "\n"
            "3. Cool-down (10 min Z1 spin)\n"
            "\n"
            "Total quality time: 36 min | Great threshold builder\n"
            "\n"
            "Estimated: ~680 kcal"
        ),
        "estimated_kcal": 680,
    },
    {
        "sport": "Ride",
        "request": "I want to do an FTP test to calibrate my power zones. Walk me through it",
        "plan": (
            "FTP TEST PROTOCOL — 20 min all-out effort\n"
            "\n"
            "1. Warm-up (25 min)\n"
            "   – 10 min easy Z2 spin\n"
            "   – 3×1 min at FTP effort with 1 min rest\n"
            "   – 5 min easy, then 5 min rest\n"
            "\n"
            "2. FTP Test: 20 min MAX effort (start the timer)\n"
            "   – Go as hard as you can sustain for the full 20 min\n"
            "   – First 5 min: resist going too hard — common mistake\n"
            "   – Mid-test (min 10): check and adjust. If fading: slightly reduce effort\n"
            "   – Last 2 min: give everything remaining\n"
            "   – Record average power for the 20 min\n"
            "\n"
            "3. Cool-down (15 min easy Z1 spin)\n"
            "\n"
            "Calculate FTP: average power × 0.95 = your FTP\n"
            "   Example: 285W avg × 0.95 = 271W FTP\n"
            "\n"
            "Do not train again today. Rest or easy walk tomorrow.\n"
            "\n"
            "Estimated: ~600 kcal"
        ),
        "estimated_kcal": 600,
    },
    {
        "sport": "Ride",
        "request": "Half triathlon race pace intervals, race is 90 km bike, 8 weeks out",
        "plan": (
            "HALF TRIATHLON RACE PACE — 4×15 min @ 90–95% FTP\n"
            "\n"
            "1. Warm-up (15 min)\n"
            "   – Z2 spin, 2×3 min at race pace (90% FTP ~243W)\n"
            "\n"
            "2. Main set: 4×(15 min @ 90–95% FTP + 5 min Z2 active recovery)\n"
            "   – Work: ~243–257W / HR ~158–167 bpm (Zone 4)\n"
            "   – Aero position during work intervals (simulate race)\n"
            "   – Cadence: 88–92 rpm\n"
            "   – Between reps: 5 min easy spin — don't fully recover\n"
            "\n"
            "3. Cool-down (10 min Z1)\n"
            "\n"
            "Total ride: ~75 min | 60 min quality\n"
            "Nutrition: 60g carbs/hr (race-simulation fueling)\n"
            "\n"
            "Estimated: ~900 kcal"
        ),
        "estimated_kcal": 900,
    },
    {
        "sport": "Ride",
        "request": "2 hour endurance ride with some tempo blocks to break it up",
        "plan": (
            "ENDURANCE + TEMPO MIX — 2 hr (~58 km)\n"
            "\n"
            "1. Warm-up (10 min Z1)\n"
            "\n"
            "2. Main set (100 min)\n"
            "   – Min 0–20: Zone 2 steady (120–138 bpm)\n"
            "   – Min 20–35: 3×4 min Z3 tempo (140–152 bpm / 76–88% FTP) + 2 min Z2 between\n"
            "   – Min 35–60: Zone 2 steady base\n"
            "   – Min 60–75: 3×4 min Z3 tempo + 2 min Z2 between\n"
            "   – Min 75–100: Zone 2 finish\n"
            "\n"
            "3. Cool-down (10 min Z1)\n"
            "\n"
            "Nutrition: 50g carbs/hr (gel at 45 min, 75 min + water)\n"
            "\n"
            "Estimated: ~1050 kcal"
        ),
        "estimated_kcal": 1050,
    },
    {
        "sport": "Ride",
        "request": "Climbing intervals, 3×10 min sustained climbing effort",
        "plan": (
            "CLIMBING THRESHOLD — 3×10 min\n"
            "\n"
            "Best done on a real climb or indoor on incline setting.\n"
            "\n"
            "1. Warm-up (15 min flat)\n"
            "   – Easy Z2 build, 1×3 min at climbing effort to open legs\n"
            "\n"
            "2. Main set: 3×(10 min climb + 5 min descent/easy spin)\n"
            "   – Work: Zone 3–4 — 145–165 bpm / 76–95% FTP\n"
            "   – Seated climbing: 70–80 rpm cadence\n"
            "   – Out of saddle: short bursts only (sharp pitches), then sit and settle\n"
            "   – Recovery: easy descent or flat spin — don't fully stop\n"
            "\n"
            "3. Cool-down (10 min easy flat)\n"
            "\n"
            "Estimated: ~700 kcal"
        ),
        "estimated_kcal": 700,
    },
    {
        "sport": "Ride",
        "request": "2 hour ride with cadence drills focus",
        "plan": (
            "CADENCE-FOCUS ENDURANCE RIDE — 2 hr\n"
            "\n"
            "Goal: improve pedaling efficiency. Stay Z2 throughout.\n"
            "\n"
            "1. Warm-up (10 min easy Z1)\n"
            "\n"
            "2. Main set (100 min)\n"
            "   – Base pace: Z2 (120–140 bpm) at comfortable cadence (~88 rpm)\n"
            "   – Cadence drills every 20 min:\n"
            "     × 4×(1 min at 100+ rpm, easy gear) + 2 min normal cadence\n"
            "     × Focus: keep hips from bouncing — disengage knees, drive with glutes\n"
            "   – After each drill block: return to comfortable Z2 base\n"
            "\n"
            "3. Cool-down (10 min easy Z1)\n"
            "\n"
            "Nutrition: 50g carbs/hr, 600 ml water/hr\n"
            "\n"
            "Estimated: ~1000 kcal"
        ),
        "estimated_kcal": 1000,
    },
    {
        "sport": "Ride",
        "request": "Pre-triathlon activation ride, race is tomorrow",
        "plan": (
            "PRE-RACE BIKE ACTIVATION — 25 min (race tomorrow!)\n"
            "\n"
            "1. 5 min easy Z1 spin, high cadence ~95 rpm\n"
            "\n"
            "2. 3×(1 min @ race effort, 90% FTP + 2 min easy Z1)\n"
            "   – Goal: sharpen legs, not create fatigue\n"
            "   – HR may hit 155–162 bpm — that's fine, keep it brief\n"
            "\n"
            "3. 5 min easy Z1 spin to finish\n"
            "\n"
            "Bike check: tyres inflated, gears indexed, garmin charged\n"
            "\n"
            "Evening: high-carb dinner (pasta/rice), hydrate well, sleep early\n"
            "\n"
            "Estimated: ~200 kcal"
        ),
        "estimated_kcal": 200,
    },
    {
        "sport": "Ride",
        "request": "4 hour long ride for full triathlon prep, 12 weeks out",
        "plan": (
            "LONG RIDE — 4 hr / ~120 km (full triathlon block)\n"
            "\n"
            "1. Warm-up (10 min easy Z1 build)\n"
            "\n"
            "2. Main set (3:40)\n"
            "   – HR 1–60 min: Zone 2 low — 120–132 bpm (no heroics early)\n"
            "   – HR 60–180 min: Zone 2 steady — 130–140 bpm / ~60–70% FTP\n"
            "   – Min 170–200: 2×10 min at 75% FTP (triathlon race-pace warmup block)\n"
            "   – Final 40 min: back to steady Z2\n"
            "\n"
            "3. Cool-down (10 min easy)\n"
            "\n"
            "Nutrition (critical, no compromise):\n"
            "   – Pre-ride: oatmeal + banana\n"
            "   – On bike: 70–80g carbs/hr (2 gels + water every 30 min)\n"
            "   – Total: ~280–320g carbs on bike\n"
            "   – Hydration: 750 ml/hr (train your gut for race day)\n"
            "\n"
            "Estimated: ~2000 kcal"
        ),
        "estimated_kcal": 2000,
    },
    {
        "sport": "Ride",
        "request": "5×5 min at 95% FTP with 3 min recovery",
        "plan": (
            "THRESHOLD INTERVALS — 5×5 min @ 95% FTP\n"
            "\n"
            "1. Warm-up (15 min)\n"
            "   – 12 min Z1→Z2 progressive, 3×30 sec at threshold\n"
            "\n"
            "2. Main set: 5×(5 min @ 95% FTP + 3 min Z1 recovery)\n"
            "   – Work: ~257W / HR ~160–168 bpm (Zone 4)\n"
            "   – Cadence: 90–95 rpm — avoid grinding\n"
            "   – Recovery: 3 min easy spin (50% of work = minimum)\n"
            "   – Rep 5: push the last minute hard if legs allow\n"
            "\n"
            "3. Cool-down (10 min Z1 spin)\n"
            "\n"
            "Total: ~55 min | 25 min at threshold — solid session\n"
            "\n"
            "Estimated: ~650 kcal"
        ),
        "estimated_kcal": 650,
    },

    # ─── SWIMMING (15) ────────────────────────────────────────────────────────────

    {
        "sport": "Swim",
        "request": "3 km mixed aerobic swim session",
        "plan": (
            "AEROBIC MIXED SWIM — 3000m\n"
            "\n"
            "1. Warm-up (1000m)\n"
            "   – 400m easy freestyle (mix with pull buoy for last 200m)\n"
            "   – 4×50m kick (kickboard) with 15s rest\n"
            "   – Drills 4×50m: single-arm (50m), catch-up (50m), fist swimming (50m), fingertip drag (50m)\n"
            "   – Breathing: every 3 strokes throughout warm-up\n"
            "\n"
            "2. Main set (1700m)\n"
            "   – 4×400m at mixed tempo: 100m easy + 100m tempo + 100m easy + 100m tempo (1:55–1:45/100m)\n"
            "   – 30s rest between each 400m\n"
            "\n"
            "3. Cool-down (300m)\n"
            "   – 300m easy catch-up drill / backstroke\n"
            "\n"
            "Estimated: ~580 kcal"
        ),
        "estimated_kcal": 580,
    },
    {
        "sport": "Swim",
        "request": "Speed and consistency session, 20×100m with target pace",
        "plan": (
            "SPEED/CONSISTENCY SET — 20×100m\n"
            "\n"
            "1. Warm-up (1000m)\n"
            "   – 400m easy freestyle + pull buoy 200m\n"
            "   – 4×50m kick, 15s rest\n"
            "   – Drills 4×50m: sculling, shoulder taps, catch-up, single-arm\n"
            "\n"
            "2. Main set (2000m): 20×100m on a consistent send-off\n"
            "   – Target: 1:45–1:50/100m with 20s rest between reps\n"
            "   – Aim for EVEN splits — rep 20 should feel like rep 1\n"
            "   – Breathing: 1 breath/3 strokes, switch to 1/2 on hard reps if needed\n"
            "   – If drifting more than 5 sec from target → take 30s and reset\n"
            "\n"
            "3. Cool-down (300m)\n"
            "   – Easy backstroke or catch-up drill\n"
            "\n"
            "Total: 3300m\n"
            "\n"
            "Estimated: ~620 kcal"
        ),
        "estimated_kcal": 620,
    },
    {
        "sport": "Swim",
        "request": "Technique-focused session, I want to work on my stroke",
        "plan": (
            "TECHNIQUE SESSION — 2500m\n"
            "\n"
            "Today is about feel, not fitness.\n"
            "\n"
            "1. Warm-up (600m)\n"
            "   – 200m easy, 4×50m kick, 200m easy with bilateral breathing focus\n"
            "\n"
            "2. Drill block (800m)\n"
            "   – 4×100m single-arm (50m left, 50m right) — 20s rest\n"
            "   – 4×100m catch-up drill — 20s rest\n"
            "   – 4×50m fist swimming (feel the forearm catch) — 15s rest\n"
            "   – 4×50m fingertip drag (high elbow recovery) — 15s rest\n"
            "\n"
            "3. Integration set (800m)\n"
            "   – 4×200m: first 50m each = drill, remaining 150m apply feel to full stroke\n"
            "   – Slow down 10% from normal pace — think, don't swim fast\n"
            "\n"
            "4. Cool-down (300m easy)\n"
            "\n"
            "Estimated: ~420 kcal"
        ),
        "estimated_kcal": 420,
    },
    {
        "sport": "Swim",
        "request": "4 km aerobic endurance swim",
        "plan": (
            "AEROBIC ENDURANCE SWIM — 4000m\n"
            "\n"
            "1. Warm-up (1000m)\n"
            "   – 400m easy, 4×50m kick (15s rest), drills: 2×50m single-arm, 2×50m catch-up, 2×50m sculling, 2×50m fist\n"
            "\n"
            "2. Main set (2700m)\n"
            "   – 3×500m easy Z2 (1:55–2:00/100m), 30s rest between\n"
            "   – 4×200m tempo Z3 (1:45–1:50/100m), 30s rest between\n"
            "   – 3×100m easy recovery between main blocks (included in count)\n"
            "\n"
            "3. Cool-down (300m)\n"
            "   – Easy backstroke or pull buoy\n"
            "\n"
            "Estimated: ~720 kcal"
        ),
        "estimated_kcal": 720,
    },
    {
        "sport": "Swim",
        "request": "Short intense 2 km quality session, mostly VO2max work",
        "plan": (
            "HIGH-INTENSITY QUALITY SWIM — 2000m\n"
            "\n"
            "1. Warm-up (800m)\n"
            "   – 300m easy, 4×50m kick, 4×50m drill (single-arm, catch-up, sculling, fist)\n"
            "\n"
            "2. Main set (900m)\n"
            "   – 3×(3×100m) — work sets:\n"
            "     × Set 1: 3×100m @ 1:40/100m (hard Z4), 20s rest between, 2 min between sets\n"
            "     × Set 2: 3×100m @ 1:35/100m (very hard Z5), 25s rest, 2 min between sets\n"
            "     × Set 3: 3×100m @ best effort, 30s rest\n"
            "   – Breathing: every 2 strokes on hard reps OK\n"
            "\n"
            "3. Cool-down (300m)\n"
            "   – Easy pull buoy, bilateral breathing focus\n"
            "\n"
            "Estimated: ~380 kcal"
        ),
        "estimated_kcal": 380,
    },
    {
        "sport": "Swim",
        "request": "Pyramid set plus drills, 2500 m total",
        "plan": (
            "PYRAMID + DRILLS — 2500m\n"
            "\n"
            "1. Warm-up (700m)\n"
            "   – 200m easy, 4×50m kick, 4×50m drill (catch-up, single-arm, fist, fingertip drag)\n"
            "\n"
            "2. Pyramid main set (1500m)\n"
            "   – 100m @ 1:50/100m (30s rest)\n"
            "   – 200m @ 1:55/100m (30s rest)\n"
            "   – 300m @ 1:57/100m (40s rest)\n"
            "   – 400m @ 2:00/100m (40s rest)\n"
            "   – 300m @ 1:55/100m (30s rest)\n"
            "   – 200m @ 1:50/100m\n"
            "   (Pace gets slightly SLOWER as distance grows — build aerobic base)\n"
            "\n"
            "3. Cool-down (300m easy)\n"
            "\n"
            "Estimated: ~440 kcal"
        ),
        "estimated_kcal": 440,
    },
    {
        "sport": "Swim",
        "request": "Pull buoy and paddles session for upper body endurance",
        "plan": (
            "PULL BUOY + PADDLES — 2800m\n"
            "\n"
            "1. Warm-up (600m)\n"
            "   – 200m easy free, 4×50m kick, 200m pull buoy only (no paddles yet)\n"
            "\n"
            "2. Main set (1900m)\n"
            "   – 5×200m pull buoy + paddles (1:48–1:52/100m), 30s rest\n"
            "   – Feel: load through forearm, high elbow, full extension\n"
            "   – 3×100m pull buoy ONLY (no paddles) — contrast the feel, 20s rest\n"
            "   – 2×200m pull buoy + paddles all-out effort (1:40–1:45/100m), 40s rest\n"
            "\n"
            "3. Cool-down (300m)\n"
            "   – Full stroke, no equipment\n"
            "\n"
            "Note: paddles increase shoulder load — stop if any shoulder discomfort\n"
            "\n"
            "Estimated: ~480 kcal"
        ),
        "estimated_kcal": 480,
    },
    {
        "sport": "Swim",
        "request": "Race prep simulation for open water triathlon 1500m swim",
        "plan": (
            "OPEN WATER RACE SIMULATION — 2500m total\n"
            "\n"
            "1. Warm-up (700m)\n"
            "   – 300m easy, 2×50m kick, 4×50m drill: sculling, catch-up, single-arm, shoulder taps\n"
            "\n"
            "2. Race simulation (1500m)\n"
            "   – Start hard: 100m at Z5 effort (simulate race start chaos)\n"
            "   – Settle: 200m drop to race pace Z3/Z4 (1:44–1:50/100m)\n"
            "   – Main body: 1000m steady Z3 (1:50–1:55/100m)\n"
            "   – Finish hard: 200m pick-up to Z4/5 (1:38–1:44/100m)\n"
            "   – 30s transition rest (simulate T1 effort)\n"
            "\n"
            "3. Brick cool-down block\n"
            "   – 2 min walk/jog to simulate T1 transition legs\n"
            "\n"
            "4. Cool-down swim (300m easy backstroke)\n"
            "\n"
            "Estimated: ~450 kcal"
        ),
        "estimated_kcal": 450,
    },
    {
        "sport": "Swim",
        "request": "Broken 1500m time trial to test my race pace",
        "plan": (
            "BROKEN 1500m TIME TRIAL\n"
            "\n"
            "1. Warm-up (1000m)\n"
            "   – 400m easy, 4×50m kick, 4×50m drills, 4×50m build to race pace\n"
            "\n"
            "2. Broken 1500m: 6×250m at race pace + 20s rest between\n"
            "   – Target: 1:44–1:50/100m per 250m block\n"
            "   – Record each 250m split separately\n"
            "   – Compare splits to find your fade point (when pace drops)\n"
            "   – Effective total time (minus rest) = your 1500m capability\n"
            "\n"
            "3. Cool-down (300m easy)\n"
            "\n"
            "Analysis after:\n"
            "   – Even splits = good pacing\n"
            "   – Negative split (faster 2nd half) = excellent\n"
            "   – Drop in last 2 blocks = need more aerobic base or better fueling\n"
            "\n"
            "Estimated: ~420 kcal"
        ),
        "estimated_kcal": 420,
    },
    {
        "sport": "Swim",
        "request": "3×(10×100m) consistency set with 2 min between rounds",
        "plan": (
            "3-SET CONSISTENCY CHALLENGE — 3×(10×100m)\n"
            "\n"
            "Total distance: 3000m\n"
            "\n"
            "1. Warm-up (1000m)\n"
            "   – 400m easy + pull buoy 200m, 4×50m kick, 4×50m drill\n"
            "\n"
            "2. Main set (3000m)\n"
            "   – Set 1 (10×100m @ 1:50/100m, 15s rest), then 2 min recovery\n"
            "   – Set 2 (10×100m @ 1:47/100m, 15s rest), then 2 min recovery\n"
            "   – Set 3 (10×100m @ 1:50/100m, 15s rest — match Set 1 after fatigue)\n"
            "   – Goal: ALL reps within 3 seconds of target — consistency over speed\n"
            "\n"
            "3. Cool-down (300m easy)\n"
            "\n"
            "Estimated: ~660 kcal"
        ),
        "estimated_kcal": 660,
    },
    {
        "sport": "Swim",
        "request": "Kick-focused endurance session with fins",
        "plan": (
            "KICK FOCUS + ENDURANCE — 2500m\n"
            "\n"
            "1. Warm-up (600m)\n"
            "   – 200m easy free, 4×50m kick without fins (15s rest)\n"
            "\n"
            "2. Kick block (600m)\n"
            "   – 6×100m kick WITH fins, alternating back/front kick:\n"
            "     × 100m flutter kick on back, 15s rest\n"
            "     × 100m flutter kick on front (face in water), 15s rest\n"
            "   – Engage glutes, not just calves\n"
            "\n"
            "3. Integration endurance set (1000m)\n"
            "   – 2×500m full freestyle with fins — focus on extended kick with good pull timing\n"
            "   – 40s rest between\n"
            "   – Remove fins: 1 min rest, feel the difference\n"
            "\n"
            "4. Cool-down (300m)\n"
            "   – Full stroke no fins, 100m easy + 100m catch-up + 100m backstroke\n"
            "\n"
            "Estimated: ~430 kcal"
        ),
        "estimated_kcal": 430,
    },
    {
        "sport": "Swim",
        "request": "3500 m mixed endurance including some tempo and easy blocks",
        "plan": (
            "MIXED ENDURANCE SWIM — 3500m\n"
            "\n"
            "1. Warm-up (1000m)\n"
            "   – 400m easy, 4×50m kick, drills: 2×50m catch-up, 2×50m single-arm, 2×50m sculling, 2×50m fist\n"
            "\n"
            "2. Main set (2200m)\n"
            "   – 800m easy Z2 continuous (1:58–2:02/100m)\n"
            "   – 4×200m tempo Z3 (1:45–1:50/100m) + 30s rest\n"
            "   – 6×100m easy recovery (1:58–2:05/100m) + 15s rest\n"
            "\n"
            "3. Cool-down (300m)\n"
            "   – Easy pull buoy\n"
            "\n"
            "Estimated: ~610 kcal"
        ),
        "estimated_kcal": 610,
    },
    {
        "sport": "Swim",
        "request": "Recovery swim after a race, just want easy movement in the water",
        "plan": (
            "ACTIVE RECOVERY SWIM — 2000m (post-race)\n"
            "\n"
            "No sets, no targets, no timers.\n"
            "\n"
            "1. 300m easy backstroke or breaststroke (whatever feels natural)\n"
            "\n"
            "2. 1200m alternating:\n"
            "   – 100m easy freestyle (no push at all)\n"
            "   – 100m backstroke (arms straight, gentle flutter kick)\n"
            "   – Repeat 6×\n"
            "   – No flip turns, push off walls softly\n"
            "\n"
            "3. 200m pull buoy (arms only, legs resting completely)\n"
            "\n"
            "4. 300m easy finisher — any stroke, don't think\n"
            "\n"
            "Purpose: blood flow, not training. Get out feeling looser than when you got in.\n"
            "\n"
            "Estimated: ~280 kcal"
        ),
        "estimated_kcal": 280,
    },
    {
        "sport": "Swim",
        "request": "20×100m each with 25m escalating pace: easy-tempo-hard-max",
        "plan": (
            "ESCALATING PACE 20×100m\n"
            "\n"
            "1. Warm-up (1000m)\n"
            "   – 400m easy, 4×50m kick, drills 4×50m: sculling, shoulder taps, fist, catch-up\n"
            "\n"
            "2. Main set (2000m): 20×100m — each rep structured as 4×25m at increasing pace\n"
            "   – 25m Z1 easy (2:05/100m feel)\n"
            "   – 25m Z2 (1:55/100m feel)\n"
            "   – 25m Z4 hard (1:38/100m feel)\n"
            "   – 25m Z5 MAX sprint finish\n"
            "   – 20s rest between reps\n"
            "   – Goal: consistently execute each 25m at the right effort — don't blow up early\n"
            "\n"
            "3. Cool-down (300m easy)\n"
            "\n"
            "Total: 3300m\n"
            "\n"
            "Estimated: ~620 kcal"
        ),
        "estimated_kcal": 620,
    },
    {
        "sport": "Swim",
        "request": "Build-up endurance set: 400-800-400 m blocks",
        "plan": (
            "BUILD-UP ENDURANCE — 400-800-400 blocks\n"
            "\n"
            "1. Warm-up (1000m)\n"
            "   – 400m easy, 4×50m kick, 4×50m drill (catch-up, single-arm, fist, fingertip drag)\n"
            "\n"
            "2. Main set (1600m)\n"
            "   – Block 1: 400m continuous @ 1:55/100m (Z2) — 45s rest\n"
            "   – Block 2: 800m continuous @ 1:58/100m (low Z2 — longer, easier) — 60s rest\n"
            "   – Block 3: 400m continuous @ 1:50/100m (Z3 — stronger finish) — done\n"
            "   – Focus on continuous smooth stroke throughout each block\n"
            "\n"
            "3. Cool-down (300m easy)\n"
            "\n"
            "Total: 2900m\n"
            "\n"
            "Estimated: ~500 kcal"
        ),
        "estimated_kcal": 500,
    },
]


def main():
    headers = [
        "id",
        "sport",
        "request",
        "plan",
        "estimated_kcal",
        "rating_1_5",
        "intensity_accurate_Y_N",
        "structure_logical_Y_N",
        "durations_realistic_Y_N",
        "feedback_comments",
    ]

    output_path = "/Users/jelleverschuure/StravaEat/coach_eval/training_sessions_eval.csv"

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, quoting=csv.QUOTE_ALL)
        writer.writerow(headers)
        for i, s in enumerate(SESSIONS, start=1):
            writer.writerow([
                i,
                s["sport"],
                s["request"],
                s["plan"],
                s["estimated_kcal"],
                "",   # rating_1_5
                "",   # intensity_accurate
                "",   # structure_logical
                "",   # durations_realistic
                "",   # feedback
            ])

    print(f"Written {len(SESSIONS)} sessions to {output_path}")


if __name__ == "__main__":
    main()
