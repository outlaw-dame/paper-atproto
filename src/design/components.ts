// ─── Glympse Component Tokens ─────────────────────────────────────────────
// Layer C: component-specific token mappings.
// Import these directly in the component that needs them.

import { radius, space, shadow, shadowDark, blur, accent, discovery, discussion, intel, signal, neutralLight } from './foundation.js';

// ─── SearchHeroField ──────────────────────────────────────────────────────
export const searchHeroField = {
  height:      58,
  radius:      radius.full,
  paddingX:    space[10],
  iconGap:     space[6],
  shadow:      shadowDark[1],
  discovery: {
    bg:          'rgba(18,24,36,0.86)',
    border:      'rgba(124,163,255,0.45)',
    text:        discovery.textPrimary,
    placeholder: '#AFC1DA',
    icon:        '#67E8F9',
  },
  focus: {
    border: '#8EC8FF',
    glow:   '0 0 0 4px rgba(103,232,249,0.10)',
  },
} as const;

// ─── StoryProgressRail ────────────────────────────────────────────────────
export const storyProgress = {
  height:       8,
  segmentGap:   4,
  radius:       radius.full,
  track:        'rgba(255,255,255,0.12)',
  segment:      'rgba(255,255,255,0.20)',
  active:       '#F8FBFF',
  complete:     'rgba(248,251,255,0.72)',
  currentGlow:  '0 0 10px rgba(124,233,255,0.20)',
} as const;

// ─── OverviewCard / FeaturedSearchStoryCard ───────────────────────────────
export const overviewCard = {
  radius:       radius[32],
  padding:      space[10],
  bg:           discovery.surfaceFocus,
  shadow:       shadowDark[2],
  mediaRadius:  radius[24],
  mediaHeight:  240,
  gap:          space[8],
  synopsisChip: {
    bg:     'rgba(9,18,30,0.58)',
    border: 'rgba(124,233,255,0.16)',
    text:   '#B8F3FF',
  },
  sourceStrip: {
    bg:       'rgba(8,13,21,0.56)',
    text:     discovery.textSecondary,
    iconTint: '#D9E6F8',
  },
} as const;

// ─── BottomQueryDock ──────────────────────────────────────────────────────
export const bottomQueryDock = {
  height:      56,
  radius:      radius.full,
  paddingX:    space[8],
  shadow:      shadowDark[2],
  bg:          'rgba(12,18,28,0.82)',
  border:      'rgba(255,255,255,0.08)',
  blur:        blur.sheet,
  text:        discovery.textPrimary,
  placeholder: discovery.textTertiary,
  actionBg:    accent.primary,
  actionFg:    '#FFFFFF',
} as const;

// ─── PromptHeroCard ───────────────────────────────────────────────────────
export const promptHero = {
  radius:  radius[28],
  padding: space[12],
  bg:      discussion.heroBg,
  text:    discussion.heroText,
  subtext: discussion.heroSubtext,
  meta:    discussion.heroMeta,
  line:    discussion.heroLine,
  shadow:  shadow[2],
  cta: {
    height: 56,
    radius: radius[20],
    bg:     '#F6F5F3',
    text:   '#181818',
    icon:   '#3B3B3B',
  },
} as const;

// ─── InterpolatorCard ─────────────────────────────────────────────────────
export const interpolator = {
  radius:  radius[28],
  padding: space[12],
  shadow:  shadow[2],
  discussion: { bg: intel.surfaceLight,  bg2: intel.surfaceLight2 },
  discovery:  { bg: intel.surfaceDark,   bg2: intel.surfaceDark2 },
  text: {
    primary:   intel.textPrimary,
    secondary: intel.textSecondary,
    meta:      intel.textMeta,
  },
  timestamp:    intel.accentCoral,
  glyph:        '#E6F3FF',
  evidenceChip: {
    bg:     'rgba(255,255,255,0.10)',
    border: 'rgba(255,255,255,0.10)',
    text:   '#EAF4FF',
  },
  link: {
    color: intel.accentCyan,
    hover: '#C8F5FF',
  },
  collapsed: { maxHeight: 220 },
  expanded:  { maxHeight: 360 },
} as const;

// ─── ContributionCard ─────────────────────────────────────────────────────
export const contribution = {
  radius:  radius[24],
  padding: space[10],
  gap:     space[8],
  shadow:  shadow[1],
  bg:      discussion.surfaceCard,
  bgAlt:   discussion.surfaceCard2,
  bgNested:discussion.surfaceNested,
  text: {
    primary:   discussion.textPrimary,
    secondary: discussion.textSecondary,
    meta:      discussion.textTertiary,
  },
  line:    discussion.lineSubtle,
  avatar:  { size: 40 },
  rolePill:{ height: 32, paddingX: 12 },
  featured:{
    shadow: shadow[2],
    border: `1px solid #E6E0D8`,
    bg:     '#FCFBF9',
  },
} as const;

// ─── Role pills (bold fills, white text — Narwhal-style) ──────────────────────
export const rolePill = {
  height:   28,
  paddingX: 12,
  radius:   radius.full,
  clarifying:        { bg: signal.clarifyingBg,   text: signal.clarifyingText },
  new_information:   { bg: signal.newBg,          text: signal.newText },
  provocative:       { bg: signal.provocativeBg,  text: signal.provocativeText },
  direct_response:   { bg: signal.sourceBg,       text: signal.sourceText },
  useful_counterpoint:{ bg: signal.counterpointBg, text: signal.counterpointText },
  story_worthy:      { bg: signal.opinionBg,      text: signal.opinionText },
  repetitive:        { bg: signal.repetitiveBg,   text: signal.repetitiveText },
  unknown:           { bg: '#E5E7EB',             text: '#374151' },
} as const;

// ─── Feedback chips (softer, below post body) ─────────────────────────────
export const signalChip = {
  height:   32,
  paddingX: 12,
  radius:   radius.full,
  clarifying:   { bg: signal.fbClarifyingBg,   text: signal.fbClarifyingText },
  new:          { bg: signal.fbNewBg,          text: signal.fbNewText },
  provocative:  { bg: signal.fbProvocativeBg,  text: signal.fbProvocativeText },
  source:       { bg: signal.fbSourceBg,       text: signal.fbSourceText },
  counterpoint: { bg: signal.counterpointBg,   text: signal.counterpointText },
} as const;

// ─── NestedContributionBlock ──────────────────────────────────────────────
export const nestedContribution = {
  radius:  radius[20],
  padding: space[8],
  bg:      discussion.surfaceNested,
  line:    discussion.lineSubtle,
  shadow:  'none',
  inset:   space[8],
  gap:     space[6],
} as const;

// ─── PromptComposer ───────────────────────────────────────────────────────
export const promptComposer = {
  bg:      discussion.bgBase,
  text:    { primary: discussion.textPrimary, secondary: discussion.textSecondary },
  line:    discussion.lineStrong,
  fieldGap:        space[12],
  fieldUnderline:  `1px solid #BFB7AF`,
  topicChip: {
    bg:           '#E7E4E0',
    text:         '#4E4A45',
    selectedBg:   '#DCE7FF',
    selectedText: '#21417D',
  },
  cta: {
    height: 56,
    radius: radius[20],
    bg:     accent.primary,
    text:   '#FFFFFF',
    shadow: shadow[2],
  },
} as const;

// ─── EntitySheet ──────────────────────────────────────────────────────────
export const entitySheet = {
  radiusTop: radius[32],
  padding:   space[12],
  shadow:    shadow[3],
  blur:      blur.sheet,
  discovery: {
    bg:      'rgba(17,21,28,0.94)',
    text:    discovery.textPrimary,
    subtext: discovery.textSecondary,
  },
  discussion: {
    bg:      'rgba(248,246,243,0.96)',
    text:    discussion.textPrimary,
    subtext: discussion.textSecondary,
  },
} as const;

// ─── QuickFilterChip ──────────────────────────────────────────────────────
export const quickFilterChip = {
  height:   36,
  paddingX: 16,
  radius:   radius.full,
  gap:      8,
  discovery: {
    bg:         'rgba(255,255,255,0.07)',
    border:     'rgba(255,255,255,0.12)',
    text:       discovery.textSecondary,
    activeBg:   accent.primary,
    activeText: '#FFFFFF',
  },
} as const;

// ─── FeaturedSearchStoryCard (Explore hero) ───────────────────────────────
export const featuredStoryCard = {
  radius:      radius[28],
  mediaHeight: 160,
  padding:     space[10],
  shadow:      shadowDark[2],
  bg:          discovery.surfaceCard,
} as const;

// ─── TrendingTopicCard ────────────────────────────────────────────────────
export const trendingTopicCard = {
  width:   160,
  height:  72,
  radius:  radius[24],
  padding: space[8],
  bg:      discovery.surfaceCard2,
} as const;

// ─── LiveClusterCard ──────────────────────────────────────────────────────
export const liveClusterCard = {
  height:  104,
  radius:  radius[24],
  padding: space[10],
  bg:      discovery.surfaceCard,
  shadow:  shadowDark[1],
} as const;
