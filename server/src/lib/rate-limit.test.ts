import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { env } from '../config/env.js';
import {
  __resetRateLimitStateForTests,
  simpleRateLimit,
  tokenBucketRateLimit,
} from './rate-limit.js';

const redisMockState = vi.hoisted(() => ({
  connectImpl: async () => undefined as unknown,
  evalImpl: async (..._args: unknown[]) => [1, 0] as unknown,
}));

vi.mock('ioredis', () => {
  class MockRedis {
    constructor(_url: string, _options: Record<string, unknown>) {}

    connect(): Promise<unknown> {
      return redisMockState.connectImpl();
    }

    eval(...args: unknown[]): Promise<unknown> {
      return redisMockState.evalImpl(args);
    }
  }

  return { default: MockRedis };
});

function buildAppWithSimpleLimit(max = 1): Hono {
  const app = new Hono();
  app.use('*', simpleRateLimit({ windowMs: 60_000, max, keyFn: () => 'fixed-key' }));
  app.get('/test', (c) => c.json({ ok: true }));
  app.onError((error, c) => {
    const status = ((error as { status?: number }).status ?? 500) as never;
    return c.json({
      code: (error as { code?: string }).code,
      details: (error as { details?: unknown }).details,
    }, status);
  });
  return app;
}

function buildAppWithDefaultSimpleLimit(max = 1): Hono {
  const app = new Hono();
  app.use('*', simpleRateLimit({ windowMs: 60_000, max }));
  app.get('/test', (c) => c.json({ ok: true }));
  app.onError((error, c) => {
    const status = ((error as { status?: number }).status ?? 500) as never;
    return c.json({
      code: (error as { code?: string }).code,
      details: (error as { details?: unknown }).details,
    }, status);
  });
  return app;
}

beforeEach(() => {
  __resetRateLimitStateForTests();
  env.NODE_ENV = 'test';
  env.RATE_LIMIT_REDIS_URL = undefined;
  env.RATE_LIMIT_REDIS_PREFIX = 'paper:ratelimit:test';
  env.RATE_LIMIT_REDIS_FAIL_CLOSED = false;
  env.RATE_LIMIT_TRUST_PROXY = false;
  env.RATE_LIMIT_TRUSTED_IP_HEADER = 'cf-connecting-ip';
  redisMockState.connectImpl = async () => undefined;
  redisMockState.evalImpl = async (..._args: unknown[]) => [1, 0] as unknown;
});

function buildAppWithTokenLimit(): Hono {
  const app = new Hono();
  app.use('*', tokenBucketRateLimit({
    refillWindowMs: 60_000,
    refillTokens: 1,
    burstCapacity: 1,
    keyFn: () => 'fixed-key',
  }));
  app.get('/test', (c) => c.json({ ok: true }));
  app.onError((error, c) => {
    const status = ((error as { status?: number }).status ?? 500) as never;
    return c.json({
      code: (error as { code?: string }).code,
      details: (error as { details?: unknown }).details,
    }, status);
  });
  return app;
}

describe('rate-limit middleware', () => {
  it('adds retryAfterMs metadata for fixed-window limits', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-04-02T00:00:00.000Z'));
      const app = buildAppWithSimpleLimit(1);

      const first = await app.request('/test');
      const second = await app.request('/test');

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);

      const body = await second.json() as { details?: { retryAfterMs?: number } };
      expect(typeof body.details?.retryAfterMs).toBe('number');
      expect((body.details?.retryAfterMs ?? 0) > 0).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds retryAfterMs metadata for token-bucket limits', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-04-02T00:00:00.000Z'));
      const app = buildAppWithTokenLimit();

      const first = await app.request('/test');
      const second = await app.request('/test');

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);

      const body = await second.json() as { details?: { retryAfterMs?: number } };
      expect(typeof body.details?.retryAfterMs).toBe('number');
      expect((body.details?.retryAfterMs ?? 0) > 0).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

    it('falls back to in-memory limits when Redis is unavailable and fail-closed is disabled', async () => {
      env.RATE_LIMIT_REDIS_URL = 'redis://127.0.0.1:6379';
      env.RATE_LIMIT_REDIS_FAIL_CLOSED = false;
      redisMockState.evalImpl = async () => {
        throw new Error('redis unavailable');
      };

      const app = buildAppWithSimpleLimit(1);
      const first = await app.request('/test');
      const second = await app.request('/test');

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
    });

    it('fails closed when Redis is unavailable and strict mode is enabled', async () => {
      env.RATE_LIMIT_REDIS_URL = 'redis://127.0.0.1:6379';
      env.RATE_LIMIT_REDIS_FAIL_CLOSED = true;
      redisMockState.evalImpl = async () => {
        throw new Error('redis unavailable');
      };

      const app = buildAppWithSimpleLimit(10);
      const response = await app.request('/test');

      expect(response.status).toBe(503);
      const body = await response.json() as { code?: string };
      expect(body.code).toBe('RATE_LIMIT_BACKEND_UNAVAILABLE');
    });

    it('does not trust proxy headers unless explicitly enabled', async () => {
      env.RATE_LIMIT_TRUST_PROXY = false;
      env.RATE_LIMIT_TRUSTED_IP_HEADER = 'x-forwarded-for';

      const app = buildAppWithDefaultSimpleLimit(1);
      const first = await app.request('/test', { headers: { 'x-forwarded-for': '203.0.113.1' } });
      const second = await app.request('/test', { headers: { 'x-forwarded-for': '198.51.100.9' } });

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
    });

    it('uses configured trusted proxy header when enabled', async () => {
      env.RATE_LIMIT_TRUST_PROXY = true;
      env.RATE_LIMIT_TRUSTED_IP_HEADER = 'x-forwarded-for';

      const app = buildAppWithDefaultSimpleLimit(1);
      const first = await app.request('/test', { headers: { 'x-forwarded-for': '203.0.113.1' } });
      const second = await app.request('/test', { headers: { 'x-forwarded-for': '198.51.100.9' } });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    });

    it('rejects insecure Redis URLs in production strict mode', async () => {
      env.NODE_ENV = 'production';
      env.RATE_LIMIT_REDIS_URL = 'redis://127.0.0.1:6379';
      env.RATE_LIMIT_REDIS_FAIL_CLOSED = true;

      const app = buildAppWithSimpleLimit(10);
      const response = await app.request('/test');

      expect(response.status).toBe(503);
      const body = await response.json() as { code?: string };
      expect(body.code).toBe('RATE_LIMIT_BACKEND_UNAVAILABLE');
    });
});