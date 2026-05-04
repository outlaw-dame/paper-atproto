/**
 * Bounded thinking lane primitive.
 *
 * The intelligence coordinator's facade tells a surface *which* lane and
 * model to use. Some surfaces additionally benefit from a multi-step
 * reasoning pass — "analyze → extract → verify → synthesize" — before
 * (or instead of) handing off to the writer. Historically each surface
 * has rolled its own ad-hoc loop, which has produced drift between the
 * composer pre-flight, the premium verification path, and the conversation
 * supervisor.
 *
 * This module provides the *single*, surface-agnostic primitive those
 * loops should compose:
 *
 *   • A {@link ThinkingPlan} is a bounded list of {@link ThinkingStep}s,
 *     each with its own time budget and an optional dependency on a
 *     previous step's output.
 *   • {@link executeThinkingPlan} runs the plan sequentially, enforces a
 *     hard total budget, honours an external `AbortSignal`, isolates
 *     step throws so a single bad step never crashes the lane, and emits
 *     one {@link IntelligenceEvent} per step against the
 *     `'thinking'` surface for telemetry parity.
 *   • A plan may declare a {@link ThinkingVerifier} which inspects
 *     intermediate state and decides whether to short-circuit, fallback,
 *     or continue. Verifiers are deterministic, synchronous, and never
 *     throw (we wrap them).
 *   • A plan may declare a {@link ThinkingFallback} producing a
 *     defensible result when steps degrade or the budget is blown.
 *
 * What this module deliberately *does not* do:
 *   • It does not call any model directly — steps are caller-provided
 *     functions. The lane orchestrates; the steps reason. This keeps the
 *     primitive testable without mocking model runtimes.
 *   • It does not retry. A step that fails proceeds to the verifier or
 *     the fallback. The surface decides whether to invoke the lane again.
 *   • It does not own the budget hierarchy — surfaces pass the budgets
 *     they have already cleared with their own latency policies.
 */
import { emitIntelligenceEvent } from './intelligenceEvents';

export type ThinkingStepKind = 'analyze' | 'extract' | 'verify' | 'synthesize' | 'plan';

export type ThinkingStepStatus = 'succeeded' | 'errored' | 'aborted' | 'timed_out' | 'skipped';

export interface ThinkingStepResult<T = unknown> {
  status: ThinkingStepStatus;
  /** The step's output value, when successful. */
  value?: T;
  /** Stable reason code when not successful. Bounded length. */
  reasonCode?: string;
  /** Wall-clock ms the step actually took. */
  durationMs: number;
}

export interface ThinkingStepContext<TPrev = unknown> {
  /** Result of the immediately preceding step, or `undefined` on step 0. */
  previous: ThinkingStepResult<TPrev> | undefined;
  /** Aggregated map of all prior step results keyed by step id. */
  prior: ReadonlyMap<string, ThinkingStepResult>;
  /** External abort signal. Steps SHOULD honour it. */
  signal: AbortSignal;
  /** Step's wall-clock deadline as an epoch ms timestamp. */
  deadline: number;
}

export interface ThinkingStep<TIn = unknown, TOut = unknown> {
  /** Stable id, unique within the plan. Used as event detail. */
  id: string;
  kind: ThinkingStepKind;
  /** Per-step max ms. The lane enforces both this and the total budget. */
  budgetMs: number;
  /**
   * The step's work. Called with an abort signal that fires when *either*
   * the step's per-step budget *or* the plan's total budget elapses.
   * The function MAY throw; the lane wraps it and emits an `errored` step.
   */
  run: (ctx: ThinkingStepContext<TIn>) => Promise<TOut> | TOut;
}

export interface ThinkingVerifierInput<TFinal> {
  /** Last successful step's value, or undefined when nothing succeeded. */
  finalValue: TFinal | undefined;
  /** All step results so far. */
  steps: ReadonlyArray<{ id: string; kind: ThinkingStepKind; result: ThinkingStepResult }>;
}

export type ThinkingVerifierVerdict =
  | { ok: true }
  | { ok: false; reasonCode: string; useFallback: boolean };

export type ThinkingVerifier<TFinal = unknown> = (
  input: ThinkingVerifierInput<TFinal>,
) => ThinkingVerifierVerdict;

export type ThinkingFallback<TFinal = unknown> = () => TFinal;

export interface ThinkingPlan<TFinal = unknown> {
  /** Stable plan id, used as the surface telemetry tag. */
  id: string;
  /** Logical surface that requested the plan. Used in the event detail. */
  requesterSurface: 'composer' | 'search' | 'media' | 'session' | 'writer' | 'router' | 'premium' | 'supervisor';
  /** Hard cap across the whole plan, regardless of step budgets. */
  totalBudgetMs: number;
  /** Sequential steps. The lane runs them in order. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: ReadonlyArray<ThinkingStep<any, any>>;
  /** Optional deterministic post-pass on the aggregated step trace. */
  verifier?: ThinkingVerifier<TFinal>;
  /** Optional fallback producing a defensible result on failure. */
  fallback?: ThinkingFallback<TFinal>;
  /** Optional hashed/truncated session id for telemetry. */
  sessionId?: string;
  /** Optional source-token freshness marker for telemetry. */
  sourceToken?: string;
}

export interface ThinkingExecutionOptions {
  signal?: AbortSignal;
}

export interface ThinkingStepTrace {
  id: string;
  kind: ThinkingStepKind;
  result: ThinkingStepResult;
}

export interface ThinkingResult<TFinal = unknown> {
  /** True when the verifier passed and at least one step produced a value. */
  ok: boolean;
  /** Final synthesised value, when produced. */
  value?: TFinal;
  /** Whether the lane fell back to {@link ThinkingPlan.fallback}. */
  degraded: boolean;
  /** Whether the total budget elapsed before the plan finished. */
  budgetExceeded: boolean;
  /** Whether the external abort signal aborted the lane. */
  aborted: boolean;
  /** Aggregated reason codes across steps and verifier. */
  reasonCodes: ReadonlyArray<string>;
  /** Per-step trace, in execution order. */
  steps: ReadonlyArray<ThinkingStepTrace>;
  /** Total wall-clock ms. Always finite. */
  totalDurationMs: number;
}

/* ────────────────────────── internals ────────────────────────── */

const MAX_REASON_CODE_LENGTH = 56;
const MAX_PLAN_STEPS = 12;
const MAX_BUDGET_MS = 30_000;

function sanitizeReason(code: string | undefined): string | undefined {
  if (typeof code !== 'string') return undefined;
  const trimmed = code.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_REASON_CODE_LENGTH);
}

function clampBudget(ms: number, fallback: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return fallback;
  return Math.min(ms, MAX_BUDGET_MS);
}

function safeNow(): number {
  return Date.now();
}

function linkAbort(parent: AbortSignal | undefined, deadline: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let cleared = false;
  const onParentAbort = () => {
    if (!cleared) controller.abort(parent?.reason);
  };
  if (parent) {
    if (parent.aborted) {
      controller.abort(parent.reason);
    } else {
      parent.addEventListener('abort', onParentAbort, { once: true });
    }
  }
  const remaining = deadline - safeNow();
  const timer =
    remaining > 0
      ? setTimeout(() => {
          if (!cleared) controller.abort(new Error('thinking_step_timeout'));
        }, remaining)
      : null;
  return {
    signal: controller.signal,
    cleanup: () => {
      cleared = true;
      if (timer) clearTimeout(timer);
      if (parent) parent.removeEventListener('abort', onParentAbort);
    },
  };
}

function safeVerifierVerdict<TFinal>(
  verifier: ThinkingVerifier<TFinal> | undefined,
  input: ThinkingVerifierInput<TFinal>,
): ThinkingVerifierVerdict {
  if (!verifier) return { ok: true };
  try {
    const verdict = verifier(input);
    if (verdict && typeof verdict === 'object') {
      if (verdict.ok === true) return { ok: true };
      if (verdict.ok === false) {
        return {
          ok: false,
          reasonCode: sanitizeReason(verdict.reasonCode) ?? 'verifier_rejected',
          useFallback: Boolean(verdict.useFallback),
        };
      }
    }
    return { ok: false, reasonCode: 'verifier_invalid', useFallback: true };
  } catch {
    return { ok: false, reasonCode: 'verifier_threw', useFallback: true };
  }
}

function safeFallback<TFinal>(fallback: ThinkingFallback<TFinal> | undefined): TFinal | undefined {
  if (!fallback) return undefined;
  try {
    return fallback();
  } catch {
    return undefined;
  }
}

/* ────────────────────────── public api ────────────────────────── */

/**
 * Run a {@link ThinkingPlan}. Always resolves; never throws. Emits one
 * `intelligence_event` per step (surface=`thinking`, status mirrors the
 * step status) plus a final summary event.
 */
export async function executeThinkingPlan<TFinal = unknown>(
  plan: ThinkingPlan<TFinal>,
  options: ThinkingExecutionOptions = {},
): Promise<ThinkingResult<TFinal>> {
  const startedAt = safeNow();
  const totalBudget = clampBudget(plan.totalBudgetMs, 5_000);
  const planDeadline = startedAt + totalBudget;
  const steps = plan.steps.slice(0, MAX_PLAN_STEPS);

  const traces: ThinkingStepTrace[] = [];
  const reasonCodes: string[] = [];
  const priorMap = new Map<string, ThinkingStepResult>();
  let lastSuccess: ThinkingStepResult | undefined;
  let aborted = false;
  let budgetExceeded = false;

  if (options.signal?.aborted) {
    aborted = true;
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!; // i < steps.length guarantees defined
    if (aborted) {
      const skipped: ThinkingStepResult = {
        status: 'skipped',
        reasonCode: 'plan_aborted_before_step',
        durationMs: 0,
      };
      traces.push({ id: step.id, kind: step.kind, result: skipped });
      priorMap.set(step.id, skipped);
      continue;
    }
    const now = safeNow();
    if (now >= planDeadline) {
      budgetExceeded = true;
      const skipped: ThinkingStepResult = {
        status: 'skipped',
        reasonCode: 'plan_budget_exceeded',
        durationMs: 0,
      };
      traces.push({ id: step.id, kind: step.kind, result: skipped });
      priorMap.set(step.id, skipped);
      continue;
    }

    const stepStart = safeNow();
    const stepBudget = clampBudget(step.budgetMs, totalBudget);
    const stepDeadline = Math.min(planDeadline, stepStart + stepBudget);
    const linked = linkAbort(options.signal, stepDeadline);

    let result: ThinkingStepResult;
    try {
      const value = await Promise.resolve(
        step.run({
          previous: lastSuccess,
          prior: priorMap,
          signal: linked.signal,
          deadline: stepDeadline,
        }),
      );
      const duration = safeNow() - stepStart;
      if (linked.signal.aborted) {
        result = {
          status: options.signal?.aborted ? 'aborted' : 'timed_out',
          reasonCode: options.signal?.aborted ? 'step_aborted' : 'step_timeout',
          durationMs: duration,
        };
      } else {
        result = { status: 'succeeded', value, durationMs: duration };
      }
    } catch (err) {
      const duration = safeNow() - stepStart;
      if (options.signal?.aborted) {
        result = { status: 'aborted', reasonCode: 'step_aborted', durationMs: duration };
      } else if (linked.signal.aborted) {
        result = { status: 'timed_out', reasonCode: 'step_timeout', durationMs: duration };
      } else {
        const message = err instanceof Error ? err.message : 'step_threw';
        result = {
          status: 'errored',
          reasonCode: sanitizeReason(message) ?? 'step_threw',
          durationMs: duration,
        };
      }
    } finally {
      linked.cleanup();
    }

    traces.push({ id: step.id, kind: step.kind, result });
    priorMap.set(step.id, result);
    if (result.status === 'succeeded') {
      lastSuccess = result;
    } else {
      const code = result.reasonCode ?? `step_${step.id}_${result.status}`;
      reasonCodes.push(code);
    }

    emitIntelligenceEvent({
      surface: 'thinking',
      status:
        result.status === 'succeeded'
          ? 'succeeded'
          : result.status === 'aborted'
            ? 'aborted'
            : result.status === 'timed_out'
              ? 'errored'
              : result.status === 'skipped'
                ? 'skipped'
                : 'errored',
      durationMs: result.durationMs,
      reasonCodes: result.reasonCode ? [result.reasonCode] : [],
      ...(plan.sessionId ? { sessionId: plan.sessionId } : {}),
      ...(plan.sourceToken ? { sourceToken: plan.sourceToken } : {}),
      details: {
        plan_id: plan.id,
        step_id: step.id,
        step_kind: step.kind,
        requester: plan.requesterSurface,
      },
    });

    if (options.signal?.aborted) aborted = true;
    if (safeNow() >= planDeadline) budgetExceeded = true;
  }

  const finalValue = lastSuccess?.value as TFinal | undefined;
  const verdict = safeVerifierVerdict<TFinal>(plan.verifier, {
    finalValue,
    steps: traces,
  });

  let result: TFinal | undefined = finalValue;
  let degraded = false;
  let ok = verdict.ok && finalValue !== undefined && !aborted;

  if (!verdict.ok) {
    reasonCodes.push(verdict.reasonCode);
    if (verdict.useFallback) {
      const fallbackValue = safeFallback<TFinal>(plan.fallback);
      if (fallbackValue !== undefined) {
        result = fallbackValue;
        degraded = true;
        ok = true;
        reasonCodes.push('thinking_fallback_used');
      } else {
        ok = false;
      }
    } else {
      ok = false;
    }
  } else if (finalValue === undefined) {
    // Verifier said ok but no step produced a value — degrade to fallback if any.
    const fallbackValue = safeFallback<TFinal>(plan.fallback);
    if (fallbackValue !== undefined) {
      result = fallbackValue;
      degraded = true;
      ok = true;
      reasonCodes.push('thinking_no_value_fallback');
    } else {
      ok = false;
      reasonCodes.push('thinking_no_value');
    }
  }

  if (aborted) reasonCodes.push('thinking_aborted');
  if (budgetExceeded) reasonCodes.push('thinking_budget_exceeded');

  const totalDurationMs = safeNow() - startedAt;

  emitIntelligenceEvent({
    surface: 'thinking',
    status: ok ? (degraded ? 'fallback' : 'succeeded') : aborted ? 'aborted' : 'errored',
    durationMs: totalDurationMs,
    deterministicFallback: degraded,
    reasonCodes,
    ...(plan.sessionId ? { sessionId: plan.sessionId } : {}),
    ...(plan.sourceToken ? { sourceToken: plan.sourceToken } : {}),
    details: {
      plan_id: plan.id,
      requester: plan.requesterSurface,
      steps_total: steps.length,
      steps_succeeded: traces.filter((t) => t.result.status === 'succeeded').length,
    },
  });

  return Object.freeze({
    ok,
    ...(result !== undefined ? { value: result } : {}),
    degraded,
    budgetExceeded,
    aborted,
    reasonCodes: Object.freeze([...new Set(reasonCodes)]),
    steps: Object.freeze(traces.map((t) => Object.freeze({ ...t, result: Object.freeze({ ...t.result }) }))),
    totalDurationMs,
  }) as ThinkingResult<TFinal>;
}
