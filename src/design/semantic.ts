// ─── Glympse Semantic Tokens ──────────────────────────────────────────────
// Layer B: meaningful tokens that differ by mode.
// Components consume these, not raw foundation values.

import {
  neutralLight, neutralDark, discovery, discussion, intel,
  accent, shadow, shadowDark, blur,
} from './foundation';

// ─── Neutral / Home mode ──────────────────────────────────────────────────
export const neutral = {
  bg:           { base: neutralLight.bgBase,   subtle: neutralLight.bgSubtle },
  surface:      { card: neutralLight.surface1, cardAlt: neutralLight.surface2 },
  text:         { primary: neutralLight.textPrimary, secondary: neutralLight.textSecondary, tertiary: neutralLight.textTertiary },
  line:         { subtle: neutralLight.lineSubtle, strong: neutralLight.lineStrong },
  accent:       { primary: accent.primary },
  shadow:       { card: shadow[1] },
} as const;

// ─── Discovery mode ───────────────────────────────────────────────────────
export const discoveryMode = {
  bg:           { base: discovery.bgBase, atmosphere: discovery.bgAtmosphere },
  surface:      { card: discovery.surfaceCard, cardAlt: discovery.surfaceCard2, focus: discovery.surfaceFocus },
  text:         { primary: discovery.textPrimary, secondary: discovery.textSecondary, tertiary: discovery.textTertiary },
  line:         { subtle: discovery.lineSubtle, focus: discovery.lineFocus },
  accent:       { primary: accent.primary, glow: discovery.glowBlue },
  shadow:       { card: shadowDark[1], hero: shadowDark[2] },
} as const;

// ─── Discussion mode ──────────────────────────────────────────────────────
export const discussionMode = {
  bg:           { base: discussion.bgBase, subtle: discussion.bgSubtle },
  surface:      { card: discussion.surfaceCard, cardAlt: discussion.surfaceCard2, nested: discussion.surfaceNested },
  text:         { primary: discussion.textPrimary, secondary: discussion.textSecondary, tertiary: discussion.textTertiary },
  line:         { subtle: discussion.lineSubtle, strong: discussion.lineStrong },
  accent:       { primary: accent.primary },
  shadow:       { card: shadow[1], hero: shadow[2] },
} as const;

// ─── Intelligence surface (Interpolator + Synopsis) ───────────────────────
export const intelMode = {
  discussion:   { bg: intel.surfaceLight,  bg2: intel.surfaceLight2 },
  discovery:    { bg: intel.surfaceDark,   bg2: intel.surfaceDark2 },
  text:         { primary: intel.textPrimary, secondary: intel.textSecondary, meta: intel.textMeta },
  accent:       { coral: intel.accentCoral, cyan: intel.accentCyan, lime: intel.accentLime },
} as const;

// ─── Blur helpers ─────────────────────────────────────────────────────────
export const blurTokens = blur;
