import { describe, expect, it } from 'vitest';
import type { ConversationSession } from './sessionTypes';
import { selectConversationSessionsByRootUris } from './sessionSelectors';

function createSession(id: string): ConversationSession {
  return {
    id,
    mode: 'thread',
    graph: {
      rootUri: id,
      nodesByUri: {},
      childUrisByParent: {},
      parentUriByChild: {},
      subtreeEndHints: {},
    },
    structure: {
      focusedAnchorUri: id,
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
      revision: 0,
      recent: [],
    },
    meta: {
      status: 'idle',
      error: null,
    },
  };
}

describe('selectConversationSessionsByRootUris', () => {
  it('returns a stable root-keyed map with nulls for missing sessions', () => {
    const rootA = 'at://did:plc:alice/app.bsky.feed.post/1';
    const rootB = 'at://did:plc:bob/app.bsky.feed.post/2';

    expect(selectConversationSessionsByRootUris(
      {
        [rootA]: createSession(rootA),
      },
      [rootA, rootB, rootA, ''],
    )).toEqual({
      [rootA]: expect.objectContaining({ id: rootA }),
      [rootB]: null,
    });
  });
});
