import { Hono } from 'hono';
import { z } from 'zod';
import { verifyEvidence } from '../verification/verify-evidence.js';
import { ValidationError, UnauthorizedError, AppError } from '../lib/errors.js';
import { requireNonEmptyText, sanitizeText, sanitizeUrls } from '../lib/sanitize.js';
import { env } from '../config/env.js';

const VerifyRequestSchema = z.object({
  postUri: z.string().optional(),
  text: z.string(),
  urls: z.array(z.string()).optional(),
  imageUrls: z.array(z.string()).optional(),
  languageCode: z.string().optional(),
  topicHints: z.array(z.string()).optional(),
});

export const verificationRouter = new Hono();

verificationRouter.post('/evidence', async (c) => {
  if (env.VERIFY_SHARED_SECRET) {
    const presented = c.req.header('x-verify-shared-secret');
    if (presented !== env.VERIFY_SHARED_SECRET) throw new UnauthorizedError();
  }

  const body = await c.req.json().catch(() => { throw new ValidationError('Invalid JSON body'); });

  const parsed = VerifyRequestSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError('Invalid verification payload', parsed.error.flatten());

  const input = parsed.data;
  const result = await verifyEvidence({
    ...(input.postUri !== undefined ? { postUri: input.postUri } : {}),
    text: requireNonEmptyText(input.text),
    urls: sanitizeUrls(input.urls),
    imageUrls: sanitizeUrls(input.imageUrls),
    ...(input.languageCode !== undefined ? { languageCode: input.languageCode } : {}),
    topicHints: (input.topicHints ?? []).map(sanitizeText).filter(Boolean).slice(0, 10),
  });

  return c.json({ ok: true, result });
});

verificationRouter.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as any);
  }
  return c.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal verification error' } }, 500);
});
