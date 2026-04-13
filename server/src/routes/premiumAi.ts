import { Hono } from 'hono';
import { z } from 'zod';
import {
  resolvePremiumAiEntitlements,
  type PremiumAiProviderPreference,
} from '../entitlements/resolveAiEntitlements.js';
import { writePremiumDeepInterpolator } from '../ai/providerRouter.js';
import { ensurePremiumAiProviderReady } from '../ai/premiumProviderReadiness.js';
import type { PremiumInterpolatorRequest } from '../ai/providers/geminiConversation.provider.js';
import { AppError, UnauthorizedError, ValidationError } from '../lib/errors.js';
import { extractRetryAfterMs } from '../lib/retry.js';
import {
  PREMIUM_AI_PROVIDER_HEADER,
  parsePremiumAiProviderPreferenceHeader,
} from '../ai/providerPreference.js';
import {
  appendVaryHeader,
  assertTrustedBrowserOrigin,
} from '../lib/originPolicy.js';
import {
  filterPremiumDeepInterpolatorResponse,
  logSafetyFlag,
} from '../services/safetyFilters.js';
import {
  recordPremiumRouteFailure,
  recordPremiumRouteInvocation,
  recordPremiumRouteSafetyFilter,
  recordPremiumRouteSuccess,
} from '../llm/premiumDiagnostics.js';
import {
  ExploreInsightResponseSchema,
  ExploreInsightSchema,
  PremiumDeepInterpolatorResponseSchema,
  PremiumInterpolatorSchema,
} from '../llm/schemas.js';
import {
  enforceNoToolsAuthorized,
  finalizeLlmOutput,
  prepareLlmInput,
} from '../llm/policyGateway.js';

export const premiumAiRouter = new Hono();

function errorPayloadForPremiumRoute(status: number): { error: string; code: string } {
  switch (status) {
    case 429:
      return { error: 'Premium AI rate-limited', code: 'PREMIUM_AI_RATE_LIMITED' };
    case 504:
    case 408:
      return { error: 'Premium AI timed out', code: 'PREMIUM_AI_TIMEOUT' };
    case 503:
    case 502:
      return { error: 'Premium AI unavailable', code: 'PREMIUM_AI_UNAVAILABLE' };
    case 403:
      return { error: 'Premium AI forbidden', code: 'PREMIUM_AI_FORBIDDEN' };
    case 400:
      return { error: 'Premium AI request invalid', code: 'PREMIUM_AI_BAD_REQUEST' };
    default:
      return { error: 'Premium AI failed', code: 'PREMIUM_AI_FAILED' };
  }
}

function applySecurityHeaders(c: any): void {
  c.header('Cache-Control', 'no-store, private');
  c.header('Pragma', 'no-cache');
  c.header('X-Content-Type-Options', 'nosniff');
  appendVaryHeader(c, 'Origin');
  appendVaryHeader(c, 'X-Glympse-User-Did');
  appendVaryHeader(c, PREMIUM_AI_PROVIDER_HEADER);
}

function actorDidFromRequest(c: any, required: true): string;
function actorDidFromRequest(c: any, required?: false): string | undefined;
function actorDidFromRequest(c: any, required = false): string | undefined {
  const value = c.req.header('X-Glympse-User-Did');
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    if (required) throw new UnauthorizedError('Missing X-Glympse-User-Did header');
    return undefined;
  }
  if (!/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(normalized)) {
    throw new UnauthorizedError('Invalid DID header format');
  }
  return normalized;
}

function validationIssues(error: ValidationError): unknown {
  return (error.details as { issues?: unknown } | undefined)?.issues;
}

function requestedProviderFromRequest(c: any): PremiumAiProviderPreference | undefined {
  return parsePremiumAiProviderPreferenceHeader(c.req.header(PREMIUM_AI_PROVIDER_HEADER));
}

premiumAiRouter.use('*', async (c, next) => {
  try {
    await next();
  } finally {
    applySecurityHeaders(c);
  }
});

premiumAiRouter.get('/entitlements', async (c) => {
  const actorDid = actorDidFromRequest(c);
  const preferredProvider = requestedProviderFromRequest(c);
  if (actorDid) {
    assertTrustedBrowserOrigin(c, 'Premium AI entitlements');
  }
  await ensurePremiumAiProviderReady(preferredProvider);
  return c.json(resolvePremiumAiEntitlements(actorDid, preferredProvider));
});

premiumAiRouter.post('/interpolator/deep', async (c) => {
  const actorDid = actorDidFromRequest(c, true);
  const requestId = c.req.header('X-Request-Id') || crypto.randomUUID();
  const preferredProvider = requestedProviderFromRequest(c);
  assertTrustedBrowserOrigin(c, 'Premium AI deep interpolator');
  await ensurePremiumAiProviderReady(preferredProvider);
  const entitlements = resolvePremiumAiEntitlements(actorDid, preferredProvider);

  if (!entitlements.capabilities.includes('deep_interpolator')) {
    return c.json({ error: 'Premium deep interpolator is not available for this user' }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  let prepared: { data: z.infer<typeof PremiumInterpolatorSchema> };
  try {
    prepared = prepareLlmInput(PremiumInterpolatorSchema, body, {
      task: 'premiumDeep',
      requestId,
    });
    enforceNoToolsAuthorized({
      task: 'premiumDeep',
      requestId,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message, issues: validationIssues(error) }, 400);
    }
    throw error;
  }

  if (actorDid && prepared.data.actorDid !== actorDid) {
    return c.json({ error: 'Request actor mismatch' }, 400);
  }

  try {
    const { visibleReplyCount, ...rest } = prepared.data;
    recordPremiumRouteInvocation();
    const request: PremiumInterpolatorRequest = {
      ...rest,
      actorDid,
      requestId,
      ...(typeof visibleReplyCount === 'number'
        ? { visibleReplyCount }
        : {}),
    };
    const result = await writePremiumDeepInterpolator(
      request,
      preferredProvider ? { preferredProvider } : undefined,
    );
    const { data: filtered, safetyMetadata } = finalizeLlmOutput(
      PremiumDeepInterpolatorResponseSchema,
      result,
      {
        task: 'premiumDeep',
        requestId,
      },
      {
        filter: (value) => filterPremiumDeepInterpolatorResponse({ ...value }) as any,
      },
    );
    const safety = safetyMetadata ?? {
      passed: true,
      flagged: false,
      categories: [],
      severity: 'none',
      filtered: '',
    };
    logSafetyFlag('[premium-ai/interpolator/deep]', safety);
    recordPremiumRouteSafetyFilter({
      mutated: JSON.stringify(filtered) !== JSON.stringify(result),
      blocked: !safety.passed,
    });

    if (!safety.passed || typeof filtered.summary !== 'string' || !filtered.summary.trim()) {
      throw Object.assign(new Error('Premium AI output failed safety validation'), {
        status: 503,
        code: 'premium_ai_safety_blocked',
      });
    }

    recordPremiumRouteSuccess();
    return c.json({
      ...filtered,
      safety: {
        flagged: safety.flagged,
        severity: safety.severity,
        categories: safety.categories,
      },
    });
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status ?? 503;
    const message = error instanceof Error ? error.message : 'Premium AI failed';
    const safeStatus: 400 | 403 | 408 | 425 | 429 | 500 | 502 | 503 | 504 =
      [400, 403, 408, 425, 429, 500, 502, 503, 504].includes(status)
        ? (status as 400 | 403 | 408 | 425 | 429 | 500 | 502 | 503 | 504)
        : 503;
    const retryAfterMs = extractRetryAfterMs(error);
    if ((safeStatus === 429 || safeStatus === 503 || safeStatus === 504) && typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)) {
      c.header('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
    }
    recordPremiumRouteFailure({
      error,
      requestId,
    });
    console.error('[premium-ai/interpolator/deep]', message);
    return c.json(errorPayloadForPremiumRoute(safeStatus), safeStatus);
  }
});

// ─── POST /explore/insight ────────────────────────────────────────────────
// Premium AI synthesis of explore search results. Frames query + top results
// as a structured context and routes through the same Gemini/OpenAI pipeline
// used by the deep interpolator. Requires explore_insight entitlement.

premiumAiRouter.post('/explore/insight', async (c) => {
  const actorDid = actorDidFromRequest(c, true);
  const requestId = c.req.header('X-Request-Id') || crypto.randomUUID();
  const preferredProvider = requestedProviderFromRequest(c);
  assertTrustedBrowserOrigin(c, 'Premium AI explore insight');
  await ensurePremiumAiProviderReady(preferredProvider);
  const entitlements = resolvePremiumAiEntitlements(actorDid, preferredProvider);

  if (!entitlements.capabilities.includes('explore_insight')) {
    return c.json({ error: 'Premium explore insight is not available for this user' }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  let prepared: { data: z.infer<typeof ExploreInsightSchema> };
  try {
    prepared = prepareLlmInput(ExploreInsightSchema, body, {
      task: 'premiumDeep',
      requestId,
    });
    enforceNoToolsAuthorized({ task: 'premiumDeep', requestId });
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message, issues: validationIssues(error) }, 400);
    }
    throw error;
  }

  const {
    query,
    intentKind,
    intentConfidence,
    storyId,
    titleHint,
    candidatePosts,
    safeEntities,
    factualHighlights,
    confidence,
  } = prepared.data;

  // Derive summary mode from confidence — same logic as other explore routes.
  const summaryMode: 'normal' | 'descriptive_fallback' | 'minimal_fallback' =
    confidence.interpretiveConfidence < 0.45
      ? (confidence.surfaceConfidence >= 0.60 ? 'descriptive_fallback' : 'minimal_fallback')
      : 'normal';

  // Frame the explore context as a PremiumInterpolatorRequest:
  // - Root post = the search query as a discovery anchor
  // - Selected comments = top search results
  // - interpretiveBrief captures intent and factual signals
  const topPost = candidatePosts[0];
  const request: PremiumInterpolatorRequest = {
    actorDid,
    requestId,
    threadId: storyId,
    summaryMode,
    confidence,
    rootPost: {
      uri: topPost?.uri ?? storyId,
      handle: topPost?.handle ?? 'explore',
      text: titleHint ?? `Explore: ${query}`,
      createdAt: new Date().toISOString(),
    },
    selectedComments: candidatePosts.slice(1).map((p) => ({
      uri: p.uri,
      handle: p.handle,
      text: p.text,
      impactScore: p.impactScore,
    })),
    topContributors: [],
    safeEntities,
    factualHighlights,
    whatChangedSignals: [],
    interpretiveBrief: {
      summaryMode,
      baseSummary: `Explore search: "${query}" — ${intentKind} intent (confidence ${intentConfidence.toFixed(2)})`,
      dominantTone: 'informational',
      conversationPhase: 'discovery',
      supports: factualHighlights.slice(0, 3),
      limits: [],
    },
  };

  try {
    recordPremiumRouteInvocation();
    const result = await writePremiumDeepInterpolator(
      request,
      preferredProvider ? { preferredProvider } : undefined,
    );
    const insight = {
      insight: result.summary,
      ...(result.groundedContext ? { shortInsight: result.groundedContext } : {}),
      provider: result.provider,
      abstained: !result.summary.trim(),
    };
    const { data: filtered, safetyMetadata } = finalizeLlmOutput(
      ExploreInsightResponseSchema,
      insight,
      { task: 'premiumDeep', requestId },
      {
        filter: (value) => filterPremiumDeepInterpolatorResponse({
          summary: (value as any).insight ?? '',
          groundedContext: (value as any).shortInsight,
          perspectiveGaps: [],
          followUpQuestions: [],
          confidence: 0.5,
          provider: (value as any).provider ?? 'gemini',
          updatedAt: new Date().toISOString(),
        }) as any,
      },
    );
    const safety = safetyMetadata ?? {
      passed: true,
      flagged: false,
      categories: [],
      severity: 'none',
      filtered: '',
    };
    logSafetyFlag('[premium-ai/explore/insight]', safety);
    recordPremiumRouteSafetyFilter({
      mutated: JSON.stringify(filtered) !== JSON.stringify(insight),
      blocked: !safety.passed,
    });

    if (!safety.passed || typeof filtered.insight !== 'string' || !filtered.insight.trim()) {
      throw Object.assign(new Error('Premium AI explore insight failed safety validation'), {
        status: 503,
        code: 'premium_ai_safety_blocked',
      });
    }

    recordPremiumRouteSuccess();
    return c.json({
      ...filtered,
      safety: {
        flagged: safety.flagged,
        severity: safety.severity,
        categories: safety.categories,
      },
    });
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status ?? 503;
    const message = error instanceof Error ? error.message : 'Premium AI explore insight failed';
    const safeStatus: 400 | 403 | 408 | 425 | 429 | 500 | 502 | 503 | 504 =
      [400, 403, 408, 425, 429, 500, 502, 503, 504].includes(status)
        ? (status as 400 | 403 | 408 | 425 | 429 | 500 | 502 | 503 | 504)
        : 503;
    const retryAfterMs = extractRetryAfterMs(error);
    if ((safeStatus === 429 || safeStatus === 503 || safeStatus === 504) && typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)) {
      c.header('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
    }
    recordPremiumRouteFailure({ error, requestId });
    console.error('[premium-ai/explore/insight]', message);
    return c.json(errorPayloadForPremiumRoute(safeStatus), safeStatus);
  }
});

premiumAiRouter.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json({ error: error.message, code: error.code }, error.status as any);
  }

  const message = error instanceof Error ? error.message : 'Premium AI failed';
  console.error('[premium-ai]', message);
  return c.json({ error: 'Premium AI failed' }, 500);
});
