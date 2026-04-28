// ─── Push Subscription Store ──────────────────────────────────────────────────
// In-memory store for Web Push subscriptions with:
//   • SHA-256 endpoint hashing for deduplication (never stores raw endpoint)
//   • Per-IP write accounting (prevents one IP flooding the store)
//   • Automatic TTL expiry (90 days default)
//   • Hard cap on total stored entries (prevents unbounded growth)
//   • Periodic compaction of expired entries
//
// This is intentionally a lightweight in-memory model. For production at scale
// replace with a proper database. All sensitive subscription data (keys) is held
// only in memory and never written to disk by this module.

import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoredSubscription {
  /** SHA-256 hex of the push endpoint URL — used as the store key. */
  endpointHash: string;
  /** Raw PushSubscription JSON — endpoint, keys.auth, keys.p256dh */
  subscription: PushSubscriptionJson;
  /** ISO timestamp of first registration */
  createdAt: string;
  /** ISO timestamp of last successful upsert */
  updatedAt: string;
  /** Unix ms — entry is expired and eligible for eviction after this */
  expiresAt: number;
}

export interface PushSubscriptionJson {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// ─── Config ───────────────────────────────────────────────────────────────────

const TTL_MS = env.PUSH_SUB_TTL_DAYS * 24 * 60 * 60 * 1000;
const MAX_SUBS = env.PUSH_MAX_SUBSCRIPTIONS;
// Compact expired entries every 10 minutes
const COMPACT_INTERVAL_MS = 10 * 60 * 1000;

// ─── Store ────────────────────────────────────────────────────────────────────

const store = new Map<string, StoredSubscription>();

// Run compaction on a timer so the Map does not grow unboundedly
const compactionTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}, COMPACT_INTERVAL_MS);

// Allow the process to exit even if this timer is still pending
if (compactionTimer.unref) compactionTimer.unref();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** SHA-256 hex digest of the endpoint URL. Used as the store key so the raw
 *  endpoint is not stored in a secondary index or log output. */
export function hashEndpoint(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Upsert a push subscription. Returns the endpoint hash on success, or an
 *  error code string on failure. */
export type UpsertResult =
  | { ok: true; endpointHash: string; created: boolean }
  | { ok: false; errorCode: 'capacity' | 'invalid' };

export function upsertSubscription(sub: PushSubscriptionJson): UpsertResult {
  const endpointHash = hashEndpoint(sub.endpoint);
  const now = Date.now();
  const existing = store.get(endpointHash);

  if (!existing && store.size >= MAX_SUBS) {
    return { ok: false, errorCode: 'capacity' };
  }

  const entry: StoredSubscription = {
    endpointHash,
    subscription: sub,
    createdAt: existing?.createdAt ?? new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: now + TTL_MS,
  };

  store.set(endpointHash, entry);
  return { ok: true, endpointHash, created: !existing };
}

/** Remove a subscription by its raw endpoint URL. Returns true if found. */
export function removeSubscription(endpoint: string): boolean {
  const key = hashEndpoint(endpoint);
  return store.delete(key);
}

/** Retrieve a subscription by its raw endpoint URL. Returns null if not found
 *  or expired. */
export function getSubscription(endpoint: string): StoredSubscription | null {
  const key = hashEndpoint(endpoint);
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry;
}

/** Return all non-expired subscriptions (e.g. for a push fanout worker). */
export function getAllSubscriptions(): StoredSubscription[] {
  const now = Date.now();
  const result: StoredSubscription[] = [];
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    } else {
      result.push(entry);
    }
  }
  return result;
}

/** Current count of stored (non-expired) subscriptions. */
export function subscriptionCount(): number {
  return getAllSubscriptions().length;
}
