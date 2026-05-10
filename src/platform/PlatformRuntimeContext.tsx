// ─── Platform Runtime Context ─────────────────────────────────────────────────
// Single source of truth for all platform + capability detection.
// Composes the five lower-level detection modules into one stable runtime object
// so every component asks one question: usePlatformRuntime().
//
// Detection modules consumed:
//   src/lib/platformDetect          — static UA / media-query signals
//   src/hooks/usePlatform           — reactive standalone state
//   src/pwa/capabilities            — PWA API feature gates
//   src/apple/availability          — Apple-specific enhancement gates
//   src/android/availability        — Android-specific enhancement gates
//
// The lower-level modules still exist and may be used directly where only one
// layer is needed, but nothing in the UI layer should compose them ad hoc.

import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
} from 'react';
import { getStaticPlatformInfo } from '../lib/platformDetect';
import { detectPwaCapabilities } from '../pwa/capabilities';
import { detectAppleEnhancementAvailability } from '../apple/availability';
import { detectAndroidEnhancementAvailability } from '../android/availability';

// ─── Visual idiom ─────────────────────────────────────────────────────────────

export type PlatformFamily = 'apple' | 'android' | 'desktop' | 'unknown';
export type VisualIdiom = 'cupertino' | 'material' | 'desktop';
export type RuntimeDisplayMode = 'browser' | 'standalone' | 'minimal-ui' | 'fullscreen';

// ─── Unified runtime type ─────────────────────────────────────────────────────

export interface PlatformRuntime {
  readonly family: PlatformFamily;
  readonly visualIdiom: VisualIdiom;
  readonly displayMode: RuntimeDisplayMode;
  readonly isInstalled: boolean;
  readonly isIOS: boolean;
  readonly isAndroid: boolean;
  readonly isMobile: boolean;

  readonly input: {
    readonly coarse: boolean;
    readonly fine: boolean;
    readonly hover: boolean;
  };

  readonly capabilities: {
    // PWA core
    readonly serviceWorker: boolean;
    readonly push: boolean;
    readonly notifications: boolean;
    readonly badging: boolean;
    readonly backgroundSync: boolean;
    readonly webShare: boolean;
    readonly fileSystemAccess: boolean;
    // Apple-specific
    readonly cloudKit: boolean;
    // Android-specific
    readonly contactPicker: boolean;
    readonly vibration: boolean;
    readonly shareTarget: boolean;
  };

  // Escape hatch for the rare case a component needs a raw capability.
  // Prefer the capabilities object for day-to-day use.
  readonly isAppleWebKit: boolean;
  readonly likelyAndroidChrome: boolean;
}

// ─── Idiom resolver ──────────────────────────────────────────────────────────
// Apple/Cupertino is the explicit brand default for unknown or desktop contexts.

function resolveVisualIdiom(family: PlatformFamily): VisualIdiom {
  if (family === 'android') return 'material';
  if (family === 'apple') return 'cupertino';
  return 'cupertino'; // brand default — Apple HIG even on unknown/desktop
}

function resolveFamily(
  isIOS: boolean,
  isAndroid: boolean,
  isAppleWebKit: boolean,
  likelyAndroidChrome: boolean,
  isMobile: boolean,
): PlatformFamily {
  if (isIOS || isAppleWebKit) return 'apple';
  if (isAndroid || likelyAndroidChrome) return 'android';
  if (isMobile) return 'android'; // unknown mobile → Material fallback
  return 'desktop';
}

function resolveDisplayMode(): RuntimeDisplayMode {
  if (typeof window === 'undefined') return 'browser';
  if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
  if (window.matchMedia('(display-mode: minimal-ui)').matches) return 'minimal-ui';
  if (window.matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen';
  return 'browser';
}

// ─── Context ──────────────────────────────────────────────────────────────────

const PlatformRuntimeCtx = createContext<PlatformRuntime | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function PlatformRuntimeProvider({ children }: { children: React.ReactNode }) {
  // Static signals — never change within a session.
  const staticInfo = useMemo(() => getStaticPlatformInfo(), []);
  const pwaCapabilities = useMemo(() => detectPwaCapabilities(), []);
  const appleAvail = useMemo(() => detectAppleEnhancementAvailability(), []);
  const androidAvail = useMemo(() => detectAndroidEnhancementAvailability(), []);

  // displayMode is reactive — it updates if the user installs the app while
  // the page is open (Chromium fires a displaymodechange media query event).
  const [displayMode, setDisplayMode] = useState<RuntimeDisplayMode>(resolveDisplayMode);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const queries = [
      window.matchMedia('(display-mode: standalone)'),
      window.matchMedia('(display-mode: minimal-ui)'),
      window.matchMedia('(display-mode: fullscreen)'),
    ];

    const update = () => setDisplayMode(resolveDisplayMode());
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);

  const runtime = useMemo((): PlatformRuntime => {
    const family = resolveFamily(
      staticInfo.isIOS,
      staticInfo.isAndroid,
      appleAvail.likelyAppleWebKit,
      androidAvail.likelyAndroidChrome,
      staticInfo.isMobile,
    );

    return {
      family,
      visualIdiom: resolveVisualIdiom(family),
      displayMode,
      isInstalled: displayMode !== 'browser',
      isIOS: staticInfo.isIOS,
      isAndroid: staticInfo.isAndroid,
      isMobile: staticInfo.isMobile,

      input: {
        coarse: staticInfo.prefersCoarsePointer,
        fine: staticInfo.hasAnyFinePointer,
        hover: staticInfo.canHover,
      },

      capabilities: {
        serviceWorker: pwaCapabilities.serviceWorker,
        push: pwaCapabilities.push,
        notifications: pwaCapabilities.notifications,
        badging: pwaCapabilities.badging,
        backgroundSync: pwaCapabilities.backgroundSync,
        webShare: pwaCapabilities.share,
        fileSystemAccess: androidAvail.filePickerAvailable,
        cloudKit: appleAvail.cloudKitJsAvailable,
        contactPicker: androidAvail.contactPickerAvailable,
        vibration: androidAvail.vibrationApiAvailable,
        shareTarget: pwaCapabilities.serviceWorker,
      },

      isAppleWebKit: appleAvail.likelyAppleWebKit || pwaCapabilities.isAppleWebKit,
      likelyAndroidChrome: androidAvail.likelyAndroidChrome,
    };
  }, [staticInfo, pwaCapabilities, appleAvail, androidAvail, displayMode]);

  return (
    <PlatformRuntimeCtx.Provider value={runtime}>
      {children}
    </PlatformRuntimeCtx.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePlatformRuntime(): PlatformRuntime {
  const ctx = useContext(PlatformRuntimeCtx);
  if (ctx === null) {
    throw new Error(
      'usePlatformRuntime() must be used inside <PlatformRuntimeProvider>. ' +
      'Add <PlatformRuntimeProvider> above the component tree in App.tsx.',
    );
  }
  return ctx;
}

// ─── Visual idiom recipes ─────────────────────────────────────────────────────
// Centralised constants that native primitives read instead of deciding ad hoc.

export const nativeRecipes = {
  cupertino: {
    radius: { card: 20, sheet: 28, button: 999, iconButton: 999, input: 14 },
    chrome: {
      background: 'var(--chrome-bg)',
      blur: 'blur(24px) saturate(1.8)',
      border: '0.33px solid var(--sep-chrome)',
    },
    motion: {
      push:  [0.25, 0.1, 0.25, 1] as [number, number, number, number],
      sheet: [0.16, 1,   0.3,  1] as [number, number, number, number],
    },
    tabBar: {
      height: 62,
      iconSize: 44,
    },
  },
  material: {
    radius: { card: 16, sheet: 28, button: 12, iconButton: 999, input: 12 },
    chrome: {
      background: 'var(--surface)',
      blur: 'none',
      border: 'none',
    },
    motion: {
      push:  [0.2, 0, 0, 1] as [number, number, number, number],
      sheet: [0.2, 0, 0, 1] as [number, number, number, number],
    },
    tabBar: {
      height: 80,
      iconSize: 44,
    },
  },
  desktop: {
    radius: { card: 12, sheet: 16, button: 8, iconButton: 8, input: 8 },
    chrome: {
      background: 'var(--surface)',
      blur: 'none',
      border: '1px solid var(--sep)',
    },
    motion: {
      push:  [0.25, 0.1, 0.25, 1] as [number, number, number, number],
      sheet: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
    },
    tabBar: {
      height: 54,
      iconSize: 34,
    },
  },
} as const;

export type NativeRecipes = typeof nativeRecipes;
