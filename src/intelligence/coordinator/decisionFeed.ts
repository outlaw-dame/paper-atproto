/**
 * Live decision feed (Phase 3).
 *
 * Consolidates verdicts from the bounded thinking lanes (composer
 * pre-flight, premium verification, supervisor planner) into a single
 * append-only feed for monitoring and downstream routing decisions.
 *
 * Design contract:
 *  - Pure, in-process, no external deps.
 *  - Append-only ring buffer with a hard size cap.
 *  - Every record is frozen, with a sanitized + length-capped reason
 *    code list and a finite duration.
 *  - Subscribers are dispatched synchronously in registration order;
 *    a throwing subscriber MUST NOT prevent other subscribers from
 *    running and MUST NOT propagate to the publisher.
 *  - `__resetDecisionFeedForTesting` clears the buffer and subscribers.
 *
 * This module does not auto-instrument the lanes. Surfaces opt in by
 * calling the lane-specific publishers below. That keeps existing call
 * sites byte-identical and allows the feed to be observed without
 * changing fault domains.
 */
import type { ThinkingResult } from './thinkingLane';
import type { PremiumVerificationResult } from '../verification/premiumVerificationLane';
import type {
  SupervisorNextStepPlannerResult,
  SupervisorNextStepPlan,
} from '../../conversation/supervisorNextStepPlanner';

export type DecisionFeedSurface =
  | 'composer_writer_preflight'
  | 'premium_verification'
  | 'supervisor_next_step';

export interface DecisionFeedRecord {
  /** Monotonic id, unique within process lifetime. */
  decisionId: string;
  surface: DecisionFeedSurface;
  /** ISO-8601 timestamp when the record was published. */
  publishedAt: string;
  /** Total wall-clock ms reported by the underlying thinking plan. */
  durationMs: number;
  /** Whether the underlying plan fell back. */
  degraded: boolean;
  /** Whether the underlying plan's verifier accepted the value. */
  ok: boolean;
  /** Aggregated reason codes (sanitized, capped). */
  reasonCodes: readonly string[];
  /** Optional surface metadata; never PII. */
  sessionId?: string;
  sourceToken?: string;
  /**
   * A small surface-specific summary. Kept narrow on purpose to avoid
   * leaking model output into the feed.
   */
  summary: DecisionFeedSummary;
}

export type DecisionFeedSummary =
  | { kind: 'composer_writer_preflight'; safeToWrite: boolean }
  | {
      kind: 'premium_verification';
      trust: 'verified' | 'low_confidence' | 'hold_until_fresh' | 'unverified';
      suggestedConfidenceCap: number;
      holdPremiumUntilFresh: boolean;
    }
  | {
      kind: 'supervisor_next_step';
      nextStepType: string | null;
      holdAll: boolean;
      prioritizedActionTypes: readonly string[];
    };

export interface DecisionFeedSnapshot {
  records: readonly DecisionFeedRecord[];
  droppedSinceReset: number;
  sequence: number;
}

export type DecisionFeedSubscriber = (record: DecisionFeedRecord) => void;

const MAX_RECORDS = 64;
const MAX_REASON_CODES = 16;
const MAX_REASON_CODE_LENGTH = 56;
const MAX_PRIORITIZED_TYPES = 8;
const MAX_SOURCE_TOKEN_LENGTH = 128;
const MAX_SESSION_ID_LENGTH = 128;

const buffer: DecisionFeedRecord[] = [];
let droppedSinceReset = 0;
let sequence = 0;
const subscribers = new Set<DecisionFeedSubscriber>();

function sanitizeReason(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const trimmed = code.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_REASON_CODE_LENGTH
    ? trimmed.slice(0, MAX_REASON_CODE_LENGTH)
    : trimmed;
}

function sanitizeReasons(input: ReadonlyArray<unknown> | undefined): readonly string[] {
  if (!Array.isArray(input)) return Object.freeze([]);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (out.length >= MAX_REASON_CODES) break;
    const norm = sanitizeReason(raw);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return Object.freeze(out);
}

function sanitizeShortString(input: unknown, maxLength: number): string | undefined {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function sanitizePrioritizedTypes(input: ReadonlyArray<unknown> | undefined): readonly string[] {
  if (!Array.isArray(input)) return Object.freeze([]);
  const out: string[] = [];
  for (const raw of input) {
    if (out.length >= MAX_PRIORITIZED_TYPES) break;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!trimmed) continue;
    out.push(trimmed.length > MAX_REASON_CODE_LENGTH ? trimmed.slice(0, MAX_REASON_CODE_LENGTH) : trimmed);
  }
  return Object.freeze(out);
}

function clampDuration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function clampUnit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function nextDecisionId(): string {
  sequence += 1;
  return `df_${sequence.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function dispatch(record: DecisionFeedRecord): void {
  for (const sub of Array.from(subscribers)) {
    try {
      sub(record);
    } catch {
      // Swallow subscriber errors. The feed must never bleed faults
      // back into the publisher.
    }
  }
}

function publish(
  surface: DecisionFeedSurface,
  thinking: Pick<ThinkingResult, 'ok' | 'degraded' | 'reasonCodes' | 'totalDurationMs'>,
  summary: DecisionFeedSummary,
  options: { sessionId?: string; sourceToken?: string } | undefined,
): DecisionFeedRecord {
  const sessionId = sanitizeShortString(options?.sessionId, MAX_SESSION_ID_LENGTH);
  const sourceToken = sanitizeShortString(options?.sourceToken, MAX_SOURCE_TOKEN_LENGTH);

  const record: DecisionFeedRecord = Object.freeze({
    decisionId: nextDecisionId(),
    surface,
    publishedAt: new Date().toISOString(),
    durationMs: clampDuration(thinking.totalDurationMs),
    degraded: thinking.degraded === true,
    ok: thinking.ok === true,
    reasonCodes: sanitizeReasons(thinking.reasonCodes),
    summary: Object.freeze({ ...summary }) as DecisionFeedSummary,
    ...(sessionId ? { sessionId } : {}),
    ...(sourceToken ? { sourceToken } : {}),
  });

  buffer.push(record);
  if (buffer.length > MAX_RECORDS) {
    buffer.shift();
    droppedSinceReset += 1;
  }
  dispatch(record);
  return record;
}

/* ────────────────────────── public API ────────────────────────── */

export function publishComposerWriterPreflightDecision(input: {
  thinking: Pick<ThinkingResult, 'ok' | 'degraded' | 'reasonCodes' | 'totalDurationMs'>;
  safeToWrite: boolean;
  sessionId?: string;
  sourceToken?: string;
}): DecisionFeedRecord {
  return publish(
    'composer_writer_preflight',
    input.thinking,
    { kind: 'composer_writer_preflight', safeToWrite: input.safeToWrite === true },
    { ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.sourceToken !== undefined ? { sourceToken: input.sourceToken } : {}) },
  );
}

export function publishPremiumVerificationDecision(input: {
  result: PremiumVerificationResult;
  sessionId?: string;
  sourceToken?: string;
}): DecisionFeedRecord {
  const { result } = input;
  return publish(
    'premium_verification',
    result.thinking,
    {
      kind: 'premium_verification',
      trust: result.verdict.trust,
      suggestedConfidenceCap: clampUnit(result.verdict.suggestedConfidenceCap),
      holdPremiumUntilFresh: result.verdict.holdPremiumUntilFresh === true,
    },
    { ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.sourceToken !== undefined ? { sourceToken: input.sourceToken } : {}) },
  );
}

export function publishSupervisorNextStepDecision(input: {
  result: SupervisorNextStepPlannerResult;
  sessionId?: string;
  sourceToken?: string;
}): DecisionFeedRecord {
  const { plan, thinking } = input.result;
  return publish(
    'supervisor_next_step',
    thinking,
    summarySupervisor(plan),
    { ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.sourceToken !== undefined ? { sourceToken: input.sourceToken } : {}) },
  );
}

function summarySupervisor(plan: SupervisorNextStepPlan): DecisionFeedSummary {
  return {
    kind: 'supervisor_next_step',
    nextStepType: plan.nextStep ? plan.nextStep.type : null,
    holdAll: plan.holdAll === true,
    prioritizedActionTypes: sanitizePrioritizedTypes(plan.prioritizedActionTypes),
  };
}

export function getDecisionFeedSnapshot(): DecisionFeedSnapshot {
  return Object.freeze({
    records: Object.freeze(buffer.slice()),
    droppedSinceReset,
    sequence,
  });
}

export function subscribeToDecisionFeed(subscriber: DecisionFeedSubscriber): () => void {
  if (typeof subscriber !== 'function') {
    return () => {};
  }
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function __resetDecisionFeedForTesting(): void {
  buffer.length = 0;
  droppedSinceReset = 0;
  sequence = 0;
  subscribers.clear();
}

export const __DECISION_FEED_INTERNALS = Object.freeze({
  MAX_RECORDS,
  MAX_REASON_CODES,
  MAX_REASON_CODE_LENGTH,
  MAX_PRIORITIZED_TYPES,
});
