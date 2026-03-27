import { Hono } from 'hono';
import { z } from 'zod';
import { ValidationError, AppError } from '../lib/errors.js';
import { isSafeHttpUrl } from '../lib/sanitize.js';
import { checkUrlAgainstSafeBrowsing } from '../services/safeBrowsing.js';

const UrlSafetyCheckSchema = z.object({
  url: z.string(),
});

export const safetyRouter = new Hono();

safetyRouter.post('/url-check', async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError('Invalid JSON body');
  });

  const parsed = UrlSafetyCheckSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid safety payload', parsed.error.flatten());
  }

  const url = parsed.data.url.trim();
  if (!isSafeHttpUrl(url)) {
    throw new ValidationError('url must be a valid http(s) URL');
  }

  const result = await checkUrlAgainstSafeBrowsing(url);
  return c.json({ ok: true, result });
});

safetyRouter.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as any);
  }

  return c.json(
    { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal safety check error' } },
    500,
  );
});
