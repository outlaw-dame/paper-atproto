// ─── Native Push Notifications ────────────────────────────────────────────────
// Manages native push notification registration and token lifecycle via
// @capacitor/push-notifications. This is SEPARATE from web push (service worker)
// — native packages use APNs (iOS) and FCM (Android) directly.
//
// SECURITY:
//   - Never log raw push tokens.
//   - Tokens are only sent to the app's backend after explicit user login.
//   - Tokens are revoked/deactivated on logout.
//   - Permission is only requested after a deliberate user action.

import {
  PushNotifications,
  type Token,
  type ActionPerformed,
  type PushNotificationSchema,
} from '@capacitor/push-notifications';
import { isNativePlatform } from './capacitorRuntime';

export interface NativePushToken {
  /** The push token value (APNs device token or FCM registration token). */
  value: string;
  /** Platform that issued this token. */
  platform: 'ios' | 'android';
  /** ISO timestamp of when this token was received. */
  receivedAt: string;
}

export interface NativePushHandlers {
  /** Called when a push token is received after successful registration. */
  onTokenReceived?: (token: NativePushToken) => void;
  /** Called when token registration fails. */
  onRegistrationError?: (error: unknown) => void;
  /** Called when a push notification is received while the app is in foreground. */
  onNotificationReceived?: (notification: PushNotificationSchema) => void;
  /** Called when the user taps a notification (foreground or background). */
  onNotificationAction?: (action: ActionPerformed) => void;
}

let handlers: NativePushHandlers = {};
let listenersAttached = false;

/**
 * Register native push notification handlers.
 * Call before requestNativePushPermission() to ensure the token callback fires.
 */
export function setNativePushHandlers(h: NativePushHandlers): void {
  handlers = { ...h };
}

/**
 * Attach Capacitor push notification listeners.
 * Must be called once at app startup (on native only).
 * Safe to call multiple times — only attaches once.
 */
export async function initNativePushListeners(): Promise<void> {
  if (listenersAttached || !isNativePlatform()) return;
  listenersAttached = true;

  await PushNotifications.addListener('registration', (token: Token) => {
    const nativeToken: NativePushToken = {
      value: token.value,
      platform: detectTokenPlatform(),
      receivedAt: new Date().toISOString(),
    };
    handlers.onTokenReceived?.(nativeToken);
  });

  await PushNotifications.addListener('registrationError', (error) => {
    handlers.onRegistrationError?.(error);
  });

  await PushNotifications.addListener(
    'pushNotificationReceived',
    (notification: PushNotificationSchema) => {
      handlers.onNotificationReceived?.(notification);
    },
  );

  await PushNotifications.addListener(
    'pushNotificationActionPerformed',
    (action: ActionPerformed) => {
      handlers.onNotificationAction?.(action);
    },
  );
}

/**
 * Check the current native push permission status.
 * Returns 'granted', 'denied', or 'prompt'.
 */
export async function checkNativePushPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  if (!isNativePlatform()) return 'denied';

  const status = await PushNotifications.checkPermissions();
  if (status.receive === 'granted') return 'granted';
  if (status.receive === 'denied') return 'denied';
  return 'prompt';
}

/**
 * Request native push notification permission and register for push.
 * Only call this in response to a deliberate user action (e.g., tapping
 * "Enable notifications" in settings). Never call on app launch.
 *
 * Returns true if permission was granted and registration was initiated.
 */
export async function requestNativePushPermission(): Promise<boolean> {
  if (!isNativePlatform()) return false;

  const permResult = await PushNotifications.requestPermissions();
  if (permResult.receive !== 'granted') return false;

  // Register for push — this triggers the 'registration' listener with the token.
  await PushNotifications.register();
  return true;
}

/**
 * Unregister from native push notifications.
 * Call on logout to stop receiving push for the current session.
 */
export async function unregisterNativePush(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await PushNotifications.unregister();
  } catch {
    // Unregister may fail on some devices — non-critical.
  }
}

/**
 * Remove all delivered notifications from the notification tray.
 */
export async function clearNativeNotifications(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await PushNotifications.removeAllDeliveredNotifications();
  } catch {
    // Non-critical.
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectTokenPlatform(): 'ios' | 'android' {
  try {
    // Import is already at the top of the file via capacitorRuntime.
    // Use the global Capacitor object directly.
    const w = globalThis as typeof globalThis & {
      Capacitor?: { getPlatform?: () => string };
    };
    return w.Capacitor?.getPlatform?.() === 'ios' ? 'ios' : 'android';
  } catch {
    return 'android';
  }
}
