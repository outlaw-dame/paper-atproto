import { describe, expect, it } from 'vitest';
import type { MockPost } from '../../data/mockData';
import type {
  ConversationNode,
  ConversationSession,
} from '../sessionTypes';
import {
  projectTimelineConversationHint,
  projectTimelineConversationHints,
} from './timelineProjection';

const ROOT_URI = 'at://did:plc:root/app.bsky.feed.post/root';
const REPLY_URI = 'at://did:plc:root/app.bsky.feed.post/reply';

function createPost(overrides: Partial<MockPost>): MockPost {
  return {
    id: overrides.id ?? ROOT_URI,
    author: {
      did: overrides.author?.did ?? 'did:plc:root',
      handle: overrides.author?.handle ?? 'root.test',
      displayName: overrides.author?.displayName ?? 'Root Test',
      ...(overrides.author?.avatar ? { avatar: overrides.author.avatar } : {}),
    },
    content: overrides.content ?? 'Root post text',
    ...(overrides.facets ? { facets: overrides.facets } : {}),
    createdAt: overrides.createdAt ?? new Date('2026-03-30T12:00:00.000Z').toISOString(),
    likeCount: overrides.likeCount ?? 4,
    replyCount: overrides.replyCount ?? 2,
    repostCount: overrides.repostCount ?? 1,
    bookmarkCount: overrides.bookmarkCount ?? 0,
    chips: overrides.chips ?? [],
    ...(overrides.embed ? { embed: overrides.embed } : {}),
    ...(overrides.media ? { media: overrides.media } : {}),
    ...(overrides.images ? { images: overrides.images } : {}),
    ...(overrides.timestamp ? { timestamp: overrides.timestamp } : {}),
    ...(overrides.threadRoot ? { threadRoot: overrides.threadRoot } : {}),
    ...(overrides.replyTo ? { replyTo: overrides.replyTo } : {}),
    ...(overrides.viewer ? { viewer: overrides.viewer } : {}),
  };
}

function createNode(overrides: Partial<ConversationNode>): ConversationNode {
  return {
    uri: overrides.uri ?? ROOT_URI,
    cid: overrides.cid ?? 'cid',
    authorDid: overrides.authorDid ?? 'did:plc:root',
    authorHandle: overrides.authorHandle ?? 'root.test',
    ...(overrides.authorName ? { authorName: overrides.authorName } : {}),
    ...(overrides.authorAvatar ? { authorAvatar: overrides.authorAvatar } : {}),
    text: overrides.text ?? 'Node text',
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
    authorName: 'Root Test',
    text: 'Root post text',
    depth: 0,
    branchDepth: 0,
    replyCount: 2,
  });
  const reply = createNode({
    uri: REPLY_URI,
    authorDid: 'did:plc:reply',
    authorHandle: 'reply.test',
    authorName: 'Reply Test',
    text: 'Reply adds new evidence and context.',
    parentUri: ROOT_URI,
    parentAuthorHandle: 'root.test',
    depth: 1,
    branchDepth: 1,
    contributionSignal: {
      role: 'evidence',
      roleConfidence: 0.9,
      addedInformation: true,
      evidencePresent: true,
      isRepetitive: false,
      heatContribution: 0.12,
      qualityScore: 0.8,
    },
    isSourceBringer: true,
  });

  return {
    id: ROOT_URI,
    mode: 'thread',
    graph: {
      rootUri: ROOT_URI,
      nodesByUri: {
        [ROOT_URI]: root,
        [REPLY_URI]: reply,
      },
      childUrisByParent: {
        [ROOT_URI]: [REPLY_URI],
      },
      parentUriByChild: {
        [REPLY_URI]: ROOT_URI,
      },
      subtreeEndHints: {},
    },
    structure: {
      focusedAnchorUri: ROOT_URI,
      visibleUris: [ROOT_URI, REPLY_URI],
      deferredUris: [],
      hiddenUris: [],
      revealedWarnUris: [],
      unresolvedChildCountsByUri: {},
    },
    interpretation: {
      interpolator: {
        rootUri: ROOT_URI,
        summaryText: 'The thread has shifted toward source-backed clarification.',
        salientClaims: [],
        salientContributors: [],
        clarificationsAdded: [],
        newAnglesAdded: [],
        repetitionLevel: 0.08,
        heatLevel: 0.22,
        sourceSupportPresent: true,
        updatedAt: new Date('2026-03-30T12:05:00.000Z').toISOString(),
        version: 1,
        replyScores: {},
        entityLandscape: [],
        topContributors: [],
        evidencePresent: true,
        factualSignalPresent: true,
        lastTrigger: null,
        triggerHistory: [],
      },
      scoresByUri: {},
      writerResult: {
        collapsedSummary: 'The thread is centering on new evidence and clarification.',
        whatChanged: ['A new source entered the thread.', 'Replies are becoming more specific.'],
        contributorBlurbs: [],
        abstained: false,
        mode: 'normal',
      },
      confidence: {
        surfaceConfidence: 0.84,
        entityConfidence: 0.72,
        interpretiveConfidence: 0.66,
      },
      summaryMode: 'normal',
      threadState: {
        dominantTone: 'contested',
        informationDensity: 'high',
        evidencePresence: true,
        topContributors: ['did:plc:reply'],
        conversationPhase: 'active',
        interpolatorConfidence: {
          surfaceConfidence: 0.84,
          entityConfidence: 0.72,
          interpretiveConfidence: 0.66,
        },
      },
      interpretiveExplanation: null,
      premium: {
        status: 'idle',
      },
      lastComputedAt: new Date('2026-03-30T12:05:00.000Z').toISOString(),
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
      topContributorDids: ['did:plc:reply'],
    },
    translations: {
      byUri: {},
    },
    trajectory: {
      direction: 'clarifying',
      heatLevel: 0.22,
      repetitionLevel: 0.08,
      activityVelocity: 0.31,
      turningPoints: [
        {
          at: new Date('2026-03-30T12:04:00.000Z').toISOString(),
          kind: 'new_evidence',
          uri: REPLY_URI,
        },
      ],
      snapshots: [],
    },
    mutations: {
      revision: 0,
      recent: [],
    },
    meta: {
      status: 'ready',
      error: null,
      lastHydratedAt: new Date('2026-03-30T12:05:00.000Z').toISOString(),
    },
  };
}

describe('timeline projection', () => {
  it('projects richer continuity hints from a conversation session', () => {
    const hint = projectTimelineConversationHint(createSession(), REPLY_URI);

    expect(hint).not.toBeNull();
    expect(hint?.direction).toBe('clarifying');
    expect(hint?.dominantTone).toBe('contested');
    expect(hint?.sourceSupportPresent).toBe(true);
    expect(hint?.factualSignalPresent).toBe(true);
    expect(hint?.compactSummary).toBe(
      'The thread is centering on new evidence and clarification.',
    );
    expect(hint?.continuityLabel).toBe('new evidence');
    expect(hint?.whatChanged).toEqual([
      'A new source entered the thread.',
      'Replies are becoming more specific.',
    ]);
  });

  it('builds a post-id hint map from shared session state', () => {
    const rootPost = createPost({
      id: ROOT_URI,
      content: 'Root post text',
    });
    const replyPost = createPost({
      id: REPLY_URI,
      author: {
        did: 'did:plc:reply',
        handle: 'reply.test',
        displayName: 'Reply Test',
      },
      content: 'Reply text',
      threadRoot: rootPost,
    });

    const hints = projectTimelineConversationHints({
      posts: [rootPost, replyPost],
      sessionsByRootUri: {
        [ROOT_URI]: createSession(),
      },
    });

    expect(hints[ROOT_URI]?.rootUri).toBe(ROOT_URI);
    expect(hints[REPLY_URI]?.branchDepth).toBe(1);
    expect(hints[REPLY_URI]?.continuityLabel).toBe('new evidence');
  });
});
