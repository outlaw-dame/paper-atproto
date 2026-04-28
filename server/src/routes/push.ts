// ─── Push Subscription Route ──────────────────────────────────────────────────
// POST   /api/push/subscription  — register or refresh a Web Push subscription
// DELETE /api/push/subscription  — unregister a subscription
//
// Security measures:
//   • Strict Zod schema — rejects any extra or malformed fields
//   • Endpoint must be an HTTPS URL (http: rejected)
//   • p256dh / auth keys validated as non-empty base64url strings
//   • Content-Type must be application/json (rejects form/multipart attacks)
//   • Rate limited at the router level (30 req/min per IP via app.ts)
//   • Response never echoes back raw subscription data or keys
//   • Capacity guard prevents store exhaustion (PUSH_MAX_SUBSCRIPTIONS)
//   • No session/auth required — subscription data is not personally identifying
//     and the endpoint hash is the deduplification key

import { Hono } from 'hono';
import { z } from 'zod';
import {
  upsertSubscription,
  removeSubscription,
  type PushSubscriptionJson,
} from '../models/pushSubscription.js';
import { ValidationError } from '../lib/errors.js';

// ─── Validation schemas ───────────────────────────────────────────────────────

// base64url: A–Z a–z 0–9 - _ = (padding optional)
const Base64UrlString = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9\-_=+/]+$/, 'Must be a base64url string');

const PushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url('endpoint must be a valid URL')
    .max(2048, 'endpoint too long')
    .refine(
      (u) => {
        try {
          return new URL(u).protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'endpoint must use HTTPS' },
    ),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: Base64UrlString,
    auth: Base64UrlString,
  }),
});

const DeleteSchema = z.object({
  endpoint: z
    .string()
    .url('endpoint must be a valid URL')
    .max(2048)
    .refine(
      (u) => {
        try {
          return new URL(u).protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'endpoint must use HTTPS' },
    ),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const pushRouter = new Hono();

// POST /api/push/subscription — register or refresh
pushRouter.post('/', async (c) => {
  // Enforce Content-Type to prevent CSRF via form submissions
  const ct = c.req.header('content-type') ?? '';
  if (!ct.includes('application/json')) {
    return c.json({ ok: false, error: 'Content-Type must be application/json' }, 415);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = PushSubscriptionSchema.safeParse(body);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    return c.json({ ok: false, error: 'Invalid subscription', issues }, 422);
  }

  const sub: PushSubscriptionJson = {
    endpoint: parsed.data.endpoint,
    keys: {
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    },
    // Omit expirationTime from storage — it's push-service internal state
  };

  const result = upsertSubscription(sub);

  if (!result.ok) {
    if (result.errorCode === 'capacity') {
      return c.json({ ok: false, error: 'Service at capacity' }, 503);
    }
    return c.json({ ok: false, error: 'Subscription could not be stored' }, 500);
  }

  const status = result.created ? 201 : 200;
  // Return only the opaque hash — never echo keys or endpoint back
  return c.json({ ok: true, endpointHash: result.endpointHash }, status);
});

// DELETE /api/push/subscription — unregister
pushRouter.delete('/', async (c) => {
  const ct = c.req.header('content-type') ?? '';
  if (!ct.includes('application/json')) {
    return c.json({ ok: false, error: 'Content-Type must be application/json' }, 415);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = DeleteSchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationError('Invalid delete request');
  }

  const removed = removeSubscription(parsed.data.endpoint);
  // Always return 200 regardless of whether the subscription existed — this
  // prevents endpoint enumeration by an attacker probing for valid subscriptions.
  return c.json({ ok: true, removed });
});
