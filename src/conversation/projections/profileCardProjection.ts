import type { ConversationalRole, ConversationSession } from '../sessionTypes';

export type ProfileCardContext =
  | { type: 'global' }
  | { type: 'thread'; threadUri: string };

export interface ThreadScopedProfileProjection {
  did: string;
  handle?: string;
  displayName?: string;
  postsInThread: Array<{
    uri: string;
    text: string;
    contributionRole?: string;
    conversationalRole?: string;
    qualityScore?: number;
    evidencePresent?: boolean;
    interpretiveWeight?: number;
  }>;
  roleSummary: string[];
  notableAction?: string;
  clarificationCount: number;
  sourceContributionCount: number;
  highConfidenceEvidenceCount: number;
}

export function projectThreadScopedProfileCard(
  session: ConversationSession,
  did: string,
): ThreadScopedProfileProjection | null {
  const posts = Object.values(session.graph.nodesByUri).filter((node) => node.authorDid === did);
  if (posts.length === 0) return null;

  const first = posts[0];
  const clarificationCount = posts.filter((p) => p.contributionSignal?.role === 'clarification').length;
  const sourceContributionCount = posts.filter((p) => p.isSourceBringer).length;
  const highConfidenceEvidenceCount = posts.filter((p) => {
    return p.contributionSignal?.evidencePresent
      && (p.contributionSignal?.qualityScore ?? 0) >= 0.68;
  }).length;

  const roleSummary = Array.from(
    new Set(
      posts
        .map((p) => p.contributionSignal?.role)
        .filter((role): role is ConversationalRole => role !== undefined),
    ),
  );

  return {
    did,
    ...(first?.authorHandle ? { handle: first.authorHandle } : {}),
    ...(first?.authorName ? { displayName: first.authorName } : {}),
    postsInThread: posts.map((p) => ({
      uri: p.uri,
      text: p.text,
      ...(p.contributionRole ? { contributionRole: p.contributionRole } : {}),
      ...(p.contributionSignal?.role ? { conversationalRole: p.contributionSignal.role } : {}),
      ...(p.contributionSignal?.qualityScore !== undefined
        ? { qualityScore: p.contributionSignal.qualityScore }
        : {}),
      ...(p.contributionSignal?.evidencePresent !== undefined
        ? { evidencePresent: p.contributionSignal.evidencePresent }
        : {}),
      ...(p.contributionSignal?.interpretiveWeight !== undefined
        ? { interpretiveWeight: p.contributionSignal.interpretiveWeight }
        : {}),
    })),
    roleSummary,
    ...(highConfidenceEvidenceCount > 0
      ? { notableAction: 'Introduced high-confidence evidence' }
      : sourceContributionCount > 0
        ? { notableAction: 'Introduced a source or evidence' }
      : clarificationCount > 0
        ? {
            notableAction: `Added ${clarificationCount} clarification${clarificationCount > 1 ? 's' : ''}`,
          }
        : {}),
    clarificationCount,
    sourceContributionCount,
    highConfidenceEvidenceCount,
  };
}
