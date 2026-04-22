import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { ValidationError, UnauthorizedError, AppError } from '../lib/errors.js';
import { env } from '../config/env.js';
import {
  appendVaryHeader,
  assertTrustedBrowserOrigin,
} from '../lib/originPolicy.js';
import {
  getAiSessionTelemetry,
  recordProductionRedactedError,
  recordRouteError,
  resetAiSessionTelemetry,
} from '../ai/sessions/telemetry.js';
import {
  PresenceWriteRequestSchema,
  ResolveThreadSummarySessionRequestSchema,
  SendMessageRequestSchema,
} from '../ai/sessions/schemas.js';
import {
  assertSessionAccess,
  bootstrapSession,
  readEventLane,
  readPresenceLane,
  readStateLane,
  resolveThreadSummarySession,
  writePresence,
  writeSessionMessage,
} from '../ai/sessions/store.js';
import { proxyDurableRead } from '../ai/sessions/durableProxy.js';

const OffsetQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  live: z.coerce.boolean().optional(),
});

const SessionIdParamSchema = z.string().min(12).max(128).regex(/^as_[a-zA-Z0-9_-]+$/);

function assertTelemetryAccess(c: Context): void {
  if (env.NODE_ENV !== 'production') return;

  const configuredSecret = env.AI_SESSION_TELEMETRY_ADMIN_SECRET?.trim();
  if (!configuredSecret) {
    throw new AppError(403, 'FORBIDDEN', 'Telemetry endpoint is disabled in production.');
  }

  const providedSecret = c.req.header('X-AI-Telemetry-Admin-Secret')?.trim();
  if (!providedSecret || providedSecret !== configuredSecret) {
    throw new AppError(403, 'FORBIDDEN', 'Telemetry endpoint requires an admin secret.');
  }
}

function applySecurityHeaders(c: Context): void {
  c.header('Cache-Control', 'no-store, private');
  c.header('Pragma', 'no-cache');
  c.header('X-Content-Type-Options', 'nosniff');
  appendVaryHeader(c, 'Origin');
  appendVaryHeader(c, 'X-Glympse-User-Did');
}

function parseDidHeader(c: Context): string {
  const value = c.req.header('X-Glympse-User-Did');
  if (!value) throw new UnauthorizedError('Missing X-Glympse-User-Did header');
  const did = value.trim();
  if (!/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(did)) {
    throw new UnauthorizedError('Invalid DID header format');
  }
  return did;
}

function parseJsonBody<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  return c.req.json()
    .then((body: unknown) => {
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError('Invalid request payload', parsed.error.issues);
      }
      return parsed.data;
    })
    .catch((error: unknown) => {
      if (error instanceof AppError) throw error;
      throw new ValidationError('Invalid JSON body');
    });
}

function parseSessionId(c: Context): string {
  const sessionId = c.req.param('sessionId');
  const parsed = SessionIdParamSchema.safeParse(sessionId);
  if (!parsed.success) {
    throw new ValidationError('Invalid sessionId path parameter', parsed.error.issues);
  }
  return parsed.data;
}

export const aiSessionsRouter = new Hono();

aiSessionsRouter.use('*', async (c, next) => {
  try {
    parseDidHeader(c);
    assertTrustedBrowserOrigin(c, 'AI session access');
    await next();
  } finally {
    applySecurityHeaders(c);
  }
});

aiSessionsRouter.post('/thread-summary/resolve', async (c) => {
  const callerDid = parseDidHeader(c);
  const payload = await parseJsonBody(c, ResolveThreadSummarySessionRequestSchema);
  const session = await resolveThreadSummarySession(payload.rootUri, callerDid, payload.privacyMode);
  return c.json({ sessionId: session.id, session });
});

aiSessionsRouter.get('/telemetry', (c) => {
  assertTelemetryAccess(c);
  return c.json({ telemetry: getAiSessionTelemetry() });
});

aiSessionsRouter.delete('/telemetry', (c) => {
  assertTelemetryAccess(c);
  resetAiSessionTelemetry();
  return c.body(null, 204);
});

aiSessionsRouter.get('/:sessionId/bootstrap', async (c) => {
  const callerDid = parseDidHeader(c);
  const sessionId = parseSessionId(c);
  const bootstrap = await bootstrapSession(sessionId, callerDid);
  return c.json(bootstrap);
});

aiSessionsRouter.get('/:sessionId/events', async (c) => {
  const callerDid = parseDidHeader(c);
  const sessionId = parseSessionId(c);
  await assertSessionAccess(sessionId, callerDid);

  const parsed = OffsetQuerySchema.safeParse(c.req.query());
  if (!parsed.success) throw new ValidationError('Invalid query params', parsed.error.issues);

  if (parsed.data.live === true) {
    const rawQuery = new URL(c.req.url).searchParams.toString();
    const proxied = await proxyDurableRead('events', sessionId, rawQuery);
    if (proxied) return proxied;
  }

  const lane = await readEventLane(sessionId, callerDid, parsed.data.offset, parsed.data.limit);
  return c.json({
    sessionId,
    lane: 'events',
    offset: parsed.data.offset,
    nextOffset: lane.nextOffset,
    items: lane.items,
    live: parsed.data.live ?? false,
  });
});

aiSessionsRouter.get('/:sessionId/state', async (c) => {
  const callerDid = parseDidHeader(c);
  const sessionId = parseSessionId(c);
  await assertSessionAccess(sessionId, callerDid);

  const parsed = OffsetQuerySchema.safeParse(c.req.query());
  if (!parsed.success) throw new ValidationError('Invalid query params', parsed.error.issues);

  if (parsed.data.live === true) {
    const rawQuery = new URL(c.req.url).searchParams.toString();
    const proxied = await proxyDurableRead('state', sessionId, rawQuery);
    if (proxied) return proxied;
  }

  const lane = await readStateLane(sessionId, callerDid, parsed.data.offset, parsed.data.limit);
  return c.json({
    sessionId,
    lane: 'state',
    offset: parsed.data.offset,
    nextOffset: lane.nextOffset,
    items: lane.items,
    live: parsed.data.live ?? false,
  });
});

aiSessionsRouter.get('/:sessionId/presence', async (c) => {
  const callerDid = parseDidHeader(c);
  const sessionId = parseSessionId(c);
  await assertSessionAccess(sessionId, callerDid);

  const parsed = OffsetQuerySchema.safeParse(c.req.query());
  if (!parsed.success) throw new ValidationError('Invalid query params', parsed.error.issues);

  if (parsed.data.live === true) {
    const rawQuery = new URL(c.req.url).searchParams.toString();
    const proxied = await proxyDurableRead('presence', sessionId, rawQuery);
    if (proxied) return proxied;
  }

  const lane = await readPresenceLane(sessionId, callerDid, parsed.data.offset, parsed.data.limit);
  return c.json({
    sessionId,
    lane: 'presence',
    offset: parsed.data.offset,
    nextOffset: lane.nextOffset,
    items: lane.items,
    live: parsed.data.live ?? false,
  });
});

aiSessionsRouter.post('/:sessionId/messages', async (c) => {
  const callerDid = parseDidHeader(c);
  const sessionId = parseSessionId(c);
  const payload = await parseJsonBody(c, SendMessageRequestSchema);

  const result = await writeSessionMessage(sessionId, callerDid, {
    clientActionId: payload.clientActionId,
    kind: payload.kind,
    content: payload.content,
    ...(payload.targetArtifactId ? { targetArtifactId: payload.targetArtifactId } : {}),
    ...(payload.metadata ? { metadata: payload.metadata } : {}),
  });
  return c.json({
    sessionId,
    ...result,
  }, result.deduplicated ? 200 : 202);
});

aiSessionsRouter.post('/:sessionId/presence', async (c) => {
  const callerDid = parseDidHeader(c);
  const sessionId = parseSessionId(c);
  const payload = await parseJsonBody(c, PresenceWriteRequestSchema);
  const event = await writePresence(sessionId, callerDid, payload.isTyping, payload.expiresInMs);
  return c.json({ sessionId, event }, 202);
});

aiSessionsRouter.onError((error, c) => {
  applySecurityHeaders(c);
  recordRouteError();

  if (error instanceof AppError) {
    c.status(error.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504);
    const isServerError = error.status >= 500;
    if (env.NODE_ENV === 'production' && isServerError) {
      recordProductionRedactedError();
      return c.json({ error: 'Internal server error', code: error.code });
    }
    return c.json({ error: error.message, code: error.code, details: error.details });
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error('[ai/sessions]', message.slice(0, 500));

  if (env.NODE_ENV === 'production') {
    recordProductionRedactedError();
    return c.json({ error: 'Internal server error' }, 500);
  }
  return c.json({ error: 'Internal server error' }, 500);
});
