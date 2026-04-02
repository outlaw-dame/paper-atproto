import { Hono } from 'hono';
import { z } from 'zod';
import { resolvePremiumAiEntitlements } from '../entitlements/resolveAiEntitlements.js';
import { writePremiumDeepInterpolator } from '../ai/providerRouter.js';
import type { PremiumInterpolatorRequest } from '../ai/providers/geminiConversation.provider.js';
import { AppError, UnauthorizedError, ValidationError } from '../lib/errors.js';
import {
  appendVaryHeader,
  assertTrustedBrowserOrigin,
} from '../lib/originPolicy.js';
import {
  filterPremiumDeepInterpolatorResponse,
  logSafetyFlag,
} from '../services/safetyFilters.js';
import {
  PremiumDeepInterpolatorResponseSchema,
  PremiumInterpolatorSchema,
} from '../llm/schemas.js';
import {
  enforceNoToolsAuthorized,
  finalizeLlmOutput,
  prepareLlmInput,
} from '../llm/policyGateway.js';

export const premiumAiRouter = new Hono();

function applySecurityHeaders(c: any): void {
  c.header('Cache-Control', 'no-store, private');
  c.header('Pragma', 'no-cache');
  c.header('X-Content-Type-Options', 'nosniff');
  appendVaryHeader(c, 'Origin');
  appendVaryHeader(c, 'X-Glympse-User-Did');
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

premiumAiRouter.use('*', async (c, next) => {
  try {
    await next();
  } finally {
    applySecurityHeaders(c);
  }
});

premiumAiRouter.get('/entitlements', (c) => {
  const actorDid = actorDidFromRequest(c);
  if (actorDid) {
    assertTrustedBrowserOrigin(c, 'Premium AI entitlements');
  }
  return c.json(resolvePremiumAiEntitlements(actorDid));
});

premiumAiRouter.post('/interpolator/deep', async (c) => {
  const actorDid = actorDidFromRequest(c, true);
  const requestId = c.req.header('X-Request-Id') || crypto.randomUUID();
  assertTrustedBrowserOrigin(c, 'Premium AI deep interpolator');
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
    const request: PremiumInterpolatorRequest = {
      ...rest,
      actorDid,
      ...(typeof visibleReplyCount === 'number'
        ? { visibleReplyCount }
        : {}),
    };
    const result = await writePremiumDeepInterpolator(request);
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

    if (!safety.passed || typeof filtered.summary !== 'string' || !filtered.summary.trim()) {
      throw Object.assign(new Error('Premium AI output failed safety validation'), { status: 503 });
    }

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
    console.error('[premium-ai/interpolator/deep]', message);
    return c.json({ error: 'Premium AI failed' }, safeStatus);
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
