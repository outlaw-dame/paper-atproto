import type {
  ConversationContinuitySnapshot,
  ConversationSession,
} from './sessionTypes';
import { readSessionMutationState } from './mutationLedger';

const MAX_CONTINUITY_SNAPSHOTS = 6;

function readContinuitySnapshots(
  session: ConversationSession,
): ConversationContinuitySnapshot[] {
  const maybeSnapshots = (session.trajectory as { snapshots?: ConversationContinuitySnapshot[] })
    .snapshots;
  return Array.isArray(maybeSnapshots) ? maybeSnapshots : [];
}

function normalizeContinuityText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function truncateContinuityText(value: string, maxLength = 44): string {
  const normalized = normalizeContinuityText(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function buildContinuityLabel(
  session: ConversationSession,
  whatChanged: string[],
): string | undefined {
  const lastTurningPoint = session.trajectory.turningPoints?.at(-1);
  if (lastTurningPoint) {
    switch (lastTurningPoint.kind) {
      case 'new_evidence':
        return 'new evidence';
      case 'new_entity':
        return 'new actor';
      case 'heat_spike':
        return 'heat spike';
      case 'branch_split':
        return 'branch split';
      default:
        break;
    }
  }

  const firstChange = whatChanged[0];
  if (firstChange) {
    return truncateContinuityText(firstChange);
  }

  if (session.interpretation.interpolator?.sourceSupportPresent) {
    return 'evidence entered';
  }

  return undefined;
}

export function buildConversationContinuitySnapshot(
  session: ConversationSession,
): ConversationContinuitySnapshot {
  const writerWhatChanged = (session.interpretation.writerResult?.whatChanged ?? [])
    .map((entry) => normalizeContinuityText(entry))
    .filter((entry) => entry.length > 0)
    .slice(0, 3);
  const mutationWhatChanged = readSessionMutationState(session).recent
    .slice(-2)
    .map((entry) => normalizeContinuityText(entry.summary))
    .filter((entry) => entry.length > 0)
    .reverse();
  const whatChanged = Array.from(new Set([
    ...mutationWhatChanged,
    ...writerWhatChanged,
  ])).slice(0, 3);
  const recordedAt = session.interpretation.lastComputedAt
    ?? session.meta.lastHydratedAt
    ?? new Date().toISOString();
  const continuityLabel = buildContinuityLabel(session, whatChanged);

  return {
    recordedAt,
    ...(session.interpretation.summaryMode !== null
      ? { summaryMode: session.interpretation.summaryMode }
      : {}),
    direction: session.trajectory.direction,
    ...(session.interpretation.threadState?.dominantTone
      ? { dominantTone: session.interpretation.threadState.dominantTone }
      : {}),
    ...(session.interpretation.threadState?.conversationPhase
      ? { conversationPhase: session.interpretation.threadState.conversationPhase }
      : {}),
    heatLevel: session.trajectory.heatLevel,
    repetitionLevel: session.trajectory.repetitionLevel,
    sourceSupportPresent: session.interpretation.interpolator?.sourceSupportPresent ?? false,
    factualSignalPresent: session.interpretation.interpolator?.factualSignalPresent ?? false,
    ...(continuityLabel
      ? { continuityLabel }
      : {}),
    whatChanged,
  };
}

function isMeaningfullyDifferentSnapshot(
  previous: ConversationContinuitySnapshot | undefined,
  next: ConversationContinuitySnapshot,
): boolean {
  if (!previous) return true;

  return previous.summaryMode !== next.summaryMode
    || previous.direction !== next.direction
    || previous.dominantTone !== next.dominantTone
    || previous.conversationPhase !== next.conversationPhase
    || previous.sourceSupportPresent !== next.sourceSupportPresent
    || previous.factualSignalPresent !== next.factualSignalPresent
    || previous.continuityLabel !== next.continuityLabel
    || Math.abs(previous.heatLevel - next.heatLevel) >= 0.05
    || Math.abs(previous.repetitionLevel - next.repetitionLevel) >= 0.05
    || previous.whatChanged.join('|') !== next.whatChanged.join('|');
}

export function appendContinuitySnapshotHistory(
  snapshots: ConversationContinuitySnapshot[],
  next: ConversationContinuitySnapshot,
): ConversationContinuitySnapshot[] {
  const previous = snapshots.at(-1);
  if (!isMeaningfullyDifferentSnapshot(previous, next)) {
    if (!previous) return [next];
    return [
      ...snapshots.slice(0, -1),
      {
        ...previous,
        recordedAt: next.recordedAt,
      },
    ];
  }

  return [...snapshots, next].slice(-MAX_CONTINUITY_SNAPSHOTS);
}

export function updateConversationContinuitySnapshots(
  session: ConversationSession,
): ConversationSession {
  const snapshot = buildConversationContinuitySnapshot(session);
  const existingSnapshots = readContinuitySnapshots(session);
  return {
    ...session,
    trajectory: {
      ...session.trajectory,
      snapshots: appendContinuitySnapshotHistory(existingSnapshots, snapshot),
    },
  };
}

export function latestContinuitySnapshot(
  session: ConversationSession,
): ConversationContinuitySnapshot | null {
  return readContinuitySnapshots(session).at(-1) ?? null;
}

export function resolveCurrentContinuitySnapshot(
  session: ConversationSession,
): ConversationContinuitySnapshot {
  const latest = latestContinuitySnapshot(session);
  const current = buildConversationContinuitySnapshot(session);
  if (!latest) {
    return current;
  }

  return isMeaningfullyDifferentSnapshot(latest, current)
    ? current
    : latest;
}
