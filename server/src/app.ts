import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { verificationRouter } from './routes/verification.js';
import { llmRouter } from './routes/llm.js';
import { composerClassifierRouter } from './routes/composerClassifier.js';
import { translateRouter } from './routes/translate.js';
import { mediaRouter } from './routes/media.js';
import { podcastIndexRouter } from './routes/podcastIndex.js';
import { safetyRouter } from './routes/safety.js';
import { pushRouter } from './routes/push.js';
import { premiumAiRouter } from './routes/premiumAi.js';
import { aiSessionsRouter } from './routes/aiSessions.js';
import { conversationWatchRouter } from './routes/conversationWatch.js';
import { simpleRateLimit, tokenBucketRateLimit } from './lib/rate-limit.js';
import { AppError, RateLimitError } from './lib/errors.js';
import { compressionMiddleware } from './lib/compression.js';
import {
  API_CORS_ALLOW_HEADERS,
  API_CORS_ALLOW_METHODS,
  resolveCorsOrigin,
} from './lib/originPolicy.js';

const app = new Hono();

app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()');
  await next();
});

app.use('/api/*', cors({
  origin: resolveCorsOrigin,
  allowMethods: [...API_CORS_ALLOW_METHODS],
  allowHeaders: [...API_CORS_ALLOW_HEADERS],
  maxAge: 600,
}));
app.use('*', compressionMiddleware());

app.use('/api/verify/*', simpleRateLimit({ windowMs: 60_000, max: 60 }));
// LLM routes: per-endpoint token buckets to preserve bursts while bounding sustained load.
app.use('/api/llm/write/interpolator', tokenBucketRateLimit({ refillWindowMs: 60_000, refillTokens: 24, burstCapacity: 12 }));
app.use('/api/llm/analyze/media', tokenBucketRateLimit({ refillWindowMs: 60_000, refillTokens: 12, burstCapacity: 6 }));
app.use('/api/llm/analyze/composer-classifier', tokenBucketRateLimit({ refillWindowMs: 60_000, refillTokens: 90, burstCapacity: 30 }));
app.use('/api/llm/write/search-story', tokenBucketRateLimit({ refillWindowMs: 60_000, refillTokens: 18, burstCapacity: 9 }));
app.use('/api/llm/write/composer-guidance', tokenBucketRateLimit({ refillWindowMs: 60_000, refillTokens: 30, burstCapacity: 15 }));
// Backstop for any future /api/llm route without explicit policy.
app.use('/api/llm/*', simpleRateLimit({ windowMs: 60_000, max: 40 }));
app.use('/api/translate/*', simpleRateLimit({ windowMs: 60_000, max: 120 }));
app.use('/api/media/*', simpleRateLimit({ windowMs: 60_000, max: 30 }));
app.use('/api/podcastindex/*', simpleRateLimit({ windowMs: 60_000, max: 60 }));
app.use('/api/safety/*', simpleRateLimit({ windowMs: 60_000, max: 120 }));
app.use('/api/premium-ai/*', simpleRateLimit({ windowMs: 60_000, max: 10 }));
app.use('/api/ai/sessions/*', simpleRateLimit({ windowMs: 60_000, max: 90 }));
app.use('/api/conversation/watch', tokenBucketRateLimit({ refillWindowMs: 60_000, refillTokens: 18, burstCapacity: 6 }));
// Push subscription endpoint: 30 writes/min per IP — enough for normal churn,
// tight enough to prevent endpoint flooding.
app.use('/api/push/*', simpleRateLimit({ windowMs: 60_000, max: 30 }));
app.get('/health', (c) => c.json({ ok: true }));
app.route('/api/verify', verificationRouter);
app.route('/api/llm/analyze/composer-classifier', composerClassifierRouter);
app.route('/api/llm', llmRouter);
app.route('/api/translate', translateRouter);
app.route('/api/media', mediaRouter);
app.route('/api/podcastindex', podcastIndexRouter);
app.route('/api/safety', safetyRouter);
app.route('/api/premium-ai', premiumAiRouter);
app.route('/api/ai/sessions', aiSessionsRouter);
app.route('/api/conversation', conversationWatchRouter);
app.route('/api/push/subscription', pushRouter);

app.onError((error, c) => {
  if (error instanceof RateLimitError) {
    const retryAfterMs = (error.details as { retryAfterMs?: unknown } | undefined)?.retryAfterMs;
    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)) {
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      c.header('Retry-After', String(retryAfterSeconds));
    }
  }

  if (error instanceof AppError) {
    return c.json({ error: error.message, code: error.code }, error.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504);
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error('[app/onError]', message);
  return c.json({ error: 'Server error' }, 500);
});

export default app;
