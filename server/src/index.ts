import 'dotenv/config';
import { serve } from '@hono/node-server';
import app from './app.js';
import { env } from './config/env.js';
import { verifyOllamaStartupHealth } from './lib/ollama-policy.js';

async function startServer(): Promise<void> {
  await verifyOllamaStartupHealth();

  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`[verify-server] listening on http://localhost:${info.port}`);
  });
}

startServer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[verify-server] startup failed:', message);
  process.exit(1);
});
