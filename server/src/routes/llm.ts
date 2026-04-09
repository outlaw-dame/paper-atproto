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
import {
  filterWriterResponse,
  filterMediaAnalyzerResponse,
  filterComposerGuidanceResponse,
  logSafetyFlag,
} from '../services/safetyFilters.js';
import { sanitizeRemoteProcessingUrl } from '../lib/sanitize.js';
import {
  checkUrlAgainstSafeBrowsing,
  shouldBlockSafeBrowsingVerdict,
} from '../services/safeBrowsing.js';
import { AppError, ValidationError } from '../lib/errors.js';
import { CircuitBreaker, CircuitOpenError } from '../lib/circuit-breaker.js';
import {
  ComposerGuidanceResponseSchema,
  ComposerGuidanceSchema,
  ExploreSynopsisResponseSchema,
  ExploreSynopsisSchema,
  MediaRequestSchema,
  MediaResponseSchema,
  ThreadStateSchema,
  WriterResponseSchema,
} from '../llm/schemas.js';
import {
  enforceNoToolsAuthorized,
  finalizeLlmOutput,
  prepareLlmInput,
} from '../llm/policyGateway.js';
import { assertTrustedBrowserOrigin, appendVaryHeader } from '../lib/originPolicy.js';
import {
  PREMIUM_AI_PROVIDER_HEADER,
  parsePremiumAiProviderPreferenceHeader,
} from '../ai/providerPreference.js';
import {
  getWriterDiagnostics,
  recordWriterClientOutcome,
  recordWriterSafetyFilterRun,
  resetWriterDiagnostics,
  type WriterClientReason,
} from '../llm/writerDiagnostics.js';
import {
  getMultimodalDiagnostics,
  resetMultimodalDiagnostics,
} from '../llm/multimodalDiagnostics.js';

type LlmRouterContext = {
  Variables: {
    requestId: string;
  };
};

export const llmRouter = new Hono<LlmRouterContext>();

const REQUEST_ID_HEADER = 'X-Request-Id';

const llmCircuitBreakers = {
  interpolator: new CircuitBreaker({ failureThreshold: 4, openMs: 30_000, halfOpenMaxTrials: 1 }),
  media: new CircuitBreaker({ failureThreshold: 3, openMs: 30_000, halfOpenMaxTrials: 1 }),
  searchStory: new CircuitBreaker({ failureThreshold: 4, openMs: 30_000, halfOpenMaxTrials: 1 }),
  composerGuidance: new CircuitBreaker({ failureThreshold: 4, openMs: 30_000, halfOpenMaxTrials: 1 }),
} as const;

type LlmRouteKey = keyof typeof llmCircuitBreakers;

function buildRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `llm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function requestIdFromContext(c: any): string {
  return (c.get('requestId') as string | undefined) ?? buildRequestId();
}

function classifyProviderError(error: unknown): string {
  if (error instanceof CircuitOpenError) return 'circuit_open';
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number') {
    if (status === 429) return 'provider_rate_limited';
    if (status >= 500) return 'provider_5xx';
    if (status >= 400) return 'provider_4xx';
  }

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const statusMatch = message.match(/\b(4\d{2}|5\d{2})\b/);
  if (statusMatch?.[1]) {
    const parsedStatus = Number.parseInt(statusMatch[1], 10);
    if (parsedStatus === 429) return 'provider_rate_limited';
    if (parsedStatus >= 500) return 'provider_5xx';
    if (parsedStatus >= 400) return 'provider_4xx';
  }
  if (message.includes('timed out') || message.includes('timeout')) return 'provider_timeout';
  if (message.includes('invalid json')) return 'provider_invalid_json';
  if (message.includes('abort')) return 'aborted';
  if (message.includes('unsafe')) return 'unsafe_payload';
  return 'unknown';
}

function logRouteEvent(level: 'info' | 'warn' | 'error', event: string, payload: Record<string, unknown>): void {
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  logger('[llm/router/audit]', {
    event,
    at: new Date().toISOString(),
    ...payload,
  });
}

async function withCircuitProtection<T>(
  c: any,
  route: LlmRouteKey,
  operation: () => Promise<T>,
): Promise<T> {
  const requestId = requestIdFromContext(c);
  const breaker = llmCircuitBreakers[route];
  const startedAt = Date.now();

  try {
    breaker.assertCanRequest();
    const result = await operation();
    breaker.recordSuccess();
    logRouteEvent('info', 'llm_upstream_success', {
      requestId,
      route,
      durationMs: Date.now() - startedAt,
      circuitState: breaker.currentState(),
    });
    return result;
  } catch (error) {
    if (!(error instanceof CircuitOpenError)) {
      breaker.recordFailure();
    }

    logRouteEvent(error instanceof CircuitOpenError ? 'warn' : 'error', 'llm_upstream_failure', {
      requestId,
      route,
      durationMs: Date.now() - startedAt,
      errorClass: classifyProviderError(error),
      errorMessage: error instanceof Error ? error.message : String(error),
      circuitState: breaker.currentState(),
    });

    throw error;
  }
}

// ─── Helper ────────────────────────────────────────────────────────────────

function writerLlmDisabled(c: any) {
  return c.json({ error: 'LLM service is disabled', abstained: true, collapsedSummary: '' }, 503);
}

function mediaLlmDisabled(c: any) {
  return c.json({
    error: 'LLM service is disabled',
    mediaCentrality: 0,
    mediaType: 'unknown',
    mediaSummary: '',
    candidateEntities: [],
    confidence: 0,
    cautionFlags: [],
  }, 503);
}

function searchLlmDisabled(c: any) {
  return c.json({ error: 'LLM service is disabled', synopsis: '', abstained: true }, 503);
}

function composerGuidanceLlmDisabled(c: any) {
  return c.json({ error: 'LLM service is disabled' }, 503);
}

function validationIssues(error: ValidationError): unknown {
  return (error.details as { issues?: unknown } | undefined)?.issues;
}

function requestedProviderFromRequest(c: any) {
  return parsePremiumAiProviderPreferenceHeader(c.req.header(PREMIUM_AI_PROVIDER_HEADER));
}

function assertDiagnosticsAccess(c: any): void {
  if (env.NODE_ENV !== 'production') return;

  const configuredSecret = env.AI_SESSION_TELEMETRY_ADMIN_SECRET?.trim();
  if (!configuredSecret) {
    throw new AppError(403, 'FORBIDDEN', 'Diagnostics endpoint is disabled in production.');
  }

  const providedSecret = c.req.header('X-AI-Telemetry-Admin-Secret')?.trim();
  if (!providedSecret || providedSecret !== configuredSecret) {
    throw new AppError(403, 'FORBIDDEN', 'Diagnostics endpoint requires an admin secret.');
  }
}

function applyDiagnosticsHeaders(c: any): void {
  c.header('Cache-Control', 'no-store, private');
  c.header('Pragma', 'no-cache');
  c.header('X-Content-Type-Options', 'nosniff');
  appendVaryHeader(c, 'Origin');
}

const WriterOutcomeTelemetrySchema = z.object({
  outcome: z.enum(['model', 'fallback']),
  reason: z.enum([
    'success',
    'abstained-response-fallback',
    'root-only-response-fallback',
    'failure-fallback',
  ]),
  telemetry: z.object({
    attempted: z.number().int().min(0).max(1_000_000),
    succeeded: z.number().int().min(0).max(1_000_000),
    abstained: z.number().int().min(0).max(1_000_000),
    failed: z.number().int().min(0).max(1_000_000),
  }).optional(),
});

llmRouter.use('*', async (c, next) => {
  const requestId = c.req.header(REQUEST_ID_HEADER) || buildRequestId();
  c.set('requestId', requestId);
  c.header(REQUEST_ID_HEADER, requestId);

  const startedAt = Date.now();
  try {
    await next();
  } finally {
    logRouteEvent('info', 'llm_request_completed', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
  }
});

// ─── POST /telemetry/writer-outcome ───────────────────────────────────────

llmRouter.post('/telemetry/writer-outcome', async (c) => {
  assertTrustedBrowserOrigin(c, 'Writer telemetry');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = WriterOutcomeTelemetrySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid telemetry payload', issues: parsed.error.issues }, 400);
  }

  recordWriterClientOutcome({
    outcome: parsed.data.outcome,
    reason: parsed.data.reason as WriterClientReason,
  });

  return c.body(null, 204);
});

// ─── GET/DELETE /admin/diagnostics ────────────────────────────────────────

llmRouter.get('/admin/diagnostics', (c) => {
  assertDiagnosticsAccess(c);
  applyDiagnosticsHeaders(c);
  return c.json({
    writer: getWriterDiagnostics(),
    multimodal: getMultimodalDiagnostics(),
  });
});

llmRouter.delete('/admin/diagnostics', (c) => {
  assertDiagnosticsAccess(c);
  resetWriterDiagnostics();
  resetMultimodalDiagnostics();
  applyDiagnosticsHeaders(c);
  return c.body(null, 204);
});

// ─── POST /write/interpolator ──────────────────────────────────────────────

llmRouter.post('/write/interpolator', async (c) => {
  if (!env.LLM_ENABLED) return writerLlmDisabled(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const requestId = requestIdFromContext(c);
  let prepared: { data: z.infer<typeof ThreadStateSchema> };
  const preferredProvider = requestedProviderFromRequest(c);
  try {
    prepared = prepareLlmInput(ThreadStateSchema, body, {
      task: 'interpolator',
      requestId,
    });
    enforceNoToolsAuthorized({
      task: 'interpolator',
      requestId,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message, issues: validationIssues(error) }, 400);
    }
    throw error;
  }

  try {
    const result = await withCircuitProtection(c, 'interpolator', () => runInterpolatorWriter({
      ...(prepared.data as any),
      requestId,
    }, preferredProvider ? {
      enhancer: {
        preferredProvider,
      },
    } : undefined));
    const filterResult = filterWriterResponse({ ...result });
    const wasMutated = JSON.stringify(filterResult.filtered) !== JSON.stringify(result);
    recordWriterSafetyFilterRun({
      mutated: wasMutated,
      blocked: !filterResult.safetyMetadata.passed,
    });

    const { data: filtered, safetyMetadata } = finalizeLlmOutput(
      WriterResponseSchema,
      result,
      {
        task: 'interpolator',
        requestId,
      },
      {
        filter: () => filterResult as any,
      },
    );
    const safety = safetyMetadata ?? {
      passed: true,
      flagged: false,
      categories: [],
      severity: 'none',
      filtered: '',
    };
    logSafetyFlag('[llm/write/interpolator]', safety);
    if (!safety.passed) {
      return c.json({
        collapsedSummary: '',
        whatChanged: [],
        contributorBlurbs: [],
        abstained: true,
        mode: prepared.data.summaryMode,
      });
    }
    return c.json(filtered);
  } catch (err: unknown) {
    if (err instanceof CircuitOpenError) {
      const retryAfterSeconds = Math.max(1, Math.ceil(err.retryAfterMs / 1000));
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json({
        error: 'LLM writer temporarily unavailable',
        code: 'CIRCUIT_OPEN',
        requestId: requestIdFromContext(c),
      }, 503);
    }
    const message = err instanceof Error ? err.message : 'Writer failed';
    console.error('[llm/write/interpolator]', message);
    // Graceful degradation: return abstained result, do not break thread UI
    return c.json({
      collapsedSummary: '',
      whatChanged: [],
      contributorBlurbs: [],
      abstained: true,
      mode: prepared.data.summaryMode,
    });
  }
});

// ─── POST /analyze/media ───────────────────────────────────────────────────

llmRouter.post('/analyze/media', async (c) => {
  if (!env.LLM_ENABLED) return mediaLlmDisabled(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const requestId = requestIdFromContext(c);
  let prepared: { data: z.infer<typeof MediaRequestSchema> };
  try {
    prepared = prepareLlmInput(MediaRequestSchema, body, {
      task: 'media',
      requestId,
    });
    enforceNoToolsAuthorized({
      task: 'media',
      requestId,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message, issues: validationIssues(error) }, 400);
    }
    throw error;
  }

  const sanitizedMediaUrl = sanitizeRemoteProcessingUrl(prepared.data.mediaUrl);
  if (!sanitizedMediaUrl) {
    return c.json({ error: 'Unsafe media URL' }, 400);
  }

  const safeBrowsingVerdict = await checkUrlAgainstSafeBrowsing(sanitizedMediaUrl);
  if (shouldBlockSafeBrowsingVerdict(safeBrowsingVerdict)) {
    return c.json({
      error: safeBrowsingVerdict.reason ?? 'Media URL blocked by Google Safe Browsing.',
    }, 400);
  }

  try {
    const result = await withCircuitProtection(c, 'media', () => runMediaAnalyzer({
      ...prepared.data,
      mediaUrl: sanitizedMediaUrl,
    } as any));
    const { data: filtered, safetyMetadata } = finalizeLlmOutput(
      MediaResponseSchema,
      result,
      {
        task: 'media',
        requestId,
      },
      {
        filter: (value) => filterMediaAnalyzerResponse({ ...value }) as any,
      },
    );
    const safety = safetyMetadata ?? {
      passed: true,
      flagged: false,
      categories: [],
      severity: 'none',
      filtered: '',
    };
    logSafetyFlag('[llm/analyze/media]', safety);
    if (!safety.passed) {
      return c.json({
        mediaCentrality: 0,
        mediaType: 'unknown',
        mediaSummary: '',
        candidateEntities: [],
        confidence: 0,
        cautionFlags: [],
      });
    }
    return c.json(filtered);
  } catch (err: unknown) {
    if (err instanceof CircuitOpenError) {
      const retryAfterSeconds = Math.max(1, Math.ceil(err.retryAfterMs / 1000));
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json({
        error: 'Media analyzer temporarily unavailable',
        code: 'CIRCUIT_OPEN',
        requestId: requestIdFromContext(c),
      }, 503);
    }
    if (err instanceof ValidationError) {
      return c.json({ error: err.message }, err.status as 400);
    }
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
  if (!env.LLM_ENABLED) return searchLlmDisabled(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const requestId = requestIdFromContext(c);
  let prepared: { data: z.infer<typeof ExploreSynopsisSchema> };
  try {
    prepared = prepareLlmInput(ExploreSynopsisSchema, body, {
      task: 'searchStory',
      requestId,
    });
    enforceNoToolsAuthorized({
      task: 'searchStory',
      requestId,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message, issues: validationIssues(error) }, 400);
    }
    throw error;
  }

  // Reuse the interpolator writer with adapted input
  const {
    storyId,
    titleHint,
    candidatePosts,
    safeEntities,
    factualHighlights,
    confidence,
    mediaFindings,
  } = prepared.data;

  // Derive summary mode from confidence — same logic as the client routing layer.
  const storySummaryMode: 'normal' | 'descriptive_fallback' | 'minimal_fallback' =
    confidence.interpretiveConfidence < 0.45
      ? (confidence.surfaceConfidence >= 0.60 ? 'descriptive_fallback' : 'minimal_fallback')
      : 'normal';

  const writerInput = {
    threadId: storyId,
    requestId,
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
    ...(mediaFindings
      ? {
          mediaFindings: mediaFindings.map((item) => ({
            mediaType: item.mediaType,
            summary: item.summary,
            confidence: item.confidence,
            ...(item.extractedText ? { extractedText: item.extractedText } : {}),
            ...(item.cautionFlags ? { cautionFlags: item.cautionFlags } : {}),
          })),
        }
      : {}),
  };

  try {
    const result = await withCircuitProtection(c, 'searchStory', () => runInterpolatorWriter(writerInput));
    const synopsis = {
      synopsis: result.collapsedSummary,
      ...(result.expandedSummary ? { shortSynopsis: result.expandedSummary } : {}),
      abstained: result.abstained,
    };
    const { data: filtered, safetyMetadata } = finalizeLlmOutput(
      ExploreSynopsisResponseSchema,
      synopsis,
      {
        task: 'searchStory',
        requestId,
      },
      {
        filter: (value) => filterWriterResponse({ ...value }) as any,
      },
    );
    const safety = safetyMetadata ?? {
      passed: true,
      flagged: false,
      categories: [],
      severity: 'none',
      filtered: '',
    };
    logSafetyFlag('[llm/write/search-story]', safety);
    if (!safety.passed) {
      return c.json({ synopsis: '', abstained: true });
    }
    return c.json(filtered);
  } catch (err: unknown) {
    if (err instanceof CircuitOpenError) {
      const retryAfterSeconds = Math.max(1, Math.ceil(err.retryAfterMs / 1000));
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json({
        error: 'Search writer temporarily unavailable',
        code: 'CIRCUIT_OPEN',
        requestId: requestIdFromContext(c),
      }, 503);
    }
    const message = err instanceof Error ? err.message : 'Synopsis writer failed';
    console.error('[llm/write/search-story]', message);
    return c.json({ synopsis: '', abstained: true });
  }
});

// ─── POST /write/composer-guidance ────────────────────────────────────────

llmRouter.post('/write/composer-guidance', async (c) => {
  if (!env.LLM_ENABLED) return composerGuidanceLlmDisabled(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const requestId = requestIdFromContext(c);
  let prepared: { data: z.infer<typeof ComposerGuidanceSchema> };
  try {
    prepared = prepareLlmInput(ComposerGuidanceSchema, body, {
      task: 'composerGuidance',
      requestId,
    });
    enforceNoToolsAuthorized({
      task: 'composerGuidance',
      requestId,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message, issues: validationIssues(error) }, 400);
    }
    throw error;
  }

  try {
    const { parentText, ...rest } = prepared.data;
    const request = parentText === undefined ? rest : { ...rest, parentText };
    const result = await withCircuitProtection(c, 'composerGuidance', () => runComposerGuidanceWriter(request));
    const { data: filtered, safetyMetadata } = finalizeLlmOutput(
      ComposerGuidanceResponseSchema,
      result,
      {
        task: 'composerGuidance',
        requestId,
      },
      {
        filter: (value) => filterComposerGuidanceResponse({ ...value }) as any,
      },
    );
    const safety = safetyMetadata ?? {
      passed: true,
      flagged: false,
      categories: [],
      severity: 'none',
      filtered: '',
    };
    logSafetyFlag('[llm/write/composer-guidance]', safety);

    if (!safety.passed || typeof filtered.message !== 'string' || !filtered.message.trim()) {
      throw new Error('Composer guidance output failed safety validation');
    }

    return c.json(filtered);
  } catch (err: unknown) {
    if (err instanceof CircuitOpenError) {
      const retryAfterSeconds = Math.max(1, Math.ceil(err.retryAfterMs / 1000));
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json({
        error: 'Composer guidance temporarily unavailable',
        code: 'CIRCUIT_OPEN',
        requestId: requestIdFromContext(c),
      }, 503);
    }
    const message = err instanceof Error ? err.message : 'Composer guidance writer failed';
    console.error('[llm/write/composer-guidance]', message);
    return c.json({ error: 'Composer guidance writer failed' }, 503);
  }
});

llmRouter.onError((error, c) => {
  if (error instanceof CircuitOpenError) {
    const retryAfterSeconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    c.header('Retry-After', String(retryAfterSeconds));
    return c.json({
      error: 'LLM route temporarily unavailable',
      code: 'CIRCUIT_OPEN',
      requestId: requestIdFromContext(c),
    }, 503);
  }

  if (error instanceof AppError) {
    return c.json({
      error: error.message,
      code: error.code,
      requestId: requestIdFromContext(c),
      ...(error.details ? { details: error.details } : {}),
    }, error.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504);
  }

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
