import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { AppError, UpstreamError, ValidationError } from '../lib/errors.js';
import {
  appendVaryHeader,
  assertTrustedBrowserOrigin,
} from '../lib/originPolicy.js';
import {
  classifyConversationWatchError,
  computeConversationWatchBackoffMs,
  fetchConversationThreadSnapshot,
  normalizeConversationWatchRootUri,
  type ConversationThreadSnapshot,
} from '../lib/conversationThreadWatch.js';

const WATCH_HEARTBEAT_MS = 15_000;
const WATCH_POLL_INTERVAL_MS = 12_000;
const WATCH_MAX_LIFETIME_MS = 4 * 60_000;
const WATCH_READY_RETRY_MS = 2_500;
const WATCH_CLOSE_RETRY_MS = 1_500;
const WATCH_MAX_CONSECUTIVE_FAILURES = 6;

const WatchQuerySchema = z.object({
  rootUri: z.string().min(12).max(320),
});

function applySecurityHeaders(headers: Headers): void {
  headers.set('Cache-Control', 'no-store, private, no-transform');
  headers.set('Pragma', 'no-cache');
  headers.set('Content-Type', 'text/event-stream; charset=utf-8');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Connection', 'keep-alive');
  headers.set('X-Accel-Buffering', 'no');
}

function encodeSseEvent(params: {
  event: string;
  data: Record<string, unknown>;
  retryMs?: number;
}): Uint8Array {
  const lines: string[] = [];
  if (typeof params.retryMs === 'number' && Number.isFinite(params.retryMs) && params.retryMs > 0) {
    lines.push(`retry: ${Math.max(500, Math.floor(params.retryMs))}`);
  }
  lines.push(`event: ${params.event}`);
  for (const line of JSON.stringify(params.data).split('\n')) {
    lines.push(`data: ${line}`);
  }
  lines.push('', '');
  return new TextEncoder().encode(lines.join('\n'));
}

function safeOriginCheck(c: Parameters<typeof assertTrustedBrowserOrigin>[0]): void {
  const rawOrigin = c.req.header('Origin');
  if (!rawOrigin || !rawOrigin.trim()) return;
  assertTrustedBrowserOrigin(c, 'Conversation watch');
}

function parseRootUri(c: Context): string {
  const parsed = WatchQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    throw new ValidationError('Invalid query params', parsed.error.issues);
  }

  const rootUri = normalizeConversationWatchRootUri(parsed.data.rootUri);
  if (!rootUri) {
    throw new ValidationError('Conversation watch requires a valid rootUri');
  }
  return rootUri;
}

function mapInitialSnapshotError(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (error instanceof UpstreamError && error.status === 404) {
    throw new AppError(404, 'NOT_FOUND', 'Conversation root was not found');
  }
  throw new AppError(503, 'UPSTREAM_UNAVAILABLE', 'Conversation watch could not reach AppView');
}

export const conversationWatchRouter = new Hono();

conversationWatchRouter.get('/watch', async (c) => {
  safeOriginCheck(c);
  appendVaryHeader(c, 'Origin');
  appendVaryHeader(c, 'Accept');

  const rootUri = parseRootUri(c);

  const initialSnapshot = await fetchConversationThreadSnapshot(rootUri, {
    signal: c.req.raw.signal,
  }).catch((error: unknown) => {
    mapInitialSnapshotError(error);
  }) as ConversationThreadSnapshot;

  const headers = new Headers();
  applySecurityHeaders(headers);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastSnapshot = initialSnapshot;
      let consecutiveFailures = 0;
      let invalidationSequence = 0;
      let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
      let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
      let lifetimeTimeoutId: ReturnType<typeof setTimeout> | null = null;

      const clearTimers = () => {
        if (pollTimeoutId !== null) clearTimeout(pollTimeoutId);
        if (heartbeatIntervalId !== null) clearInterval(heartbeatIntervalId);
        if (lifetimeTimeoutId !== null) clearTimeout(lifetimeTimeoutId);
        pollTimeoutId = null;
        heartbeatIntervalId = null;
        lifetimeTimeoutId = null;
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearTimers();
        try {
          controller.close();
        } catch {
          // best-effort stream shutdown
        }
      };

      const send = (event: string, data: Record<string, unknown>, retryMs?: number) => {
        if (closed) return;
        try {
          controller.enqueue(encodeSseEvent({
            event,
            data,
            ...(retryMs !== undefined ? { retryMs } : {}),
          }));
        } catch {
          close();
        }
      };

      const schedulePoll = (delayMs: number) => {
        if (closed) return;
        if (pollTimeoutId !== null) clearTimeout(pollTimeoutId);
        pollTimeoutId = setTimeout(() => {
          void poll();
        }, delayMs);
      };

      const poll = async () => {
        if (closed) return;

        try {
          const nextSnapshot = await fetchConversationThreadSnapshot(rootUri, {
            signal: c.req.raw.signal,
          });
          if (closed) return;

          consecutiveFailures = 0;
          if (nextSnapshot.signature !== lastSnapshot.signature) {
            invalidationSequence += 1;
            lastSnapshot = nextSnapshot;
            send('invalidation', {
              rootUri,
              reason: 'remote_thread_changed',
              observedAt: nextSnapshot.observedAt,
              sequence: invalidationSequence,
              replyCount: nextSnapshot.replyCount,
              nodeCount: nextSnapshot.nodeCount,
              latestReplyAt: nextSnapshot.latestReplyAt,
            });
          } else {
            lastSnapshot = nextSnapshot;
          }

          schedulePoll(WATCH_POLL_INTERVAL_MS);
        } catch (error) {
          if (closed || c.req.raw.signal.aborted) {
            close();
            return;
          }

          consecutiveFailures += 1;
          const failure = classifyConversationWatchError(error);
          const retryMs = computeConversationWatchBackoffMs(consecutiveFailures - 1, error);

          send('status', {
            rootUri,
            state: 'degraded',
            code: failure.code,
            retryable: failure.retryable,
            retryAfterMs: failure.retryAfterMs ?? retryMs,
            observedAt: new Date().toISOString(),
          }, retryMs);

          if (!failure.retryable || consecutiveFailures >= WATCH_MAX_CONSECUTIVE_FAILURES) {
            close();
            return;
          }

          schedulePoll(retryMs);
        }
      };

      c.req.raw.signal.addEventListener('abort', close, { once: true });

      send('ready', {
        rootUri,
        observedAt: initialSnapshot.observedAt,
        replyCount: initialSnapshot.replyCount,
        nodeCount: initialSnapshot.nodeCount,
        latestReplyAt: initialSnapshot.latestReplyAt,
        pollIntervalMs: WATCH_POLL_INTERVAL_MS,
      }, WATCH_READY_RETRY_MS);

      heartbeatIntervalId = setInterval(() => {
        send('heartbeat', {
          rootUri,
          observedAt: new Date().toISOString(),
        });
      }, WATCH_HEARTBEAT_MS);

      lifetimeTimeoutId = setTimeout(() => {
        send('status', {
          rootUri,
          state: 'reconnect',
          retryable: true,
          retryAfterMs: WATCH_CLOSE_RETRY_MS,
          observedAt: new Date().toISOString(),
        }, WATCH_CLOSE_RETRY_MS);
        close();
      }, WATCH_MAX_LIFETIME_MS);

      schedulePoll(WATCH_POLL_INTERVAL_MS);
    },
    cancel() {
      // The request signal handler closes the stream and clears timers.
    },
  });

  return new Response(stream, {
    status: 200,
    headers,
  });
});
