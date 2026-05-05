import { detectAndroidEnhancementAvailability } from '../android/availability';
import type { AndroidEnhancementAvailability } from '../android/types';
import { detectAppleEnhancementAvailability } from '../apple/availability';
import type { AppleEnhancementAvailability } from '../apple/types';
import { getStaticPlatformInfo, type StaticPlatformInfo } from '../lib/platformDetect';
import { detectPwaCapabilities } from '../pwa/capabilities';
import type { PwaCapabilities } from '../pwa/types';

export type PlatformFamily = 'apple' | 'android' | 'web';
export type NativeBridgeKind = 'capacitor' | 'web';
export type PlatformVisualLanguage = 'apple' | 'material' | 'web';
export type PlatformBackBehavior = 'android-overlay-history' | 'browser-default';

export interface PlatformCapabilitySnapshot {
  readonly schemaVersion: 1;
  readonly family: PlatformFamily;
  readonly staticInfo: StaticPlatformInfo;
  readonly pwa: PwaCapabilities;
  readonly apple: AppleEnhancementAvailability;
  readonly android: AndroidEnhancementAvailability;
  readonly nativeBridge: {
    readonly kind: NativeBridgeKind;
    readonly available: boolean;
  };
  readonly ui: {
    readonly visualLanguage: PlatformVisualLanguage;
    readonly preferNativeEmoji: boolean;
    readonly minimumTouchTargetPx: number;
    readonly backBehavior: PlatformBackBehavior;
    readonly useReducedEffects: boolean;
  };
  readonly privacy: {
    /**
     * Capability snapshots intentionally expose only coarse booleans and small
     * enums. Never add raw UA strings, IP-derived location, account IDs, DIDs,
     * notification tokens, or device identifiers here.
     */
    readonly coarseSignalsOnly: true;
  };
}

interface CapacitorLike {
  isNativePlatform?: () => boolean;
}

function safeNavigatorPlatform(): string {
  try {
    const userAgentData = (navigator as Navigator & {
      userAgentData?: { platform?: string };
    }).userAgentData;
    if (typeof userAgentData?.platform === 'string') {
      return userAgentData.platform.toLowerCase();
    }
    return typeof navigator.platform === 'string' ? navigator.platform.toLowerCase() : '';
  } catch {
    return '';
  }
}

function safeUserAgent(): string {
  try {
    return typeof navigator.userAgent === 'string' ? navigator.userAgent.toLowerCase() : '';
  } catch {
    return '';
  }
}

function isLikelyAppleSystem(staticInfo: StaticPlatformInfo, pwa: PwaCapabilities, apple: AppleEnhancementAvailability): boolean {
  if (staticInfo.isIOS || pwa.isAppleWebKit || apple.likelyAppleWebKit) {
    return true;
  }

  const platform = safeNavigatorPlatform();
  const ua = safeUserAgent();
  return platform.includes('mac') || platform.includes('iphone') || platform.includes('ipad') || /macintosh|iphone|ipad|ipod/.test(ua);
}

function detectNativeBridgeKind(): NativeBridgeKind {
  try {
    const maybeCapacitor = (globalThis as typeof globalThis & {
      Capacitor?: CapacitorLike;
    }).Capacitor;
    return maybeCapacitor?.isNativePlatform?.() === true ? 'capacitor' : 'web';
  } catch {
    return 'web';
  }
}

function shouldUseReducedEffects(staticInfo: StaticPlatformInfo): boolean {
  return staticInfo.saveData || staticInfo.connectionEffectiveType === 'slow-2g' || staticInfo.connectionEffectiveType === '2g';
}

export function createPlatformCapabilitySnapshot(): PlatformCapabilitySnapshot {
  const staticInfo = getStaticPlatformInfo();
  const pwa = detectPwaCapabilities();
  const apple = detectAppleEnhancementAvailability();
  const android = detectAndroidEnhancementAvailability();
  const nativeBridgeKind = detectNativeBridgeKind();

  const isAndroid = staticInfo.isAndroid || android.likelyAndroidChrome;
  const isApple = !isAndroid && isLikelyAppleSystem(staticInfo, pwa, apple);
  const family: PlatformFamily = isApple ? 'apple' : isAndroid ? 'android' : 'web';
  const visualLanguage: PlatformVisualLanguage =
    family === 'apple' ? 'apple' : family === 'android' ? 'material' : 'web';

  return Object.freeze({
    schemaVersion: 1,
    family,
    staticInfo,
    pwa,
    apple,
    android,
    nativeBridge: Object.freeze({
      kind: nativeBridgeKind,
      available: nativeBridgeKind !== 'web',
    }),
    ui: Object.freeze({
      visualLanguage,
      preferNativeEmoji: family === 'apple',
      minimumTouchTargetPx: 44,
      backBehavior: family === 'android' ? 'android-overlay-history' : 'browser-default',
      useReducedEffects: shouldUseReducedEffects(staticInfo),
    }),
    privacy: Object.freeze({
      coarseSignalsOnly: true,
    }),
  });
}

export function shouldEnableAppleEnhancements(snapshot: PlatformCapabilitySnapshot): boolean {
  return snapshot.family === 'apple' || snapshot.apple.likelyAppleWebKit;
}

export function shouldEnableAndroidEnhancements(snapshot: PlatformCapabilitySnapshot): boolean {
  return snapshot.family === 'android' && snapshot.android.likelyAndroidChrome;
}
