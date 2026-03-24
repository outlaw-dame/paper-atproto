import { UpstreamError } from './errors.js';
import { env } from '../config/env.js';
import { withRetry } from './retry.js';

export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = env.VERIFY_TIMEOUT_MS,
): Promise<T> {
  return withRetry<T>(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            ...(init?.headers ?? {}),
          },
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new UpstreamError(
            `Upstream request failed with status ${response.status}`,
            { status: response.status, body: text.slice(0, 500), url },
            response.status >= 400 && response.status < 500 ? response.status : 502,
          );
        }

        return (await response.json()) as T;
      } catch (error: unknown) {
        if ((error as { name?: string })?.name === 'AbortError') {
          throw new UpstreamError('Upstream request timed out', { url, timeoutMs }, 504);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    {
      attempts: env.VERIFY_RETRY_ATTEMPTS,
      baseDelayMs: 300,
      maxDelayMs: 3000,
      jitter: true,
      shouldRetry: (error) => {
        const status = (error as { status?: number })?.status;
        return !status || [408, 425, 429, 500, 502, 503, 504].includes(status);
      },
    },
  );
}
