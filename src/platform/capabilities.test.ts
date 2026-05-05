import { afterEach, describe, expect, it } from 'vitest';
import {
  createPlatformCapabilitySnapshot,
  shouldEnableAndroidEnhancements,
  shouldEnableAppleEnhancements,
} from './capabilities';

const ORIGINAL_WINDOW = globalThis.window;
const ORIGINAL_NAVIGATOR = globalThis.navigator;
const ORIGINAL_NOTIFICATION = globalThis.Notification;
const ORIGINAL_HISTORY = globalThis.history;
const ORIGINAL_CAPACITOR = (globalThis as typeof globalThis & { Capacitor?: unknown }).Capacitor;

type MatchMediaStub = (query: string) => {
  matches: boolean;
  addEventListener: () => void;
  removeEventListener: () => void;
};

function installBrowserStubs({
  userAgent,
  platform = '',
  userAgentData,
  standalone = false,
  hasChrome = false,
  hasVibrate = false,
  hasContacts = false,
  capacitorNative = false,
}: {
  userAgent: string;
  platform?: string;
  userAgentData?: { platform?: string; mobile?: boolean };
  standalone?: boolean;
  hasChrome?: boolean;
  hasVibrate?: boolean;
  hasContacts?: boolean;
  capacitorNative?: boolean;
}) {
  const matchMedia: MatchMediaStub = (query) => ({
    matches: standalone && query.includes('display-mode: standalone'),
    addEventListener: () => {},
    removeEventListener: () => {},
  });

  const windowStub = {
    matchMedia,
    ...(hasChrome ? { chrome: {} } : {}),
  } as unknown as typeof window & { chrome?: object };

  const navigatorStub = {
    userAgent,
    platform,
    userAgentData,
    hardwareConcurrency: 8,
    standalone,
    serviceWorker: {},
    ...(hasVibrate ? { vibrate: () => true } : {}),
    ...(hasContacts ? { contacts: {} } : {}),
  } as unknown as Navigator & {
    userAgentData?: { platform?: string; mobile?: boolean };
    contacts?: unknown;
    standalone?: boolean;
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowStub,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: navigatorStub,
  });
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: { permission: 'default' },
  });
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: { pushState: () => {} },
  });
  Object.defineProperty(globalThis, 'Capacitor', {
    configurable: true,
    value: capacitorNative ? { isNativePlatform: () => true } : undefined,
  });
}

describe('createPlatformCapabilitySnapshot', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: ORIGINAL_WINDOW,
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: ORIGINAL_NAVIGATOR,
    });
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: ORIGINAL_NOTIFICATION,
    });
    Object.defineProperty(globalThis, 'history', {
      configurable: true,
      value: ORIGINAL_HISTORY,
    });
    Object.defineProperty(globalThis, 'Capacitor', {
      configurable: true,
      value: ORIGINAL_CAPACITOR,
    });
  });

  it('returns conservative web capabilities without browser globals', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });

    const snapshot = createPlatformCapabilitySnapshot();

    expect(snapshot.family).toBe('web');
    expect(snapshot.nativeBridge.kind).toBe('web');
    expect(snapshot.privacy.coarseSignalsOnly).toBe(true);
  });

  it('classifies Apple systems without leaking raw UA data into the snapshot', () => {
    installBrowserStubs({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      standalone: true,
    });

    const snapshot = createPlatformCapabilitySnapshot();

    expect(snapshot.family).toBe('apple');
    expect(snapshot.ui.visualLanguage).toBe('apple');
    expect(snapshot.ui.preferNativeEmoji).toBe(true);
    expect(shouldEnableAppleEnhancements(snapshot)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('iPhone OS');
  });

  it('classifies Android Chrome and enables overlay-history back behavior', () => {
    installBrowserStubs({
      userAgent:
        'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      userAgentData: { platform: 'Android', mobile: true },
      hasChrome: true,
      hasVibrate: true,
      hasContacts: true,
      capacitorNative: true,
    });

    const snapshot = createPlatformCapabilitySnapshot();

    expect(snapshot.family).toBe('android');
    expect(snapshot.ui.visualLanguage).toBe('material');
    expect(snapshot.ui.backBehavior).toBe('android-overlay-history');
    expect(snapshot.nativeBridge.kind).toBe('capacitor');
    expect(shouldEnableAndroidEnhancements(snapshot)).toBe(true);
  });
});
