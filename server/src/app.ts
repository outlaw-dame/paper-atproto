import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { verificationRouter } from './routes/verification.js';
import { llmRouter } from './routes/llm.js';
import { translateRouter } from './routes/translate.js';
import { podcastIndexRouter } from './routes/podcastIndex.js';
import { safetyRouter } from './routes/safety.js';
import { pushRouter } from './routes/push.js';
import { premiumAiRouter } from './routes/premiumAi.js';
import { simpleRateLimit } from './lib/rate-limit.js';
import { compressionMiddleware } from './lib/compression.js';

const app = new Hono();

// Allow requests from any origin on the local network (dev PWA accessed by IP)
app.use('*', cors({ origin: '*' }));
app.use('*', compressionMiddleware());

app.use('/api/verify/*', simpleRateLimit({ windowMs: 60_000, max: 60 }));
// LLM routes: tighter rate limit (model inference is expensive)
app.use('/api/llm/*', simpleRateLimit({ windowMs: 60_000, max: 20 }));
app.use('/api/translate/*', simpleRateLimit({ windowMs: 60_000, max: 120 }));
app.use('/api/podcastindex/*', simpleRateLimit({ windowMs: 60_000, max: 60 }));
app.use('/api/safety/*', simpleRateLimit({ windowMs: 60_000, max: 120 }));
app.use('/api/premium-ai/*', simpleRateLimit({ windowMs: 60_000, max: 10 }));
// Push subscription endpoint: 30 writes/min per IP — enough for normal churn,
// tight enough to prevent endpoint flooding.
app.use('/api/push/*', simpleRateLimit({ windowMs: 60_000, max: 30 }));
app.get('/health', (c) => c.json({ ok: true }));
app.route('/api/verify', verificationRouter);
app.route('/api/llm', llmRouter);
app.route('/api/translate', translateRouter);
app.route('/api/podcastindex', podcastIndexRouter);
app.route('/api/safety', safetyRouter);
app.route('/api/premium-ai', premiumAiRouter);
app.route('/api/push/subscription', pushRouter);

export default app;
