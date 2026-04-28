import { Hono } from 'hono';
import { z } from 'zod';
import { detectLanguage } from '../services/translation/detectLanguage.js';
import {
  getTranslationCache,
  setTranslationCache,
  translationCacheKey,
} from '../services/translation/cache.js';
import { translateBatchWithRouter, translateWithRouter } from '../services/translation/runtime.js';
import { resolveDynamicTranslationMode } from '../services/translation/policy.js';
import { AppError } from '../lib/errors.js';
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

async function performInlineTranslationWithFallback(req: InlineTranslateRequest) {
  const detectedSourceLang = req.sourceLang ?? detectLanguage(req.sourceText).language;
  try {
    return await performInlineTranslation({
      ...req,
      sourceLang: detectedSourceLang,
    });
  } catch {
    // Graceful fallback: keep original text to avoid breaking timeline/thread rendering.
    return {
      id: req.id,
      translatedText: req.sourceText,
      sourceLang: detectedSourceLang,
      targetLang: req.targetLang,
      provider: 'm2m100' as const,
      cached: false,
      modelVersion: 'fallback:identity',
      qualityTier: 'default' as const,
      runtimeProfile: req.mode === 'local_private'
        ? 'privacy' as const
        : req.mode === 'server_optimized'
          ? 'quality' as const
          : 'latency' as const,
    };
  }
}

export const translateRouter = new Hono();

translateRouter.post('/inline', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = InlineTranslateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Invalid inline translation request', issues: parsed.error.issues }, 400);
  }

  const result = await performInlineTranslationWithFallback({
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
  const preparedItems = input.items.map((item) => ({
    ...item,
    mode: resolveDynamicTranslationMode({
      requestedMode: input.mode as TranslationMode,
      visibility: input.visibility,
      sourceText: item.sourceText,
    }),
  }));

  const resolvedItems = preparedItems.map((item) => ({
    ...item,
    sourceLang: item.sourceLang ?? detectLanguage(item.sourceText).language,
  }));

  const cachedResults = new Map<string, ReturnType<typeof getTranslationCache>>();
  const uncachedItems: typeof resolvedItems = [];

  for (const item of resolvedItems) {
    const cacheKey = translationCacheKey({
      sourceLang: item.sourceLang,
      targetLang: input.targetLang,
      modelVersion: `route:auto:${item.mode}`,
      sourceText: item.sourceText,
    });
    const cached = getTranslationCache(cacheKey);
    if (cached) {
      cachedResults.set(item.id, {
        ...cached,
        cached: true,
      });
      continue;
    }
    uncachedItems.push(item);
  }

  const translatedBatch = uncachedItems.length > 0
    ? await translateBatchWithRouter({
        items: uncachedItems,
        targetLang: input.targetLang,
      })
    : [];

  translatedBatch.forEach((result, index) => {
    const sourceItem = uncachedItems[index];
    if (!sourceItem) return;
    const cacheKey = translationCacheKey({
      sourceLang: sourceItem.sourceLang,
      targetLang: input.targetLang,
      modelVersion: `route:auto:${sourceItem.mode}`,
      sourceText: sourceItem.sourceText,
    });
    setTranslationCache(cacheKey, result);
    cachedResults.set(sourceItem.id, result);
  });

  const results = input.items.map((item) => {
    const resolved = cachedResults.get(item.id);
    if (resolved) return resolved;

    const sourceLang = item.sourceLang ?? detectLanguage(item.sourceText).language;
    return {
      id: item.id,
      translatedText: item.sourceText,
      sourceLang,
      targetLang: input.targetLang,
      provider: 'm2m100' as const,
      cached: false,
      modelVersion: 'fallback:identity',
      qualityTier: 'default' as const,
      runtimeProfile: 'latency' as const,
    };
  });

  const profileCounts = results.reduce<Record<string, number>>((acc, result) => {
    const key = result.runtimeProfile ?? 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  console.info('[translation/batch][telemetry]', {
    count: results.length,
    targetLang: input.targetLang,
    visibility: input.visibility,
    providers: Array.from(new Set(results.map((result) => result.provider))),
    modelVersions: Array.from(new Set(results.map((result) => result.modelVersion))),
    profileCounts,
    at: new Date().toISOString(),
  });

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

translateRouter.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json({ ok: false, error: error.message }, error.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504);
  }

  // Route-level fail-safe to keep translation paths resilient.
  return c.json({ ok: false, error: 'Translation route failed' }, 500);
});
