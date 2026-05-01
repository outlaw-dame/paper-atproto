import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { ComposerClassifierResponseSchema, ComposerClassifierSchema } from '../llm/schemas.js';
import {
  enforceNoToolsAuthorized,
  finalizeLlmOutput,
  prepareLlmInput,
} from '../llm/policyGateway.js';
import { ValidationError } from '../lib/errors.js';
import { runComposerClassifier } from '../services/composerClassifier.js';
import { CircuitBreaker, CircuitOpenError } from '../lib/circuit-breaker.js';

type ComposerClassifierRouterContext = {
  Variables: {
    requestId: string;
  };
};

export const composerClassifierRouter = new Hono<ComposerClassifierRouterContext>();

const REQUEST_ID_HEADER = 'X-Request-Id';
const classifierCircuitBreaker = new CircuitBreaker({
  failureThreshold: 6,
  openMs: 20_000,
  halfOpenMaxTrials: 2,
});

function buildRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `composer-classifier-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function requestIdFromContext(c: Context<ComposerClassifierRouterContext>): string {
  return c.get('requestId') ?? buildRequestId();
}

function validationIssues(error: ValidationError): unknown {
  return (error.details as { issues?: unknown } | undefined)?.issues;
}

function logClassifierRouteEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  payload: Record<string, unknown>,
): void {
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  logger('[llm/analyze/composer-classifier]', {
    event,
    at: new Date().toISOString(),
    ...payload,
  });
}

function classifyError(error: unknown): string {
  if (error instanceof CircuitOpenError) return 'circuit_open';
  if (error instanceof ValidationError) return 'validation_error';
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('abort')) return 'aborted';
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  return 'unknown';
}

composerClassifierRouter.use('*', async (c, next) => {
  const requestId = c.req.header(REQUEST_ID_HEADER) || buildRequestId();
  c.set('requestId', requestId);
  c.header(REQUEST_ID_HEADER, requestId);
  c.header('Cache-Control', 'no-store, private');
  c.header('X-Content-Type-Options', 'nosniff');

  const startedAt = Date.now();
  try {
    await next();
  } finally {
    logClassifierRouteEvent('info', 'request_completed', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
  }
});

composerClassifierRouter.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const requestId = requestIdFromContext(c);
  let prepared: { data: z.infer<typeof ComposerClassifierSchema> };

  try {
    prepared = prepareLlmInput(ComposerClassifierSchema, body, {
      task: 'composerClassifier',
      requestId,
    });
    enforceNoToolsAuthorized({
      task: 'composerClassifier',
      requestId,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message, issues: validationIssues(error) }, 400);
    }
    throw error;
  }

  const startedAt = Date.now();
  try {
    classifierCircuitBreaker.assertCanRequest();
    const result = await runComposerClassifier(prepared.data);
    classifierCircuitBreaker.recordSuccess();
    const { data } = finalizeLlmOutput(
      ComposerClassifierResponseSchema,
      result,
      {
        task: 'composerClassifier',
        requestId,
      },
    );

    logClassifierRouteEvent('info', 'classifier_success', {
      requestId,
      durationMs: Date.now() - startedAt,
      confidence: data.confidence,
      toolsUsed: data.toolsUsed,
      circuitState: classifierCircuitBreaker.currentState(),
    });

    return c.json(data);
  } catch (error) {
    if (!(error instanceof CircuitOpenError)) {
      classifierCircuitBreaker.recordFailure();
    }

    logClassifierRouteEvent(error instanceof CircuitOpenError ? 'warn' : 'error', 'classifier_failure', {
      requestId,
      durationMs: Date.now() - startedAt,
      errorClass: classifyError(error),
      errorMessage: error instanceof Error ? error.message : String(error),
      circuitState: classifierCircuitBreaker.currentState(),
    });

    if (error instanceof CircuitOpenError) {
      const retryAfterSeconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json({
        error: 'Composer classifier temporarily unavailable',
        code: 'CIRCUIT_OPEN',
        requestId,
      }, 503);
    }

    if (error instanceof ValidationError) {
      return c.json({ error: error.message, issues: validationIssues(error) }, 400);
    }

    return c.json({
      error: 'Composer classifier failed',
      requestId,
    }, 503);
  }
});

composerClassifierRouter.onError((error, c) => {
  const requestId = requestIdFromContext(c);
  logClassifierRouteEvent('error', 'unhandled_error', {
    requestId,
    errorClass: classifyError(error),
    errorMessage: error instanceof Error ? error.message : String(error),
  });

  if (error instanceof ValidationError) {
    return c.json({ error: error.message, issues: validationIssues(error) }, 400);
  }

  return c.json({
    error: 'Composer classifier failed',
    requestId,
  }, 503);
});
