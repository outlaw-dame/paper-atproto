import { describe, expect, it } from 'vitest';
import type { MockPost } from '../../data/mockData';
import type {
  ConversationNode,
  ConversationSession,
} from '../sessionTypes';
import { projectStoryView } from './storyProjection';

const ROOT_URI = 'at://did:plc:root/app.bsky.feed.post/root';
const REPLY_URI = 'at://did:plc:root/app.bsky.feed.post/reply';

function createPost(overrides: Partial<MockPost>): MockPost {
  return {
    id: overrides.id ?? ROOT_URI,
    author: {
      did: overrides.author?.did ?? 'did:plc:one',
      handle: overrides.author?.handle ?? 'one.test',
      displayName: overrides.author?.displayName ?? 'One Test',
      ...(overrides.author?.avatar ? { avatar: overrides.author.avatar } : {}),
    },
    content: overrides.content ?? 'AI policy update from @janedoe #AI',
    ...(overrides.facets ? { facets: overrides.facets } : {}),
    createdAt: overrides.createdAt ?? new Date('2026-03-30T12:00:00.000Z').toISOString(),
    likeCount: overrides.likeCount ?? 12,
    replyCount: overrides.replyCount ?? 4,
    repostCount: overrides.repostCount ?? 1,
    bookmarkCount: overrides.bookmarkCount ?? 0,
    chips: overrides.chips ?? [],
    ...(overrides.images ? { images: overrides.images } : {}),
    ...(overrides.embed ? { embed: overrides.embed } : {}),
    ...(overrides.media ? { media: overrides.media } : {}),
    timestamp: overrides.timestamp ?? '2m',
    ...(overrides.threadRoot ? { threadRoot: overrides.threadRoot } : {}),
    ...(overrides.replyTo ? { replyTo: overrides.replyTo } : {}),
    ...(overrides.viewer ? { viewer: overrides.viewer } : {}),
  };
}

function createNode(overrides: Partial<ConversationNode>): ConversationNode {
  return {
    uri: overrides.uri ?? REPLY_URI,
    cid: overrides.cid ?? 'cid',
    authorDid: overrides.authorDid ?? 'did:plc:one',
    authorHandle: overrides.authorHandle ?? 'one.test',
    ...(overrides.authorName ? { authorName: overrides.authorName } : {}),
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
    authorDid: 'did:plc:one',
    authorHandle: 'one.test',
    authorName: 'One Test',
    text: 'Root discussion prompt',
    depth: 0,
    branchDepth: 0,
  });
  const reply = createNode({
    uri: REPLY_URI,
    authorDid: 'did:plc:two',
    authorHandle: 'two.test',
    authorName: 'Two Test',
    text: 'Reply adds sourcing and pushes the thread toward clarification.',
    parentUri: ROOT_URI,
    parentAuthorHandle: 'one.test',
    depth: 1,
    branchDepth: 1,
    contributionSignal: {
      role: 'clarification',
      roleConfidence: 0.92,
      addedInformation: true,
      evidencePresent: true,
      isRepetitive: false,
      heatContribution: 0.18,
      qualityScore: 0.78,
    },
    isSourceBringer: true,
  });

  return {
    id: ROOT_URI,
    mode: 'story',
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
        summaryText: 'The post is drawing source-backed replies about enforcement tactics.',
        salientClaims: [],
        salientContributors: [],
        clarificationsAdded: [],
        newAnglesAdded: [],
        repetitionLevel: 0.12,
        heatLevel: 0.28,
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
        collapsedSummary: 'The thread centers on sourcing requests and clarifications around the claim.',
        whatChanged: [],
        contributorBlurbs: [],
        abstained: false,
        mode: 'descriptive_fallback',
      },
      confidence: {
        surfaceConfidence: 0.76,
        entityConfidence: 0.7,
        interpretiveConfidence: 0.58,
      },
      summaryMode: 'descriptive_fallback',
      threadState: {
        dominantTone: 'contested',
        informationDensity: 'medium',
        evidencePresence: true,
        topContributors: ['did:plc:two'],
        conversationPhase: 'active',
        interpolatorConfidence: {
          surfaceConfidence: 0.76,
          entityConfidence: 0.7,
          interpretiveConfidence: 0.58,
        },
        interpretiveState: {
          semanticCoherence: 'high',
          contextCompleteness: 'high',
          perspectiveBreadth: 'moderate',
          ambiguity: 'low',
          coverageCompleteness: 'medium',
        },
      },
      interpretiveExplanation: {
        score: 0.58,
        mode: 'descriptive_fallback',
        factors: {
          semanticCoherence: 0.81,
          evidenceAdequacy: 0.72,
          contextCompleteness: 0.84,
          perspectiveBreadth: 0.55,
          ambiguityPenalty: 0.18,
          contradictionPenalty: 0.24,
          repetitionPenalty: 0.1,
          heatPenalty: 0.22,
          coverageGapPenalty: 0.18,
          freshnessPenalty: 0.05,
          sourceIntegritySupport: 0.63,
          userLabelSupport: 0.2,
          signalAgreement: 0.68,
        },
        rationale: [],
        boostedBy: ['semanticCoherence'],
        degradedBy: ['contradictionPenalty'],
      },
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
      entityLandscape: [
        {
          entityText: 'Jane Doe',
          canonicalLabel: 'Jane Doe',
          canonicalEntityId: 'person:jane-doe',
          entityKind: 'person',
          mentionCount: 3,
          sentimentShift: 0,
          isNewEntity: false,
          matchConfidence: 0.93,
        },
        {
          entityText: 'policy enforcement',
          canonicalLabel: 'Policy Enforcement',
          canonicalEntityId: 'concept:policy-enforcement',
          entityKind: 'concept',
          mentionCount: 2,
          sentimentShift: 0,
          isNewEntity: false,
          matchConfidence: 0.88,
        },
      ],
    },
    contributors: {
      contributors: [],
      topContributorDids: ['did:plc:two'],
    },
    translations: {
      byUri: {},
    },
    trajectory: {
      direction: 'clarifying',
      heatLevel: 0.28,
      repetitionLevel: 0.12,
      activityVelocity: 0.34,
      turningPoints: [],
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

describe('story projection', () => {
  it('extracts reusable discovery card view models from search results', () => {
    const posts = [
      createPost({
        embed: {
          type: 'external',
          url: 'https://time.com/story/example',
          title: 'Time reporting',
          description: 'A reported overview of the policy story.',
          thumb: 'https://example.com/thumb.jpg',
          domain: 'time.com',
        },
      }),
      createPost({
        id: 'at://did:plc:two/app.bsky.feed.post/2',
        author: {
          did: 'did:plc:two',
          handle: 'two.test',
          displayName: 'Two Test',
        },
        content: 'Critics say @janedoe still has open #AI transparency questions.',
      }),
    ];

    const projection = projectStoryView({
      query: 'ai policy',
      posts,
      getTranslatedText: (post) => `${post.content} [translated]`,
    });

    expect(projection.query).toBe('ai policy');
    expect(projection.resultCount).toBe(2);
    expect(projection.presentationMode).toBe('glanceable');
    expect(projection.badges).toEqual([]);
    expect(projection.canonicalStory?.id).toMatch(/^story:[0-9a-f]{8}$/);
    expect(projection.canonicalStory?.protocols).toEqual(['atproto']);
    expect(projection.canonicalStory?.sourceThreadCount).toBe(1);
    expect(projection.overview?.text).toContain('[translated]');
    expect(projection.overview?.domain).toBe('time.com');
    expect(projection.bestSource?.profileCardData?.variant).toBe('standard');
    expect(projection.relatedConversations).toHaveLength(1);
    expect(projection.relatedEntities.topics.length).toBeGreaterThan(0);
    expect(projection.relatedEntities.actors.length).toBeGreaterThan(0);
  });

  it('prefers session-backed discovery context when a conversation session is available', () => {
    const rootPost = createPost({
      id: ROOT_URI,
      content: 'Root claim text that the overview should not simply restate.',
    });
    const posts = [
      rootPost,
      createPost({
        id: REPLY_URI,
        author: {
          did: 'did:plc:two',
          handle: 'two.test',
          displayName: 'Two Test',
        },
        content: 'Reply text from search results.',
        threadRoot: rootPost,
      }),
    ];
    const session = createSession();

    const projection = projectStoryView({
      query: 'policy enforcement',
      posts,
      getTranslatedText: (post) => post.content,
      sessionsByRootUri: {
        [ROOT_URI]: session,
      },
    });

    expect(projection.sessionBackedCount).toBe(2);
    expect(projection.presentationMode).toBe('descriptive');
    expect(projection.clusterConfidence).toBeGreaterThan(0.4);
    expect(projection.canonicalStory?.signalCounts.rootUris).toBe(1);
    expect(projection.canonicalStory?.sourceThreadCount).toBe(2);
    expect(projection.overview?.isSessionBacked).toBe(true);
    expect(projection.overview?.synopsisText).toBe(
      'The thread centers on sourcing requests and clarifications around the claim.',
    );
    expect(projection.overview?.direction).toBe('clarifying');
    expect(projection.overview?.sourceSupportPresent).toBe(true);
    expect(projection.relatedConversations[0]?.synopsisText).toBe(
      'The thread centers on sourcing requests and clarifications around the claim.',
    );
    expect(projection.relatedEntities.actors[0]?.label).toBe('Jane Doe');
    expect(projection.relatedEntities.topics[0]?.label).toBe('Policy Enforcement');
  });

  it('projects coverage-gap signals into discovery presentation policy', () => {
    const posts = [
      createPost({
        id: ROOT_URI,
        content: 'A sourced policy thread with wider coverage gaps.',
      }),
      createPost({
        id: REPLY_URI,
        content: 'A related reply.',
        threadRoot: createPost({ id: ROOT_URI, content: 'A sourced policy thread with wider coverage gaps.' }),
      }),
    ];
    const session = createSession();

    const projection = projectStoryView({
      query: 'policy enforcement',
      posts,
      getTranslatedText: (post) => post.content,
      sessionsByRootUri: {
        [ROOT_URI]: {
          ...session,
          interpretation: {
            ...session.interpretation,
            confidence: {
              surfaceConfidence: 0.8,
              entityConfidence: 0.72,
              interpretiveConfidence: 0.82,
            },
          },
        },
      },
      coverageGapSignal: {
        magnitude: 0.7,
        kind: 'divergent_sources',
        comparisonCount: 3,
        schemaVersion: 1,
      },
    });

    expect(projection.coverageGap).toBe(0.7);
    expect(projection.divergenceIndicator).toBe('divergent_sources');
    expect(projection.badges).toEqual(['divergent-coverage']);
    expect(projection.presentationMode).toBe('glanceable');
  });
});
