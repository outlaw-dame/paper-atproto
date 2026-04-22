// ─── Static Platform Detection ───────────────────────────────────────────────
// Pure, synchronous, zero-React platform detection.
// Safe to import from bootstrap.ts, service workers, and anywhere React hooks
// cannot be used. All values represent the environment at the time of the call.
//
// usePlatform() (src/hooks/usePlatform.ts) wraps this for React and makes
// `isStandalone`/`isPWA` reactive via matchMedia event listeners.

// ─── Extended navigator types ─────────────────────────────────────────────────
interface NavigatorExtended extends Navigator {
  readonly deviceMemory?: number;
  readonly standalone?: boolean;
  readonly userAgentData?: NavigatorUAData;
  readonly connection?: NetworkInformation;
}

interface NavigatorUAData {
  readonly platform?: string;
  readonly mobile?: boolean;
  readonly brands?: ReadonlyArray<{ brand: string; version: string }>;
}

interface NetworkInformation {
  readonly effectiveType?: string;
  readonly saveData?: boolean;
  readonly downlink?: number;
  readonly rtt?: number;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface StaticPlatformInfo {
  /** Running on an iPhone, iPad, or iPod touch. UA-based. */
  readonly isIOS: boolean;
  /** Running on an Android device. UA-based. */
  readonly isAndroid: boolean;
  /** isIOS || isAndroid. */
  readonly isMobile: boolean;
  /** Primary pointer is coarse (finger/stylus). */
  readonly prefersCoarsePointer: boolean;
  /** Any input system has a coarse pointer. */
  readonly hasAnyCoarsePointer: boolean;
  /** Any input system has a fine pointer. */
  readonly hasAnyFinePointer: boolean;
  /** Any input system supports hover. */
  readonly canHover: boolean;
  /**
   * Running in standalone / PWA mode at the moment of the call.
   * This is a snapshot — use usePlatform() for a reactive value.
   */
  readonly isStandalone: boolean;
  /**
   * Reported device RAM in GiB. 0 means the value was absent or non-finite.
   * Source: navigator.deviceMemory (Chrome/Android; absent on iOS/Firefox).
   */
  readonly deviceMemory: number;
  /**
   * Logical CPU count. 0 means the value was absent or non-finite.
   * Source: navigator.hardwareConcurrency.
   */
  readonly hardwareConcurrency: number;
  /**
   * Effective connection type string from the Network Information API
   * ('slow-2g' | '2g' | '3g' | '4g'). Empty string if unavailable.
   */
  readonly connectionEffectiveType: string;
  /** navigator.connection.saveData — true if the user has Data Saver enabled. */
  readonly saveData: boolean;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function safeMatchMedia(query: string): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia !== undefined
      ? window.matchMedia(query).matches
      : false;
  } catch {
    return false;
  }
}

function safeNav(): NavigatorExtended | null {
  try {
    return typeof navigator !== 'undefined' ? (navigator as NavigatorExtended) : null;
  } catch {
    return null;
  }
}

function safeUa(): string {
  try {
    return typeof navigator !== 'undefined' ? navigator.userAgent : '';
  } catch {
    return '';
  }
}

function clampedInt(value: number | undefined | null, min = 0): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.max(min, n) : 0;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Returns a snapshot of static platform characteristics.
 *
 * - Never throws: all browser API access is guarded.
 * - Safe for SSR: returns conservative values when window/navigator are absent.
 * - Call once per logical context (bootstrap, prefetch decision, etc.) and
 *   destructure what you need — no caching needed since the values are stable.
 */
export function getStaticPlatformInfo(): StaticPlatformInfo {
  const ua = safeUa();
  const nav = safeNav();

  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isAndroid = /android/i.test(ua);

  const prefersCoarsePointer = safeMatchMedia('(pointer: coarse)');
  const hasAnyCoarsePointer = safeMatchMedia('(any-pointer: coarse)');
  const hasAnyFinePointer = safeMatchMedia('(any-pointer: fine)');
  const canHover =
    safeMatchMedia('(hover: hover)') || safeMatchMedia('(any-hover: hover)');

  const isStandalone =
    safeMatchMedia('(display-mode: standalone)') ||
    safeMatchMedia('(display-mode: minimal-ui)') ||
    (isIOS && nav !== null && 'standalone' in nav && nav.standalone === true);

  const deviceMemory = clampedInt(nav?.deviceMemory);
  const hardwareConcurrency = clampedInt(nav?.hardwareConcurrency);

  const connection: NetworkInformation | undefined = nav?.connection;
  const connectionEffectiveType =
    typeof connection?.effectiveType === 'string' ? connection.effectiveType : '';
  const saveData = connection?.saveData === true;

  return {
    isIOS,
    isAndroid,
    isMobile: isIOS || isAndroid,
    prefersCoarsePointer,
    hasAnyCoarsePointer,
    hasAnyFinePointer,
    canHover,
    isStandalone,
    deviceMemory,
    hardwareConcurrency,
    connectionEffectiveType,
    saveData,
  };
}
