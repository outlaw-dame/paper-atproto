import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { Context, MiddlewareHandler } from 'hono';
import { env } from '../config/env.js';
import { AppError, RateLimitError } from './errors.js';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
type TokenBucket = {
  tokens: number;
  lastRefillAt: number;
};
const tokenBuckets = new Map<string, TokenBucket>();
const REDIS_BACKEND_COOLDOWN_MS = 30_000;

type FixedWindowResult = {
  allowed: boolean;
  retryAfterMs: number;
};

type TokenBucketResult = {
  allowed: boolean;
  retryAfterMs: number;
};

type RateLimitBackend = {
  consumeFixedWindow: (input: {
    key: string;
    now: number;
    windowMs: number;
    max: number;
  }) => Promise<FixedWindowResult>;
  consumeTokenBucket: (input: {
    key: string;
    now: number;
    refillWindowMs: number;
    refillTokens: number;
    burstCapacity: number;
  }) => Promise<TokenBucketResult>;
};

type RedisLikeClient = {
  connect: () => Promise<unknown>;
  eval: (script: string, numKeys: number, ...args: string[]) => Promise<unknown>;
};

const MAX_TRACKED_KEYS = 20_000;
const TOKEN_BUCKET_STALE_MS = 15 * 60_000;
const MAX_RAW_RATE_LIMIT_KEY_BYTES = 1024;
const GLOBAL_RATE_LIMIT_KEY = 'global';
let redisBackendCooldownUntil = 0;
let redisBackendInitFailed = false;

const REDIS_FIXED_WINDOW_SCRIPT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])

local count = redis.call('INCR', key)
if count == 1 then
  redis.call('PEXPIRE', key, windowMs)
end

local ttl = redis.call('PTTL', key)
if ttl < 0 then
  ttl = windowMs
end

if count > max then
  return {0, ttl}
end

return {1, ttl}
`;

const REDIS_TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local burst = tonumber(ARGV[1])
local refillTokens = tonumber(ARGV[2])
local refillWindowMs = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'lastRefillAt')
local storedTokens = tonumber(data[1])
local lastRefillAt = tonumber(data[2])

if storedTokens == nil then
  storedTokens = burst
end
if lastRefillAt == nil then
  lastRefillAt = now
end

local elapsed = now - lastRefillAt
if elapsed < 0 then
  elapsed = 0
end

local tokensPerMs = refillTokens / refillWindowMs
local available = storedTokens + (elapsed * tokensPerMs)
if available > burst then
  available = burst
end

local ttl = refillWindowMs * 2
if available < 1 then
  redis.call('HMSET', key, 'tokens', available, 'lastRefillAt', now)
  redis.call('PEXPIRE', key, ttl)
  local deficit = 1 - available
  local retryAfterMs = refillWindowMs
  if tokensPerMs > 0 then
    retryAfterMs = math.ceil(deficit / tokensPerMs)
  end
  return {0, retryAfterMs}
end

local remaining = available - 1
redis.call('HMSET', key, 'tokens', remaining, 'lastRefillAt', now)
redis.call('PEXPIRE', key, ttl)
return {1, 0}
`;

class MemoryRateLimitBackend implements RateLimitBackend {
  async consumeFixedWindow(input: {
    key: string;
    now: number;
    windowMs: number;
    max: number;
  }): Promise<FixedWindowResult> {
    pruneSimpleBuckets(input.now);
    const existing = buckets.get(input.key);

    if (!existing || existing.resetAt <= input.now) {
      buckets.set(input.key, { count: 1, resetAt: input.now + input.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (existing.count >= input.max) {
      return {
        allowed: false,
        retryAfterMs: Math.max(0, existing.resetAt - input.now),
      };
    }

    existing.count += 1;
    buckets.set(input.key, existing);
    return { allowed: true, retryAfterMs: 0 };
  }

  async consumeTokenBucket(input: {
    key: string;
    now: number;
    refillWindowMs: number;
    refillTokens: number;
    burstCapacity: number;
  }): Promise<TokenBucketResult> {
    pruneTokenBuckets(input.now);
    const current = tokenBuckets.get(input.key) ?? {
      tokens: input.burstCapacity,
      lastRefillAt: input.now,
    };

    const tokensPerMs = input.refillTokens / input.refillWindowMs;
    const elapsedMs = Math.max(0, input.now - current.lastRefillAt);
    const refilledTokens = elapsedMs * tokensPerMs;
    const availableTokens = Math.min(input.burstCapacity, current.tokens + refilledTokens);

    if (availableTokens < 1) {
      tokenBuckets.set(input.key, {
        tokens: availableTokens,
        lastRefillAt: input.now,
      });
      const deficit = Math.max(0, 1 - availableTokens);
      const retryAfterMs = tokensPerMs > 0
        ? Math.ceil(deficit / tokensPerMs)
        : input.refillWindowMs;
      return { allowed: false, retryAfterMs };
    }

    tokenBuckets.set(input.key, {
      tokens: availableTokens - 1,
      lastRefillAt: input.now,
    });

    return { allowed: true, retryAfterMs: 0 };
  }
}

class RedisRateLimitBackend implements RateLimitBackend {
  private redis: RedisLikeClient | null = null;
  private readonly redisUrl: string;
  private readonly prefix: string;

  constructor(redisUrl: string, prefix: string) {
    this.redisUrl = redisUrl;
    this.prefix = prefix;
  }

  private async getClient(): Promise<RedisLikeClient> {
    if (this.redis) return this.redis;

    const module = await import('ioredis');
    const RedisCtor = (module as unknown as {
      default?: new (url: string, options: Record<string, unknown>) => RedisLikeClient;
    }).default
      ?? (module as unknown as new (
        url: string,
        options: Record<string, unknown>,
      ) => RedisLikeClient);

    this.redis = new RedisCtor(this.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableAutoPipelining: true,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
    });
    return this.redis;
  }

  private key(space: 'simple' | 'bucket', key: string): string {
    return `${this.prefix}:${space}:${key}`;
  }

  async consumeFixedWindow(input: {
    key: string;
    now: number;
    windowMs: number;
    max: number;
  }): Promise<FixedWindowResult> {
    const redis = await this.getClient();
    await redis.connect().catch(() => undefined);
    const result = await redis.eval(
      REDIS_FIXED_WINDOW_SCRIPT,
      1,
      this.key('simple', input.key),
      String(input.max),
      String(input.windowMs),
    ) as [number, number] | null;

    const allowed = Array.isArray(result) && Number(result[0]) === 1;
    const retryAfterMs = Array.isArray(result) ? Math.max(0, Number(result[1]) || 0) : input.windowMs;
    return { allowed, retryAfterMs };
  }

  async consumeTokenBucket(input: {
    key: string;
    now: number;
    refillWindowMs: number;
    refillTokens: number;
    burstCapacity: number;
  }): Promise<TokenBucketResult> {
    const redis = await this.getClient();
    await redis.connect().catch(() => undefined);
    const result = await redis.eval(
      REDIS_TOKEN_BUCKET_SCRIPT,
      1,
      this.key('bucket', input.key),
      String(input.burstCapacity),
      String(input.refillTokens),
      String(input.refillWindowMs),
      String(input.now),
    ) as [number, number] | null;

    const allowed = Array.isArray(result) && Number(result[0]) === 1;
    const retryAfterMs = Array.isArray(result) ? Math.max(0, Number(result[1]) || 0) : input.refillWindowMs;
    return { allowed, retryAfterMs };
  }
}

const memoryBackend = new MemoryRateLimitBackend();
let redisBackend: RedisRateLimitBackend | null = null;

function getBackend(): RateLimitBackend {
  if (!env.RATE_LIMIT_REDIS_URL) return memoryBackend;
  if (Date.now() < redisBackendCooldownUntil) return memoryBackend;
  if (redisBackendInitFailed) return memoryBackend;
  if (!isRedisConfigurationSecure(env.RATE_LIMIT_REDIS_URL)) {
    redisBackendInitFailed = true;
    return memoryBackend;
  }
  if (!redisBackend) {
    try {
      redisBackend = new RedisRateLimitBackend(env.RATE_LIMIT_REDIS_URL, env.RATE_LIMIT_REDIS_PREFIX);
    } catch {
      redisBackendInitFailed = true;
      return memoryBackend;
    }
  }
  return redisBackend;
}

function markRedisBackendFailure(): void {
  redisBackendCooldownUntil = Date.now() + REDIS_BACKEND_COOLDOWN_MS;
}

function isRedisConfigurationSecure(redisUrl: string): boolean {
  if (env.NODE_ENV !== 'production') return true;
  try {
    const parsed = new URL(redisUrl);
    if (parsed.protocol !== 'rediss:') return false;
    if (!parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}

function resolveTrustedClientIp(c: Context): string | null {
  if (!env.RATE_LIMIT_TRUST_PROXY) return null;

  const trustedHeader = env.RATE_LIMIT_TRUSTED_IP_HEADER.trim().toLowerCase();
  if (!trustedHeader) return null;

  const raw = c.req.header(trustedHeader);
  if (!raw) return null;

  const candidate = trustedHeader === 'x-forwarded-for'
    ? raw.split(',')[0]?.trim()
    : raw.trim();

  if (!candidate) return null;

  const bracketMatch = candidate.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketMatch?.[1] && isIP(bracketMatch[1])) {
    return bracketMatch[1];
  }

  if (isIP(candidate)) {
    return candidate;
  }

  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
  if (ipv4WithPort?.[1] && isIP(ipv4WithPort[1])) {
    return ipv4WithPort[1];
  }

  return null;
}

function normalizeRateLimitKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (!trimmed) return GLOBAL_RATE_LIMIT_KEY;

  const bounded = Buffer.from(trimmed, 'utf8').subarray(0, MAX_RAW_RATE_LIMIT_KEY_BYTES).toString('utf8');
  if (!bounded) return GLOBAL_RATE_LIMIT_KEY;

  return createHash('sha256').update(bounded).digest('hex').slice(0, 32);
}

function isStrictRedisFailClosedEnabled(): boolean {
  return Boolean(env.RATE_LIMIT_REDIS_URL) && env.RATE_LIMIT_REDIS_FAIL_CLOSED;
}

function getLimiterKey(c: Context, keyFn: (c: Context) => string): string {
  const custom = keyFn(c);
  return normalizeRateLimitKey(custom);
}

function createRateLimiterBackendUnavailableError(): AppError {
  return new AppError(
    503,
    'RATE_LIMIT_BACKEND_UNAVAILABLE',
    'Rate limiting backend unavailable',
  );
}

export function __resetRateLimitStateForTests(): void {
  buckets.clear();
  tokenBuckets.clear();
  redisBackend = null;
  redisBackendCooldownUntil = 0;
  redisBackendInitFailed = false;
}

function enforceMapBound<T>(map: Map<string, T>): void {
  while (map.size > MAX_TRACKED_KEYS) {
    const oldestKey = map.keys().next().value;
    if (!oldestKey) break;
    map.delete(oldestKey);
  }
}

function pruneSimpleBuckets(now: number): void {
  for (const [key, entry] of buckets.entries()) {
    if (entry.resetAt <= now) {
      buckets.delete(key);
    }
  }
  enforceMapBound(buckets);
}

function pruneTokenBuckets(now: number): void {
  for (const [key, entry] of tokenBuckets.entries()) {
    if (now - entry.lastRefillAt > TOKEN_BUCKET_STALE_MS) {
      tokenBuckets.delete(key);
    }
  }
  enforceMapBound(tokenBuckets);
}

export function simpleRateLimit(options?: {
  windowMs?: number;
  max?: number;
  keyFn?: (c: Context) => string;
}): MiddlewareHandler {
  const windowMs = options?.windowMs ?? 60_000;
  const max = options?.max ?? 60;
  const keyFn =
    options?.keyFn ??
      ((c: Context) => resolveTrustedClientIp(c) ?? GLOBAL_RATE_LIMIT_KEY);

  return async (c, next) => {
      const key = getLimiterKey(c, keyFn);
    const now = Date.now();
    const backend = getBackend();
      const strictRedisFailClosed = isStrictRedisFailClosedEnabled();

      if (strictRedisFailClosed && backend === memoryBackend) {
        throw createRateLimiterBackendUnavailableError();
      }

    let result: FixedWindowResult;
    try {
      result = await backend.consumeFixedWindow({ key, now, windowMs, max });
    } catch {
      markRedisBackendFailure();
        if (strictRedisFailClosed) {
          throw createRateLimiterBackendUnavailableError();
        }
      result = await memoryBackend.consumeFixedWindow({ key, now, windowMs, max });
    }

    if (!result.allowed) {
      throw new RateLimitError('Rate limit exceeded', result.retryAfterMs);
    }

    return next();
  };
}

export function tokenBucketRateLimit(options?: {
  refillWindowMs?: number;
  refillTokens?: number;
  burstCapacity?: number;
  keyFn?: (c: Context) => string;
}): MiddlewareHandler {
  const refillWindowMs = options?.refillWindowMs ?? 60_000;
  const refillTokens = options?.refillTokens ?? 60;
  const burstCapacity = options?.burstCapacity ?? refillTokens;
  const keyFn =
    options?.keyFn
      ?? ((c: Context) => resolveTrustedClientIp(c) ?? GLOBAL_RATE_LIMIT_KEY);

  const tokensPerMs = refillTokens / refillWindowMs;

  return async (c, next) => {
      const key = getLimiterKey(c, keyFn);
    const now = Date.now();
    const backend = getBackend();
      const strictRedisFailClosed = isStrictRedisFailClosedEnabled();

      if (strictRedisFailClosed && backend === memoryBackend) {
        throw createRateLimiterBackendUnavailableError();
      }

    let result: TokenBucketResult;
    try {
      result = await backend.consumeTokenBucket({
        key,
        now,
        refillWindowMs,
        refillTokens,
        burstCapacity,
      });
    } catch {
      markRedisBackendFailure();
        if (strictRedisFailClosed) {
          throw createRateLimiterBackendUnavailableError();
        }
      result = await memoryBackend.consumeTokenBucket({
        key,
        now,
        refillWindowMs,
        refillTokens,
        burstCapacity,
      });
    }

    if (!result.allowed) {
      const retryAfterMs = tokensPerMs > 0
        ? result.retryAfterMs
        : refillWindowMs;
      throw new RateLimitError('Rate limit exceeded', retryAfterMs);
    }

    return next();
  };
}
