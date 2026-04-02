import { env } from '../../config/env.js';
import { withRetry } from '../../lib/retry.js';
import { UpstreamError } from '../../lib/errors.js';
import type { AiSessionEvent, PresenceEvent, StateEvent } from './schemas.js';

type Lane = 'events' | 'state' | 'presence';
type AppendPayload = AiSessionEvent | StateEvent | PresenceEvent;

type DurableAppendResult = {
  offset: number | null;
};

type DurableReadResult<T> = {
  items: Array<{ offset: number; payload: T }>;
  nextOffset: number;
};

const DEFAULT_TIMEOUT_MS = 12_000;

function buildStreamUrl(baseUrl: string, sessionId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(sessionId)}`;
}

function laneBaseUrl(lane: Lane, mode: 'read' | 'write'): string | null {
  if (lane === 'events') {
    return mode === 'read'
      ? env.AI_DURABLE_EVENTS_READ_BASE_URL ?? null
      : env.AI_DURABLE_EVENTS_WRITE_BASE_URL ?? null;
  }
  if (lane === 'state') {
    return mode === 'read'
      ? env.AI_DURABLE_STATE_READ_BASE_URL ?? null
      : env.AI_DURABLE_STATE_WRITE_BASE_URL ?? null;
  }
  return mode === 'read'
    ? env.AI_DURABLE_PRESENCE_READ_BASE_URL ?? null
    : env.AI_DURABLE_PRESENCE_WRITE_BASE_URL ?? null;
}

function authHeaders(mode: 'read' | 'write'): HeadersInit {
  const token = mode === 'read'
    ? env.AI_DURABLE_READ_BEARER_TOKEN
    : (env.AI_DURABLE_WRITE_BEARER_TOKEN ?? env.AI_DURABLE_READ_BEARER_TOKEN);
  if (!token) return {};
  return {
    Authorization: `Bearer ${token}`,
  };
}

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
}

function parseOffsetHeader(response: Response): number | null {
  const raw =
    response.headers.get('x-stream-offset')
    ?? response.headers.get('x-durable-offset')
    ?? response.headers.get('next-offset');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseNextOffset(response: Response, body: unknown): number | null {
  const headerRaw =
    response.headers.get('x-next-offset')
    ?? response.headers.get('next-offset')
    ?? response.headers.get('x-stream-next-offset');
  if (headerRaw) {
    const parsedHeader = Number(headerRaw);
    if (Number.isFinite(parsedHeader) && parsedHeader >= 0) {
      return parsedHeader;
    }
  }

  const candidate = body as { nextOffset?: unknown; next_offset?: unknown } | null;
  const bodyRaw = candidate?.nextOffset ?? candidate?.next_offset;
  if (typeof bodyRaw !== 'number' || !Number.isFinite(bodyRaw) || bodyRaw < 0) {
    return null;
  }
  return bodyRaw;
}

function shouldRetry(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  return !status || [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const raw = headerValue.trim();
  if (!raw) return null;

  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(10_000, Math.max(250, Math.round(asSeconds * 1000)));
  }

  const asDate = Date.parse(raw);
  if (!Number.isFinite(asDate)) return null;
  const delta = asDate - Date.now();
  if (delta <= 0) return 250;
  return Math.min(10_000, Math.max(250, delta));
}

async function requestWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return withRetry<Response>(
    async () => {
      const { signal, clear } = createTimeoutSignal(timeoutMs);
      try {
        const response = await fetch(url, {
          ...init,
          signal,
        });
        if (!response.ok) {
          const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
          throw new UpstreamError('Durable stream request failed', {
            url,
            status: response.status,
            retryAfterMs,
          }, response.status >= 400 && response.status < 500 ? response.status : 502);
        }
        return response;
      } catch (error: unknown) {
        if ((error as { name?: string }).name === 'AbortError') {
          throw new UpstreamError('Durable stream request timed out', { url, timeoutMs }, 504);
        }
        throw error;
      } finally {
        clear();
      }
    },
    {
      attempts: env.AI_DURABLE_RETRY_ATTEMPTS,
      baseDelayMs: 250,
      maxDelayMs: 3000,
      jitter: true,
      shouldRetry,
    },
  );
}

export function durableLaneConfigured(lane: Lane): boolean {
  return !!(laneBaseUrl(lane, 'read') && laneBaseUrl(lane, 'write'));
}

export async function ensureDurableStream(lane: Lane, sessionId: string): Promise<void> {
  const writeBase = laneBaseUrl(lane, 'write');
  if (!writeBase) return;
  const url = buildStreamUrl(writeBase, sessionId);

  try {
    await requestWithRetry(
      url,
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json, */*;q=0.8',
          ...authHeaders('write'),
        },
      },
      env.AI_DURABLE_WRITE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
    );
  } catch (error) {
    if ((error as { status?: number }).status === 409) return;
    throw error;
  }
}

export async function appendDurableMessage(lane: Lane, sessionId: string, payload: AppendPayload): Promise<DurableAppendResult> {
  const writeBase = laneBaseUrl(lane, 'write');
  if (!writeBase) return { offset: null };

  const url = buildStreamUrl(writeBase, sessionId);
  const response = await requestWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json, */*;q=0.8',
        'Content-Type': 'application/json',
        'Idempotency-Key': `${lane}:${sessionId}:${payload.id}`,
        ...authHeaders('write'),
      },
      body: JSON.stringify(payload),
    },
    env.AI_DURABLE_WRITE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  );

  const headerOffset = parseOffsetHeader(response);
  if (headerOffset !== null) {
    return { offset: headerOffset };
  }

  const json = await response.json().catch(() => null) as { offset?: number; nextOffset?: number } | null;
  const rawOffset = json?.offset ?? json?.nextOffset;
  return {
    offset: typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? rawOffset : null,
  };
}

function normalizeReadItems<T>(body: unknown): Array<{ offset: number; payload: T }> {
  const source = Array.isArray(body)
    ? body
    : (body as { items?: unknown[] } | null)?.items;

  if (!Array.isArray(source)) return [];

  const normalized: Array<{ offset: number; payload: T }> = [];
  for (const raw of source) {
    const mapped = raw as { offset?: unknown; payload?: unknown; data?: unknown };
    const offset = Number(mapped.offset);
    const payload = (mapped.payload ?? mapped.data) as T | undefined;
    if (!Number.isFinite(offset) || offset < 0 || payload === undefined) continue;
    normalized.push({ offset, payload });
  }

  normalized.sort((a, b) => a.offset - b.offset);
  return normalized;
}

export async function readDurableLane<T>(
  lane: Lane,
  sessionId: string,
  offset: number,
  limit: number,
): Promise<DurableReadResult<T> | null> {
  const readBase = laneBaseUrl(lane, 'read');
  if (!readBase) return null;

  const url = new URL(buildStreamUrl(readBase, sessionId));
  url.searchParams.set('offset', String(Math.max(0, offset)));
  url.searchParams.set('limit', String(Math.max(1, Math.min(limit, 500))));
  url.searchParams.set('live', 'false');

  const response = await requestWithRetry(
    url.toString(),
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders('read'),
      },
    },
    env.AI_DURABLE_READ_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  );

  const body = await response.json().catch(() => null);
  const items = normalizeReadItems<T>(body);
  const derivedNextOffset = items.length > 0
    ? items[items.length - 1]!.offset + 1
    : Math.max(0, offset);
  const nextOffset = parseNextOffset(response, body) ?? derivedNextOffset;

  return {
    items,
    nextOffset,
  };
}
