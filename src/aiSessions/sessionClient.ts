import { getConfiguredApiBaseUrl, resolveApiUrl } from '../lib/apiBase';
import { composeAbortSignals, sleepWithAbort } from '../lib/abortSignals';
import {
  AiSessionEventSchema,
  type AiSessionId,
  BootstrapResponseSchema,
  LaneReadResponseSchema,
  PresenceEventSchema,
  ResolveSessionResponseSchema,
  StateEventSchema,
} from './sessionSchemas';

const BASE_URL = getConfiguredApiBaseUrl(
  (import.meta as any).env?.VITE_GLYMPSE_AI_SESSIONS_BASE_URL,
  (import.meta as any).env?.VITE_GLYMPSE_API_BASE_URL,
);

const DEFAULT_TIMEOUT_MS = 12_000;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 300;
const RETRY_MAX_MS = 5000;
const RETRY_JITTER = 0.25;
const SESSION_ID_PATTERN = /^as_[a-zA-Z0-9_-]+$/;
const DID_PATTERN = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;
const CLIENT_ACTION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

type RequestError = Error & { status?: number; retryable?: boolean };

function backoffMs(attempt: number): number {
  const exp = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
  const jitterSpread = exp * RETRY_JITTER;
  return Math.floor(exp - jitterSpread + Math.random() * jitterSpread * 2);
}

function isRetryableStatus(status: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function makeRequestError(message: string, status?: number): RequestError {
  const error = new Error(message) as RequestError;
  if (typeof status === 'number') {
    error.status = status;
    error.retryable = isRetryableStatus(status);
  }
  return error;
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const raw = headerValue.trim();
  if (!raw) return null;

  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(RETRY_MAX_MS, Math.max(RETRY_BASE_MS, Math.round(asSeconds * 1000)));
  }

  const asDate = Date.parse(raw);
  if (!Number.isFinite(asDate)) return null;
  const delta = asDate - Date.now();
  if (delta <= 0) return RETRY_BASE_MS;
  return Math.min(RETRY_MAX_MS, Math.max(RETRY_BASE_MS, delta));
}

function sanitizeText(value: string, maxLen: number): string {
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) : clean;
}

function sanitizeDid(did: string): string {
  const clean = sanitizeText(did, 190);
  if (!DID_PATTERN.test(clean)) {
    const error = new Error('Invalid DID format') as RequestError;
    error.retryable = false;
    throw error;
  }
  return clean;
}

function sanitizeSessionId(sessionId: string): AiSessionId {
  const clean = sanitizeText(sessionId, 128);
  if (clean.length < 12 || !SESSION_ID_PATTERN.test(clean)) {
    const error = new Error('Invalid session ID format') as RequestError;
    error.retryable = false;
    throw error;
  }
  return clean as AiSessionId;
}

function sanitizeClientActionId(clientActionId: string): string {
  const clean = sanitizeText(clientActionId, 128);
  if (clean.length < 12 || !CLIENT_ACTION_ID_PATTERN.test(clean)) {
    const error = new Error('Invalid clientActionId format') as RequestError;
    error.retryable = false;
    throw error;
  }
  return clean;
}

function sanitizeRootUri(rootUri: string): string {
  const clean = sanitizeText(rootUri, 600);
  if (!clean) {
    const error = new Error('rootUri is required') as RequestError;
    error.retryable = false;
    throw error;
  }
  return clean;
}

function sanitizeOptionalArtifactId(targetArtifactId: string | undefined): string | undefined {
  if (!targetArtifactId) return undefined;
  const clean = sanitizeText(targetArtifactId, 128);
  if (!clean) {
    const error = new Error('targetArtifactId must not be empty') as RequestError;
    error.retryable = false;
    throw error;
  }
  return clean;
}

function sanitizeMessageContent(content: string): string {
  const clean = sanitizeText(content, 6000);
  if (!clean) {
    const error = new Error('content is required') as RequestError;
    error.retryable = false;
    throw error;
  }
  return clean;
}

function sanitizeUnknownJson(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value === null) return null;

  const kind = typeof value;
  if (kind === 'string') return sanitizeText(value as string, 300);
  if (kind === 'number') return Number.isFinite(value) ? value : null;
  if (kind === 'boolean') return value;
  if (Array.isArray(value)) {
    return (value as unknown[]).slice(0, 50).map((item) => sanitizeUnknownJson(item, depth + 1));
  }
  if (kind === 'object') {
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    let count = 0;
    for (const [key, nested] of Object.entries(source)) {
      if (count >= 50) break;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const safeKey = sanitizeText(key, 64);
      if (!safeKey) continue;
      target[safeKey] = sanitizeUnknownJson(nested, depth + 1);
      count += 1;
    }
    return target;
  }

  return null;
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const sanitized = sanitizeUnknownJson(metadata);
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
    return undefined;
  }
  return sanitized as Record<string, unknown>;
}

function isRetryableError(error: unknown): boolean {
  if ((error as RequestError)?.retryable === true) return true;
  if ((error as RequestError)?.retryable === false) return false;

  // Network stack issues and internal timeouts are transient by default.
  if (error instanceof DOMException && error.name === 'AbortError') return true;

  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();
    return message.includes('network')
      || message.includes('fetch')
      || message.includes('failed')
      || message.includes('timeout')
      || message.includes('timed out');
  }

  if (error instanceof Error) {
    const anyErr = error as { code?: string };
    const message = error.message.toLowerCase();
    if (
      message.includes('network')
      || message.includes('fetch')
      || message.includes('timeout')
      || message.includes('timed out')
      || message.includes('econnreset')
      || message.includes('etimedout')
    ) {
      return true;
    }
    if (anyErr.code === 'ECONNRESET' || anyErr.code === 'ETIMEDOUT') {
      return true;
    }
  }

  return false;
}

async function fetchJsonWithRetry<T>(
  path: string,
  did: string,
  options?: {
    method?: 'GET' | 'POST';
    body?: unknown;
    query?: URLSearchParams;
    signal?: AbortSignal;
    attempts?: number;
  },
): Promise<T> {
  const safeDid = sanitizeDid(did);
  const attempts = Math.max(1, options?.attempts ?? RETRY_ATTEMPTS);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const combinedSignal = options?.signal
      ? composeAbortSignals([options.signal, controller.signal])
      : controller.signal;

    try {
      const query = options?.query ? `?${options.query.toString()}` : '';
      const endpoint = resolveApiUrl(`${path}${query}`, BASE_URL);
      const response = await fetch(endpoint, {
        method: options?.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Glympse-User-Did': safeDid,
        },
        ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
        signal: combinedSignal,
      });

      if (!response.ok) {
        const canRetry = isRetryableStatus(response.status);
        const errorText = await response.text().catch(() => '');
        const error = makeRequestError(`Request failed ${response.status}: ${errorText.slice(0, 240)}`, response.status);
        lastError = error;
        if (attempt < attempts - 1 && canRetry) {
          const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
          await sleepWithAbort(retryAfterMs ?? backoffMs(attempt), options?.signal);
          continue;
        }
        throw error;
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.name === 'AbortError') {
        // Respect explicit caller cancellation, but retry internal per-attempt timeouts.
        if (options?.signal?.aborted) {
          throw error;
        }
      }
      const retryable = isRetryableError(error);
      if (!retryable) {
        throw error;
      }
      if (attempt >= attempts - 1) {
        throw error;
      }
      await sleepWithAbort(backoffMs(attempt), options?.signal);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError;
}

export async function resolveThreadSummarySession(rootUri: string, did: string): Promise<{ sessionId: AiSessionId }> {
  const body = {
    rootUri: sanitizeRootUri(rootUri),
    privacyMode: 'private' as const,
  };
  const json = await fetchJsonWithRetry<unknown>('/api/ai/sessions/thread-summary/resolve', did, {
    method: 'POST',
    body,
  });
  const parsed = ResolveSessionResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error('Invalid resolve session response');
  }
  return { sessionId: parsed.data.sessionId };
}

export async function bootstrapAiSession(sessionId: AiSessionId, did: string) {
  const safeSessionId = sanitizeSessionId(sessionId);
  const json = await fetchJsonWithRetry<unknown>(`/api/ai/sessions/${safeSessionId}/bootstrap`, did, {
    method: 'GET',
  });
  const parsed = BootstrapResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error('Invalid bootstrap response');
  }
  return parsed.data;
}

export async function readEventLane(sessionId: AiSessionId, did: string, offset: number, limit = 200) {
  const safeSessionId = sanitizeSessionId(sessionId);
  const query = new URLSearchParams({
    offset: String(Math.max(0, offset)),
    limit: String(Math.max(1, Math.min(limit, 500))),
    live: 'false',
  });
  const json = await fetchJsonWithRetry<unknown>(`/api/ai/sessions/${safeSessionId}/events`, did, {
    method: 'GET',
    query,
  });
  const parsed = LaneReadResponseSchema(AiSessionEventSchema).safeParse(json);
  if (!parsed.success) {
    throw new Error('Invalid event lane response');
  }
  return parsed.data;
}

export async function readStateLane(sessionId: AiSessionId, did: string, offset: number, limit = 200) {
  const safeSessionId = sanitizeSessionId(sessionId);
  const query = new URLSearchParams({
    offset: String(Math.max(0, offset)),
    limit: String(Math.max(1, Math.min(limit, 500))),
    live: 'false',
  });
  const json = await fetchJsonWithRetry<unknown>(`/api/ai/sessions/${safeSessionId}/state`, did, {
    method: 'GET',
    query,
  });
  const parsed = LaneReadResponseSchema(StateEventSchema).safeParse(json);
  if (!parsed.success) {
    throw new Error('Invalid state lane response');
  }
  return parsed.data;
}

export async function readPresenceLane(sessionId: AiSessionId, did: string, offset: number, limit = 200) {
  const safeSessionId = sanitizeSessionId(sessionId);
  const query = new URLSearchParams({
    offset: String(Math.max(0, offset)),
    limit: String(Math.max(1, Math.min(limit, 500))),
    live: 'false',
  });
  const json = await fetchJsonWithRetry<unknown>(`/api/ai/sessions/${safeSessionId}/presence`, did, {
    method: 'GET',
    query,
  });
  const parsed = LaneReadResponseSchema(PresenceEventSchema).safeParse(json);
  if (!parsed.success) {
    throw new Error('Invalid presence lane response');
  }
  return parsed.data;
}

export async function sendSessionMessage(
  sessionId: AiSessionId,
  did: string,
  payload: {
    clientActionId: string;
    kind: 'message' | 'regenerate' | 'ask_followup' | 'revise_summary' | 'critique' | 'tool_action';
    content: string;
    targetArtifactId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const safeSessionId = sanitizeSessionId(sessionId);
  const safeClientActionId = sanitizeClientActionId(payload.clientActionId);
  const safeTargetArtifactId = sanitizeOptionalArtifactId(payload.targetArtifactId);
  const safeMetadata = sanitizeMetadata(payload.metadata);
  await fetchJsonWithRetry<unknown>(`/api/ai/sessions/${safeSessionId}/messages`, did, {
    method: 'POST',
    body: {
      ...payload,
      clientActionId: safeClientActionId,
      content: sanitizeMessageContent(payload.content),
      ...(safeTargetArtifactId ? { targetArtifactId: safeTargetArtifactId } : {}),
      ...(safeMetadata ? { metadata: safeMetadata } : {}),
    },
  });
}

export async function sendTypingPresence(
  sessionId: AiSessionId,
  did: string,
  isTyping: boolean,
  expiresInMs = 6000,
): Promise<void> {
  const safeSessionId = sanitizeSessionId(sessionId);
  const safeExpiresInMs = Math.max(1000, Math.min(10_000, Math.floor(expiresInMs)));
  await fetchJsonWithRetry<unknown>(`/api/ai/sessions/${safeSessionId}/presence`, did, {
    method: 'POST',
    body: {
      isTyping,
      expiresInMs: safeExpiresInMs,
    },
  });
}
