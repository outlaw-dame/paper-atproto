import { env } from '../../config/env.js';
import { withRetry } from '../../lib/retry.js';
import { UpstreamError } from '../../lib/errors.js';

function toUpstreamUrl(baseUrl: string, sessionId: string, rawQuery: string): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(sessionId)}`);
  if (rawQuery) {
    const params = new URLSearchParams(rawQuery);
    for (const [key, value] of params.entries()) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function getDurableReadBase(lane: 'events' | 'state' | 'presence'): string | null {
  if (lane === 'events') return env.AI_DURABLE_EVENTS_READ_BASE_URL ?? null;
  if (lane === 'state') return env.AI_DURABLE_STATE_READ_BASE_URL ?? null;
  return env.AI_DURABLE_PRESENCE_READ_BASE_URL ?? null;
}

export async function proxyDurableRead(
  lane: 'events' | 'state' | 'presence',
  sessionId: string,
  rawQuery: string,
): Promise<Response | null> {
  const baseUrl = getDurableReadBase(lane);
  if (!baseUrl) return null;

  const url = toUpstreamUrl(baseUrl, sessionId, rawQuery);

  const response = await withRetry<Response>(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.AI_DURABLE_READ_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json, text/event-stream;q=0.9, */*;q=0.1',
            ...(env.AI_DURABLE_READ_BEARER_TOKEN
              ? { Authorization: `Bearer ${env.AI_DURABLE_READ_BEARER_TOKEN}` }
              : {}),
          },
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new UpstreamError('Durable read failed', {
            lane,
            status: res.status,
            body: text.slice(0, 500),
          }, res.status >= 400 && res.status < 500 ? res.status : 502);
        }

        return res;
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') {
          throw new UpstreamError('Durable read timed out', { lane, timeoutMs: env.AI_DURABLE_READ_TIMEOUT_MS }, 504);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    {
      attempts: env.AI_DURABLE_RETRY_ATTEMPTS,
      baseDelayMs: 250,
      maxDelayMs: 3000,
      jitter: true,
      shouldRetry: (error) => {
        const status = (error as { status?: number }).status;
        return !status || [408, 425, 429, 500, 502, 503, 504].includes(status);
      },
    },
  );

  const headers = new Headers();
  const contentType = response.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const cacheControl = response.headers.get('cache-control');
  if (cacheControl) headers.set('cache-control', cacheControl);

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
