import type { Context, MiddlewareHandler } from 'hono';
import { RateLimitError } from './errors.js';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function simpleRateLimit(options?: {
  windowMs?: number;
  max?: number;
  keyFn?: (c: Context) => string;
}): MiddlewareHandler {
  const windowMs = options?.windowMs ?? 60_000;
  const max = options?.max ?? 60;
  const keyFn =
    options?.keyFn ??
    ((c: Context) =>
      c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? 'unknown');

  return async (c, next) => {
    const key = keyFn(c);
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (existing.count >= max) throw new RateLimitError();

    existing.count += 1;
    buckets.set(key, existing);
    return next();
  };
}
