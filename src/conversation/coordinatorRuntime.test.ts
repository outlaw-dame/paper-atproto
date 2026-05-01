import { describe, expect, it } from 'vitest';
import type { ConversationSession } from './sessionTypes';
import { createSessionAiDiagnostics, markConversationModelDiscarded, markConversationModelError, markConversationModelLoading } from './modelExecution';
import {
  createConversationCoordinatorContextSnapshot,
  selectConversationCoordinatorDecision,
} from './coordinatorRuntime';

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

describe('coordinator runtime context snapshot', () => {
  it('summarizes canonical session and model state without side effects', () => {
    const session = createSession({
      interpretation: {
        ...createSession().interpretation,
        writerResult: {
          collapsedSummary: 'Existing writer result.',
          whatChanged: [],
          contributorBlurbs: [],
          abstained: false,
          mode: 'normal',
        },
        mediaFindings: [
          {
            sourceUri: ROOT_URI,
            mediaUri: 'https://example.test/image.jpg',
            mediaType: 'image',
            summary: 'Image summary',
            confidence: 0.8,
            analysisStatus: 'complete',
            moderationStatus: 'available',
          },
        ],
      },
    });

    const snapshot = createConversationCoordinatorContextSnapshot(session);

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.sessionId).toBe(ROOT_URI);
    expect(snapshot.rootUri).toBe(ROOT_URI);
    expect(snapshot.metaStatus).toBe('ready');
    expect(snapshot.sourceToken).toBe('2026-05-01T20:00:00.000Z::0');
    expect(snapshot.activeStages).toEqual([]);
    expect(snapshot.errorStages).toEqual([]);
    expect(snapshot.staleStages).toEqual([]);
    expect(snapshot.reasonCodes).toEqual(expect.arrayContaining([
      'canonical_session_ready',
      'source_token_available',
      'writer_result_present',
      'media_findings_present',
    ]));
    expect(session.interpretation.aiDiagnostics?.writer.status).toBe('idle');
  });

  it('detects active model stages and returns a wait decision', () => {
    const loading = markConversationModelLoading(createSession(), 'writer', {
      sourceToken: 'token-1',
      requestedAt: '2026-05-01T20:00:02.000Z',
    });

    const snapshot = createConversationCoordinatorContextSnapshot(loading);
    const decision = selectConversationCoordinatorDecision(snapshot);

    expect(snapshot.activeStages).toEqual(['writer']);
    expect(snapshot.modelStages.writer).toMatchObject({
      status: 'loading',
      sourceToken: 'token-1',
      provider: 'interpolator_writer',
    });
    expect(snapshot.reasonCodes).toEqual(expect.arrayContaining(['writer_loading']));
    expect(decision).toMatchObject({
      action: 'wait_for_active_model_stage',
      final: false,
      activeStages: ['writer'],
    });
  });

  it('detects errors and stale discards for review decisions', () => {
    const errored = markConversationModelError(createSession(), 'premium', {
      sourceToken: 'token-2',
      requestedAt: '2026-05-01T20:00:02.000Z',
      completedAt: '2026-05-01T20:00:04.000Z',
      error: 'provider unavailable',
    });
    const stale = markConversationModelDiscarded(errored, 'writer', {
      discardedAt: '2026-05-01T20:00:05.000Z',
    });

    const snapshot = createConversationCoordinatorContextSnapshot(stale);
    const decision = selectConversationCoordinatorDecision(snapshot);

    expect(snapshot.errorStages).toEqual(['premium']);
    expect(snapshot.staleStages).toEqual(['writer']);
    expect(snapshot.reasonCodes).toEqual(expect.arrayContaining([
      'premium_error',
      'writer_stale_discard',
    ]));
    expect(decision).toMatchObject({
      action: 'review_model_errors',
      final: true,
      errorStages: ['premium'],
      staleStages: ['writer'],
    });
  });

  it('detects mutation churn relative to the last hydration timestamp', () => {
    const session = createSession({
      mutations: {
        revision: 3,
        lastMutationAt: '2026-05-01T20:01:00.000Z',
        recent: [],
      },
      meta: {
        status: 'ready',
        error: null,
        lastHydratedAt: '2026-05-01T20:00:01.000Z',
      },
    });

    const snapshot = createConversationCoordinatorContextSnapshot(session);

    expect(snapshot.hasMutationChurn).toBe(true);
    expect(snapshot.mutationRevision).toBe(3);
    expect(snapshot.reasonCodes).toContain('mutation_churn_present');
  });

  it('waits for canonical session readiness before model orchestration', () => {
    const snapshot = createConversationCoordinatorContextSnapshot(createSession({
      meta: {
        status: 'loading',
        error: null,
      },
    }));

    expect(selectConversationCoordinatorDecision(snapshot)).toMatchObject({
      action: 'wait_for_session',
      final: false,
      reasonCodes: ['canonical_session_loading'],
    });
  });
});
