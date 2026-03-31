import { Hono } from 'hono';
import { z } from 'zod';
import { resolvePremiumAiEntitlements } from '../entitlements/resolveAiEntitlements.js';
import { writePremiumDeepInterpolator } from '../ai/providerRouter.js';
import type { PremiumInterpolatorRequest } from '../ai/providers/geminiConversation.provider.js';
import {
  filterPremiumDeepInterpolatorResponse,
  logSafetyFlag,
} from '../services/safetyFilters.js';

export const premiumAiRouter = new Hono();

const ConfidenceSchema = z.object({
  surfaceConfidence: z.number().min(0).max(1),
  entityConfidence: z.number().min(0).max(1),
  interpretiveConfidence: z.number().min(0).max(1),
});

const WriterEntitySchema = z.object({
  id: z.string(),
  label: z.string().max(120),
  type: z.string(),
  confidence: z.number().min(0).max(1),
  impact: z.number().min(0).max(1),
});

const WriterCommentSchema = z.object({
  uri: z.string(),
  handle: z.string().max(100),
  displayName: z.string().max(120).optional(),
  text: z.string().max(300),
  impactScore: z.number().min(0).max(1),
  role: z.string().optional(),
  liked: z.number().int().optional(),
  replied: z.number().int().optional(),
});

const WriterContributorSchema = z.object({
  did: z.string().optional(),
  handle: z.string().max(100),
  role: z.string(),
  impactScore: z.number().min(0).max(1),
  stanceSummary: z.string().max(200),
});

const PremiumInterpolatorSchema = z.object({
  actorDid: z.string().min(1).max(200),
  threadId: z.string().max(300),
  summaryMode: z.enum(['normal', 'descriptive_fallback', 'minimal_fallback']),
  confidence: ConfidenceSchema,
  visibleReplyCount: z.number().int().min(0).max(5000).optional(),
  rootPost: z.object({
    uri: z.string(),
    handle: z.string().max(100),
    displayName: z.string().max(120).optional(),
    text: z.string().max(600),
    createdAt: z.string(),
  }),
  selectedComments: z.array(WriterCommentSchema).max(12),
  topContributors: z.array(WriterContributorSchema).max(6),
  safeEntities: z.array(WriterEntitySchema).max(10),
  factualHighlights: z.array(z.string().max(200)).max(6),
  whatChangedSignals: z.array(z.string().max(150)).max(8),
  interpretiveBrief: z.object({
    summaryMode: z.enum(['normal', 'descriptive_fallback', 'minimal_fallback']),
    baseSummary: z.string().max(400).optional(),
    dominantTone: z.string().max(80).optional(),
    conversationPhase: z.string().max(80).optional(),
    supports: z.array(z.string().max(160)).max(6),
    limits: z.array(z.string().max(160)).max(6),
  }),
});

function actorDidFromRequest(c: any): string | undefined {
  const value = c.req.header('X-Glympse-User-Did');
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

premiumAiRouter.get('/entitlements', (c) => {
  const actorDid = actorDidFromRequest(c);
  return c.json(resolvePremiumAiEntitlements(actorDid));
});

premiumAiRouter.post('/interpolator/deep', async (c) => {
  const actorDid = actorDidFromRequest(c);
  const entitlements = resolvePremiumAiEntitlements(actorDid);

  if (!entitlements.capabilities.includes('deep_interpolator')) {
    return c.json({ error: 'Premium deep interpolator is not available for this user' }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = PremiumInterpolatorSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
  }

  if (actorDid && parsed.data.actorDid !== actorDid) {
    return c.json({ error: 'Request actor mismatch' }, 400);
  }

  try {
    const { visibleReplyCount, ...rest } = parsed.data;
    const request: PremiumInterpolatorRequest = {
      ...rest,
      actorDid: actorDid ?? parsed.data.actorDid,
      ...(typeof visibleReplyCount === 'number'
        ? { visibleReplyCount }
        : {}),
    };
    const result = await writePremiumDeepInterpolator(request);
    const { filtered, safetyMetadata } = filterPremiumDeepInterpolatorResponse({ ...result });
    logSafetyFlag('[premium-ai/interpolator/deep]', safetyMetadata);

    if (!safetyMetadata.passed || typeof filtered.summary !== 'string' || !filtered.summary.trim()) {
      throw Object.assign(new Error('Premium AI output failed safety validation'), { status: 503 });
    }

    return c.json({
      ...filtered,
      safety: {
        flagged: safetyMetadata.flagged,
        severity: safetyMetadata.severity,
        categories: safetyMetadata.categories,
      },
    });
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status ?? 503;
    const message = error instanceof Error ? error.message : 'Premium AI failed';
    const safeStatus: 400 | 403 | 408 | 425 | 429 | 500 | 502 | 503 | 504 =
      [400, 403, 408, 425, 429, 500, 502, 503, 504].includes(status)
        ? (status as 400 | 403 | 408 | 425 | 429 | 500 | 502 | 503 | 504)
        : 503;
    console.error('[premium-ai/interpolator/deep]', message);
    return c.json({ error: 'Premium AI failed' }, safeStatus);
  }
});
