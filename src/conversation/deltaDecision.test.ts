import { describe, expect, it } from 'vitest';

import {
  finalizeConversationDeltaDecision,
  resolveConversationDeltaDecision,
} from './deltaDecision';
import type { ConversationSession } from './sessionTypes';

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
          text: 'Root post about a developing policy dispute.',
          createdAt: '2026-04-08T10:00:00.000Z',
          likeCount: 0,
          replyCount: 2,
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
      },
      childUrisByParent: {},
      parentUriByChild: {},
      subtreeEndHints: {},
    },
    structure: {
      focusedAnchorUri: ROOT_URI,
      visibleUris: [ROOT_URI],
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
        newAnglesAdded: [],
        repetitionLevel: 0.1,
        heatLevel: 0.15,
        sourceSupportPresent: false,
        updatedAt: '2026-04-08T10:10:00.000Z',
        version: 2,
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
        surfaceConfidence: 0.61,
        entityConfidence: 0.34,
        interpretiveConfidence: 0.22,
      },
      summaryMode: 'normal',
      deltaDecision: {
        didMeaningfullyChange: true,
        changeMagnitude: 0.82,
        changeReasons: ['heat_shift'],
        confidence: {
          surfaceConfidence: 0.28,
          entityConfidence: 0.12,
          interpretiveConfidence: 0.81,
        },
        summaryMode: 'normal',
        computedAt: '2026-04-08T10:00:00.000Z',
      },
      threadState: null,
      interpretiveExplanation: null,
      premium: {
        status: 'idle',
      },
      lastComputedAt: '2026-04-08T10:12:00.000Z',
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
      heatLevel: 0.15,
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
      lastHydratedAt: '2026-04-08T10:12:00.000Z',
    },
  };
}

describe('conversation delta decisions', () => {
  it('self-heals stale stored decisions from current confidence state', () => {
    const resolved = resolveConversationDeltaDecision(createSession());

    expect(resolved).not.toBeNull();
    expect(resolved?.summaryMode).toBe('descriptive_fallback');
    expect(resolved?.confidence.interpretiveConfidence).toBe(0.22);
    expect(resolved?.changeReasons).toEqual(['heat_shift']);
    expect(resolved?.computedAt).toBe('2026-04-08T10:12:00.000Z');
  });

  it('finalizes a session with one authoritative summary mode and delta decision', () => {
    const session = finalizeConversationDeltaDecision(createSession(), {
      didMeaningfullyChange: true,
      changeMagnitude: 0.36,
      changeReasons: ['new_angle_introduced'],
    });

    expect(session.interpretation.deltaDecision?.summaryMode).toBe('descriptive_fallback');
    expect(session.interpretation.summaryMode).toBe('descriptive_fallback');
    expect(session.interpretation.deltaDecision?.changeReasons).toEqual(['new_angle_introduced']);
  });
});
