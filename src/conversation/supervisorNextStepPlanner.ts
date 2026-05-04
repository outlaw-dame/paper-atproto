import {
  executeThinkingPlan,
  type ThinkingPlan,
  type ThinkingResult,
} from '../intelligence/coordinator/thinkingLane';
import type {
  ConversationSupervisorAction,
  ConversationSupervisorActionType,
  ConversationSupervisorStateSummary,
  ConversationSupervisorTraceCode,
} from './supervisorTypes';

/**
 * Bounded, deterministic next-step planner for the conversation supervisor.
 *
 * Why this exists:
 *  - The synchronous shadow supervisor in {@link ./shadowSupervisor.ts} produces
 *    a flat set of recommendations. Live consumers (router, surface coordinators)
 *    sometimes need a single, prioritized "what should happen next" decision,
 *    and a hold signal when the system is too unstable to act on any one of them.
 *  - This lane runs a bounded thinking plan (no I/O, no model calls) over the
 *    summary + base actions to produce a frozen, defensible plan.
 *
 * Hard rules:
 *  - Pure analysis. Never throws. Total budget: 600ms (typical < 2ms).
 *  - Output is frozen. Reason codes are length-capped by the lane.
 *  - Falls back to the existing supervisor action set on any internal failure
 *    (no escalation), preserving caller behaviour.
 *  - Only narrows or reorders — never invents new action types.
 */

export interface SupervisorNextStepPlan {
  /** Single highest-confidence next action, or null if nothing actionable. */
  nextStep: ConversationSupervisorAction | null;
  /** Action types in recommended execution order (deduplicated). */
  prioritizedActionTypes: readonly ConversationSupervisorActionType[];
  /**
   * When true, the system is too unstable to act on any single recommendation.
   * Callers should defer all surfaces and re-evaluate on the next supervisor cycle.
   */
  holdAll: boolean;
  reasonCodes: readonly string[];
}

export interface SupervisorNextStepPlannerInput {
  summary: ConversationSupervisorStateSummary;
  baseActions: readonly ConversationSupervisorAction[];
  traceCodes: readonly ConversationSupervisorTraceCode[];
}

export interface SupervisorNextStepPlannerResult {
  plan: SupervisorNextStepPlan;
  thinking: ThinkingResult<SupervisorNextStepPlan>;
}

const PLAN_TOTAL_BUDGET_MS = 600;
const PLAN_STEP_BUDGET_MS = 200;

const PRIORITY_RANK: Record<ConversationSupervisorAction['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

interface SupervisorSignals {
  errorTaskCount: number;
  multipleErrors: boolean;
  hasMutationChurn: boolean;
  premiumLoading: boolean;
  premiumError: boolean;
  writerError: boolean;
  multimodalDegraded: boolean;
  hasLowSignalCycle: boolean;
  baseActions: readonly ConversationSupervisorAction[];
}

function extractSignals(input: SupervisorNextStepPlannerInput): SupervisorSignals {
  const traces = new Set(input.traceCodes);
  const errorTaskCount = input.summary.errorTasks.length;
  return {
    errorTaskCount,
    multipleErrors: errorTaskCount >= 2,
    hasMutationChurn: input.summary.hasMutationChurn,
    premiumLoading: input.summary.premiumStatus === 'loading',
    premiumError:
      input.summary.premiumStatus === 'error' || traces.has('premium_error'),
    writerError: traces.has('writer_error'),
    multimodalDegraded:
      traces.has('multimodal_degraded') || traces.has('multimodal_error'),
    hasLowSignalCycle: traces.has('premium_low_signal_cycle'),
    baseActions: input.baseActions,
  };
}

function prioritizeActions(
  actions: readonly ConversationSupervisorAction[],
): ConversationSupervisorAction[] {
  const seen = new Set<ConversationSupervisorActionType>();
  const deduped: ConversationSupervisorAction[] = [];
  for (const action of actions) {
    if (seen.has(action.type)) continue;
    seen.add(action.type);
    deduped.push(action);
  }
  // Stable sort by priority rank then insertion order.
  return deduped
    .map((action, index) => ({ action, index }))
    .sort((a, b) => {
      const priorityDelta = PRIORITY_RANK[a.action.priority] - PRIORITY_RANK[b.action.priority];
      if (priorityDelta !== 0) return priorityDelta;
      return a.index - b.index;
    })
    .map((entry) => entry.action);
}

function decide(
  signals: SupervisorSignals,
): { plan: SupervisorNextStepPlan } {
  const prioritized = prioritizeActions(signals.baseActions);
  const prioritizedTypes = prioritized.map((action) => action.type);
  const reasonCodes: string[] = [];

  // Hold-all: severe instability — multiple errors plus mutation churn means
  // any single action will likely race and be overwritten. Defer all surfaces.
  if (signals.multipleErrors && signals.hasMutationChurn) {
    reasonCodes.push('supervisor_plan_hold_all');
    return {
      plan: Object.freeze({
        nextStep: null,
        prioritizedActionTypes: Object.freeze(prioritizedTypes.slice()),
        holdAll: true,
        reasonCodes: Object.freeze(reasonCodes),
      }),
    };
  }

  if (prioritized.length === 0) {
    reasonCodes.push('supervisor_plan_no_actions');
    return {
      plan: Object.freeze({
        nextStep: null,
        prioritizedActionTypes: Object.freeze([] as readonly ConversationSupervisorActionType[]),
        holdAll: false,
        reasonCodes: Object.freeze(reasonCodes),
      }),
    };
  }

  // Writer errors are always escalated first — they block the user's primary surface.
  const writerAction = prioritized.find(
    (action) => action.type === 'rerun_writer_with_safe_fallback',
  );
  if (signals.writerError && writerAction) {
    reasonCodes.push('supervisor_plan_escalate_writer');
    return {
      plan: Object.freeze({
        nextStep: writerAction,
        prioritizedActionTypes: Object.freeze(prioritizedTypes.slice()),
        holdAll: false,
        reasonCodes: Object.freeze(reasonCodes),
      }),
    };
  }

  // Premium-error on a low-signal cycle: prefer skip over hold so we don't
  // burn budget waiting for a state change that will not produce new info.
  if (signals.premiumError && signals.hasLowSignalCycle) {
    const skipAction = prioritized.find(
      (action) => action.type === 'skip_premium_for_cycle',
    );
    if (skipAction) {
      reasonCodes.push('supervisor_plan_escalate_premium_skip');
      return {
        plan: Object.freeze({
          nextStep: skipAction,
          prioritizedActionTypes: Object.freeze(prioritizedTypes.slice()),
          holdAll: false,
          reasonCodes: Object.freeze(reasonCodes),
        }),
      };
    }
  }

  reasonCodes.push('supervisor_plan_clean');
  return {
    plan: Object.freeze({
      nextStep: prioritized[0] ?? null,
      prioritizedActionTypes: Object.freeze(prioritizedTypes.slice()),
      holdAll: false,
      reasonCodes: Object.freeze(reasonCodes),
    }),
  };
}

function isPlan(value: unknown): value is SupervisorNextStepPlan {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<SupervisorNextStepPlan>;
  return (
    (v.nextStep === null || (typeof v.nextStep === 'object' && v.nextStep !== null))
    && Array.isArray(v.prioritizedActionTypes)
    && typeof v.holdAll === 'boolean'
    && Array.isArray(v.reasonCodes)
  );
}

export async function planSupervisorNextStep(
  input: SupervisorNextStepPlannerInput,
  options?: { signal?: AbortSignal },
): Promise<SupervisorNextStepPlannerResult> {
  let signals: SupervisorSignals | null = null;
  let plan: SupervisorNextStepPlan | null = null;

  const thinkingPlan: ThinkingPlan<SupervisorNextStepPlan> = {
    id: 'supervisor_next_step_planner',
    requesterSurface: 'supervisor',
    totalBudgetMs: PLAN_TOTAL_BUDGET_MS,
    steps: [
      {
        id: 'analyze_signals',
        kind: 'analyze',
        budgetMs: PLAN_STEP_BUDGET_MS,
        run: () => {
          signals = extractSignals(input);
          return signals;
        },
      },
      {
        id: 'prioritize_actions',
        kind: 'plan',
        budgetMs: PLAN_STEP_BUDGET_MS,
        run: () => {
          if (!signals) signals = extractSignals(input);
          return prioritizeActions(signals.baseActions);
        },
      },
      {
        id: 'select_next_step',
        kind: 'plan',
        budgetMs: PLAN_STEP_BUDGET_MS,
        run: () => {
          if (!signals) signals = extractSignals(input);
          const decided = decide(signals);
          plan = decided.plan;
          return decided.plan;
        },
      },
    ],
    verifier: ({ finalValue }) => {
      if (!isPlan(finalValue)) {
        return {
          ok: false,
          reasonCode: 'supervisor_plan_shape_invalid',
          useFallback: true,
        };
      }
      return { ok: true };
    },
    fallback: () => {
      const fallbackPrioritized = prioritizeActions(input.baseActions);
      return Object.freeze({
        nextStep: fallbackPrioritized[0] ?? null,
        prioritizedActionTypes: Object.freeze(
          fallbackPrioritized.map((action) => action.type),
        ),
        holdAll: false,
        reasonCodes: Object.freeze(['supervisor_plan_unavailable']),
      });
    },
  };

  const thinking = await executeThinkingPlan<SupervisorNextStepPlan>(thinkingPlan, options);

  const finalPlan: SupervisorNextStepPlan = (() => {
    if (thinking.value && isPlan(thinking.value)) return thinking.value;
    if (plan) return plan;
    const fallbackPrioritized = prioritizeActions(input.baseActions);
    return Object.freeze({
      nextStep: fallbackPrioritized[0] ?? null,
      prioritizedActionTypes: Object.freeze(
        fallbackPrioritized.map((action) => action.type),
      ),
      holdAll: false,
      reasonCodes: Object.freeze(['supervisor_plan_unavailable']),
    });
  })();

  return Object.freeze({ plan: finalPlan, thinking });
}
