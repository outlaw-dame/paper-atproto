/**
 * Coordinator behaviour scorecard.
 *
 * The {@link CONVERSATION_OS_SCORECARD} grades editorial output of the
 * thread interpolator. This sibling scorecard grades the *coordinator
 * seams* — the structural guarantees the intelligence layer must keep:
 *
 *   • fallback_correctness — when the router cannot decide, the
 *     deterministic policy primary route is used (never the contract
 *     safety fallback).
 *   • source_token_freshness — every emitted intelligence_event carries
 *     the source token of the brief that produced it (or omits it).
 *   • stale_discard_correctness — advice computed from a stale brief is
 *     marked as such and not committed to session state.
 *   • router_policy_agreement — the lane the deterministic policy picked
 *     is eligible for the task per {@link capabilityRegistry}.
 *   • latency_budget_respected — `event.durationMs` is finite and below
 *     the surface's published budget.
 *   • telemetry_event_emitted — every advise call produces exactly one
 *     authoritative `intelligence_event`.
 *
 * The fixtures here are pure, synthetic, and never call into network or
 * model code. They exercise the facade with controlled `RuntimeCapability`
 * inputs and assert structural properties on the resulting advice.
 */
import type { IntelligenceTask } from '../intelligence/intelligenceRoutingPolicy';

export const COORDINATOR_BEHAVIOR_SCORECARD_VERSION = 'coordinator-behavior-v1';

export interface CoordinatorBehaviorScorecardItem {
  id: string;
  weight: number;
  description: string;
}

export const COORDINATOR_BEHAVIOR_SCORECARD: ReadonlyArray<CoordinatorBehaviorScorecardItem> = Object.freeze([
  Object.freeze({
    id: 'fallback_correctness',
    weight: 2,
    description:
      'When the router runtime is unavailable or invalid, advice falls back to the deterministic policy primary, not to the contract safety fallback.',
  }),
  Object.freeze({
    id: 'source_token_freshness',
    weight: 2,
    description:
      'When the brief carries a source token, the emitted intelligence_event also carries that token; otherwise the field is omitted.',
  }),
  Object.freeze({
    id: 'stale_discard_correctness',
    weight: 2,
    description:
      'Advice computed from a brief whose source token has rotated must report `stale_discarded` so callers can drop the result.',
  }),
  Object.freeze({
    id: 'router_policy_agreement',
    weight: 1,
    description:
      'The lane the deterministic policy returns is eligible for the task per the capability registry.',
  }),
  Object.freeze({
    id: 'latency_budget_respected',
    weight: 1,
    description:
      'event.durationMs is finite and below 5_000ms for in-process advice (no network involved).',
  }),
  Object.freeze({
    id: 'telemetry_event_emitted',
    weight: 1,
    description:
      'Each advise call produces exactly one IntelligenceEvent in the buffer for that surface and intent.',
  }),
  Object.freeze({
    id: 'thinking_lane_bounded',
    weight: 2,
    description:
      'Bounded thinking lane: every thinking plan respects its total budget, isolates step throws, never throws, always emits a summary event, and returns either a value or a defensible fallback.',
  }),
  Object.freeze({
    id: 'premium_verification_bounded',
    weight: 2,
    description:
      'Premium verification lane never raises confidence above the input cap, never throws, falls back to an unverified verdict on shape failure, and emits a frozen verdict with sanitized reason codes.',
  }),
  Object.freeze({
    id: 'supervisor_planner_bounded',
    weight: 2,
    description:
      'Supervisor next-step planner never invents action types, prioritizes deterministically (high → medium → low, stable on ties), holds all on multi-error + churn, and falls back to the first prioritized base action when the verifier rejects.',
  }),
  Object.freeze({
    id: 'decision_feed_bounded',
    weight: 2,
    description:
      'The unified decision feed is append-only, bounded in size, frozen per record, sanitizes reason codes, isolates throwing subscribers, and never bleeds faults back into the publisher.',
  }),
]);

export const COORDINATOR_BEHAVIOR_BUDGET_MS = 5_000;

export interface CoordinatorBehaviorFixture {
  id: string;
  description: string;
  intent: IntelligenceTask;
  /** Provide a non-null capability so the router actually runs. */
  withCapability: boolean;
  /** Source token to put on the brief; null means omit. */
  sourceToken: string | null;
  /** When true, the fixture simulates a stale brief (token has rotated). */
  stale?: boolean;
  /** Surface that should be invoked. */
  surface: 'session' | 'composer' | 'search' | 'media';
}

export const COORDINATOR_BEHAVIOR_FIXTURES: ReadonlyArray<CoordinatorBehaviorFixture> = Object.freeze([
  Object.freeze({
    id: 'session.story_summary.nominal',
    description: 'Story summary with no router runtime registered → deterministic primary path.',
    intent: 'story_summary',
    withCapability: true,
    sourceToken: 'src-stable-1',
    surface: 'session',
  }),
  Object.freeze({
    id: 'composer.writer.no_capability',
    description: 'Composer writer without a capability skips the router and returns deterministic advice.',
    intent: 'composer_writer',
    withCapability: false,
    sourceToken: 'src-c-1',
    surface: 'composer',
  }),
  Object.freeze({
    id: 'search.public_search.fast_path',
    description: 'Public search runs hot-path scoring; router is skipped, edge plan is produced.',
    intent: 'public_search',
    withCapability: true,
    sourceToken: 'src-s-1',
    surface: 'search',
  }),
  Object.freeze({
    id: 'media.media_analysis.balanced',
    description: 'Media analysis on balanced privacy uses edge classifier and emits one event.',
    intent: 'media_analysis',
    withCapability: true,
    sourceToken: null,
    surface: 'media',
  }),
  Object.freeze({
    id: 'session.story_summary.stale',
    description: 'A stale brief (rotated source token) is reported as stale_discarded.',
    intent: 'story_summary',
    withCapability: true,
    sourceToken: 'src-old',
    stale: true,
    surface: 'session',
  }),
]);
