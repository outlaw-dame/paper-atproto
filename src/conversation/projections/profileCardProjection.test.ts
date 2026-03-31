import { describe, expect, it } from 'vitest';
import type {
  ConversationNode,
  ConversationSession,
} from '../sessionTypes';
import { projectThreadScopedProfileCardData } from './profileCardProjection';

const ROOT_URI = 'at://did:plc:root/app.bsky.feed.post/root';
const FIRST_URI = 'at://did:plc:reply/app.bsky.feed.post/one';
const SECOND_URI = 'at://did:plc:reply/app.bsky.feed.post/two';

function createNode(overrides: Partial<ConversationNode>): ConversationNode {
  return {
    uri: overrides.uri ?? FIRST_URI,
    cid: overrides.cid ?? 'cid',
    authorDid: overrides.authorDid ?? 'did:plc:reply',
    authorHandle: overrides.authorHandle ?? 'reply.test',
    ...(overrides.authorName ?? 'Reply Tester'
      ? { authorName: overrides.authorName ?? 'Reply Tester' }
      : {}),
    ...(overrides.authorAvatar ? { authorAvatar: overrides.authorAvatar } : {}),
    text: overrides.text ?? 'Reply text',
    createdAt: overrides.createdAt ?? new Date('2026-03-30T12:00:00.000Z').toISOString(),
    likeCount: overrides.likeCount ?? 0,
    replyCount: overrides.replyCount ?? 0,
    repostCount: overrides.repostCount ?? 0,
    facets: overrides.facets ?? [],
    embed: overrides.embed ?? null,
    labels: overrides.labels ?? [],
    depth: overrides.depth ?? 0,
    replies: overrides.replies ?? [],
    ...(overrides.parentUri ? { parentUri: overrides.parentUri } : {}),
    ...(overrides.parentAuthorHandle ? { parentAuthorHandle: overrides.parentAuthorHandle } : {}),
    branchDepth: overrides.branchDepth ?? 0,
    siblingIndex: overrides.siblingIndex ?? 0,
    descendantCount: overrides.descendantCount ?? 0,
    ...(overrides.hiddenByModeration !== undefined
      ? { hiddenByModeration: overrides.hiddenByModeration }
      : {}),
    ...(overrides.warnedByModeration !== undefined
      ? { warnedByModeration: overrides.warnedByModeration }
      : {}),
    ...(overrides.deferredReason ? { deferredReason: overrides.deferredReason } : {}),
    ...(overrides.contributionRole ? { contributionRole: overrides.contributionRole } : {}),
    ...(overrides.contributionScores ? { contributionScores: overrides.contributionScores } : {}),
    ...(overrides.contributionSignal ? { contributionSignal: overrides.contributionSignal } : {}),
    ...(overrides.isOriginalPoster !== undefined
      ? { isOriginalPoster: overrides.isOriginalPoster }
      : {}),
    ...(overrides.isHighImpactContributor !== undefined
      ? { isHighImpactContributor: overrides.isHighImpactContributor }
      : {}),
    ...(overrides.isSourceBringer !== undefined
      ? { isSourceBringer: overrides.isSourceBringer }
      : {}),
  };
}

function createSession(): ConversationSession {
  const root = createNode({
    uri: ROOT_URI,
    authorDid: 'did:plc:root',
    authorHandle: 'root.test',
    authorName: 'Root Tester',
    text: 'Root discussion prompt',
    depth: 0,
  });
  const first = createNode({
    uri: FIRST_URI,
    parentUri: ROOT_URI,
    parentAuthorHandle: 'root.test',
    text: 'Here is a source-backed clarification.',
    contributionSignal: {
      role: 'clarification',
      roleConfidence: 0.86,
      addedInformation: true,
      evidencePresent: true,
      isRepetitive: false,
      heatContribution: 0.18,
      qualityScore: 0.74,
    },
    isSourceBringer: true,
  });
  const second = createNode({
    uri: SECOND_URI,
    parentUri: ROOT_URI,
    parentAuthorHandle: 'root.test',
    text: 'A second reply that sharpens the same point.',
    contributionSignal: {
      role: 'new_information',
      roleConfidence: 0.82,
      addedInformation: true,
      evidencePresent: false,
      isRepetitive: false,
      heatContribution: 0.12,
      qualityScore: 0.66,
    },
  });

  return {
    id: ROOT_URI,
    mode: 'story',
    graph: {
      rootUri: ROOT_URI,
      nodesByUri: {
        [ROOT_URI]: root,
        [FIRST_URI]: first,
        [SECOND_URI]: second,
      },
      childUrisByParent: {
        [ROOT_URI]: [FIRST_URI, SECOND_URI],
      },
      parentUriByChild: {
        [FIRST_URI]: ROOT_URI,
        [SECOND_URI]: ROOT_URI,
      },
      subtreeEndHints: {},
    },
    structure: {
      focusedAnchorUri: ROOT_URI,
      visibleUris: [ROOT_URI, FIRST_URI, SECOND_URI],
      deferredUris: [],
      hiddenUris: [],
      revealedWarnUris: [],
      unresolvedChildCountsByUri: {},
    },
    interpretation: {
      interpolator: null,
      scoresByUri: {},
      writerResult: null,
      confidence: null,
      summaryMode: null,
      threadState: null,
      interpretiveExplanation: null,
      premium: {
        status: 'idle',
      },
    },
    evidence: {
      verificationByUri: {},
      rootVerification: null,
    },
    entities: {
      writerEntities: [],
      canonicalEntities: [],
      entityLandscape: [],
    },
    contributors: {
      contributors: [],
      topContributorDids: [],
    },
    translations: {
      byUri: {},
    },
    trajectory: {
      direction: 'forming',
      heatLevel: 0,
      repetitionLevel: 0,
      activityVelocity: 0,
      turningPoints: [],
    },
    meta: {
      status: 'ready',
      error: null,
    },
  };
}

describe('profile card projection', () => {
  it('builds canonical thread-scoped cards from the session projection layer', () => {
    const data = projectThreadScopedProfileCardData({
      session: createSession(),
      did: 'did:plc:reply',
      focusUri: SECOND_URI,
      isFollowing: true,
    });

    expect(data?.variant).toBe('thread_scoped');
    expect(data?.social.isPartial).toBe(true);
    expect(data?.threadContext?.threadUri).toBe(ROOT_URI);
    expect(data?.threadContext?.compactPosts[0]?.uri).toBe(SECOND_URI);
    expect(data?.threadContext?.roleSummary).toMatch(/clarification|new information/i);
    expect(data?.threadContext?.notableAction).toBe('Introduced high-confidence evidence');
  });
});
