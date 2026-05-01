import { describe, expect, it } from 'vitest';
import type { ConversationSession } from './sessionTypes';
import { createSessionAiDiagnostics } from './modelExecution';
import { buildConversationModelSourceToken } from './modelSourceToken';
import {
  getCoordinatorCurrentSourceToken,
  isCoordinatorSourceFresh,
  selectCoordinatorSourceApplication,
} from './coordinatorSourceGuards';

const ROOT_URI = 'at://did:plc:test/app.bsky.feed.post/root';

function createSession(overrides?: Partial<ConversationSession>): ConversationSession {
  return {
    id: ROOT_URI,
    mode: 'thread',
    graph: {
      rootUri: ROOT_URI,
      nodesByUri: {},
      childUrisByParent: {},
      parentUriByChild: {},
      subtreeEndHints: {},
    },
    structure: {
      focusedAnchorUri: ROOT_URI,
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
      summaryMode: 'normal',
      threadState: null,
      interpretiveExplanation: null,
      lastComputedAt: '2026-05-01T20:00:00.000Z',
      aiDiagnostics: createSessionAiDiagnostics(),
      premium: {
        status: 'idle',
      },
      ...(overrides?.interpretation ?? {}),
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
      status: 'ready',
      error: null,
      lastHydratedAt: '2026-05-01T20:00:01.000Z',
    },
    ...overrides,
  };
}

describe('coordinator source token guards', () => {
  it('delegates to the existing source token format', () => {
    const session = createSession();

    expect(getCoordinatorCurrentSourceToken(session)).toBe(buildConversationModelSourceToken(session));
    expect(getCoordinatorCurrentSourceToken(session)).toBe('2026-05-01T20:00:00.000Z::0');
  });

  it('allows applying a fresh writer result', () => {
    const session = createSession();
    const token = buildConversationModelSourceToken(session);

    expect(isCoordinatorSourceFresh(session, token)).toBe(true);
    expect(selectCoordinatorSourceApplication(session, token, 'writer')).toEqual({
      schemaVersion: 1,
      action: 'apply',
      stage: 'writer',
      fresh: true,
      currentSourceToken: token,
      candidateSourceToken: token,
      reasonCodes: ['source_token_fresh'],
    });
  });

  it('normalizes candidate whitespace before applying a fresh result', () => {
    const session = createSession();
    const token = buildConversationModelSourceToken(session);

    expect(isCoordinatorSourceFresh(session, `  ${token}\n`)).toBe(true);
    expect(selectCoordinatorSourceApplication(session, `  ${token}\n`, 'writer')).toEqual({
      schemaVersion: 1,
      action: 'apply',
      stage: 'writer',
      fresh: true,
      currentSourceToken: token,
      candidateSourceToken: token,
      reasonCodes: ['source_token_fresh'],
    });
  });

  it('discards a stale multimodal result', () => {
    const session = createSession({
      mutations: {
        revision: 2,
        recent: [],
      },
    });
    const staleToken = '2026-05-01T20:00:00.000Z::1';

    expect(isCoordinatorSourceFresh(session, staleToken)).toBe(false);
    expect(selectCoordinatorSourceApplication(session, staleToken, 'multimodal')).toEqual({
      schemaVersion: 1,
      action: 'discard_stale',
      stage: 'multimodal',
      fresh: false,
      currentSourceToken: '2026-05-01T20:00:00.000Z::2',
      candidateSourceToken: staleToken,
      reasonCodes: ['source_token_stale'],
    });
  });

  it('discards missing premium source tokens', () => {
    const session = createSession();

    expect(selectCoordinatorSourceApplication(session, undefined, 'premium')).toEqual({
      schemaVersion: 1,
      action: 'discard_stale',
      stage: 'premium',
      fresh: false,
      currentSourceToken: '2026-05-01T20:00:00.000Z::0',
      candidateSourceToken: null,
      reasonCodes: ['source_token_missing'],
    });
  });

  it('discards empty writer source tokens', () => {
    const session = createSession();

    expect(selectCoordinatorSourceApplication(session, '   ', 'writer')).toEqual({
      schemaVersion: 1,
      action: 'discard_stale',
      stage: 'writer',
      fresh: false,
      currentSourceToken: '2026-05-01T20:00:00.000Z::0',
      candidateSourceToken: null,
      reasonCodes: ['source_token_empty'],
    });
  });

  it('does not mutate the session while selecting source application', () => {
    const session = createSession();
    const before = JSON.stringify(session);

    selectCoordinatorSourceApplication(session, 'stale-token', 'writer');

    expect(JSON.stringify(session)).toBe(before);
    expect(session.interpretation.aiDiagnostics?.writer.staleDiscardCount).toBe(0);
  });
});
