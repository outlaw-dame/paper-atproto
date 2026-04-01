import { describe, expect, it } from 'vitest';
import type { ConversationSession } from './sessionTypes';
import {
  buildConversationModelSourceToken,
  matchesConversationModelSourceToken,
} from './modelSourceToken';

function createSession(): ConversationSession {
  return {
    id: 'at://did:plc:test/app.bsky.feed.post/root',
    mode: 'thread',
    graph: {
      rootUri: 'at://did:plc:test/app.bsky.feed.post/root',
      nodesByUri: {},
      childUrisByParent: {},
      parentUriByChild: {},
      subtreeEndHints: {},
    },
    structure: {
      focusedAnchorUri: 'at://did:plc:test/app.bsky.feed.post/root',
      visibleUris: [],
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
      lastComputedAt: '2026-03-31T00:00:00.000Z',
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
      snapshots: [],
    },
    mutations: {
      revision: 2,
      recent: [],
    },
    meta: {
      status: 'ready',
      error: null,
      lastHydratedAt: '2026-03-31T00:00:00.000Z',
    },
  };
}

describe('model source token', () => {
  it('changes when the computed interpretation timestamp changes', () => {
    const session = createSession();
    const token = buildConversationModelSourceToken(session);

    const changed = buildConversationModelSourceToken({
      ...session,
      interpretation: {
        ...session.interpretation,
        lastComputedAt: '2026-03-31T00:01:00.000Z',
      },
    });

    expect(changed).not.toBe(token);
  });

  it('changes when the mutation revision changes', () => {
    const session = createSession();
    const token = buildConversationModelSourceToken(session);

    const changedSession = {
      ...session,
      mutations: {
        ...session.mutations,
        revision: session.mutations.revision + 1,
      },
    };

    expect(matchesConversationModelSourceToken(changedSession, token)).toBe(false);
  });
});
