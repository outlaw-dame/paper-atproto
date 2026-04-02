import { describe, expect, it } from 'vitest';
import type { ConversationSession } from './sessionTypes';
import {
  createSessionAiDiagnostics,
  markConversationModelDiscarded,
  markConversationModelLoading,
  markConversationModelReady,
  markConversationModelSkipped,
  shouldRunInterpolatorWriter,
} from './modelExecution';

function createSession(
  overrides?: Partial<ConversationSession>,
): ConversationSession {
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
      interpolator: {
        rootUri: 'at://did:plc:test/app.bsky.feed.post/root',
        summaryText: 'summary',
        salientClaims: [],
        salientContributors: [],
        clarificationsAdded: [],
        newAnglesAdded: [],
        topContributors: [],
        entityLandscape: [],
        heatLevel: 0.2,
        repetitionLevel: 0.1,
        sourceSupportPresent: false,
        updatedAt: '2026-03-31T00:00:00.000Z',
        version: 1,
        replyScores: {},
        evidencePresent: false,
        factualSignalPresent: false,
        lastTrigger: null,
        triggerHistory: [],
        ...(overrides?.interpretation?.interpolator ?? {}),
      },
      scoresByUri: {},
      writerResult: null,
      confidence: {
        surfaceConfidence: 0.6,
        entityConfidence: 0.5,
        interpretiveConfidence: 0.55,
        ...(overrides?.interpretation?.confidence ?? {}),
      },
      summaryMode: 'normal',
      threadState: null,
      interpretiveExplanation: null,
      aiDiagnostics: createSessionAiDiagnostics(),
      premium: {
        status: 'idle',
        ...(overrides?.interpretation?.premium ?? {}),
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
      lastHydratedAt: '2026-03-31T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('model execution policy', () => {
  it('skips the writer when the session is already in minimal fallback mode', () => {
    const session = createSession({
      interpretation: {
        ...createSession().interpretation,
        summaryMode: 'minimal_fallback',
      },
    });

    expect(shouldRunInterpolatorWriter(session, 0)).toEqual({
      shouldRun: false,
      reason: 'minimal_fallback',
    });
  });

  it('skips the writer for very low-signal threads', () => {
    const session = createSession({
      interpretation: {
        ...createSession().interpretation,
        confidence: {
          surfaceConfidence: 0.22,
          entityConfidence: 0.18,
          interpretiveConfidence: 0.19,
        },
        interpolator: {
          ...createSession().interpretation.interpolator!,
          sourceSupportPresent: false,
          factualSignalPresent: false,
        },
      },
    });

    expect(shouldRunInterpolatorWriter(session, 0)).toEqual({
      shouldRun: false,
      reason: 'insufficient_signal',
    });
  });

  it('runs the writer when evidence or replies justify it', () => {
    const evidenceSession = createSession({
      interpretation: {
        ...createSession().interpretation,
        confidence: {
          surfaceConfidence: 0.2,
          entityConfidence: 0.2,
          interpretiveConfidence: 0.2,
        },
        interpolator: {
          ...createSession().interpretation.interpolator!,
          sourceSupportPresent: true,
        },
      },
    });

    expect(shouldRunInterpolatorWriter(evidenceSession, 0)).toEqual({
      shouldRun: true,
    });
    expect(shouldRunInterpolatorWriter(createSession(), 3)).toEqual({
      shouldRun: true,
    });
  });
});

describe('model execution diagnostics', () => {
  it('initializes a dedicated multimodal diagnostics lane', () => {
    const diagnostics = createSessionAiDiagnostics();

    expect(diagnostics.multimodal).toEqual({
      provider: 'qwen_multimodal',
      status: 'idle',
      staleDiscardCount: 0,
    });
  });

  it('tracks loading, ready, and stale discard state', () => {
    const loading = markConversationModelLoading(createSession(), 'writer', {
      sourceToken: 'source-token',
      requestedAt: '2026-03-31T00:00:00.000Z',
    });
    const ready = markConversationModelReady(loading, 'writer', {
      sourceToken: 'source-token',
      requestedAt: '2026-03-31T00:00:00.000Z',
      completedAt: '2026-03-31T00:00:02.000Z',
    });
    const discarded = markConversationModelDiscarded(ready, 'writer', {
      discardedAt: '2026-03-31T00:00:03.000Z',
    });

    expect(loading.interpretation.aiDiagnostics?.writer.status).toBe('loading');
    expect(ready.interpretation.aiDiagnostics?.writer.status).toBe('ready');
    expect(ready.interpretation.aiDiagnostics?.writer.lastDurationMs).toBe(2000);
    expect(discarded.interpretation.aiDiagnostics?.writer.staleDiscardCount).toBe(1);
    expect(discarded.interpretation.aiDiagnostics?.writer.lastDiscardedAt).toBe(
      '2026-03-31T00:00:03.000Z',
    );
  });

  it('tracks multimodal skip state independently from the writer', () => {
    const skipped = markConversationModelSkipped(createSession(), 'multimodal', {
      reason: 'multimodal_not_needed',
      sourceToken: 'source-token',
      completedAt: '2026-03-31T00:00:01.000Z',
    });

    expect(skipped.interpretation.aiDiagnostics?.multimodal.status).toBe('skipped');
    expect(skipped.interpretation.aiDiagnostics?.multimodal.lastSkipReason).toBe('multimodal_not_needed');
    expect(skipped.interpretation.aiDiagnostics?.writer.status).toBe('idle');
  });
});
