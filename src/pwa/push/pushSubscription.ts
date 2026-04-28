// ─── Push Subscription Management ────────────────────────────────────────────
// Create, reconcile, and remove push subscriptions.
// Subscription endpoint is synced to the backend under the authenticated session.
//
// Security: never persist raw subscription endpoint in plaintext beyond what
// is operationally needed; hash for local deduplication only.

import type { PushSubscriptionSyncResult } from './pushTypes';
import { getPushCapability } from './pushCapability';

// The VAPID public key must be configured via environment variable.
const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY ??
  import.meta.env.VITE_VAPID_PUBLIC_KEY;

// Backend endpoint that receives the subscription object.
// Requires authenticated session (cookie/bearer).
const PUSH_SUBSCRIPTION_ENDPOINT =
  import.meta.env.VITE_PUSH_SUBSCRIPTION_ENDPOINT ?? '/api/push/subscription';

// Backoff config for sync retries.
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 60_000;
const MAX_SYNC_ATTEMPTS = 5;

export async function ensurePushSubscription(): Promise<PushSubscriptionSyncResult> {
  const cap = getPushCapability();
  if (!cap.supported) return { ok: false, errorCode: 'unsupported' };
  if (cap.permission === 'denied') return { ok: false, errorCode: 'permission-denied' };

  if (!VAPID_PUBLIC_KEY) {
    console.warn(
      '[Push] VITE_WEB_PUSH_VAPID_PUBLIC_KEY not configured — push unavailable.',
    );
    return { ok: false, errorCode: 'unsupported' };
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
    });

    const result = await syncSubscriptionToBackend(sub);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('permission') || msg.includes('denied')) {
      return { ok: false, errorCode: 'permission-denied' };
    }
    return { ok: false, errorCode: 'subscription-failed' };
  }
}

export async function disablePushSubscription(): Promise<PushSubscriptionSyncResult> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe();
      await removeSubscriptionFromBackend(sub);
    }
    return { ok: true };
  } catch {
    return { ok: false, errorCode: 'sync-failed' };
  }
}

export async function reconcilePushSubscription(): Promise<PushSubscriptionSyncResult> {
  const cap = getPushCapability();
  if (!cap.supported || cap.permission !== 'granted') {
    return { ok: false, errorCode: cap.permission === 'denied' ? 'permission-denied' : 'unsupported' };
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: false, errorCode: 'subscription-failed' };
    return syncSubscriptionToBackend(sub);
  } catch {
    return { ok: false, errorCode: 'sync-failed' };
  }
}

async function syncSubscriptionToBackend(
  sub: PushSubscription
): Promise<PushSubscriptionSyncResult> {
  const payload = sub.toJSON();

  for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(PUSH_SUBSCRIPTION_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (res.status === 401 || res.status === 403) {
        return { ok: false, errorCode: 'auth-required' };
      }
      if (res.status === 422) {
        return { ok: false, errorCode: 'validation-failed' };
      }
      if (res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        const endpointHash = typeof body?.endpointHash === 'string' ? body.endpointHash : undefined;
        return endpointHash !== undefined ? { ok: true, endpointHash } : { ok: true };
      }

      // Retryable server error.
    } catch {
      // Network error — retryable.
    }

    if (attempt < MAX_SYNC_ATTEMPTS - 1) {
      await delay(withFullJitter(BASE_DELAY_MS, MAX_DELAY_MS, attempt));
    }
  }

  return { ok: false, errorCode: 'sync-failed' };
}

async function removeSubscriptionFromBackend(sub: PushSubscription): Promise<void> {
  try {
    await fetch(PUSH_SUBSCRIPTION_ENDPOINT, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    // Non-fatal.
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function withFullJitter(base: number, max: number, attempt: number): number {
  const ceiling = Math.min(base * Math.pow(2, attempt), max);
  return Math.floor(Math.random() * ceiling);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
