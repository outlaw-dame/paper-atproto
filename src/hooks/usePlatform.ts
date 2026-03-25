// ─── Platform Detection Hook ─────────────────────────────────────────────────
// Detects the runtime platform to enable Apple HIG–compliant adaptive UI.
// Signals:
//   isIOS       — iPhone/iPad (user-agent based)
//   isAndroid   — Android device
//   isMobile    — isIOS || isAndroid
//   isPWA       — running in standalone/PWA mode (home-screen launch)
//
// Usage:
//   const { isIOS, isMobile } = usePlatform();

import { useMemo } from 'react';

export interface PlatformInfo {
  isIOS: boolean;
  isAndroid: boolean;
  isMobile: boolean;
  isPWA: boolean;
  isStandalone: boolean;
  prefersCoarsePointer: boolean;
  hasAnyCoarsePointer: boolean;
  hasAnyFinePointer: boolean;
  canHover: boolean;
}

export function usePlatform(): PlatformInfo {
  return useMemo(() => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const mm = typeof window !== 'undefined' ? window.matchMedia.bind(window) : null;
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isAndroid = /android/i.test(ua);
    const isStandalone =
      (!!mm && (mm('(display-mode: standalone)').matches || mm('(display-mode: minimal-ui)').matches)) ||
      (isIOS && 'standalone' in navigator && (navigator as any).standalone === true);
    const prefersCoarsePointer = !!mm && mm('(pointer: coarse)').matches;
    const hasAnyCoarsePointer = !!mm && mm('(any-pointer: coarse)').matches;
    const hasAnyFinePointer = !!mm && mm('(any-pointer: fine)').matches;
    const canHover = !!mm && (mm('(hover: hover)').matches || mm('(any-hover: hover)').matches);

    return {
      isIOS,
      isAndroid,
      isMobile: isIOS || isAndroid,
      isPWA: isStandalone,
      isStandalone,
      prefersCoarsePointer,
      hasAnyCoarsePointer,
      hasAnyFinePointer,
      canHover,
    };
  }, []);
}

// ─── Platform-aware button tokens ─────────────────────────────────────────────
// Two token sets:
//   getButtonTokens   — CTA / full-width rectangular buttons (Follow, Post, Sign In)
//   getIconBtnTokens  — circular icon buttons (back, close, refresh nav icons)
// Use these values directly in style props instead of hard-coded constants.

export interface ButtonTokens {
  height: number;         // px — meets 44pt minimum on mobile
  borderRadius: number;   // px — pill on iOS, medium rounding elsewhere
  fontSize: number;       // px
  fontWeight: number;
  paddingH: number;       // horizontal padding px
  activeScale: number;    // CSS transform scale on :active
}

export function getButtonTokens(platform: PlatformInfo): ButtonTokens {
  const touchLike = platform.prefersCoarsePointer || platform.isMobile;

  if (platform.isIOS && touchLike) {
    return {
      height: 44,
      borderRadius: 22,   // full pill
      fontSize: 15,
      fontWeight: 600,
      paddingH: 20,
      activeScale: 0.97,
    };
  }
  if (platform.isAndroid && touchLike) {
    return {
      height: 44,
      borderRadius: 12,   // Material-style rounded rect
      fontSize: 15,
      fontWeight: 600,
      paddingH: 18,
      activeScale: 0.98,
    };
  }
  if (touchLike) {
    return {
      height: 44,
      borderRadius: 12,
      fontSize: 15,
      fontWeight: 600,
      paddingH: 18,
      activeScale: 0.985,
    };
  }

  // Desktop
  return {
    height: 36,
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    paddingH: 16,
    activeScale: 1,
  };
}

// ─── Icon button tokens ────────────────────────────────────────────────────────
export interface IconBtnTokens {
  size: number;       // width & height px
  borderRadius: number; // 50% equivalent in px or just use '50%'
}

export function getIconBtnTokens(platform: PlatformInfo): IconBtnTokens {
  // Coarse pointers need 44px to meet touch target guidance.
  // Desktop can be compact.
  const touchLike = platform.prefersCoarsePointer || platform.isMobile;
  return {
    size: touchLike ? 44 : 34,
    borderRadius: touchLike ? 22 : 17,
  };
}
