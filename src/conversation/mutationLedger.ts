import type {
  ConversationMutationDelta,
  ConversationMutationKind,
  ConversationSession,
  SessionMutationState,
} from './sessionTypes';

const MAX_RECENT_MUTATIONS = 8;

function normalizeMutationSummary(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function buildMutationSummary(input: {
  kind: ConversationMutationKind;
  branchFocused?: boolean;
  userFeedback?: string;
}): string {
  switch (input.kind) {
    case 'optimistic_reply_inserted':
      return 'A reply is being sent.';
    case 'optimistic_reply_reconciled':
      return 'A new reply was added.';
    case 'optimistic_reply_rolled_back':
      return 'A pending reply failed to send.';
    case 'user_feedback_set':
      return input.userFeedback
        ? `Reply feedback updated: ${input.userFeedback}.`
        : 'Reply feedback was updated.';
    case 'warned_post_revealed':
      return 'A warned post was revealed.';
    case 'focused_branch_changed':
      return input.branchFocused
        ? 'Thread focus shifted to a branch.'
        : 'Thread focus returned to the full conversation.';
    default:
      return 'The conversation state changed.';
  }
}

export function readSessionMutationState(
  session: ConversationSession,
): SessionMutationState {
  const raw = (session as { mutations?: Partial<SessionMutationState> }).mutations;
  return {
    revision: typeof raw?.revision === 'number' && Number.isFinite(raw.revision)
      ? raw.revision
      : 0,
    ...(typeof raw?.lastMutationAt === 'string'
      ? { lastMutationAt: raw.lastMutationAt }
      : {}),
    recent: Array.isArray(raw?.recent) ? raw.recent : [],
  };
}

export function latestConversationMutation(
  session: ConversationSession,
): ConversationMutationDelta | null {
  return readSessionMutationState(session).recent.at(-1) ?? null;
}

export function appendConversationMutation(
  session: ConversationSession,
  input: {
    kind: ConversationMutationKind;
    at?: string;
    targetUri?: string;
    relatedUri?: string;
    summary?: string;
    branchFocused?: boolean;
    userFeedback?: string;
  },
): ConversationSession {
  const current = readSessionMutationState(session);
  const nextRevision = current.revision + 1;
  const at = input.at ?? new Date().toISOString();
  const summary = normalizeMutationSummary(
    input.summary
      ?? buildMutationSummary({
        kind: input.kind,
        ...(input.branchFocused !== undefined ? { branchFocused: input.branchFocused } : {}),
        ...(input.userFeedback !== undefined ? { userFeedback: input.userFeedback } : {}),
      }),
  );

  const delta: ConversationMutationDelta = {
    revision: nextRevision,
    at,
    kind: input.kind,
    summary,
    ...(input.targetUri ? { targetUri: input.targetUri } : {}),
    ...(input.relatedUri ? { relatedUri: input.relatedUri } : {}),
  };

  return {
    ...session,
    mutations: {
      revision: nextRevision,
      lastMutationAt: at,
      recent: [...current.recent, delta].slice(-MAX_RECENT_MUTATIONS),
    },
  };
}
