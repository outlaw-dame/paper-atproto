import type { MediaAnalysisRequest } from '../intelligence/llmContracts';
import type { PremiumAiEntitlements } from '../intelligence/premiumContracts';
import type {
  ConversationModelRunSkipReason,
  ConversationSession,
} from './sessionTypes';
import {
  shouldReuseExistingModelOutputs,
  shouldRunInterpolatorWriter,
  shouldRunPremiumDeepInterpolator,
} from './modelExecution';

export const CONVERSATION_COORDINATOR_STAGE_PLANNER_VERSION = 1 as const;

export type ConversationCoordinatorPlannedStage = 'writer' | 'multimodal' | 'premium';
export type ConversationCoordinatorStagePlanAction = 'run' | 'skip';

export type ConversationCoordinatorStagePlannerReasonCode =
  | 'interpolator_disabled'
  | 'reuse_existing_outputs'
  | 'writer_gate_allowed'
  | 'writer_gate_blocked'
  | 'multimodal_plan_available'
  | 'multimodal_plan_not_needed'
  | 'multimodal_plan_no_candidates'
  | 'premium_entitled'
  | 'premium_provider_unavailable'
  | 'premium_capability_missing'
  | 'premium_signal_insufficient';

export type ConversationCoordinatorMultimodalPlanningInput =
  | {
      shouldRun: true;
      requests: readonly MediaAnalysisRequest[];
    }
  | {
      shouldRun: false;
      reason: Extract<ConversationModelRunSkipReason, 'multimodal_not_needed' | 'no_media_candidates'>;
    };

export interface ConversationCoordinatorStagePlan {
  stage: ConversationCoordinatorPlannedStage;
  action: ConversationCoordinatorStagePlanAction;
  reason: ConversationModelRunSkipReason | 'run_ready';
  reasonCodes: ConversationCoordinatorStagePlannerReasonCode[];
  requestCount?: number;
}

export interface ConversationCoordinatorModelStagePlanInput {
  session: ConversationSession;
  replyCount: number;
  interpolatorEnabled: boolean;
  didMeaningfullyChange: boolean;
  multimodalPlan: ConversationCoordinatorMultimodalPlanningInput;
  premiumEntitlements: PremiumAiEntitlements;
}

export interface ConversationCoordinatorModelStagePlan {
  schemaVersion: typeof CONVERSATION_COORDINATOR_STAGE_PLANNER_VERSION;
  plans: Record<ConversationCoordinatorPlannedStage, ConversationCoordinatorStagePlan>;
  shouldRunAny: boolean;
  reasonCodes: ConversationCoordinatorStagePlannerReasonCode[];
}

export function planConversationCoordinatorModelStages(
  input: ConversationCoordinatorModelStagePlanInput,
): ConversationCoordinatorModelStagePlan {
  const {
    session,
    replyCount,
    interpolatorEnabled,
    didMeaningfullyChange,
    multimodalPlan,
    premiumEntitlements,
  } = input;

  if (!interpolatorEnabled) {
    return buildPlan({
      writer: skipPlan('writer', 'interpolator_disabled', ['interpolator_disabled']),
      multimodal: skipPlan('multimodal', 'interpolator_disabled', ['interpolator_disabled']),
      premium: skipPlan('premium', 'interpolator_disabled', ['interpolator_disabled']),
    });
  }

  if (shouldReuseExistingModelOutputs(session, didMeaningfullyChange)) {
    return buildPlan({
      writer: skipPlan('writer', 'no_meaningful_change', ['reuse_existing_outputs']),
      multimodal: skipPlan('multimodal', 'no_meaningful_change', ['reuse_existing_outputs']),
      premium: skipPlan('premium', 'no_meaningful_change', ['reuse_existing_outputs']),
    });
  }

  const writerGate = shouldRunInterpolatorWriter(session, replyCount);
  if (!writerGate.shouldRun) {
    return buildPlan({
      writer: skipPlan('writer', writerGate.reason, ['writer_gate_blocked']),
      multimodal: skipPlan('multimodal', writerGate.reason, ['writer_gate_blocked']),
      premium: skipPlan('premium', writerGate.reason, ['writer_gate_blocked']),
    });
  }

  const writer = runPlan('writer', ['writer_gate_allowed']);
  const multimodal = planMultimodalStage(multimodalPlan);
  const premium = planPremiumStage({ session, replyCount, entitlements: premiumEntitlements });

  return buildPlan({ writer, multimodal, premium });
}

function planMultimodalStage(
  multimodalPlan: ConversationCoordinatorMultimodalPlanningInput,
): ConversationCoordinatorStagePlan {
  if (!multimodalPlan.shouldRun) {
    return skipPlan(
      'multimodal',
      multimodalPlan.reason,
      [multimodalPlan.reason === 'no_media_candidates'
        ? 'multimodal_plan_no_candidates'
        : 'multimodal_plan_not_needed'],
    );
  }

  if (multimodalPlan.requests.length === 0) {
    return skipPlan('multimodal', 'no_media_candidates', ['multimodal_plan_no_candidates']);
  }

  return runPlan('multimodal', ['multimodal_plan_available'], multimodalPlan.requests.length);
}

function planPremiumStage(params: {
  session: ConversationSession;
  replyCount: number;
  entitlements: PremiumAiEntitlements;
}): ConversationCoordinatorStagePlan {
  const { session, replyCount, entitlements } = params;

  if (!entitlements.providerAvailable) {
    return skipPlan('premium', 'not_entitled', ['premium_provider_unavailable']);
  }

  if (!entitlements.capabilities.includes('deep_interpolator')) {
    return skipPlan('premium', 'not_entitled', ['premium_capability_missing']);
  }

  if (!shouldRunPremiumDeepInterpolator(session, replyCount, entitlements)) {
    return skipPlan('premium', 'insufficient_signal', ['premium_signal_insufficient']);
  }

  return runPlan('premium', ['premium_entitled']);
}

function runPlan(
  stage: ConversationCoordinatorPlannedStage,
  reasonCodes: ConversationCoordinatorStagePlannerReasonCode[],
  requestCount?: number,
): ConversationCoordinatorStagePlan {
  return {
    stage,
    action: 'run',
    reason: 'run_ready',
    reasonCodes: unique(reasonCodes),
    ...(requestCount !== undefined ? { requestCount } : {}),
  };
}

function skipPlan(
  stage: ConversationCoordinatorPlannedStage,
  reason: ConversationModelRunSkipReason,
  reasonCodes: ConversationCoordinatorStagePlannerReasonCode[],
): ConversationCoordinatorStagePlan {
  return {
    stage,
    action: 'skip',
    reason,
    reasonCodes: unique(reasonCodes),
  };
}

function buildPlan(
  plans: Record<ConversationCoordinatorPlannedStage, ConversationCoordinatorStagePlan>,
): ConversationCoordinatorModelStagePlan {
  const allPlans = Object.values(plans);
  return {
    schemaVersion: CONVERSATION_COORDINATOR_STAGE_PLANNER_VERSION,
    plans,
    shouldRunAny: allPlans.some((plan) => plan.action === 'run'),
    reasonCodes: unique(allPlans.flatMap((plan) => plan.reasonCodes)),
  };
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
