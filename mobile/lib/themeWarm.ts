// Warm Airy theme — cream, pastel gradients, dark-on-light typography
// Same keys as C (lib/theme.ts) for drop-in import swap
export const W = {
  bg:       '#FAF7F4',      // Warm cream
  surface:  '#FFFFFF',
  surface2: '#F5F1EC',      // Softer cream
  surface3: '#EDE8E1',
  border:   '#EDE8E1',
  divider:  '#F0EBE4',

  accent:   '#1C1917',      // Near-black primary
  accent2:  '#F0845C',      // Warm coral
  accentBg: 'rgba(240,132,92,0.10)',

  gradA:    '#DDF0E6',      // Soft mint
  gradB:    '#BFE4D1',      // Light sage green

  text1:    '#1C1917',
  text2:    '#6B6560',
  text3:    '#A89E96',
  text4:    '#C8C0B8',

  overlay:  'rgba(28,25,23,0.35)',
  white:    '#FFFFFF',

  accent2Bg:     'rgba(240,132,92,0.10)',
  accent2Border: 'rgba(240,132,92,0.25)',

  success:       '#16A34A',
  successBg:     'rgba(22,163,74,0.10)',
  successBorder: 'rgba(22,163,74,0.25)',
  danger:        '#DC2626',
  dangerBg:      'rgba(220,38,38,0.10)',
  dangerBorder:  'rgba(220,38,38,0.25)',
  warning:       '#D97706',
  warningBg:     'rgba(217,119,6,0.10)',
  warningBorder: 'rgba(217,119,6,0.25)',

  rain:  '#818CF8',

  swim:  '#0EA5E9',
  run:   '#EF4444',
  walk:  '#F97316',
  ride:  '#22C55E',
  sport: '#94A3B8',

  drawerBg: '#1C1917',
} as const
