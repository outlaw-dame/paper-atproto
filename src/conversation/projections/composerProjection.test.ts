import { describe, expect, it } from 'vitest';
import type { MockPost } from '../../data/mockData';
import type { ConversationSession } from '../sessionTypes';
import {
  projectComposeSheetComposerContext,
  projectComposerContext,
  projectHostedThreadComposerContext,
} from './composerProjection';

function makeReplyTarget(overrides: Partial<MockPost> = {}): MockPost {
  return {
    id: 'at://did:plc:test/app.bsky.feed.post/reply',
    cid: 'cid-reply',
    content: 'Parent post content',
    createdAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    author: {
      did: 'did:plc:test',
      handle: 'tester.bsky.social',
      displayName: 'Tester',
    },
    repostCount: 0,
    replyCount: 7,
    likeCount: 0,
    bookmarkCount: 0,
    chips: [],
    replyTo: {
      id: 'at://did:plc:test/app.bsky.feed.post/comment',
      cid: 'cid-comment',
      content: 'Nearby comment',
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      author: {
        did: 'did:plc:comment',
        handle: 'commenter.bsky.social',
        displayName: 'Commenter',
      },
      repostCount: 0,
      replyCount: 0,
      likeCount: 0,
      bookmarkCount: 0,
      chips: [],
    },
    threadRoot: {
      id: 'at://did:plc:test/app.bsky.feed.post/root',
      cid: 'cid-root',
      content: 'Root thread content',
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      author: {
        did: 'did:plc:root',
        handle: 'rooter.bsky.social',
        displayName: 'Rooter',
      },
      repostCount: 0,
      replyCount: 12,
      likeCount: 0,
      bookmarkCount: 0,
      chips: [],
    },
    ...overrides,
  };
}

function makeConversationSession(): ConversationSession {
  const rootUri = 'at://did:plc:root/app.bsky.feed.post/root';
  const replyUri = 'at://did:plc:reply/app.bsky.feed.post/reply';

  return {
    id: rootUri,
    mode: 'thread',
    graph: {
      rootUri,
      nodesByUri: {
        [rootUri]: {
          uri: rootUri,
          cid: 'root-cid',
          authorDid: 'did:plc:root',
          authorHandle: 'root.test',
          text: 'A leak claims the transit agency rewrote the weekend service policy overnight.',
          createdAt: new Date().toISOString(),
          likeCount: 0,
          replyCount: 1,
          repostCount: 0,
          facets: [],
          embed: null,
          labels: [],
          depth: 0,
          replies: [],
          branchDepth: 0,
          siblingIndex: 0,
          descendantCount: 1,
        },
        [replyUri]: {
          uri: replyUri,
          cid: 'reply-cid',
          authorDid: 'did:plc:reply',
          authorHandle: 'reply.test',
          text: 'The screenshot looks real, but people still want the underlying memo.',
          createdAt: new Date().toISOString(),
          likeCount: 0,
          replyCount: 0,
          repostCount: 0,
          facets: [],
          embed: null,
          labels: [],
          depth: 1,
          replies: [],
          branchDepth: 1,
          siblingIndex: 0,
          descendantCount: 0,
        },
      },
      childUrisByParent: {
        [rootUri]: [replyUri],
      },
      parentUriByChild: {
        [replyUri]: rootUri,
      },
      subtreeEndHints: {},
    },
    structure: {
      focusedAnchorUri: rootUri,
      visibleUris: [rootUri, replyUri],
      deferredUris: [],
      hiddenUris: [],
      revealedWarnUris: [],
      unresolvedChildCountsByUri: {},
    },
    interpretation: {
      interpolator: {
        rootUri,
        summaryText: 'People are debating whether the policy screenshot proves the leak.',
        salientClaims: [],
        salientContributors: [],
        clarificationsAdded: ['a reply asks for the underlying memo'],
        newAnglesAdded: ['the screenshot appears to show redlined policy text'],
        repetitionLevel: 0.12,
        heatLevel: 0.18,
        sourceSupportPresent: true,
        updatedAt: new Date().toISOString(),
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
      writerResult: null,
      mediaFindings: [
        {
          mediaType: 'document',
          summary: 'A screenshot of a redlined transit policy memo.',
          confidence: 0.82,
          extractedText: 'WEEKEND SERVICE REDUCTION BEGINS MAY 1',
          cautionFlags: ['partial-view'],
          analysisStatus: 'degraded',
          moderationStatus: 'unavailable',
        },
      ],
      confidence: {
        surfaceConfidence: 0.71,
        entityConfidence: 0.64,
        interpretiveConfidence: 0.58,
      },
      summaryMode: 'normal',
      deltaDecision: null,
      threadState: {
        dominantTone: 'contested',
        informationDensity: 'medium',
        evidencePresence: true,
        topContributors: ['reply.test'],
        conversationPhase: 'active',
        interpolatorConfidence: {
          surfaceConfidence: 0.71,
          entityConfidence: 0.64,
          interpretiveConfidence: 0.58,
        },
      },
      interpretiveExplanation: null,
      premium: {
        status: 'idle',
      },
      lastComputedAt: new Date().toISOString(),
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
      direction: 'clarifying',
      heatLevel: 0.18,
      repetitionLevel: 0.12,
      activityVelocity: 0.14,
      turningPoints: [],
      snapshots: [],
    },
    mutations: {
      revision: 0,
      recent: [],
    },
    meta: {
      status: 'ready',
      lastHydratedAt: new Date().toISOString(),
    },
  };
}

describe('composerProjection helpers', () => {
  it('uses the projected session context for compose sheet guidance and sanitizes draft text', () => {
    const context = projectComposeSheetComposerContext({
      draftText: 'Hello\u0007 world',
      replyTarget: makeReplyTarget(),
      projectedContext: {
        mode: 'reply',
        draftText: '',
        directParent: {
          uri: 'at://did:plc:test/app.bsky.feed.post/reply',
          text: 'Projected parent',
          authorHandle: 'projected.bsky.social',
        },
        threadContext: {
          rootText: 'Projected root',
          ancestorTexts: ['Ancestor one'],
          branchTexts: ['Branch one'],
        },
        replyContext: {
          siblingReplyTexts: ['Sibling one'],
          selectedCommentTexts: ['Selected one'],
          totalCommentCount: 9,
        },
        summaries: {
          threadSummary: 'Summary',
        },
      },
    });

    expect(context.mode).toBe('reply');
    expect(context.draftText).toBe('Hello world');
    expect(context.directParent?.text).toBe('Projected parent');
    expect(context.threadContext?.rootText).toBe('Projected root');
    expect(context.replyContext?.selectedCommentTexts).toEqual(['Selected one']);
    expect(context.summaries?.threadSummary).toBe('Summary');
  });

  it('falls back to reply target context when no session projection exists', () => {
    const context = projectComposeSheetComposerContext({
      draftText: 'Draft reply',
      replyTarget: makeReplyTarget(),
      projectedContext: null,
    });

    expect(context.mode).toBe('reply');
    expect(context.directParent?.text).toBe('Parent post content');
    expect(context.threadContext?.rootText).toBe('Root thread content');
    expect(context.replyContext?.selectedCommentTexts).toEqual(['Nearby comment']);
    expect(context.replyContext?.totalReplyCount).toBe(7);
  });

  it('sanitizes and bounds hosted thread context', () => {
    const context = projectHostedThreadComposerContext({
      draftText: '  draft\u0007 text  ',
      prompt: `  ${'A'.repeat(340)}  `,
      description: 'Description\u0007 with control chars',
      source: '  https://example.com/story  ',
      topics: ['#alpha', '#alpha', `#${'b'.repeat(80)}`],
      audience: 'Everyone',
    });

    expect(context.mode).toBe('hosted_thread');
    expect(context.draftText).toBe('draft text');
    expect(context.hostedThread?.prompt.endsWith('...')).toBe(true);
    expect(context.hostedThread?.description).toBe('Description with control chars');
    expect(context.hostedThread?.source).toBe('https://example.com/story');
    expect(context.hostedThread?.topics?.[0]).toBe('#alpha');
    expect(context.hostedThread?.topics?.[1]?.startsWith('#')).toBe(true);
    expect(context.hostedThread?.topics?.[1]?.endsWith('...')).toBe(true);
    expect(context.hostedThread?.topics?.[1]?.length).toBeLessThanOrEqual(48);
  });

  it('projects media-aware context from session findings', () => {
    const context = projectComposerContext({
      session: makeConversationSession(),
      replyToUri: 'at://did:plc:reply/app.bsky.feed.post/reply',
      draftText: 'Draft a calm reply',
    });

    expect(context.summaries?.mediaContext?.summary).toContain('redlined transit policy memo');
    expect(context.summaries?.mediaContext?.summary).toContain('Visible text includes');
    expect(context.summaries?.mediaContext?.primaryKind).toBe('document');
    expect(context.summaries?.mediaContext?.cautionFlags).toEqual(['partial-view']);
    expect(context.summaries?.mediaContext?.analysisStatus).toBe('degraded');
    expect(context.summaries?.mediaContext?.moderationStatus).toBe('unavailable');
  });
});
