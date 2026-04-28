import { feedService } from '../feeds';
import { normalizeExternalFeedUrl } from './feedUrls';

type FeedCategory = 'News' | 'Podcasts' | 'Videos' | 'General';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 2_500;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type FeedSubscriptionResult =
  | {
      ok: true;
      normalizedUrl: string;
      category: FeedCategory;
      result: Awaited<ReturnType<typeof feedService.addFeed>>;
    }
  | {
      ok: false;
      normalizedUrl: string | null;
      category: FeedCategory;
      reason: 'invalid_url' | 'subscribe_failed';
      message: string;
      error?: unknown;
    };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function jitteredBackoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const base = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.round(base * jitter);
}

function extractErrorStatus(error: unknown): number | null {
  const candidate = Number(
    (error as { status?: unknown })?.status
      ?? (error as { response?: { status?: unknown } })?.response?.status
      ?? NaN,
  );
  return Number.isFinite(candidate) ? candidate : null;
}

function isRetryableFeedSubscriptionError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return false;
  }

  const status = extractErrorStatus(error);
  if (status != null) {
    return RETRYABLE_STATUSES.has(status);
  }

  const message = String(
    (error as { message?: unknown })?.message
      ?? error
      ?? '',
  ).toLowerCase();

  return /network|fetch|timeout|timed out|temporar|proxy|econnreset|socket|503|502|429/.test(message);
}

export async function subscribeToExternalFeed(params: {
  rawUrl: string;
  category?: FeedCategory;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}): Promise<FeedSubscriptionResult> {
  const {
    rawUrl,
    category = 'News',
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
  } = params;

  const normalizedUrl = normalizeExternalFeedUrl(rawUrl);
  if (!normalizedUrl) {
    return {
      ok: false,
      normalizedUrl: null,
      category,
      reason: 'invalid_url',
      message: 'Enter a valid http(s) feed URL.',
    };
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt += 1) {
    try {
      const result = await feedService.addFeed(normalizedUrl, category);
      return {
        ok: true,
        normalizedUrl,
        category,
        result,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableFeedSubscriptionError(error)) {
        break;
      }
      if (attempt >= Math.max(1, maxAttempts) - 1) {
        break;
      }
      await sleep(jitteredBackoffMs(attempt, baseDelayMs, maxDelayMs));
    }
  }

  return {
    ok: false,
    normalizedUrl,
    category,
    reason: 'subscribe_failed',
    message: 'Unable to add this feed right now. Please try again.',
    error: lastError,
  };
}
