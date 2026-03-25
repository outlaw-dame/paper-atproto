import { Hono } from 'hono';
import { z } from 'zod';
import { detectLanguage } from '../services/translation/detectLanguage.js';
import {
  getTranslationCache,
  setTranslationCache,
  translationCacheKey,
} from '../services/translation/cache.js';
import { translateWithRouter } from '../services/translation/runtime.js';
import type {
  BatchTranslateRequest,
  DetectLanguageRequest,
  InlineTranslateRequest,
  TranslationMode,
} from '../services/translation/types.js';

const InlineTranslateSchema = z.object({
  id: z.string().min(1),
  sourceText: z.string().min(1).max(10_000),
  sourceLang: z.string().optional(),
  targetLang: z.string().min(2).max(12),
  mode: z.enum(['server_default', 'server_optimized', 'local_private']),
});

const BatchTranslateSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    sourceText: z.string().min(1).max(10_000),
    sourceLang: z.string().optional(),
  })).max(30),
  targetLang: z.string().min(2).max(12),
  mode: z.enum(['server_default', 'server_optimized', 'local_private']),
  visibility: z.enum(['inline_post', 'thread_reply', 'story_synopsis', 'entity_snippet', 'writer_input']),
});

const DetectLanguageSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(10_000),
});

async function performInlineTranslation(req: InlineTranslateRequest) {
  const sourceLang = req.sourceLang ?? detectLanguage(req.sourceText).language;
  const cacheKey = translationCacheKey({
    id: req.id,
    sourceLang,
    targetLang: req.targetLang,
    modelVersion: 'route:auto',
    sourceText: req.sourceText,
  });
  const cached = getTranslationCache(cacheKey);
  if (cached) return { ...cached, cached: true };

  const result = await translateWithRouter({
    id: req.id,
    sourceText: req.sourceText,
    sourceLang,
    targetLang: req.targetLang,
    mode: req.mode,
    localOnlyMode: req.mode === 'local_private',
  });

  setTranslationCache(cacheKey, result);
  return result;
}

export const translateRouter = new Hono();

translateRouter.post('/inline', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = InlineTranslateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Invalid inline translation request', issues: parsed.error.issues }, 400);
  }

  const result = await performInlineTranslation({
    id: parsed.data.id,
    sourceText: parsed.data.sourceText,
    targetLang: parsed.data.targetLang,
    mode: parsed.data.mode,
    ...(parsed.data.sourceLang ? { sourceLang: parsed.data.sourceLang } : {}),
  });
  return c.json({ ok: true, result });
});

translateRouter.post('/batch', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = BatchTranslateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Invalid batch translation request', issues: parsed.error.issues }, 400);
  }

  const input = parsed.data as BatchTranslateRequest;
  const results = await Promise.all(
    input.items.map((item) => {
      const req: InlineTranslateRequest = {
        id: item.id,
        sourceText: item.sourceText,
        targetLang: input.targetLang,
        mode: input.mode as TranslationMode,
        ...(item.sourceLang ? { sourceLang: item.sourceLang } : {}),
      };
      return performInlineTranslation(req);
    }),
  );

  return c.json({ ok: true, results });
});

translateRouter.post('/detect', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = DetectLanguageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Invalid detect request', issues: parsed.error.issues }, 400);
  }

  const req = parsed.data as DetectLanguageRequest;
  const result = detectLanguage(req.text);
  return c.json({ ok: true, result });
});
