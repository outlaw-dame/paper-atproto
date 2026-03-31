// ─── LLM Routes — Narwhal v3 ──────────────────────────────────────────────
// Server-side model endpoints. All model calls are proxied through here.
// Client never calls Ollama directly.
//
// Routes:
//   POST /api/llm/write/interpolator  — Qwen3-4B thread summary writer
//   POST /api/llm/analyze/media       — Qwen3-VL multimodal analyzer (Phase B)
//   POST /api/llm/write/search-story  — Qwen3-4B Explore synopsis writer
//   POST /api/llm/write/composer-guidance — selective composer guidance writer

import { Hono } from 'hono';
import { z } from 'zod';
import { runInterpolatorWriter } from '../services/qwenWriter.js';
import { runMediaAnalyzer } from '../services/qwenMultimodal.js';
import { runComposerGuidanceWriter } from '../services/qwenComposerGuidanceWriter.js';
import { env } from '../config/env.js';
import { filterWriterResponse, filterMediaAnalyzerResponse, logSafetyFlag } from '../services/safetyFilters.js';
export const llmRouter = new Hono();

// ─── Shared schemas ────────────────────────────────────────────────────────

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

const ThreadStateSchema = z.object({
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
  mediaFindings: z.array(z.object({
    mediaType: z.string(),
    summary: z.string().max(300),
    confidence: z.number(),
    extractedText: z.string().max(500).optional(),
    cautionFlags: z.array(z.string()).optional(),
  })).max(3).optional(),
});

const MediaRequestSchema = z.object({
  threadId: z.string().max(300),
  mediaUrl: z.string().url().max(1000),
  mediaAlt: z.string().max(300).optional(),
  nearbyText: z.string().max(400),
  candidateEntities: z.array(z.string().max(80)).max(10),
  factualHints: z.array(z.string().max(120)).max(5),
});

const ExploreSynopsisSchema = z.object({
  storyId: z.string().max(300),
  titleHint: z.string().max(200).optional(),
  candidatePosts: z.array(z.object({
    uri: z.string(),
    handle: z.string().max(100),
    text: z.string().max(300),
    impactScore: z.number(),
  })).max(10),
  safeEntities: z.array(WriterEntitySchema).max(8),
  factualHighlights: z.array(z.string().max(200)).max(5),
  confidence: ConfidenceSchema,
});

const ComposerGuidanceSchema = z.object({
  mode: z.enum(['post', 'reply', 'hosted_thread']),
  draftText: z.string().min(1).max(1200),
  parentText: z.string().max(500).optional(),
  uiState: z.enum(['positive', 'caution', 'warning']),
  scores: z.object({
    positiveSignal: z.number().min(0).max(1),
    negativeSignal: z.number().min(0).max(1),
    supportiveness: z.number().min(0).max(1),
    constructiveness: z.number().min(0).max(1),
    clarifying: z.number().min(0).max(1),
    hostility: z.number().min(0).max(1),
    dismissiveness: z.number().min(0).max(1),
    escalation: z.number().min(0).max(1),
    sentimentPositive: z.number().min(0).max(1),
    sentimentNegative: z.number().min(0).max(1),
    anger: z.number().min(0).max(1),
    trust: z.number().min(0).max(1),
    optimism: z.number().min(0).max(1),
    targetedNegativity: z.number().min(0).max(1),
    toxicity: z.number().min(0).max(1),
  }),
  constructiveSignals: z.array(z.string().max(200)).max(4),
  supportiveSignals: z.array(z.string().max(200)).max(4),
  parentSignals: z.array(z.string().max(200)).max(4),
});

// ─── Helper ────────────────────────────────────────────────────────────────

function llmDisabled(c: any) {
  return c.json({ error: 'LLM service is disabled', abstained: true, collapsedSummary: '' }, 503);
}

// ─── POST /write/interpolator ──────────────────────────────────────────────

llmRouter.post('/write/interpolator', async (c) => {
  if (!env.LLM_ENABLED) return llmDisabled(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = ThreadStateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
  }

  try {
    const result = await runInterpolatorWriter(parsed.data as any);
    const { filtered, safetyMetadata } = filterWriterResponse(result);
    logSafetyFlag('[llm/write/interpolator]', safetyMetadata);
    return c.json(filtered);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Writer failed';
    console.error('[llm/write/interpolator]', message);
    // Graceful degradation: return abstained result, do not break thread UI
    return c.json({
      collapsedSummary: '',
      whatChanged: [],
      contributorBlurbs: [],
      abstained: true,
      mode: parsed.data.summaryMode,
    });
  }
});

// ─── POST /analyze/media ───────────────────────────────────────────────────

llmRouter.post('/analyze/media', async (c) => {
  if (!env.LLM_ENABLED) return llmDisabled(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = MediaRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
  }

  try {
    const result = await runMediaAnalyzer(parsed.data as any);
    const { filtered, safetyMetadata } = filterMediaAnalyzerResponse(result);
    logSafetyFlag('[llm/analyze/media]', safetyMetadata);
    return c.json(filtered);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Media analysis failed';
    console.error('[llm/analyze/media]', message);
    // Graceful degradation
    return c.json({
      mediaCentrality: 0,
      mediaType: 'unknown',
      mediaSummary: '',
      candidateEntities: [],
      confidence: 0,
      cautionFlags: [],
    });
  }
});

// ─── POST /write/search-story ──────────────────────────────────────────────

llmRouter.post('/write/search-story', async (c) => {
  if (!env.LLM_ENABLED) return llmDisabled(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = ExploreSynopsisSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
  }

  // Reuse the interpolator writer with adapted input
  const { storyId, titleHint, candidatePosts, safeEntities, factualHighlights, confidence } = parsed.data;

  // Derive summary mode from confidence — same logic as the client routing layer.
  const storySummaryMode: 'normal' | 'descriptive_fallback' | 'minimal_fallback' =
    confidence.interpretiveConfidence < 0.45
      ? (confidence.surfaceConfidence >= 0.60 ? 'descriptive_fallback' : 'minimal_fallback')
      : 'normal';

  const writerInput = {
    threadId: storyId,
    summaryMode: storySummaryMode,
    confidence,
    rootPost: {
      uri: candidatePosts[0]?.uri ?? storyId,
      handle: candidatePosts[0]?.handle ?? 'unknown',
      text: titleHint ?? candidatePosts[0]?.text ?? '',
      createdAt: new Date().toISOString(),
    },
    selectedComments: candidatePosts.slice(1).map(p => ({
      uri: p.uri,
      handle: p.handle,
      text: p.text,
      impactScore: p.impactScore,
    })),
    topContributors: [],
    safeEntities,
    factualHighlights,
    whatChangedSignals: [],
  };

  try {
    const result = await runInterpolatorWriter(writerInput);
    const synopsis = {
      synopsis: result.collapsedSummary,
      ...(result.expandedSummary ? { shortSynopsis: result.expandedSummary } : {}),
      abstained: result.abstained,
    };
    const { filtered, safetyMetadata } = filterWriterResponse(synopsis);
    logSafetyFlag('[llm/write/search-story]', safetyMetadata);
    return c.json(filtered);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Synopsis writer failed';
    console.error('[llm/write/search-story]', message);
    return c.json({ synopsis: '', abstained: true });
  }
});

// ─── POST /write/composer-guidance ────────────────────────────────────────

llmRouter.post('/write/composer-guidance', async (c) => {
  if (!env.LLM_ENABLED) return llmDisabled(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = ComposerGuidanceSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
  }

  try {
    const { parentText, ...rest } = parsed.data;
    const request = parentText === undefined ? rest : { ...rest, parentText };
    const result = await runComposerGuidanceWriter(request);
    return c.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Composer guidance writer failed';
    console.error('[llm/write/composer-guidance]', message);
    return c.json({ error: 'Composer guidance writer failed' }, 503);
  }
});

llmRouter.onError((error, c) => {
  const path = c.req.path;
  const message = error instanceof Error ? error.message : String(error);

  if (path.endsWith('/write/interpolator')) {
    console.error('[llm/onError/interpolator]', message);
    return c.json({
      collapsedSummary: '',
      whatChanged: [],
      contributorBlurbs: [],
      abstained: true,
      mode: 'minimal_fallback',
    });
  }

  if (path.endsWith('/analyze/media')) {
    console.error('[llm/onError/analyze-media]', message);
    return c.json({
      mediaCentrality: 0,
      mediaType: 'unknown',
      mediaSummary: '',
      candidateEntities: [],
      confidence: 0,
      cautionFlags: [],
    });
  }

  if (path.endsWith('/write/search-story')) {
    console.error('[llm/onError/search-story]', message);
    return c.json({ synopsis: '', abstained: true });
  }

  if (path.endsWith('/write/composer-guidance')) {
    console.error('[llm/onError/composer-guidance]', message);
    return c.json({ error: 'Composer guidance writer failed' }, 503);
  }

  console.error('[llm/onError/unhandled]', message);
  return c.json({ error: 'LLM route failed' }, 500);
});
