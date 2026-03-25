import { Hono } from 'hono';
import { verificationRouter } from './routes/verification.js';
import { llmRouter } from './routes/llm.js';
import { simpleRateLimit } from './lib/rate-limit.js';

const app = new Hono();

app.use('/api/verify/*', simpleRateLimit({ windowMs: 60_000, max: 60 }));
// LLM routes: tighter rate limit (model inference is expensive)
app.use('/api/llm/*', simpleRateLimit({ windowMs: 60_000, max: 20 }));
app.get('/health', (c) => c.json({ ok: true }));
app.route('/api/verify', verificationRouter);
app.route('/api/llm', llmRouter);

export default app;
