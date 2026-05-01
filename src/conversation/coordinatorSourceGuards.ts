import type { ConversationSession } from './sessionTypes';
import {
  buildConversationModelSourceToken,
  matchesConversationModelSourceToken,
} from './modelSourceToken';

export const CONVERSATION_COORDINATOR_SOURCE_GUARD_VERSION = 1 as const;

export type ConversationCoordinatorModelStage = 'writer' | 'multimodal' | 'premium';

export type ConversationCoordinatorSourceApplicationAction = 'apply' | 'discard_stale';

export type ConversationCoordinatorSourceGuardReasonCode =
  | 'source_token_fresh'
  | 'source_token_stale'
  | 'source_token_missing'
  | 'source_token_empty'
  | 'source_token_unavailable';

export interface ConversationCoordinatorSourceApplicationDecision {
  schemaVersion: typeof CONVERSATION_COORDINATOR_SOURCE_GUARD_VERSION;
  action: ConversationCoordinatorSourceApplicationAction;
  stage: ConversationCoordinatorModelStage;
  fresh: boolean;
  currentSourceToken: string | null;
  candidateSourceToken: string | null;
  reasonCodes: ConversationCoordinatorSourceGuardReasonCode[];
}

export function getCoordinatorCurrentSourceToken(session: ConversationSession): string | null {
  try {
    const token = buildConversationModelSourceToken(session).trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function isCoordinatorSourceFresh(
  session: ConversationSession,
  sourceToken: string | null | undefined,
): boolean {
  const normalizedSourceToken = normalizeSourceToken(sourceToken);
  if (!normalizedSourceToken) return false;

  try {
    return matchesConversationModelSourceToken(session, normalizedSourceToken);
  } catch {
    return false;
  }
}

export function selectCoordinatorSourceApplication(
  session: ConversationSession,
  sourceToken: string | null | undefined,
  stage: ConversationCoordinatorModelStage,
): ConversationCoordinatorSourceApplicationDecision {
  const currentSourceToken = getCoordinatorCurrentSourceToken(session);
  const candidateSourceToken = normalizeSourceToken(sourceToken);

  if (!candidateSourceToken) {
    return buildDecision({
      action: 'discard_stale',
      stage,
      fresh: false,
      currentSourceToken,
      candidateSourceToken,
      reasonCodes: [sourceToken === undefined || sourceToken === null ? 'source_token_missing' : 'source_token_empty'],
    });
  }

  if (!currentSourceToken) {
    return buildDecision({
      action: 'discard_stale',
      stage,
      fresh: false,
      currentSourceToken,
      candidateSourceToken,
      reasonCodes: ['source_token_unavailable'],
    });
  }

  const fresh = isCoordinatorSourceFresh(session, candidateSourceToken);
  return buildDecision({
    action: fresh ? 'apply' : 'discard_stale',
    stage,
    fresh,
    currentSourceToken,
    candidateSourceToken,
    reasonCodes: [fresh ? 'source_token_fresh' : 'source_token_stale'],
  });
}

function normalizeSourceToken(sourceToken: string | null | undefined): string | null {
  if (typeof sourceToken !== 'string') return null;
  const trimmed = sourceToken.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildDecision(
  decision: Omit<ConversationCoordinatorSourceApplicationDecision, 'schemaVersion' | 'reasonCodes'> & {
    reasonCodes: readonly ConversationCoordinatorSourceGuardReasonCode[];
  },
): ConversationCoordinatorSourceApplicationDecision {
  return {
    schemaVersion: CONVERSATION_COORDINATOR_SOURCE_GUARD_VERSION,
    ...decision,
    reasonCodes: Array.from(new Set(decision.reasonCodes)),
  };
}
