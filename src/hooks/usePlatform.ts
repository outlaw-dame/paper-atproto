// ─── Platform Detection Hook ─────────────────────────────────────────────────
// Detects the runtime platform to enable Apple HIG–compliant adaptive UI.
// Signals:
//   isIOS       — iPhone/iPad (user-agent based)
//   isAndroid   — Android device
//   isMobile    — isIOS || isAndroid
//   isPWA       — running in standalone/PWA mode (home-screen launch)
//
// isPWA is reactive: it updates if the display mode changes within the
// session (e.g. the user installs the app while the page is open in Chrome).
//
// Static platform data (UA, pointer, memory) is sourced from
// src/lib/platformDetect.ts — the single source of truth shared with
// bootstrap.ts, runtimePrefetch.ts, and the android/ module.
//
// Usage:
//   const { isIOS, isMobile } = usePlatform();

import { useState, useEffect, useMemo } from 'react';
import { getStaticPlatformInfo } from '../lib/platformDetect';

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

// UA-based and static media-query signals never change — compute once,
// delegating to the shared platformDetect utility.
function getStaticPlatform() {
  const {
    isIOS,
    isAndroid,
    prefersCoarsePointer,
    hasAnyCoarsePointer,
    hasAnyFinePointer,
    canHover,
  } = getStaticPlatformInfo();
  return { isIOS, isAndroid, prefersCoarsePointer, hasAnyCoarsePointer, hasAnyFinePointer, canHover };
}

function readIsStandalone(isIOS: boolean): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    (isIOS && 'standalone' in navigator && (navigator as Record<string, unknown>).standalone === true)
  );
}

export function usePlatform(): PlatformInfo {
  const static_ = useMemo(getStaticPlatform, []);
  const [isStandalone, setIsStandalone] = useState(() => readIsStandalone(static_.isIOS));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // React to the user installing the app while the page is open.
    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const minimalQuery = window.matchMedia('(display-mode: minimal-ui)');

    const update = () => setIsStandalone(readIsStandalone(static_.isIOS));

    standaloneQuery.addEventListener('change', update);
    minimalQuery.addEventListener('change', update);
    return () => {
      standaloneQuery.removeEventListener('change', update);
      minimalQuery.removeEventListener('change', update);
    };
  }, [static_.isIOS]);

  return useMemo((): PlatformInfo => ({
    ...static_,
    isMobile: static_.isIOS || static_.isAndroid,
    isPWA: isStandalone,
    isStandalone,
  }), [static_, isStandalone]);
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
