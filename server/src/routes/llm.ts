// ─── LLM Routes — Narwhal v3 ──────────────────────────────────────────────
// Server-side model endpoints. All model calls are proxied through here.
// Client never calls Ollama directly.
//
// Routes:
//   POST /api/llm/write/interpolator  — Qwen3-4B thread summary writer
//   POST /api/llm/analyze/media       — Qwen3-VL multimodal analyzer (Phase B)
//   POST /api/llm/write/search-story  — Qwen3-4B Explore synopsis writer

import { Hono } from 'hono';
import { z } from 'zod';
import { runInterpolatorWriter } from '../services/qwenWriter.js';
import { runMediaAnalyzer } from '../services/qwenMultimodal.js';
import { env } from '../config/env.js';

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
    const result = await runInterpolatorWriter(parsed.data);
    return c.json(result);
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
    const result = await runMediaAnalyzer(parsed.data);
    return c.json(result);
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
  const writerInput = {
    threadId: storyId,
    summaryMode: 'normal' as const,
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
    return c.json({
      synopsis: result.collapsedSummary,
      ...(result.expandedSummary ? { shortSynopsis: result.expandedSummary } : {}),
      abstained: result.abstained,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Synopsis writer failed';
    console.error('[llm/write/search-story]', message);
    return c.json({ synopsis: '', abstained: true });
  }
});
