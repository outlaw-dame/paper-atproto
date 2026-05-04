/**
 * Intelligence event envelope — the single structured telemetry record
 * that surfaces, the router orchestrator, the edge runtime, and the
 * coordinator facade emit when something interesting happens.
 *
 * Goals (from the unification task):
 *   • Replace ad-hoc `console.info('[router/audit]', …)` lines and the
 *     scattered counter buckets with a single shape that downstream code
 *     (diagnostics card, evals, dashboards) can consume.
 *   • Stay PII-free: only enums, durations, hashed-or-truncated IDs, and
 *     reason codes. Never the user's text.
 *   • Stay safe: emitting must never throw — failures inside subscribers
 *     are isolated and logged at most once per subscriber per session.
 *   • Stay bounded: the in-memory ring buffer caps memory use; the
 *     subscribers list caps fan-out.
 *
 * This file deliberately depends only on the cross-cutting vocabulary
 * (`IntelligenceLane`, `IntelligenceTask`) so it can be imported from
 * anywhere in the intelligence layer without creating cycles.
 */
import type { IntelligenceLane, IntelligenceTask } from '../intelligenceRoutingPolicy';
import type { ModelChoice } from '../../runtime/modelPolicy';

export const INTELLIGENCE_EVENT_SCHEMA_VERSION = 1 as const;

export type IntelligenceSurface =
  | 'session'
  | 'composer'
  | 'search'
  | 'discovery'
  | 'media'
  | 'sports'
  | 'router'
  | 'edge'
  | 'writer'
  | 'thinking';

export type IntelligenceStatus =
  | 'planned'
  | 'started'
  | 'succeeded'
  | 'fallback'
  | 'aborted'
  | 'errored'
  | 'skipped'
  | 'stale_discarded';

export interface IntelligenceEvent {
  schemaVersion: typeof INTELLIGENCE_EVENT_SCHEMA_VERSION;
  /** Per-event id, used for deduping in dashboards. */
  eventId: string;
  /** ISO-8601 emission time. */
  at: string;
  /** Logical surface emitting the event. */
  surface: IntelligenceSurface;
  /** Bounded task being performed when known. */
  task?: IntelligenceTask;
  /** Selected lane when known. */
  lane?: IntelligenceLane;
  /** Selected model when known. */
  model?: ModelChoice | null;
  status: IntelligenceStatus;
  /** Wall clock duration in ms when known (>= 0, finite). */
  durationMs?: number;
  /** True when the deterministic policy primary was used in place of a learned route. */
  deterministicFallback?: boolean;
  /**
   * Stable reason codes — bounded set to keep dashboards aggregable.
   * Caller-supplied; the registry does not validate them, but we
   * truncate the array and each string defensively.
   */
  reasonCodes: ReadonlyArray<string>;
  /** Optional opaque session id (already hashed/truncated upstream). */
  sessionId?: string;
  /** Optional source-token freshness marker (already a stable, redacted token). */
  sourceToken?: string;
  /**
   * Optional non-PII details. Keys are short snake_case; values are
   * primitive or short string arrays. Anything else is dropped.
   */
  details?: Readonly<Record<string, IntelligenceEventDetailValue>>;
}

export type IntelligenceEventDetailValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<string | number | boolean>;

export type IntelligenceEventInput = Omit<IntelligenceEvent, 'schemaVersion' | 'eventId' | 'at' | 'reasonCodes'> & {
  reasonCodes?: ReadonlyArray<string>;
  /** Optional override for tests. */
  at?: string;
  eventId?: string;
};

const MAX_REASON_CODES = 8;
const MAX_REASON_CODE_LENGTH = 56;
const MAX_DETAIL_KEYS = 12;
const MAX_DETAIL_STRING_LENGTH = 120;
const RING_BUFFER_CAPACITY = 256;

let ring: IntelligenceEvent[] = [];
let ringIndex = 0;
let totalEmitted = 0;

type Subscriber = (event: IntelligenceEvent) => void;
const subscribers = new Set<Subscriber>();
const failedSubscribers = new WeakSet<Subscriber>();

function safeNowIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return '1970-01-01T00:00:00.000Z';
  }
}

function safeRandomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `evt_${Date.now().toString(36)}_${Math.floor(Math.random() * 1_000_000).toString(36)}`;
}

function sanitizeReasonCodes(input: ReadonlyArray<string> | undefined): ReadonlyArray<string> {
  if (!input || input.length === 0) return Object.freeze([]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    // strip control chars, collapse whitespace, truncate
    const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_REASON_CODE_LENGTH);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= MAX_REASON_CODES) break;
  }
  return Object.freeze(out);
}

function sanitizeDetailValue(value: unknown): IntelligenceEventDetailValue | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, MAX_DETAIL_STRING_LENGTH);
  if (Array.isArray(value)) {
    const out: Array<string | number | boolean> = [];
    for (const item of value) {
      if (typeof item === 'string') out.push(item.slice(0, MAX_DETAIL_STRING_LENGTH));
      else if (typeof item === 'number' && Number.isFinite(item)) out.push(item);
      else if (typeof item === 'boolean') out.push(item);
      if (out.length >= MAX_REASON_CODES) break;
    }
    return Object.freeze(out);
  }
  return undefined;
}

function sanitizeDetails(
  details: Readonly<Record<string, IntelligenceEventDetailValue>> | undefined,
): Readonly<Record<string, IntelligenceEventDetailValue>> | undefined {
  if (!details) return undefined;
  const out: Record<string, IntelligenceEventDetailValue> = {};
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(details)) {
    if (count >= MAX_DETAIL_KEYS) break;
    const key = rawKey.replace(/[^a-z0-9_]/gi, '').slice(0, 32);
    if (!key) continue;
    const value = sanitizeDetailValue(rawValue);
    if (value === undefined) continue;
    out[key] = value;
    count += 1;
  }
  return Object.freeze(out);
}

function sanitizeShortToken(token: string | undefined, max: number): string | undefined {
  if (!token) return undefined;
  return token.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) || undefined;
}

function sanitizeDurationMs(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  // cap at one hour to keep histograms bounded
  return Math.min(value, 3_600_000);
}

function pushToRing(event: IntelligenceEvent): void {
  if (ring.length < RING_BUFFER_CAPACITY) {
    ring.push(event);
  } else {
    ring[ringIndex] = event;
    ringIndex = (ringIndex + 1) % RING_BUFFER_CAPACITY;
  }
  totalEmitted += 1;
}

function fanOut(event: IntelligenceEvent): void {
  for (const sub of subscribers) {
    if (failedSubscribers.has(sub)) continue;
    try {
      sub(event);
    } catch (err) {
      // Quarantine the subscriber so a bad consumer never spams the console.
      failedSubscribers.add(sub);
      try {
        // eslint-disable-next-line no-console
        console.warn('[intelligence/event] subscriber threw — quarantining', {
          message: err instanceof Error ? err.message : 'unknown',
        });
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Emit a single intelligence event. Never throws. Returns the canonical
 * stored event so callers can correlate (e.g. attach the eventId to a
 * console line if they still want one).
 */
export function emitIntelligenceEvent(input: IntelligenceEventInput): IntelligenceEvent {
  const event: IntelligenceEvent = Object.freeze({
    schemaVersion: INTELLIGENCE_EVENT_SCHEMA_VERSION,
    eventId: input.eventId ?? safeRandomId(),
    at: input.at ?? safeNowIso(),
    surface: input.surface,
    ...(input.task !== undefined ? { task: input.task } : {}),
    ...(input.lane !== undefined ? { lane: input.lane } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    status: input.status,
    ...(input.durationMs !== undefined
      ? (() => {
          const d = sanitizeDurationMs(input.durationMs);
          return d === undefined ? {} : { durationMs: d };
        })()
      : {}),
    ...(input.deterministicFallback !== undefined
      ? { deterministicFallback: input.deterministicFallback }
      : {}),
    reasonCodes: sanitizeReasonCodes(input.reasonCodes),
    ...(input.sessionId !== undefined
      ? (() => {
          const t = sanitizeShortToken(input.sessionId, 64);
          return t === undefined ? {} : { sessionId: t };
        })()
      : {}),
    ...(input.sourceToken !== undefined
      ? (() => {
          const t = sanitizeShortToken(input.sourceToken, 64);
          return t === undefined ? {} : { sourceToken: t };
        })()
      : {}),
    ...(input.details !== undefined
      ? (() => {
          const d = sanitizeDetails(input.details);
          return d === undefined ? {} : { details: d };
        })()
      : {}),
  });

  try {
    pushToRing(event);
    fanOut(event);
  } catch {
    // The emitter must never throw to its caller.
  }
  return event;
}

export interface IntelligenceEventBufferSnapshot {
  capacity: number;
  size: number;
  totalEmitted: number;
  events: ReadonlyArray<IntelligenceEvent>;
}

export function getIntelligenceEventBufferSnapshot(): IntelligenceEventBufferSnapshot {
  if (ring.length < RING_BUFFER_CAPACITY) {
    return Object.freeze({
      capacity: RING_BUFFER_CAPACITY,
      size: ring.length,
      totalEmitted,
      events: Object.freeze(ring.slice()),
    });
  }
  // Replay in chronological order: from ringIndex around to ringIndex - 1
  const events: IntelligenceEvent[] = [];
  for (let i = 0; i < RING_BUFFER_CAPACITY; i += 1) {
    const idx = (ringIndex + i) % RING_BUFFER_CAPACITY;
    const ev = ring[idx];
    if (ev) events.push(ev);
  }
  return Object.freeze({
    capacity: RING_BUFFER_CAPACITY,
    size: events.length,
    totalEmitted,
    events: Object.freeze(events),
  });
}

export function subscribeToIntelligenceEvents(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function resetIntelligenceEventBuffer(): void {
  ring = [];
  ringIndex = 0;
  totalEmitted = 0;
}

/** Test-only helper: clears subscribers in addition to the buffer. */
export function __resetIntelligenceEventsForTesting(): void {
  resetIntelligenceEventBuffer();
  subscribers.clear();
}
