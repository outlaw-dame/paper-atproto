import { Hono } from 'hono';
import { verificationRouter } from './routes/verification.js';
import { simpleRateLimit } from './lib/rate-limit.js';

const app = new Hono();

app.use('/api/verify/*', simpleRateLimit({ windowMs: 60_000, max: 60 }));
app.get('/health', (c) => c.json({ ok: true }));
app.route('/api/verify', verificationRouter);

export default app;
