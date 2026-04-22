import { createHash } from 'node:crypto';
import { AppError, UpstreamError } from './errors.js';
import { extractRetryAfterMs, withRetry } from './retry.js';

const AT_URI_RE = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/;
const APPVIEW_THREAD_ENDPOINT = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread';
const WATCH_THREAD_DEPTH = 6;
const WATCH_FETCH_TIMEOUT_MS = 8_000;
const WATCH_FETCH_ATTEMPTS = 3;
const WATCH_FETCH_BASE_DELAY_MS = 500;
const WATCH_FETCH_MAX_DELAY_MS = 5_000;
const WATCH_BACKOFF_BASE_MS = 1_200;
const WATCH_BACKOFF_MAX_MS = 30_000;

type ConversationWatchThreadView = {
  post?: {
    uri?: unknown;
    cid?: unknown;
    replyCount?: unknown;
    indexedAt?: unknown;
    record?: {
      createdAt?: unknown;
    };
  };
  replies?: ConversationWatchThreadView[] | null;
};

type ConversationWatchResponse = {
  thread?: ConversationWatchThreadView | null;
};

type ConversationWatchNodeSignature = {
  uri: string;
  cid: string | null;
  replyCount: number;
  indexedAt: string | null;
  childUris: string[];
};

export interface ConversationThreadSnapshot {
  rootUri: string;
  signature: string;
  replyCount: number;
  nodeCount: number;
  latestReplyAt: string | null;
  observedAt: string;
}

function normalizeBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeIsoTimestamp(value: unknown): string | null {
  const raw = normalizeBoundedString(value, 64);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function normalizeReplyCount(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.min(10_000, Math.trunc(numeric));
}

export function normalizeConversationWatchRootUri(value: unknown): string | null {
  const normalized = normalizeBoundedString(value, 320);
  if (!normalized || !AT_URI_RE.test(normalized)) return null;
  return normalized;
}

function sanitizeAppViewErrorPreview(value: unknown): string {
  return normalizeBoundedString(value, 240) ?? 'upstream error';
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined || [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function buildRequestSignal(signal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WATCH_FETCH_TIMEOUT_MS);

  const abortFromParent = () => controller.abort();
  signal?.addEventListener('abort', abortFromParent, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortFromParent);
    },
  };
}

function appendNodeSignature(
  node: ConversationWatchThreadView | null | undefined,
  signatures: ConversationWatchNodeSignature[],
  seen: Set<string>,
): void {
  if (!node || typeof node !== 'object') return;
  const post = node.post;
  const uri = normalizeConversationWatchRootUri(post?.uri);
  if (!uri || seen.has(uri)) return;
  seen.add(uri);

  const replies = Array.isArray(node.replies) ? node.replies : [];
  const childUris = replies
    .map((reply) => normalizeConversationWatchRootUri(reply?.post?.uri))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));

  signatures.push({
    uri,
    cid: normalizeBoundedString(post?.cid, 128),
    replyCount: normalizeReplyCount(post?.replyCount),
    indexedAt: normalizeIsoTimestamp(post?.indexedAt ?? post?.record?.createdAt),
    childUris,
  });

  replies.forEach((reply) => {
    appendNodeSignature(reply, signatures, seen);
  });
}

export function buildConversationThreadSnapshot(
  rootUri: string,
  payload: ConversationWatchResponse,
  observedAt: string = new Date().toISOString(),
): ConversationThreadSnapshot {
  const normalizedRootUri = normalizeConversationWatchRootUri(rootUri);
  if (!normalizedRootUri) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Conversation watch requires a valid rootUri');
  }

  const rootThread = payload?.thread;
  const rootPostUri = normalizeConversationWatchRootUri(rootThread?.post?.uri);
  if (!rootPostUri) {
    throw new UpstreamError('Conversation watch upstream returned an empty thread', undefined, 502);
  }
  if (rootPostUri !== normalizedRootUri) {
    throw new UpstreamError('Conversation watch upstream returned the wrong thread root', undefined, 502);
  }

  const nodeSignatures: ConversationWatchNodeSignature[] = [];
  appendNodeSignature(rootThread, nodeSignatures, new Set<string>());
  if (nodeSignatures.length === 0) {
    throw new UpstreamError('Conversation watch upstream returned no visible nodes', undefined, 502);
  }

  const rootNode = nodeSignatures.find((node) => node.uri === normalizedRootUri) ?? nodeSignatures[0];
  const sortedNodes = [...nodeSignatures].sort((left, right) => left.uri.localeCompare(right.uri));
  const signature = createHash('sha256')
    .update(JSON.stringify({
      rootUri: normalizedRootUri,
      nodes: sortedNodes,
    }))
    .digest('hex');

  const latestReplyAt = nodeSignatures
    .filter((node) => node.uri !== normalizedRootUri)
    .map((node) => node.indexedAt)
    .filter((value): value is string => typeof value === 'string')
    .sort()
    .at(-1) ?? null;

  return {
    rootUri: normalizedRootUri,
    signature,
    replyCount: rootNode?.replyCount ?? Math.max(0, nodeSignatures.length - 1),
    nodeCount: nodeSignatures.length,
    latestReplyAt,
    observedAt: normalizeIsoTimestamp(observedAt) ?? new Date().toISOString(),
  };
}

export async function fetchConversationThreadSnapshot(
  rootUri: string,
  options?: { signal?: AbortSignal },
): Promise<ConversationThreadSnapshot> {
  const normalizedRootUri = normalizeConversationWatchRootUri(rootUri);
  if (!normalizedRootUri) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Conversation watch requires a valid rootUri');
  }

  const url = new URL(APPVIEW_THREAD_ENDPOINT);
  url.searchParams.set('uri', normalizedRootUri);
  url.searchParams.set('depth', String(WATCH_THREAD_DEPTH));

  const payload = await withRetry<ConversationWatchResponse>(
    async () => {
      const request = buildRequestSignal(options?.signal);
      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          signal: request.signal,
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          const error = new UpstreamError(
            `Conversation watch upstream failed (${response.status})`,
            {
              status: response.status,
              body: sanitizeAppViewErrorPreview(body),
              url: url.toString(),
            },
            response.status,
          ) as UpstreamError & { headers?: Headers };
          error.headers = response.headers;
          throw error;
        }

        return await response.json() as ConversationWatchResponse;
      } catch (error) {
        if (request.signal.aborted && !(options?.signal?.aborted)) {
          throw new UpstreamError(
            'Conversation watch upstream timed out',
            { url: url.toString(), timeoutMs: WATCH_FETCH_TIMEOUT_MS },
            504,
          );
        }
        throw error;
      } finally {
        request.cleanup();
      }
    },
    {
      attempts: WATCH_FETCH_ATTEMPTS,
      baseDelayMs: WATCH_FETCH_BASE_DELAY_MS,
      maxDelayMs: WATCH_FETCH_MAX_DELAY_MS,
      jitter: true,
      shouldRetry: (error) => {
        if (options?.signal?.aborted) return false;
        const status = (error as { status?: number })?.status;
        return isRetryableStatus(status);
      },
    },
  );

  return buildConversationThreadSnapshot(normalizedRootUri, payload);
}

export function classifyConversationWatchError(error: unknown): {
  code: 'timeout' | 'rate_limited' | 'upstream_4xx' | 'upstream_5xx' | 'aborted' | 'unknown';
  retryable: boolean;
  retryAfterMs: number | null;
} {
  if ((error as { name?: string })?.name === 'AbortError') {
    return { code: 'aborted', retryable: false, retryAfterMs: null };
  }

  const status = (error as { status?: number })?.status;
  const retryAfterMs = extractRetryAfterMs(error);
  if (status === 429) {
    return { code: 'rate_limited', retryable: true, retryAfterMs };
  }
  if (status === 504) {
    return { code: 'timeout', retryable: true, retryAfterMs };
  }
  if (typeof status === 'number' && status >= 500) {
    return { code: 'upstream_5xx', retryable: true, retryAfterMs };
  }
  if (typeof status === 'number' && status >= 400) {
    return {
      code: 'upstream_4xx',
      retryable: isRetryableStatus(status),
      retryAfterMs,
    };
  }

  return { code: 'unknown', retryable: true, retryAfterMs };
}

export function computeConversationWatchBackoffMs(
  attempt: number,
  error?: unknown,
): number {
  const retryAfterMs = extractRetryAfterMs(error);
  if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)) {
    return Math.max(1_000, Math.min(WATCH_BACKOFF_MAX_MS, Math.floor(retryAfterMs)));
  }

  const exponential = Math.min(
    WATCH_BACKOFF_MAX_MS,
    WATCH_BACKOFF_BASE_MS * (2 ** Math.max(0, attempt)),
  );
  const spread = Math.floor(exponential * 0.25);
  const min = Math.max(500, exponential - spread);
  const max = exponential + spread;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
