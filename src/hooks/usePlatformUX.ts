// ─── usePlatformUX ────────────────────────────────────────────────────────────
// Central decision hub: converts low-level platform runtime data into actionable
// UI decisions that feature components can consume without platform knowledge.
//
// When: Use this in components that need to decide "which UI pattern should I use?"
// Example:
//   const ux = usePlatformUX();
//   if (ux.navigationPattern === 'ios-tabs') { /* render bottom tabs */ }
//
// Never: Don't use raw capability checks in feature code. Use usePlatformUX() instead.

import { useMemo } from 'react';
import { usePlatformRuntime } from '../platform/PlatformRuntimeContext';

// ─── Decision types ───────────────────────────────────────────────────────────

export type ThemeVariant = 'cupertino' | 'material' | 'desktop';
export type NavigationPattern = 'ios-tabs' | 'ios-sidebar' | 'material-tabs' | 'material-rail' | 'desktop-nav';
export type ComposePattern = 'ios-sheet' | 'ios-fullscreen' | 'material-fab' | 'desktop-dialog';
export type InstallPattern = 'ios-share-sheet' | 'android-beforeinstall' | 'macos-add-to-dock' | 'desktop-bookmark' | 'hidden-standalone';
export type MotionPreset = 'ios-spring' | 'material-emphasized' | 'desktop-smooth' | 'reduced' | 'no-motion';
export type InputDensity = 'touch' | 'pointer' | 'compact' | 'spacious';

/**
 * High-level platform UX decisions derived from runtime.
 * Feature code should read this instead of raw capability checks.
 */
export interface PlatformUX {
  readonly theme: ThemeVariant;
  readonly navigationPattern: NavigationPattern;
  readonly composePattern: ComposePattern;
  readonly installPattern: InstallPattern;
  readonly motionPreset: MotionPreset;
  readonly inputDensity: InputDensity;
  readonly chromeStyle: 'translucent' | 'solid' | 'material';
  readonly hapticsSupport: 'full' | 'light' | 'none';
  readonly statusBarMode: 'light-content' | 'dark-content' | 'default';
}

/**
 * Resolve navigation pattern based on platform and form factor.
 * iOS: bottom tabs for phone, sidebar for iPad/macOS.
 * Material: bottom nav for phone, navigation rail for tablet/desktop.
 */
function resolveNavigationPattern(runtime: ReturnType<typeof usePlatformRuntime>): NavigationPattern {
  if (runtime.visualIdiom === 'material') {
    // Android/Material: bottom nav on mobile, rail on tablet/desktop
    const isSmallForm = runtime.isMobile && !runtime.isAndroid; // Treat non-Android mobile as tablet-like
    return isSmallForm ? 'material-tabs' : 'material-rail';
  }

  if (runtime.visualIdiom === 'cupertino') {
    // iOS: tabs on phone, sidebar on iPad+
    const isSmallForm = runtime.isMobile && !runtime.isIOS; // Treat non-iOS mobile as tablet-like
    return isSmallForm ? 'ios-tabs' : 'ios-sidebar';
  }

  // Desktop/web: traditional sidebar nav
  return 'desktop-nav';
}

/**
 * Resolve compose entry pattern based on platform.
 */
function resolveComposePattern(runtime: ReturnType<typeof usePlatformRuntime>): ComposePattern {
  if (runtime.visualIdiom === 'material') {
    // Material: FAB everywhere
    return 'material-fab';
  }

  if (runtime.visualIdiom === 'cupertino') {
    // iOS phone: bottom sheet
    // iOS tablet/macOS: fullscreen dialog (more space)
    return runtime.isMobile ? 'ios-sheet' : 'ios-fullscreen';
  }

  // Desktop: traditional dialog
  return 'desktop-dialog';
}

/**
 * Resolve install UX pattern based on platform and install state.
 */
function resolveInstallPattern(runtime: ReturnType<typeof usePlatformRuntime>): InstallPattern {
  // If already installed, hide prompts
  if (runtime.isInstalled) {
    return 'hidden-standalone';
  }

  if (runtime.visualIdiom === 'material') {
    // Android: beforeinstallprompt (if available)
    return runtime.capabilities.backgroundSync ? 'android-beforeinstall' : 'desktop-bookmark';
  }

  if (runtime.visualIdiom === 'cupertino') {
    // iOS: show Share → Add to Home Screen instructions
    if (runtime.isIOS || runtime.isAppleWebKit) {
      return 'ios-share-sheet';
    }
    // macOS web app: Add to Dock
    if (!runtime.isMobile) {
      return 'macos-add-to-dock';
    }
    return 'ios-share-sheet';
  }

  // Desktop browser: bookmark/add shortcut
  return 'desktop-bookmark';
}

/**
 * Resolve motion preset based on platform and accessibility preferences.
 * Always respect reduced motion even on platforms that normally use spring animations.
 */
function resolveMotionPreset(runtime: ReturnType<typeof usePlatformRuntime>): MotionPreset {
  // Check prefers-reduced-motion system setting
  if (typeof window !== 'undefined') {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      return 'reduced';
    }
  }

  if (runtime.visualIdiom === 'material') {
    return 'material-emphasized';
  }

  if (runtime.visualIdiom === 'cupertino') {
    return 'ios-spring';
  }

  return 'desktop-smooth';
}

/**
 * Resolve input density based on pointer type and device class.
 * Touch targets on mobile should be larger and more spacious.
 */
function resolveInputDensity(runtime: ReturnType<typeof usePlatformRuntime>): InputDensity {
  if (runtime.input.coarse) {
    // Touch device: spacious touch targets
    return 'spacious';
  }

  if (runtime.input.fine && runtime.input.hover) {
    // Fine pointer with hover: compact for desktop
    return 'compact';
  }

  if (runtime.input.fine) {
    // Fine pointer without hover (e.g., precision stylus): normal
    return 'pointer';
  }

  // Unknown input: default to touch
  return 'touch';
}

/**
 * Resolve chrome style (nav/tab bar appearance).
 */
function resolveChromeStyle(runtime: ReturnType<typeof usePlatformRuntime>): 'translucent' | 'solid' | 'material' {
  if (runtime.visualIdiom === 'material') {
    return 'material';
  }

  if (runtime.visualIdiom === 'cupertino') {
    // Apple platforms prefer translucent blur glass
    return 'translucent';
  }

  return 'solid';
}

/**
 * Resolve haptics support based on runtime capabilities.
 */
function resolveHapticsSupport(runtime: ReturnType<typeof usePlatformRuntime>): 'full' | 'light' | 'none' {
  if (runtime.capabilities.vibration) {
    return 'light';
  }

  // iOS may have haptics via webkit, but no capability flag; assume light support
  if (runtime.isIOS) {
    return 'light';
  }

  return 'none';
}

/**
 * Resolve status bar content color based on platform.
 * Hint to the browser/OS which color scheme the status bar should use.
 */
function resolveStatusBarMode(runtime: ReturnType<typeof usePlatformRuntime>): 'light-content' | 'dark-content' | 'default' {
  if (runtime.visualIdiom === 'material') {
    // Material prefers dark-content status bar
    return 'dark-content';
  }

  if (runtime.visualIdiom === 'cupertino') {
    // iOS: defaults to dark content; can be overridden via apple-mobile-web-app-status-bar-style meta tag
    return 'dark-content';
  }

  return 'default';
}

/**
 * Hook: query resolved platform UX decisions.
 */
export function usePlatformUX(): PlatformUX {
  const runtime = usePlatformRuntime();

  return useMemo((): PlatformUX => ({
    theme: runtime.visualIdiom,
    navigationPattern: resolveNavigationPattern(runtime),
    composePattern: resolveComposePattern(runtime),
    installPattern: resolveInstallPattern(runtime),
    motionPreset: resolveMotionPreset(runtime),
    inputDensity: resolveInputDensity(runtime),
    chromeStyle: resolveChromeStyle(runtime),
    hapticsSupport: resolveHapticsSupport(runtime),
    statusBarMode: resolveStatusBarMode(runtime),
  }), [runtime]);
}

// ─── Motion parameter presets ──────────────────────────────────────────────────
// Use these in Framer Motion components to respect platform motion preferences.

export const MOTION_PRESETS = {
  iosSpring: {
    type: 'spring' as const,
    stiffness: 420,
    damping: 38,
    mass: 0.9,
    velocity: 0,
  },
  materialEmphasized: {
    duration: 0.24,
    ease: [0.2, 0, 0, 1] as const,
  },
  desktopSmooth: {
    duration: 0.3,
    ease: [0.25, 0.46, 0.45, 0.94] as const,
  },
  reduced: {
    duration: 0,
  },
} as const;

/**
 * Helper: get Framer Motion transition object based on preset.
 * Example: <motion.div transition={getMotionTransition('ios-spring')} />
 */
export function getMotionTransition(preset: MotionPreset) {
  switch (preset) {
    case 'ios-spring':
      return MOTION_PRESETS.iosSpring;
    case 'material-emphasized':
      return MOTION_PRESETS.materialEmphasized;
    case 'desktop-smooth':
      return MOTION_PRESETS.desktopSmooth;
    case 'reduced':
    case 'no-motion':
      return MOTION_PRESETS.reduced;
    default:
      return MOTION_PRESETS.desktopSmooth;
  }
}
