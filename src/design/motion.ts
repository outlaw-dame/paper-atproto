// ─── Glympse Motion Presets ───────────────────────────────────────────────
// Pre-built Framer Motion transition objects for consistent animation.

import { motion as motionTokens, ease } from './foundation.js';

export const transitions = {
  // Chip tap / state change
  chipTap: {
    duration: motionTokens.fast / 1000,
    ease: ease.standard,
  },
  // Card hover / press
  cardPress: {
    duration: motionTokens.base / 1000,
    ease: ease.standard,
  },
  // Search Story card advance/retreat
  storyCard: {
    duration: motionTokens.base / 1000,
    ease: ease.decel,
  },
  // Sheet open/close
  sheet: {
    duration: motionTokens.base / 1000,
    ease: ease.soft,
  },
  // Story Mode entry
  storyEntry: {
    duration: motionTokens.slow / 1000,
    ease: ease.soft,
  },
  // Interpolator expand/collapse
  interpolatorToggle: {
    duration: motionTokens.slow / 1000,
    ease: ease.decel,
  },
  // Fade in (generic)
  fadeIn: {
    duration: motionTokens.base / 1000,
    ease: ease.decel,
  },
  // Spring for bottom sheets
  spring: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 42,
  },
} as const;

// ─── Framer variants ──────────────────────────────────────────────────────

export const fadeVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1 },
  exit:    { opacity: 0 },
};

export const slideUpVariants = {
  hidden:  { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: 12 },
};

export const storyCardVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 60 : -60, scale: 0.96 }),
  center: { opacity: 1, x: 0, scale: 1 },
  exit:  (dir: number) => ({ opacity: 0, x: dir > 0 ? -60 : 60, scale: 0.96 }),
};

export const overlayVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1 },
  exit:    { opacity: 0 },
};

export const sheetVariants = {
  hidden:  { y: '100%' },
  visible: { y: 0 },
  exit:    { y: '100%' },
};
