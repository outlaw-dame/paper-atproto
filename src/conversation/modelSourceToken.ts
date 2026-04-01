import type { ConversationSession } from './sessionTypes';

export function buildConversationModelSourceToken(
  session: ConversationSession,
): string {
  const computedAt = session.interpretation.lastComputedAt ?? 'none';
  const mutationRevision = session.mutations.revision;
  return `${computedAt}::${mutationRevision}`;
}

export function matchesConversationModelSourceToken(
  session: ConversationSession,
  token: string,
): boolean {
  return buildConversationModelSourceToken(session) === token;
}
