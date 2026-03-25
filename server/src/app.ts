import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { verificationRouter } from './routes/verification.js';
import { llmRouter } from './routes/llm.js';
import { translateRouter } from './routes/translate.js';
import { simpleRateLimit } from './lib/rate-limit.js';

const app = new Hono();

// Allow requests from any origin on the local network (dev PWA accessed by IP)
app.use('*', cors({ origin: '*' }));

app.use('/api/verify/*', simpleRateLimit({ windowMs: 60_000, max: 60 }));
// LLM routes: tighter rate limit (model inference is expensive)
app.use('/api/llm/*', simpleRateLimit({ windowMs: 60_000, max: 20 }));
app.use('/api/translate/*', simpleRateLimit({ windowMs: 60_000, max: 120 }));
app.get('/health', (c) => c.json({ ok: true }));
app.route('/api/verify', verificationRouter);
app.route('/api/llm', llmRouter);
app.route('/api/translate', translateRouter);

export default app;
