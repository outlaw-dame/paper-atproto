import { afterEach, describe, expect, it } from 'vitest';
import { buildInterpolatorSurfaceProjection } from './interpolatorAdapter';
import type { ConversationSession } from '../sessionTypes';
import { useInterpolatorSettingsStore } from '../../store/interpolatorSettingsStore';

const ROOT_URI = 'at://did:plc:root/app.bsky.feed.post/root';

function createSession(): ConversationSession {
  return {
    id: ROOT_URI,
    mode: 'thread',
    graph: {
      rootUri: ROOT_URI,
      nodesByUri: {
        [ROOT_URI]: {
          uri: ROOT_URI,
          cid: 'root-cid',
          authorDid: 'did:plc:root',
          authorHandle: 'root.test',
          text: "New Claude found zero-day's in OpenBSD, ffmpeg, Linux and FreeBSD.",
          createdAt: '2026-04-07T00:00:00.000Z',
          likeCount: 0,
          replyCount: 4,
          repostCount: 0,
          facets: [],
          embed: null,
          labels: [],
          depth: 0,
          replies: [],
          branchDepth: 0,
          siblingIndex: 0,
          descendantCount: 2,
        },
        'at://did:plc:reply/app.bsky.feed.post/1': {
          uri: 'at://did:plc:reply/app.bsky.feed.post/1',
          cid: 'reply-1',
          authorDid: 'did:plc:reply1',
          authorHandle: 'reply1.test',
          text: 'This looks a lot like the earlier XZ incident.',
          createdAt: '2026-04-07T00:01:00.000Z',
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
          contributionSignal: {
            role: 'new_information',
            roleConfidence: 0.61,
            addedInformation: true,
            evidencePresent: false,
            isRepetitive: false,
            heatContribution: 0.05,
            qualityScore: 0.42,
          },
        },
        'at://did:plc:reply/app.bsky.feed.post/2': {
          uri: 'at://did:plc:reply/app.bsky.feed.post/2',
          cid: 'reply-2',
          authorDid: 'did:plc:reply2',
          authorHandle: 'reply2.test',
          text: 'Another reply compares it to older supply-chain scares.',
          createdAt: '2026-04-07T00:02:00.000Z',
          likeCount: 0,
          replyCount: 0,
          repostCount: 0,
          facets: [],
          embed: null,
          labels: [],
          depth: 1,
          replies: [],
          branchDepth: 1,
          siblingIndex: 1,
          descendantCount: 0,
          contributionSignal: {
            role: 'new_information',
            roleConfidence: 0.58,
            addedInformation: true,
            evidencePresent: false,
            isRepetitive: false,
            heatContribution: 0.04,
            qualityScore: 0.39,
          },
        },
      },
      childUrisByParent: {
        [ROOT_URI]: [
          'at://did:plc:reply/app.bsky.feed.post/1',
          'at://did:plc:reply/app.bsky.feed.post/2',
        ],
      },
      parentUriByChild: {
        'at://did:plc:reply/app.bsky.feed.post/1': ROOT_URI,
        'at://did:plc:reply/app.bsky.feed.post/2': ROOT_URI,
      },
      subtreeEndHints: {},
    },
    structure: {
      focusedAnchorUri: ROOT_URI,
      visibleUris: [
        ROOT_URI,
        'at://did:plc:reply/app.bsky.feed.post/1',
        'at://did:plc:reply/app.bsky.feed.post/2',
      ],
      deferredUris: [],
      hiddenUris: [],
      revealedWarnUris: [],
      unresolvedChildCountsByUri: {},
    },
    interpretation: {
      interpolator: {
        rootUri: ROOT_URI,
        summaryText: 'The thread is focused on reactions to the post.',
        salientClaims: [],
        salientContributors: [],
        clarificationsAdded: [],
        newAnglesAdded: ['replies compare it to earlier incidents'],
        repetitionLevel: 0.1,
        heatLevel: 0.12,
        sourceSupportPresent: false,
        updatedAt: '2026-04-07T00:03:00.000Z',
        version: 1,
        replyScores: {},
        entityLandscape: [],
        topContributors: [],
        evidencePresent: false,
        factualSignalPresent: false,
        lastTrigger: null,
        triggerHistory: [],
      },
      scoresByUri: {},
      writerResult: null,
      mediaFindings: [],
      confidence: {
        surfaceConfidence: 0.41,
        entityConfidence: 0.35,
        interpretiveConfidence: 0.22,
      },
      summaryMode: 'descriptive_fallback',
      deltaDecision: {
        didMeaningfullyChange: true,
        changeMagnitude: 0.34,
        changeReasons: ['new_angle_introduced'],
        confidence: {
          surfaceConfidence: 0.41,
          entityConfidence: 0.35,
          interpretiveConfidence: 0.22,
        },
        summaryMode: 'descriptive_fallback',
        computedAt: '2026-04-07T00:03:00.000Z',
      },
      threadState: null,
      interpretiveExplanation: null,
      premium: {
        status: 'idle',
      },
      lastComputedAt: '2026-04-07T00:03:00.000Z',
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
      heatLevel: 0.12,
      repetitionLevel: 0.1,
      activityVelocity: 0.2,
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
      lastHydratedAt: '2026-04-07T00:03:00.000Z',
    },
  };
}

describe('buildInterpolatorSurfaceProjection', () => {
  afterEach(() => {
    useInterpolatorSettingsStore.setState({ enabled: true });
  });

  it('uses cleaner sparse-thread wording for fallback summaries', () => {
    useInterpolatorSettingsStore.setState({ enabled: true });

    const projection = buildInterpolatorSurfaceProjection(createSession());

    expect(projection.summaryText).toContain('Visible replies introduce a new angle.');
    expect(projection.summaryText).not.toContain('Visible replies mostly');
  });

  it('self-heals stale summary mode from current confidence when stored decision drifts', () => {
    useInterpolatorSettingsStore.setState({ enabled: true });

    const session = createSession();
    session.interpretation.deltaDecision = {
      didMeaningfullyChange: true,
      changeMagnitude: 0.8,
      changeReasons: ['source_backed_clarification'],
      confidence: {
        surfaceConfidence: 0.82,
        entityConfidence: 0.4,
        interpretiveConfidence: 0.8,
      },
      summaryMode: 'normal',
      computedAt: '2026-04-07T00:01:00.000Z',
    };

    const projection = buildInterpolatorSurfaceProjection(session);

    expect(projection.summaryMode).toBe('minimal_fallback');
  });
});
