import type { ConversationSession } from './sessionTypes';
import {
  buildConversationDeltaDecision,
  resolveSummaryModeFromConfidence,
  type ConversationDeltaDecision,
} from '../intelligence/conversationDelta';
import type { ConfidenceState } from '../intelligence/llmContracts';
import { recordInterpolatorDeltaResolution } from '../perf/interpolatorTelemetry';

function equalConfidence(
  left: ConfidenceState | null | undefined,
  right: ConfidenceState | null | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.surfaceConfidence === right.surfaceConfidence
    && left.entityConfidence === right.entityConfidence
    && left.interpretiveConfidence === right.interpretiveConfidence;
}

function resolveComputedAt(session: ConversationSession): string {
  return session.interpretation.lastComputedAt
    ?? session.meta.lastHydratedAt
    ?? session.interpretation.interpolator?.updatedAt
    ?? new Date().toISOString();
}

function equalStringArray(
  left: string[] | undefined,
  right: string[] | undefined,
): boolean {
  const leftList = left ?? [];
  const rightList = right ?? [];
  if (leftList.length !== rightList.length) return false;
  return leftList.every((value, index) => value === rightList[index]);
}

function equalDecision(
  left: ConversationDeltaDecision | null | undefined,
  right: ConversationDeltaDecision | null | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.didMeaningfullyChange === right.didMeaningfullyChange
    && left.changeMagnitude === right.changeMagnitude
    && left.summaryMode === right.summaryMode
    && left.computedAt === right.computedAt
    && equalConfidence(left.confidence, right.confidence)
    && equalStringArray(left.changeReasons, right.changeReasons);
}

export function buildConversationDeltaDecisionForSession(
  session: ConversationSession,
  seed?: Partial<ConversationDeltaDecision> | null,
): ConversationDeltaDecision | null {
  const confidence = session.interpretation.confidence ?? seed?.confidence ?? null;
  if (!confidence) return null;

  return buildConversationDeltaDecision({
    didMeaningfullyChange: seed?.didMeaningfullyChange ?? false,
    changeMagnitude: seed?.changeMagnitude ?? 0,
    changeReasons: seed?.changeReasons ?? [],
    confidence,
    computedAt: resolveComputedAt(session),
  });
}

export function resolveConversationDeltaDecision(
  session: ConversationSession,
): ConversationDeltaDecision | null {
  const stored = session.interpretation.deltaDecision ?? null;
  const rebuilt = buildConversationDeltaDecisionForSession(session, stored);
  if (!rebuilt) return stored;
  if (!stored) return rebuilt;

  const expectedMode = resolveSummaryModeFromConfidence(rebuilt.confidence);
  const expectedComputedAt = resolveComputedAt(session);
  const isFresh = stored.computedAt === expectedComputedAt;
  const modeMatches = stored.summaryMode === expectedMode;
  const confidenceMatches = equalConfidence(stored.confidence, rebuilt.confidence);

  if (isFresh && modeMatches && confidenceMatches) {
    return stored;
  }

  return rebuilt;
}

export function finalizeConversationDeltaDecision(
  session: ConversationSession,
  seed?: Partial<ConversationDeltaDecision> | null,
): ConversationSession {
  const deltaDecision = buildConversationDeltaDecisionForSession(session, seed);
  if (!deltaDecision) return session;
  const stored = session.interpretation.deltaDecision ?? null;
  const usedStored = equalDecision(stored, deltaDecision);
  recordInterpolatorDeltaResolution({
    usedStored,
    selfHealed: Boolean(stored) && !usedStored,
  });

  return {
    ...session,
    interpretation: {
      ...session.interpretation,
      deltaDecision,
      summaryMode: deltaDecision.summaryMode,
    },
  };
}
