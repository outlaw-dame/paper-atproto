import type {
  ConversationModelRunDiagnostics,
  ConversationModelRunSkipReason,
  ConversationSession,
  SessionAiDiagnostics,
} from './sessionTypes';

type ConversationModelRunKind = 'writer' | 'multimodal' | 'premium';

function createConversationModelRunDiagnostics(
  provider: ConversationModelRunDiagnostics['provider'],
): ConversationModelRunDiagnostics {
  return {
    provider,
    status: 'idle',
    staleDiscardCount: 0,
  };
}

export function createSessionAiDiagnostics(): SessionAiDiagnostics {
  return {
    writer: createConversationModelRunDiagnostics('interpolator_writer'),
    multimodal: createConversationModelRunDiagnostics('qwen_multimodal'),
    premium: createConversationModelRunDiagnostics('gemini'),
  };
}

export function readSessionAiDiagnostics(
  session: ConversationSession,
): SessionAiDiagnostics {
  return session.interpretation.aiDiagnostics ?? createSessionAiDiagnostics();
}

function updateSessionAiDiagnostics(
  session: ConversationSession,
  kind: ConversationModelRunKind,
  updater: (current: ConversationModelRunDiagnostics) => ConversationModelRunDiagnostics,
): ConversationSession {
  const diagnostics = readSessionAiDiagnostics(session);
  return {
    ...session,
    interpretation: {
      ...session.interpretation,
      aiDiagnostics: {
        ...diagnostics,
        [kind]: updater(diagnostics[kind]),
      },
    },
  };
}

function computeDurationMs(
  requestedAt: string,
  completedAt: string,
): number | undefined {
  const requestedMs = Date.parse(requestedAt);
  const completedMs = Date.parse(completedAt);
  if (!Number.isFinite(requestedMs) || !Number.isFinite(completedMs)) {
    return undefined;
  }
  return Math.max(0, Math.round(completedMs - requestedMs));
}

export function markConversationModelLoading(
  session: ConversationSession,
  kind: ConversationModelRunKind,
  params: {
    sourceToken: string;
    requestedAt?: string;
  },
): ConversationSession {
  const requestedAt = params.requestedAt ?? new Date().toISOString();
  return updateSessionAiDiagnostics(session, kind, (current) => ({
    provider: current.provider,
    status: 'loading',
    sourceToken: params.sourceToken,
    lastRequestedAt: requestedAt,
    ...(current.lastCompletedAt ? { lastCompletedAt: current.lastCompletedAt } : {}),
    ...(current.lastDurationMs !== undefined ? { lastDurationMs: current.lastDurationMs } : {}),
    staleDiscardCount: current.staleDiscardCount,
    ...(current.lastDiscardedAt ? { lastDiscardedAt: current.lastDiscardedAt } : {}),
  }));
}

export function markConversationModelReady(
  session: ConversationSession,
  kind: ConversationModelRunKind,
  params: {
    sourceToken: string;
    requestedAt: string;
    completedAt?: string;
  },
): ConversationSession {
  const completedAt = params.completedAt ?? new Date().toISOString();
  const durationMs = computeDurationMs(params.requestedAt, completedAt);
  return updateSessionAiDiagnostics(session, kind, (current) => ({
    provider: current.provider,
    status: 'ready',
    sourceToken: params.sourceToken,
    lastRequestedAt: params.requestedAt,
    lastCompletedAt: completedAt,
    ...(durationMs !== undefined ? { lastDurationMs: durationMs } : {}),
    staleDiscardCount: current.staleDiscardCount,
    ...(current.lastDiscardedAt ? { lastDiscardedAt: current.lastDiscardedAt } : {}),
  }));
}

export function markConversationModelSkipped(
  session: ConversationSession,
  kind: ConversationModelRunKind,
  params: {
    reason: ConversationModelRunSkipReason;
    sourceToken?: string;
    completedAt?: string;
  },
): ConversationSession {
  const completedAt = params.completedAt ?? new Date().toISOString();
  return updateSessionAiDiagnostics(session, kind, (current) => ({
    provider: current.provider,
    status: 'skipped',
    ...(params.sourceToken ?? current.sourceToken
      ? { sourceToken: params.sourceToken ?? current.sourceToken }
      : {}),
    ...(current.lastRequestedAt ? { lastRequestedAt: current.lastRequestedAt } : {}),
    lastCompletedAt: completedAt,
    ...(current.lastDurationMs !== undefined ? { lastDurationMs: current.lastDurationMs } : {}),
    lastSkipReason: params.reason,
    staleDiscardCount: current.staleDiscardCount,
    ...(current.lastDiscardedAt ? { lastDiscardedAt: current.lastDiscardedAt } : {}),
  }));
}

export function markConversationModelError(
  session: ConversationSession,
  kind: ConversationModelRunKind,
  params: {
    sourceToken: string;
    requestedAt: string;
    error: string;
    completedAt?: string;
  },
): ConversationSession {
  const completedAt = params.completedAt ?? new Date().toISOString();
  const durationMs = computeDurationMs(params.requestedAt, completedAt);
  return updateSessionAiDiagnostics(session, kind, (current) => ({
    provider: current.provider,
    status: 'error',
    sourceToken: params.sourceToken,
    lastRequestedAt: params.requestedAt,
    lastCompletedAt: completedAt,
    ...(durationMs !== undefined ? { lastDurationMs: durationMs } : {}),
    lastError: params.error,
    staleDiscardCount: current.staleDiscardCount,
    ...(current.lastDiscardedAt ? { lastDiscardedAt: current.lastDiscardedAt } : {}),
  }));
}

export function markConversationModelDiscarded(
  session: ConversationSession,
  kind: ConversationModelRunKind,
  params?: {
    discardedAt?: string;
  },
): ConversationSession {
  const discardedAt = params?.discardedAt ?? new Date().toISOString();
  return updateSessionAiDiagnostics(session, kind, (current) => ({
    ...current,
    staleDiscardCount: current.staleDiscardCount + 1,
    lastDiscardedAt: discardedAt,
  }));
}

export function shouldRunInterpolatorWriter(
  session: ConversationSession,
  replyCount: number,
): { shouldRun: true } | { shouldRun: false; reason: ConversationModelRunSkipReason } {
  if (session.interpretation.summaryMode === 'minimal_fallback') {
    return {
      shouldRun: false,
      reason: 'minimal_fallback',
    };
  }

  const confidence = session.interpretation.confidence;
  const surfaceConfidence = confidence?.surfaceConfidence ?? 0;
  const interpretiveConfidence = confidence?.interpretiveConfidence ?? 0;
  const hasSourceSignal = session.interpretation.interpolator?.sourceSupportPresent ?? false;
  const hasFactualSignal = session.interpretation.interpolator?.factualSignalPresent ?? false;

  if (replyCount >= 4) {
    return { shouldRun: true };
  }
  if (replyCount >= 3 && (surfaceConfidence >= 0.5 || interpretiveConfidence >= 0.42)) {
    return { shouldRun: true };
  }
  if (replyCount >= 2 && (hasSourceSignal || hasFactualSignal)) {
    return { shouldRun: true };
  }
  if (hasSourceSignal || hasFactualSignal) {
    return { shouldRun: true };
  }
  if (replyCount >= 2 && (surfaceConfidence >= 0.68 || interpretiveConfidence >= 0.6)) {
    return { shouldRun: true };
  }
  if (surfaceConfidence >= 0.72 || interpretiveConfidence >= 0.66) {
    return { shouldRun: true };
  }

  return {
    shouldRun: false,
    reason: 'insufficient_signal',
  };
}
