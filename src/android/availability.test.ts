import { afterEach, describe, expect, it } from 'vitest';
import { detectAndroidEnhancementAvailability } from './availability';

type MatchMediaStub = (query: string) => {
  matches: boolean;
  addEventListener: () => void;
  removeEventListener: () => void;
};

const ORIGINAL_WINDOW = globalThis.window;
const ORIGINAL_NAVIGATOR = globalThis.navigator;
const ORIGINAL_NOTIFICATION = globalThis.Notification;
const ORIGINAL_HISTORY = globalThis.history;

function installBrowserStubs({
  userAgent,
  userAgentData,
  hasVibrate = false,
  hasContacts = false,
}: {
  userAgent: string;
  userAgentData?: { platform?: string; mobile?: boolean };
  hasVibrate?: boolean;
  hasContacts?: boolean;
}) {
  const matchMedia: MatchMediaStub = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });

  const windowStub = {
    chrome: {},
    matchMedia,
  } as unknown as typeof window & { chrome: object };

  const navigatorStub = {
    userAgent,
    userAgentData,
    share: () => Promise.resolve(),
    serviceWorker: {},
    hardwareConcurrency: 8,
    ...(hasVibrate ? { vibrate: () => true } : {}),
    ...(hasContacts ? { contacts: {} } : {}),
  } as unknown as Navigator & {
    userAgentData?: { platform?: string; mobile?: boolean };
    contacts?: unknown;
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
}

describe('detectAndroidEnhancementAvailability', () => {
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
  });

  it('does not classify desktop Chromium as Android Chrome from vibration alone', () => {
    installBrowserStubs({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      userAgentData: { platform: 'macOS', mobile: false },
      hasVibrate: true,
      hasContacts: false,
    });

    const availability = detectAndroidEnhancementAvailability();

    expect(availability.vibrationApiAvailable).toBe(true);
    expect(availability.likelyAndroidChrome).toBe(false);
  });

  it('still classifies Android Chrome correctly from structured platform data', () => {
    installBrowserStubs({
      userAgent:
        'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36',
      userAgentData: { platform: 'Android', mobile: true },
      hasVibrate: true,
      hasContacts: true,
    });

    const availability = detectAndroidEnhancementAvailability();

    expect(availability.likelyAndroidChrome).toBe(true);
    expect(availability.contactPickerAvailable).toBe(true);
  });
});
