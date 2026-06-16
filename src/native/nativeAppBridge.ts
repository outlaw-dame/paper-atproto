// ─── Native App Lifecycle Bridge ──────────────────────────────────────────────
// Bridges Capacitor App plugin events (pause, resume, deep links, restored
// plugin results) into the app's state layer.
//
// Must be initialized once at app startup via initNativeAppBridge().
// Safe to call on web — returns immediately without side effects.

import { App, type URLOpenListenerEvent, type RestoredListenerEvent } from '@capacitor/app';
import { isNativePlatform } from './capacitorRuntime';

let initialized = false;

/** Callbacks the app can register to respond to native lifecycle events. */
export interface NativeAppLifecycleHandlers {
  onPause?: () => void;
  onResume?: () => void;
  onDeepLink?: (url: string) => void;
  onRestoredResult?: (event: RestoredListenerEvent) => void;
}

let registeredHandlers: NativeAppLifecycleHandlers = {};

/** Queued deep link from cold-start before handler is registered. */
let pendingDeepLink: string | null = null;

/**
 * Register lifecycle handlers.
 *
 * If a deep link arrived during cold-start before handlers were registered,
 * it is delivered immediately upon registration (prevents silent loss).
 */
export function setNativeAppLifecycleHandlers(handlers: NativeAppLifecycleHandlers): void {
  registeredHandlers = { ...handlers };

  // Flush any deep link that arrived before handlers were ready.
  if (pendingDeepLink && registeredHandlers.onDeepLink) {
    registeredHandlers.onDeepLink(pendingDeepLink);
    pendingDeepLink = null;
  }
}

/**
 * Initialize the native app lifecycle bridge.
 * Subscribes to Capacitor App plugin events and routes them to registered handlers.
 *
 * Safe to call multiple times — only initializes once.
 * Safe to call on web — returns immediately.
 */
export async function initNativeAppBridge(): Promise<void> {
  if (initialized || !isNativePlatform()) return;
  initialized = true;

  await App.addListener('pause', () => {
    registeredHandlers.onPause?.();
  });

  await App.addListener('resume', () => {
    registeredHandlers.onResume?.();
  });

  await App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    const url = event.url;
    if (isValidDeepLink(url)) {
      if (registeredHandlers.onDeepLink) {
        registeredHandlers.onDeepLink(url);
      } else {
        // Queue for delivery when handlers are registered (cold-start race).
        pendingDeepLink = url;
      }
    }
  });

  await App.addListener('appRestoredResult', (event: RestoredListenerEvent) => {
    // Android can restore plugin results after process death.
    // Handle camera/file/share results defensively.
    registeredHandlers.onRestoredResult?.(event);
  });
}

// ─── Deep Link Validation ─────────────────────────────────────────────────────

/** Allowed URL schemes for deep link routing. */
const ALLOWED_SCHEMES = new Set(['https:', 'http:', 'web+at:']);

/**
 * Validates that a deep link URL is safe to route.
 * Only allows approved schemes — blocks javascript:, data:, etc.
 */
function isValidDeepLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_SCHEMES.has(parsed.protocol);
  } catch {
    return false;
  }
}
