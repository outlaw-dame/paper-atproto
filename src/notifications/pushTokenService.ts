// ─── Push Token Registration Service ──────────────────────────────────────────
// Manages the lifecycle of push notification tokens on the server:
//   - Register: send token + metadata to backend after user login
//   - Revoke: deactivate token on logout
//   - Refresh: update token if the platform issues a new one
//
// SECURITY:
//   - Never log raw push tokens (they are bearer credentials for push delivery).
//   - Only register tokens after explicit session binding (user is logged in).
//   - Tokens include platform, app version, and device label — NOT device IDs
//     or hardware fingerprints.
//   - Revoke immediately on logout — do not leave orphaned tokens.

import { getPushChannel } from '../native/pushRuntime';
import type { PushChannel } from '../native/pushRuntime';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PushTokenRecord {
  /** The push token value (APNs device token, FCM token, or web push subscription endpoint). */
  token: string;
  /** Delivery channel for the backend to route through. */
  channel: PushChannel;
  /** Platform: 'ios', 'android', or 'web'. */
  platform: 'ios' | 'android' | 'web';
  /** App version at time of registration. */
  appVersion: string;
  /** Optional user-chosen device label (e.g. "Damon's iPhone"). */
  deviceLabel?: string;
  /** ISO timestamp of registration. */
  registeredAt: string;
}

export interface PushTokenRegistrationResult {
  success: boolean;
  /** Server-assigned token record ID (for revocation). */
  recordId?: string;
  error?: string;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const PUSH_TOKEN_ENDPOINT = '/api/push/tokens';
const MAX_REGISTRATION_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1000;

// ─── State ────────────────────────────────────────────────────────────────────

let currentRecordId: string | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a push token with the backend.
 *
 * Call ONLY after:
 *   1. User is authenticated (session exists)
 *   2. Push permission was granted
 *   3. Token was received from the platform
 *
 * Uses exponential backoff on transient failures.
 * Never throws — returns a result object.
 */
export async function registerPushToken(
  token: string,
  options?: {
    deviceLabel?: string;
    appVersion?: string;
  },
): Promise<PushTokenRegistrationResult> {
  const channel = getPushChannel();
  if (channel === 'none') {
    return { success: false, error: 'No push channel available' };
  }

  const record: PushTokenRecord = {
    token,
    channel,
    platform: derivePlatform(channel),
    appVersion: options?.appVersion ?? getAppVersion(),
    registeredAt: new Date().toISOString(),
    ...(options?.deviceLabel ? { deviceLabel: options.deviceLabel } : {}),
  };

  for (let attempt = 0; attempt < MAX_REGISTRATION_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(PUSH_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(record),
      });

      if (response.ok) {
        const body = await response.json() as { recordId?: string };
        currentRecordId = body.recordId ?? null;
        return {
          success: true,
          ...(currentRecordId ? { recordId: currentRecordId } : {}),
        };
      }

      // Non-retryable client errors
      if (response.status >= 400 && response.status < 500) {
        return { success: false, error: `Server rejected: ${response.status}` };
      }

      // Retryable server errors — backoff and retry
    } catch {
      // Network error — retry
    }

    if (attempt < MAX_REGISTRATION_ATTEMPTS - 1) {
      await sleep(BACKOFF_BASE_MS * 2 ** attempt);
    }
  }

  return { success: false, error: 'Registration failed after retries' };
}

/**
 * Revoke the current push token on the backend.
 *
 * Call on logout to ensure the user stops receiving push notifications
 * for this session/device. Best-effort — does not block logout flow.
 */
export async function revokePushToken(): Promise<void> {
  if (!currentRecordId) return;

  try {
    await fetch(`${PUSH_TOKEN_ENDPOINT}/${currentRecordId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
  } catch {
    // Best-effort. If revocation fails, the server should eventually
    // expire the token when delivery fails repeatedly.
  } finally {
    currentRecordId = null;
  }
}

/**
 * Returns whether a token is currently registered with the backend.
 */
export function hasRegisteredToken(): boolean {
  return currentRecordId !== null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function derivePlatform(channel: PushChannel): 'ios' | 'android' | 'web' {
  if (channel === 'native-apns') return 'ios';
  if (channel === 'native-fcm') return 'android';
  return 'web';
}

function getAppVersion(): string {
  try {
    return (import.meta as ImportMeta & { env?: Record<string, string> })
      .env?.VITE_APP_VERSION ?? '1.0.0';
  } catch {
    return '1.0.0';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}
