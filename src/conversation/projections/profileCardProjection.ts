import type { ConversationalRole, ConversationSession } from '../sessionTypes';
import type { CompactPostPreview, ProfileCardData } from '../../types/profileCard';

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
    createdAt: string;
    likeCount: number;
    replyCount: number;
    hasMedia: boolean;
    mediaType?: CompactPostPreview['mediaType'];
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

interface BuildThreadScopedProfileCardDataInput {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  banner?: string;
  threadUri: string;
  compactPosts: CompactPostPreview[];
  roleSummary?: string;
  notableAction?: string;
  mostLabelledReply?: NonNullable<ProfileCardData['threadContext']>['mostLabelledReply'];
  isFollowing?: boolean;
  isPartial?: boolean;
}

function humanizeRole(role: string): string {
  return role.replace(/_/g, ' ');
}

function buildRoleSummary(roles: string[]): string | undefined {
  const primaryRole = roles[0];
  if (!primaryRole) return undefined;
  if (roles.length === 1) return humanizeRole(primaryRole);
  return `${humanizeRole(primaryRole)} + ${roles.length - 1} more`;
}

function sortCompactPostsForFocus(
  posts: CompactPostPreview[],
  focusUri?: string,
): CompactPostPreview[] {
  if (!focusUri) return posts;
  return [...posts].sort((left, right) => {
    if (left.uri === focusUri) return -1;
    if (right.uri === focusUri) return 1;
    return 0;
  });
}

export function buildThreadScopedProfileCardData(
  input: BuildThreadScopedProfileCardDataInput,
): ProfileCardData | null {
  const did = input.did.trim();
  const handle = input.handle.trim();
  if (!did || !handle) return null;

  return {
    variant: 'thread_scoped',
    identity: {
      did,
      handle,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.avatar ? { avatar: input.avatar } : {}),
      ...(input.banner ? { banner: input.banner } : {}),
    },
    social: {
      followersCount: 0,
      mutualsCount: 0,
      followingCount: 0,
      isFollowing: input.isFollowing ?? false,
      canFollow: false,
      canBlock: false,
      isPartial: input.isPartial ?? true,
    },
    starterPacks: [],
    activity: {
      recentPosts: input.compactPosts.slice(0, 2),
      popularPosts: [],
    },
    threadContext: {
      threadUri: input.threadUri,
      compactPosts: input.compactPosts.slice(0, 3),
      ...(input.roleSummary ? { roleSummary: input.roleSummary } : {}),
      ...(input.notableAction ? { notableAction: input.notableAction } : {}),
      ...(input.mostLabelledReply ? { mostLabelledReply: input.mostLabelledReply } : {}),
    },
  };
}

export function projectThreadScopedProfileCardData(params: {
  session: ConversationSession;
  did: string;
  focusUri?: string;
  isFollowing?: boolean;
}): ProfileCardData | null {
  const { session, did, focusUri, isFollowing } = params;
  const projection = projectThreadScopedProfileCard(session, did);
  if (!projection?.handle) return null;

  const compactPosts = sortCompactPostsForFocus(
    projection.postsInThread
      .filter((post) => post.text.trim().length > 0)
      .map((post) => ({
        uri: post.uri,
        text: post.text,
        createdAt: post.createdAt,
        likeCount: post.likeCount,
        replyCount: post.replyCount,
        hasMedia: post.hasMedia,
        ...(post.mediaType ? { mediaType: post.mediaType } : {}),
        ...(post.conversationalRole ? { roleBadge: humanizeRole(post.conversationalRole) } : {}),
      })),
    focusUri,
  );
  const roleSummary = buildRoleSummary(projection.roleSummary);
  const avatarUri = focusUri ?? compactPosts[0]?.uri;

  return buildThreadScopedProfileCardData({
    did: projection.did,
    handle: projection.handle,
    ...(projection.displayName ? { displayName: projection.displayName } : {}),
    ...(avatarUri && session.graph.nodesByUri[avatarUri]?.authorAvatar
      ? { avatar: session.graph.nodesByUri[avatarUri]?.authorAvatar }
      : {}),
    threadUri: session.graph.rootUri,
    compactPosts,
    ...(roleSummary ? { roleSummary } : {}),
    ...(projection.notableAction ? { notableAction: projection.notableAction } : {}),
    ...(typeof isFollowing === 'boolean' ? { isFollowing } : {}),
  });
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
      createdAt: p.createdAt,
      likeCount: p.likeCount,
      replyCount: p.replyCount,
      hasMedia: Boolean(
        p.embed?.kind === 'images'
        || p.embed?.kind === 'external'
        || p.embed?.kind === 'recordWithMedia',
      ),
      ...(p.embed?.kind === 'images'
        ? { mediaType: 'image' as const }
        : p.embed?.kind === 'external'
          ? { mediaType: 'external' as const }
          : p.embed?.kind === 'recordWithMedia'
            ? { mediaType: 'image' as const }
            : {}),
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
