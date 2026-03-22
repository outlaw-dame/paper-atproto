// ─── Glympse Foundation Tokens ────────────────────────────────────────────
// Layer A: pure values — spacing, radii, borders, shadows, blur, type, motion.
// These are never consumed directly in components; use semantic.ts or components.ts.

// ─── Spacing ──────────────────────────────────────────────────────────────
export const space = {
  2:  4,
  4:  8,
  6:  12,
  8:  16,
  10: 20,
  12: 24,
  16: 32,
  20: 40,
  24: 48,
  32: 64,
} as const;

// ─── Radii ────────────────────────────────────────────────────────────────
export const radius = {
  8:    8,
  12:   12,
  16:   16,
  18:   18,
  20:   20,
  24:   24,
  28:   28,
  32:   32,
  full: 999,
} as const;

// ─── Strokes ──────────────────────────────────────────────────────────────
export const stroke = {
  hair:   '0.5px',
  thin:   '1px',
  strong: '1.5px',
} as const;

// ─── Shadows (light) ──────────────────────────────────────────────────────
export const shadow = {
  0: 'none',
  1: '0 2px 10px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.04)',
  2: '0 6px 24px rgba(15,23,42,0.08), 0 2px 8px rgba(15,23,42,0.05)',
  3: '0 14px 40px rgba(15,23,42,0.12), 0 6px 16px rgba(15,23,42,0.07)',
} as const;

// ─── Shadows (dark) ───────────────────────────────────────────────────────
export const shadowDark = {
  1: '0 4px 20px rgba(0,0,0,0.24)',
  2: '0 10px 30px rgba(0,0,0,0.34)',
  3: '0 18px 44px rgba(0,0,0,0.42)',
} as const;

// ─── Blur ─────────────────────────────────────────────────────────────────
export const blur = {
  chrome: '18px',
  sheet:  '24px',
  heavy:  '32px',
} as const;

// ─── Type scale ───────────────────────────────────────────────────────────
// Format: [fontSize, lineHeight, fontWeight, letterSpacing]
export const type = {
  displayXl: [40, 44, 700, '-0.03em'],
  displayLg: [34, 38, 700, '-0.025em'],
  titleXl:   [28, 32, 700, '-0.02em'],
  titleLg:   [24, 29, 700, '-0.015em'],
  titleMd:   [20, 24, 600, '-0.01em'],
  titleSm:   [18, 22, 600, '-0.005em'],
  bodyLg:    [18, 28, 400, '0'],
  bodyMd:    [17, 27, 400, '0'],
  bodySm:    [15, 22, 400, '0'],
  metaLg:    [13, 18, 500, '0.01em'],
  metaSm:    [12, 16, 500, '0.02em'],
  chip:      [14, 18, 600, '0'],
  buttonLg:  [18, 22, 600, '-0.01em'],
  buttonMd:  [16, 20, 600, '-0.005em'],
} as const;

// ─── Neutral colors — light ───────────────────────────────────────────────
export const neutralLight = {
  bgBase:       '#F6F5F3',
  bgSubtle:     '#F0EEEB',
  surface1:     '#FFFFFF',
  surface2:     '#F7F4F1',
  surface3:     '#ECE8E3',
  lineSubtle:   '#E2DDD7',
  lineStrong:   '#D2CBC3',
  textPrimary:  '#151515',
  textSecondary:'#5D5A57',
  textTertiary: '#8D8882',
  textInverse:  '#FFFFFF',
} as const;

// ─── Neutral colors — dark ────────────────────────────────────────────────
export const neutralDark = {
  bgBase:       '#0C0F14',
  bgSubtle:     '#11151C',
  surface1:     '#161C25',
  surface2:     '#1C2430',
  surface3:     '#232C39',
  lineSubtle:   'rgba(255,255,255,0.08)',
  lineStrong:   'rgba(255,255,255,0.14)',
  textPrimary:  '#F7F9FC',
  textSecondary:'#C5CEDB',
  textTertiary: '#8E99AA',
  textInverse:  '#0B0F15',
} as const;

// ─── Accent palette ───────────────────────────────────────────────────────
export const accent = {
  primary:      '#5B7CFF',
  primaryStrong:'#4668F2',
  primarySoft:  'rgba(91,124,255,0.14)',
  blue500:      '#3B82F6',
  blue600:      '#2563EB',
  indigo500:    '#6366F1',
  indigo600:    '#4F46E5',
  cyan400:      '#67E8F9',
  cyan500:      '#22D3EE',
} as const;

// ─── Discovery palette ────────────────────────────────────────────────────
export const discovery = {
  bgBase:        '#070B12',
  bgAtmosphere:  `radial-gradient(circle at 20% 20%, rgba(69,102,242,0.22), transparent 32%),
                  radial-gradient(circle at 80% 10%, rgba(34,211,238,0.12), transparent 28%),
                  linear-gradient(180deg, #0A0E16 0%, #070B12 100%)`,
  surfaceCard:   '#121824',
  surfaceCard2:  '#171F2C',
  surfaceFocus:  '#1C2636',
  lineSubtle:    'rgba(174,196,255,0.10)',
  lineFocus:     'rgba(122,161,255,0.28)',
  textPrimary:   '#F8FBFF',
  textSecondary: '#C9D5E7',
  textTertiary:  '#93A3BC',
  glowBlue:      'rgba(91,124,255,0.35)',
  glowCyan:      'rgba(34,211,238,0.18)',
  glowIndigo:    'rgba(99,102,241,0.20)',
} as const;

// ─── Discussion palette ───────────────────────────────────────────────────
export const discussion = {
  bgBase:        '#F6F5F3',
  bgSubtle:      '#F1EFEC',
  surfaceCard:   '#FBFAF8',
  surfaceCard2:  '#F3F0EC',
  surfaceNested: '#EFEAE5',
  lineSubtle:    '#E1DBD4',
  lineStrong:    '#D0C8C0',
  textPrimary:   '#151515',
  textSecondary: '#5F5B56',
  textTertiary:  '#8B857F',
  heroBg:        '#070707',
  heroText:      '#FFFFFF',
  heroSubtext:   'rgba(255,255,255,0.82)',
  heroMeta:      'rgba(255,255,255,0.55)',
  heroLine:      'rgba(255,255,255,0.12)',
} as const;

// ─── Intelligence palette ─────────────────────────────────────────────────
export const intel = {
  surfaceLight:  '#173B70',
  surfaceLight2: '#1B447F',
  surfaceDark:   '#14263E',
  surfaceDark2:  '#18304D',
  textPrimary:   '#F7FBFF',
  textSecondary: 'rgba(247,251,255,0.82)',
  textMeta:      'rgba(247,251,255,0.62)',
  accentCoral:   '#FF8A67',
  accentCyan:    '#7CE9FF',
  accentLime:    '#D7E97A',
} as const;

// ─── Signal palette ───────────────────────────────────────────────────────
export const signal = {
  clarifyingBg:     '#ECE39A',
  clarifyingText:   '#5B570B',
  newBg:            '#CFEFF4',
  newText:          '#0E5561',
  provocativeBg:    '#F3D5D4',
  provocativeText:  '#7A2D33',
  sourceBg:         '#DCE7FF',
  sourceText:       '#21417D',
  counterpointBg:   '#E8DDFB',
  counterpointText: '#5B3F98',
} as const;

// ─── Motion ───────────────────────────────────────────────────────────────
export const motion = {
  fast:   140,
  base:   220,
  slow:   320,
  xslow:  420,
} as const;

export const ease = {
  standard: [0.25, 0.1, 0.25, 1]  as [number,number,number,number],
  decel:    [0.16, 1,   0.3,  1]  as [number,number,number,number],
  accel:    [0.32, 0,   0.67, 0]  as [number,number,number,number],
  soft:     [0.22, 1,   0.36, 1]  as [number,number,number,number],
} as const;
