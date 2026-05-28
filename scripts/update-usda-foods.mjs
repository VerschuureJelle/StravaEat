#!/usr/bin/env node
/**
 * Fetches verified nutritional values from USDA FoodData Central for every
 * food in mobile/lib/commonFoods.ts and rewrites the file.
 *
 * Usage:
 *   USDA_API_KEY=your_key node scripts/update-usda-foods.mjs
 *
 * Get a free key at https://fdc.nal.usda.gov/api-key-signup.html
 */

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = join(__dirname, '../mobile/lib/commonFoods.ts')

const API_KEY = process.env.USDA_API_KEY
if (!API_KEY) {
  console.error('Error: set USDA_API_KEY=your_key before running')
  console.error('Get a free key at https://fdc.nal.usda.gov/api-key-signup.html')
  process.exit(1)
}

// ─── USDA nutrient IDs ────────────────────────────────────────────────────────
// nutrientId = SR Legacy identifier; nutrientNumber = Foundation/Survey string code
const NUTRIENTS = {
  kcal:    { id: 1008, num: '208' },
  protein: { id: 1003, num: '203' },
  fat:     { id: 1004, num: '204' },
  carbs:   { id: 1005, num: '205' },
}

// ─── Search terms keyed to USDA SR Legacy naming conventions ─────────────────
// SR Legacy uses "Food, variety, preparation, state" format.
const SEARCH_OVERRIDES = {
  // Fruit
  'Apple (medium)':                   'apples raw with skin',
  'Banana (medium)':                  'bananas raw',
  'Orange (medium)':                  'oranges raw all commercial varieties',
  'Kiwi (1 piece)':                   'kiwifruit green raw',
  'Watermelon (200g)':                'watermelon raw',
  'Pineapple (100g)':                 'pineapple raw',
  'Raspberries (100g)':               'raspberries raw',
  'Blueberries (100g)':               'blueberries raw',
  'Strawberries (100g)':              'strawberries raw',
  'Mango (100g)':                     'mangos raw',
  'Grapes (100g)':                    'grapes raw',
  'Melon / cantaloupe (100g)':        'melons cantaloupe raw',
  // Vegetables
  'Spinach (100g)':                   'spinach raw',
  'Carrot (medium)':                  'carrots raw',
  'Bell pepper (medium)':             'peppers sweet red raw',
  'Tomato (medium)':                  'tomatoes red raw',
  'Cherry tomatoes (100g)':           'tomatoes red raw',
  'Cucumber (100g)':                  'cucumber peeled raw',
  'Zucchini (100g)':                  'zucchini summer squash raw',
  'Courgette (100g)':                 'zucchini summer squash raw',
  'Cauliflower (100g)':               'cauliflower raw',
  'Green beans (100g)':               'beans snap green raw',
  'Corn / sweetcorn (100g)':          'corn sweet yellow raw',
  'Mushrooms (100g)':                 'mushrooms white raw',
  'Asparagus (100g)':                 'asparagus raw',
  'Sweet potato (medium)':            'sweet potatoes boiled flesh without skin',
  'Potato (medium, boiled)':          'potatoes boiled cooked in skin flesh without salt',
  'Edamame (100g)':                   'edamame frozen prepared',
  'Beetroot (100g)':                  'beets raw',
  'Lettuce / mixed greens (50g)':     'lettuce raw',
  'Avocado (half)':                   'avocados raw',
  'Eggplant / aubergine (100g)':      'eggplant raw',
  // Bread & Grains
  'Slice of bread (white)':           'bread white commercially prepared',
  'Slice of bread (whole wheat)':     'bread whole-wheat commercially prepared',
  'Sourdough (slice)':                'bread french vienna sourdough',
  'Wrap / tortilla (medium)':         'tortillas ready-to-bake wheat',
  'Pita bread (1 piece)':             'bread pita white enriched',
  'Oats (50g uncooked)':              'cereals oats regular quick unenriched dry',
  'Muesli (50g)':                     'cereals oats rolled uncooked',
  'Granola (50g)':                    'granola homemade',
  'White rice (100g uncooked)':       'rice white long-grain raw',
  'Brown rice (100g uncooked)':       'rice brown long-grain raw',
  'Basmati rice (100g uncooked)':     'rice white long-grain raw',
  'Spaghetti (100g uncooked)':        'pasta dry unenriched spaghetti',
  'Penne (100g uncooked)':            'pasta dry enriched',
  'Pasta (wholegrain, 100g uncooked)':'pasta whole-grain dry',
  'Egg noodles (100g uncooked)':      'noodles egg dry enriched',
  'Couscous (100g uncooked)':         'couscous dry',
  'Quinoa (100g uncooked)':           'quinoa uncooked',
  'Bulgur wheat (100g uncooked)':     'bulgur dry',
  'Lentils (100g dry)':               'lentils raw',
  'Chickpeas (100g dry)':             'chickpeas raw',
  'Kidney beans (100g, canned)':      'beans kidney canned',
  // Meat
  'Beef mince 5% fat (100g)':         'beef ground 95% lean raw',
  'Beef mince 20% fat (100g)':        'beef ground 80% lean raw',
  'Beef steak (100g)':                'beef tenderloin raw',
  'Pork tenderloin (100g)':           'pork tenderloin raw',
  'Pork chop (100g)':                 'pork loin chop raw',
  'Bacon (2 rashers)':                'pork cured bacon cooked',
  'Ham / cooked (50g)':               'pork cured ham cooked',
  'Chicken breast (100g)':            'chicken broilers fryers breast meat only raw',
  'Chicken thigh (100g)':             'chicken broilers fryers thigh meat only raw',
  // Seafood
  'Salmon (100g)':                    'fish salmon atlantic raw',
  'Cod (100g)':                       'fish cod atlantic raw',
  'Tuna in water (100g)':             'fish tuna light canned water drained',
  'Tuna in oil (100g)':               'fish tuna light canned oil drained',
  'Mackerel (100g)':                  'fish mackerel atlantic raw',
  'Tilapia (100g)':                   'fish tilapia raw',
  'Shrimp / prawns (100g)':           'crustaceans shrimp mixed species cooked moist heat',
  'Lamb mince (100g)':                'lamb ground raw',
  // Dairy & Eggs
  'Egg (large)':                      'egg whole raw fresh',
  'Egg white (large)':                'egg white raw fresh',
  'Scrambled eggs (2 eggs)':          'egg whole cooked scrambled',
  'Greek yogurt (150g)':              'yogurt greek plain nonfat',
  'Natural yogurt (150g)':            'yogurt plain whole milk',
  'Skyr (150g)':                      'yogurt plain nonfat',
  'Whole milk (250ml)':               'milk whole 3.25% milkfat',
  'Skimmed milk (250ml)':             'milk nonfat fluid skim',
  'Oat milk (250ml)':                 'oat milk unsweetened',
  'Almond milk (250ml)':              'almond milk unsweetened',
  'Soy milk (250ml)':                 'soymilk original',
  'Butter (10g)':                     'butter salted',
  'Cream cheese (30g)':               'cheese cream',
  'Cheddar cheese (30g)':             'cheddar cheese natural',
  'Mozzarella (30g)':                 'mozzarella cheese whole milk',
  'Parmesan (15g)':                   'cheese parmesan grated',
  'Ricotta (50g)':                    'cheese ricotta whole milk',
  // Drinks (beverages/ alcoholic prefixes navigate SR Legacy category names)
  'Water (500ml)':                    '__SKIP__',
  'Cup of coffee (black)':            'beverages coffee brewed',
  'Coffee with milk':                 'beverages coffee brewed',
  'Latte (250ml)':                    'beverages coffee brewed',
  'Flat white (200ml)':               'beverages coffee brewed',
  'Cappuccino (200ml)':               'beverages coffee brewed',
  'Cup of tea (black)':               'beverages tea brewed',
  'Tea with milk':                    'beverages tea brewed',
  'Coke (330ml)':                     'beverages carbonated cola regular',
  'Diet Coke (330ml)':                'beverages carbonated cola diet',
  'Sparkling water (330ml)':          'beverages water carbonated',
  'Orange juice (250ml)':             'orange juice canned unsweetened',
  'Apple juice (250ml)':              'juice apple canned unsweetened',
  'Sports drink (500ml)':             'beverages sports drink electrolyte',
  'Energy drink (250ml)':             'beverages energy drink',
  'Protein shake (scoop)':            'beverages protein powder whey',
  'Smoothie (fruit, 300ml)':          'fruit smoothie',
  'Smoothie (green, 300ml)':          'fruit smoothie',
  'Smoothie (banana & oat, 300ml)':   'fruit smoothie strawberry banana',
  'Protein smoothie (300ml)':         'fruit smoothie',
  'Beer (330ml)':                     'alcoholic beer regular',
  'Wine, red (175ml)':                'alcoholic wine table red',
  'Wine, white (175ml)':              'alcoholic wine table white',
  'Chocolate milk (200ml)':           'milk chocolate fluid whole',
  // Nuts & Spreads
  'Almonds (30g)':                    'nuts almonds raw',
  'Cashews (30g)':                    'nuts cashew raw',
  'Walnuts (30g)':                    'nuts walnuts english',
  'Mixed nuts (30g)':                 'nuts mixed dry roasted',
  'Peanut butter (1 tbsp)':           'peanut butter smooth',
  'Almond butter (1 tbsp)':           'almond butter plain',
  'Hummus (2 tbsp)':                  'hummus commercial',
  'Cream cheese (1 tbsp)':            'cheese cream',
  'Jam / marmalade (1 tbsp)':         'jams preserves',
  'Honey (1 tbsp)':                   'honey',
  'Olive oil (1 tbsp)':               'oil olive salad',
  // Snacks
  'Granola bar':                      'granola bar oats',
  'Protein bar (avg)':                'formulated bar snickers marathon',
  'Energy bar (avg)':                 'formulated bar energy',
  'Crisps / chips (25g bag)':         'snacks potato chips plain salted',
  'Popcorn (30g)':                    'snacks popcorn oil-popped',
  'Biscuit / cookie (1 piece)':       'cookies butter commercially prepared',
  'Oat cake (1 piece)':               'crackers whole-wheat',
  'Waffle (plain)':                   'waffles plain frozen',
  'Pancake (plain, medium)':          'pancakes plain',
  'Banana bread (slice)':             'bread banana',
  'Medjool date (1 piece)':           'dates medjool',
  // Tofu & soy
  'Tofu (100g)':                      'tofu raw firm prepared with calcium sulfate',
}

// ─── Gram weight per serving ──────────────────────────────────────────────────
// All values in grams (ml treated as g, close enough for nutrition purposes)
const SERVING_G = {
  // Fruit
  'Apple (medium)': 182,  'Banana (medium)': 118, 'Orange (medium)': 131,
  'Pear (medium)': 178, 'Peach (medium)': 150, 'Kiwi (1 piece)': 69,
  'Watermelon (200g)': 200, 'Pineapple (100g)': 100, 'Raspberries (100g)': 100,
  'Blueberries (100g)': 100, 'Strawberries (100g)': 100, 'Mango (100g)': 100,
  'Grapes (100g)': 100, 'Cherries (100g)': 100, 'Melon / cantaloupe (100g)': 100,
  // Vegetables
  'Broccoli (100g)': 100, 'Spinach (100g)': 100, 'Kale (100g)': 100,
  'Carrot (medium)': 61, 'Bell pepper (medium)': 119, 'Tomato (medium)': 123,
  'Cherry tomatoes (100g)': 100, 'Cucumber (100g)': 100, 'Zucchini (100g)': 100,
  'Courgette (100g)': 100, 'Cauliflower (100g)': 100, 'Green beans (100g)': 100,
  'Peas (100g)': 100, 'Corn / sweetcorn (100g)': 100, 'Onion (medium)': 110,
  'Garlic (1 clove)': 3, 'Mushrooms (100g)': 100, 'Asparagus (100g)': 100,
  'Sweet potato (medium)': 130, 'Potato (medium, boiled)': 150,
  'Edamame (100g)': 100, 'Beetroot (100g)': 100, 'Lettuce / mixed greens (50g)': 50,
  'Avocado (half)': 100, 'Eggplant / aubergine (100g)': 100,
  // Bread & Grains
  'Slice of bread (white)': 28, 'Slice of bread (whole wheat)': 28,
  'Sourdough (slice)': 33, 'Bagel (plain)': 98, 'Croissant': 57,
  'Wrap / tortilla (medium)': 45, 'Pita bread (1 piece)': 57,
  'Oats (50g uncooked)': 50, 'Muesli (50g)': 50, 'Granola (50g)': 50,
  'White rice (100g uncooked)': 100, 'Brown rice (100g uncooked)': 100,
  'Basmati rice (100g uncooked)': 100, 'Spaghetti (100g uncooked)': 100,
  'Penne (100g uncooked)': 100, 'Pasta (wholegrain, 100g uncooked)': 100,
  'Egg noodles (100g uncooked)': 100, 'Couscous (100g uncooked)': 100,
  'Quinoa (100g uncooked)': 100, 'Bulgur wheat (100g uncooked)': 100,
  'Lentils (100g dry)': 100, 'Chickpeas (100g dry)': 100,
  'Kidney beans (100g, canned)': 100,
  // Meat & Fish
  'Chicken breast (100g)': 100, 'Chicken thigh (100g)': 100,
  'Turkey breast (100g)': 100, 'Beef mince 5% fat (100g)': 100,
  'Beef mince 20% fat (100g)': 100, 'Beef steak (100g)': 100,
  'Pork tenderloin (100g)': 100, 'Pork chop (100g)': 100,
  'Bacon (2 rashers)': 42, 'Ham / cooked (50g)': 50,
  'Salmon (100g)': 100, 'Cod (100g)': 100, 'Tuna in water (100g)': 100,
  'Tuna in oil (100g)': 100, 'Mackerel (100g)': 100, 'Tilapia (100g)': 100,
  'Shrimp / prawns (100g)': 100, 'Lamb mince (100g)': 100,
  'Tofu (100g)': 100, 'Tempeh (100g)': 100,
  // Dairy & Eggs
  'Egg (large)': 50, 'Egg white (large)': 33, 'Scrambled eggs (2 eggs)': 100,
  'Greek yogurt (150g)': 150, 'Natural yogurt (150g)': 150, 'Skyr (150g)': 150,
  'Cottage cheese (100g)': 100, 'Ricotta (50g)': 50,
  'Cheddar cheese (30g)': 30, 'Mozzarella (30g)': 30, 'Parmesan (15g)': 15,
  'Cream cheese (30g)': 30, 'Whole milk (250ml)': 244, 'Skimmed milk (250ml)': 244,
  'Butter (10g)': 10,
  // Drinks
  'Water (500ml)': 500, 'Cup of coffee (black)': 237, 'Coffee with milk': 240,
  'Latte (250ml)': 250, 'Flat white (200ml)': 200, 'Cappuccino (200ml)': 200,
  'Cup of tea (black)': 237, 'Tea with milk': 240,
  'Smoothie (fruit, 300ml)': 300, 'Smoothie (green, 300ml)': 300,
  'Smoothie (banana & oat, 300ml)': 300, 'Protein smoothie (300ml)': 300,
  'Coke (330ml)': 330, 'Diet Coke (330ml)': 330, 'Sparkling water (330ml)': 330,
  'Orange juice (250ml)': 250, 'Apple juice (250ml)': 250,
  'Oat milk (250ml)': 250, 'Almond milk (250ml)': 250, 'Soy milk (250ml)': 250,
  'Sports drink (500ml)': 500, 'Energy drink (250ml)': 250,
  'Protein shake (scoop)': 30,
  'Beer (330ml)': 330, 'Wine, red (175ml)': 175, 'Wine, white (175ml)': 175,
  'Chocolate milk (200ml)': 200,
  // Nuts & Spreads
  'Almonds (30g)': 30, 'Cashews (30g)': 30, 'Walnuts (30g)': 30,
  'Mixed nuts (30g)': 30, 'Peanut butter (1 tbsp)': 16,
  'Almond butter (1 tbsp)': 16, 'Hummus (2 tbsp)': 30,
  'Cream cheese (1 tbsp)': 14, 'Jam / marmalade (1 tbsp)': 20,
  'Honey (1 tbsp)': 21, 'Olive oil (1 tbsp)': 14,
  // Snacks & Sweets
  'Rice cake (plain)': 9, 'Oat cake (1 piece)': 13,
  'Granola bar': 47, 'Protein bar (avg)': 60, 'Energy bar (avg)': 55,
  'Dark chocolate (30g)': 30, 'Milk chocolate (30g)': 30,
  'Medjool date (1 piece)': 24, 'Banana bread (slice)': 60,
  'Crisps / chips (25g bag)': 25, 'Popcorn (30g)': 30,
  'Biscuit / cookie (1 piece)': 16, 'Waffle (plain)': 75,
  'Pancake (plain, medium)': 38,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getNutrient(nutrients, key) {
  const { id, num } = NUTRIENTS[key]
  // SR Legacy uses nutrientId; Foundation/Survey uses nutrientNumber string
  const n = nutrients.find(n => n.nutrientId === id || n.nutrientNumber === num)
  return n?.value ?? null
}

function scaleRound(per100g, servingG) {
  if (per100g == null) return undefined
  return Math.round((per100g / 100) * servingG)
}

function scaleRound1(per100g, servingG) {
  if (per100g == null) return undefined
  const v = (per100g / 100) * servingG
  return Math.round(v * 10) / 10 || undefined
}

async function searchUSDA(query) {
  const params = new URLSearchParams({
    query,
    dataType: 'Foundation,SR Legacy',
    pageSize: '5',
    api_key: API_KEY,
  })
  const res = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?${params}`)
  if (!res.ok) throw new Error(`USDA ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.foods ?? []
}

// The search API returns an abridged nutrient list; Foundation foods sometimes
// omit energy. Fetch full detail for any food where kcal is missing.
async function fetchFullNutrients(fdcId) {
  // No format=abridged — the full endpoint returns all nutrients
  const res = await fetch(
    `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${API_KEY}`
  )
  if (!res.ok) return null
  const data = await res.json()
  const raw = data.foodNutrients ?? []
  // Full detail format: { nutrient: { id, number }, amount }
  // Foundation foods use `median` (not `amount`) as the best-estimate value.
  // Search API format: { nutrientId, nutrientNumber, value }
  // Normalise both to the search-API shape.
  return raw.map(n => ({
    nutrientId:     n.nutrient?.id     ?? n.nutrientId,
    nutrientNumber: String(n.nutrient?.number ?? n.nutrientNumber ?? ''),
    value:          n.amount ?? n.median ?? n.value,
  }))
}

// Prefer SR Legacy — the search API always returns full macros for SR Legacy foods.
// Foundation foods sometimes omit energy from the condensed search-result nutrients.
function pickBest(foods) {
  return (
    foods.find(f => f.dataType === 'SR Legacy') ??
    foods.find(f => f.dataType === 'Foundation') ??
    foods[0] ??
    null
  )
}

// Words that are not useful as a "main ingredient" identifier.
const SKIP_WORDS = new Set([
  'slice', 'cup', 'glass', 'piece', 'bag', 'bar', 'mixed', 'plain', 'whole',
  'cooked', 'raw', 'dried', 'fresh', 'large', 'medium', 'small', 'with',
  'and', 'the', 'for', 'from', 'into', 'milk', 'oil', 'flat', 'diet',
  'beverages', 'alcoholic', 'snacks', 'cereals', 'juice', 'formulated',
  'natural',   // avoid "natural yogurt → natural"
])

function mainWord(name) {
  const words = name.replace(/\([^)]*\)/g, '').toLowerCase().split(/[\s,\/\-]+/)
  return words.find(w => /^[a-z]{3,}$/.test(w) && !SKIP_WORDS.has(w)) ?? ''
}

// Three-tier validation:
//  0. All name words — all key words from the food name appear in description
//     (e.g. "almond butter" → both "almond" AND "butter" in description)
//  1. Strict — main word in first comma-segment
//  2. Loose  — main word anywhere in description
// Imitation, substitute, and analog products are excluded before matching.
// Returns null if NO food passes — caller will skip and keep original value.
function pickBestValidated(foodName, query, foods) {
  // Strip imitation/substitute/reduced-sugar variants — they have misleading macros
  const genuine = foods.filter(f => {
    const d = (f.description ?? '').toLowerCase()
    return !d.includes('imitation') && !d.includes('substitute') &&
           !d.includes('analog') && !d.includes('reduced sugar')
  })
  const candidates = genuine.length > 0 ? genuine : foods

  const word = mainWord(foodName) || mainWord(query)
  if (!word) return pickBest(candidates)

  // Tier 0: union of food-name key words AND query key words must ALL appear in description.
  // This catches "Orange peel" for "orange juice canned" (no 'juice' → rejected),
  // and "Sweet Potato puffs" for query "sweet potatoes boiled flesh" (no 'potatoes' → rejected).
  const nameWords = foodName
    .replace(/\([^)]*\)/g, '')
    .toLowerCase()
    .split(/[\s,\/\-]+/)
    .filter(w => /^[a-z]{3,}$/.test(w) && !SKIP_WORDS.has(w))
  const queryWords = query
    .toLowerCase()
    .split(/[\s,\/\-]+/)
    .filter(w => /^[a-z]{3,}$/.test(w) && !SKIP_WORDS.has(w))
  const allKeyWords = [...new Set([...nameWords, ...queryWords])]
  if (allKeyWords.length >= 2) {
    const allWords = candidates.filter(f => {
      const d = (f.description ?? '').toLowerCase()
      return allKeyWords.every(w => d.includes(w))
    })
    if (allWords.length > 0) return pickBest(allWords)
  }

  // Tier 1: main word in first comma-segment
  const strict = candidates.filter(f =>
    (f.description ?? '').split(',')[0].toLowerCase().includes(word)
  )
  if (strict.length > 0) return pickBest(strict)

  // Tier 2: main word anywhere in description
  const loose = candidates.filter(f =>
    (f.description ?? '').toLowerCase().includes(word)
  )
  if (loose.length > 0) {
    console.warn(`    ↳ loose match for "${word}"`)
    return pickBest(loose)
  }

  // No relevant food found — skip this item
  console.warn(`    ↳ no USDA food contains "${word}" — skipping`)
  return null
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── Main ─────────────────────────────────────────────────────────────────────
// We import the current file as text and parse the food list from it.
// Simpler than dynamic import of a TS file: we extract names via regex.
const currentTs = readFileSync(OUT_PATH, 'utf8')

// Extract all food names from the file
const nameRegex = /\{\s*name:\s*'([^']+)'/g
const allNames = []
let m
while ((m = nameRegex.exec(currentTs)) !== null) allNames.push(m[1])

console.log(`Found ${allNames.length} foods to update\n`)

const results = []

for (const name of allNames) {
  const query = SEARCH_OVERRIDES[name] ?? name.replace(/\s*\([^)]*\)/g, '').trim()
  const servingG = SERVING_G[name]

  if (!servingG) {
    console.warn(`⚠  No serving weight for "${name}" — skipping`)
    results.push({ name, skipped: true })
    continue
  }

  // Foods marked __SKIP__ have no useful USDA counterpart (e.g. plain water)
  if (query === '__SKIP__') {
    console.log(`⊘  "${name}" — intentionally skipped`)
    results.push({ name, skipped: true })
    continue
  }

  let foods
  try {
    foods = await searchUSDA(query)
  } catch (e) {
    console.error(`✗ API error for "${name}": ${e.message}`)
    results.push({ name, skipped: true })
    await sleep(1000)
    continue
  }

  const best = pickBestValidated(name, query, foods)

  if (!best) {
    console.warn(`⚠  No USDA result for "${name}" (query: "${query}")`)
    results.push({ name, skipped: true })
    await sleep(300)
    continue
  }

  let nutrients = best.foodNutrients ?? []
  let kcalPer100    = getNutrient(nutrients, 'kcal')
  let proteinPer100 = getNutrient(nutrients, 'protein')
  let fatPer100     = getNutrient(nutrients, 'fat')
  let carbsPer100   = getNutrient(nutrients, 'carbs')

  // Foundation foods return abridged nutrient lists in search results — energy is
  // sometimes missing. Fetch the full food detail to get all nutrients.
  if (kcalPer100 == null && best.fdcId) {
    console.log(`    ↳ fetching full detail for ${best.dataType} food (no kcal in search results)`)
    await sleep(300)
    const fullNutrients = await fetchFullNutrients(best.fdcId)
    if (fullNutrients) {
      nutrients     = fullNutrients
      kcalPer100    = getNutrient(nutrients, 'kcal')
      proteinPer100 = getNutrient(nutrients, 'protein')
      fatPer100     = getNutrient(nutrients, 'fat')
      carbsPer100   = getNutrient(nutrients, 'carbs')
    }
  }

  const kcal     = scaleRound(kcalPer100, servingG)
  const protein_g = scaleRound1(proteinPer100, servingG)
  const fat_g     = scaleRound1(fatPer100, servingG)
  const carb_g    = scaleRound1(carbsPer100, servingG)

  if (kcal == null) {
    console.warn(`⚠  No kcal data for "${name}" — USDA match: "${best.description}"`)
    results.push({ name, skipped: true })
    await sleep(300)
    continue
  }

  console.log(`✓ "${name}"`)
  console.log(`    USDA: ${best.description} (${best.dataType})`)
  console.log(`    per 100g: ${kcalPer100} kcal | p${proteinPer100} f${fatPer100} c${carbsPer100}`)
  console.log(`    serving ${servingG}g: ${kcal} kcal | p${protein_g} f${fat_g} c${carb_g}`)

  results.push({ name, kcal, protein_g, fat_g, carb_g, match: best.description })

  await sleep(300) // ~3 req/s — well within 1000/hr limit
}

console.log(`\nDone. Updating ${OUT_PATH}...\n`)

// ─── Rewrite commonFoods.ts ───────────────────────────────────────────────────
// Replace each food's numeric values in-place using the food name as anchor.
let output = currentTs

for (const r of results) {
  if (r.skipped) continue

  // Match the object for this food name and replace its numeric fields
  // Pattern: { name: 'Food Name', kcal: NNN, ...optional macros..., optional amount_label }
  const escaped = r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `(\\{\\s*name:\\s*'${escaped}'\\s*,\\s*)` +
    `kcal:\\s*\\d+` +
    `((?:\\s*,\\s*(?:protein_g|fat_g|carb_g):\\s*\\d+(?:\\.\\d+)?)*?)` +
    `((?:\\s*,\\s*amount_label:[^}]+?)?)` +
    `(\\s*\\})`,
    'g'
  )

  const macros = []
  if (r.protein_g != null && r.protein_g > 0) macros.push(`protein_g: ${r.protein_g}`)
  if (r.fat_g != null && r.fat_g > 0) macros.push(`fat_g: ${r.fat_g}`)
  if (r.carb_g != null && r.carb_g > 0) macros.push(`carb_g: ${r.carb_g}`)

  output = output.replace(pattern, (_, prefix, _oldMacros, amountLabel, closing) => {
    const macroStr = macros.length > 0 ? ', ' + macros.join(', ') : ''
    return `${prefix}kcal: ${r.kcal}${macroStr}${amountLabel}${closing}`
  })
}

writeFileSync(OUT_PATH, output, 'utf8')
console.log('commonFoods.ts updated.')

// Summary
const updated = results.filter(r => !r.skipped).length
const skipped = results.filter(r => r.skipped).length
console.log(`\nSummary: ${updated} updated, ${skipped} skipped (kept original values)`)
