import type { ConfidenceState, SummaryMode } from './llmContracts';
import type {
  AtUri,
  InterpolatorDecisionScore,
  ThreadInterpolatorState,
} from './interpolatorTypes';
import {
  applyChangeReasonBoosts,
  computeConfidenceState,
} from './confidence';
import {
  computeThreadChange,
  type ChangeReason,
} from './changeDetection';
import { chooseSummaryMode } from './routing';

export interface ConversationDeltaDecision {
  didMeaningfullyChange: boolean;
  changeMagnitude: number;
  changeReasons: ChangeReason[];
  confidence: ConfidenceState;
  summaryMode: SummaryMode;
  computedAt: string;
}

export function resolveSummaryModeFromConfidence(
  confidence: ConfidenceState,
): SummaryMode {
  return chooseSummaryMode({
    surfaceConfidence: confidence.surfaceConfidence,
    interpretiveConfidence: confidence.interpretiveConfidence,
  });
}

export function buildConversationDeltaDecision(params: {
  didMeaningfullyChange: boolean;
  changeMagnitude: number;
  changeReasons: ChangeReason[];
  confidence: ConfidenceState;
  computedAt?: string;
}): ConversationDeltaDecision {
  const computedAt = params.computedAt ?? new Date().toISOString();
  return {
    didMeaningfullyChange: params.didMeaningfullyChange,
    changeMagnitude: params.changeMagnitude,
    changeReasons: params.changeReasons,
    confidence: params.confidence,
    summaryMode: resolveSummaryModeFromConfidence(params.confidence),
    computedAt,
  };
}

export function computeConversationDeltaDecision(params: {
  previous: ThreadInterpolatorState | null;
  current: ThreadInterpolatorState;
  scores: Record<AtUri, InterpolatorDecisionScore>;
}): ConversationDeltaDecision {
  const changeResult = computeThreadChange(
    params.previous,
    params.current,
    params.scores,
  );
  const rawConfidence = computeConfidenceState(params.current, params.scores);
  const confidence = applyChangeReasonBoosts(
    rawConfidence,
    changeResult.changeReasons,
  );

  return buildConversationDeltaDecision({
    ...changeResult,
    confidence,
    computedAt: params.current.updatedAt,
  });
}
