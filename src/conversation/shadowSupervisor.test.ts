import { describe, expect, it } from 'vitest';

import { createSessionAiDiagnostics } from './modelExecution';
import { applyShadowConversationSupervisor } from './shadowSupervisor';
import type { ConversationSession } from './sessionTypes';

const ROOT_URI = 'at://did:plc:root/app.bsky.feed.post/root';

function createSession(): ConversationSession {
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
      visibleUris: [ROOT_URI],
      deferredUris: [],
      hiddenUris: [],
      revealedWarnUris: [],
      unresolvedChildCountsByUri: {},
    },
    interpretation: {
      interpolator: null,
      scoresByUri: {},
      writerResult: null,
      mediaFindings: [],
      confidence: {
        surfaceConfidence: 0.61,
        entityConfidence: 0.42,
        interpretiveConfidence: 0.33,
      },
      summaryMode: 'descriptive_fallback',
      deltaDecision: {
        didMeaningfullyChange: true,
        changeMagnitude: 0.44,
        changeReasons: ['new_angle_introduced'],
        confidence: {
          surfaceConfidence: 0.61,
          entityConfidence: 0.42,
          interpretiveConfidence: 0.33,
        },
        summaryMode: 'descriptive_fallback',
        computedAt: '2026-04-09T12:00:00.000Z',
      },
      threadState: null,
      interpretiveExplanation: null,
      aiDiagnostics: createSessionAiDiagnostics(),
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
      status: 'ready',
      error: null,
      lastHydratedAt: '2026-04-09T12:00:00.000Z',
    },
  };
}

describe('shadowConversationSupervisor', () => {
  it('recommends low-authority handling for degraded multimodal findings', () => {
    const session = createSession();
    session.interpretation.mediaFindings = [{
      mediaType: 'screenshot',
      summary: 'Screenshot of a breaking-news claim.',
      confidence: 0.33,
      analysisStatus: 'degraded',
      moderationStatus: 'unavailable',
    }];
    session.interpretation.aiDiagnostics!.multimodal.status = 'error';

    const nextSession = applyShadowConversationSupervisor(
      session,
      'multimodal_completed',
      { evaluatedAt: '2026-04-09T12:05:00.000Z' },
    );

    expect(nextSession.interpretation.supervisor?.currentRecommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'treat_multimodal_as_low_authority',
          target: 'multimodal',
        }),
      ]),
    );
    expect(nextSession.interpretation.supervisor?.lastDecision?.traceCodes).toContain('multimodal_degraded');
  });

  it('suppresses identical decisions inside the cooldown window', () => {
    const session = createSession();
    session.interpretation.aiDiagnostics!.writer.status = 'error';
    session.interpretation.aiDiagnostics!.writer.lastError = 'writer unavailable';

    const first = applyShadowConversationSupervisor(
      session,
      'writer_completed',
      {
        evaluatedAt: '2026-04-09T12:10:00.000Z',
        cooldownMs: 60_000,
      },
    );
    const second = applyShadowConversationSupervisor(
      first,
      'writer_completed',
      {
        evaluatedAt: '2026-04-09T12:10:20.000Z',
        cooldownMs: 60_000,
      },
    );

    expect(first.interpretation.supervisor?.currentRecommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'rerun_writer_with_safe_fallback',
        }),
      ]),
    );
    expect(second.interpretation.supervisor?.decisionsEvaluated).toBe(2);
    expect(second.interpretation.supervisor?.cooldownSuppressions).toBe(1);
    expect(second.interpretation.supervisor?.lastDecision?.evaluatedAt).toBe('2026-04-09T12:10:00.000Z');
  });

  it('recommends skipping premium on low-signal failed cycles', () => {
    const session = createSession();
    session.interpretation.summaryMode = 'minimal_fallback';
    session.interpretation.deltaDecision = {
      didMeaningfullyChange: false,
      changeMagnitude: 0.08,
      changeReasons: [],
      confidence: {
        surfaceConfidence: 0.2,
        entityConfidence: 0.14,
        interpretiveConfidence: 0.1,
      },
      summaryMode: 'minimal_fallback',
      computedAt: '2026-04-09T12:00:00.000Z',
    };
    session.interpretation.premium = {
      status: 'error',
      lastError: 'premium route failed',
    };
    session.interpretation.aiDiagnostics!.premium.status = 'error';

    const nextSession = applyShadowConversationSupervisor(
      session,
      'premium_completed',
      { evaluatedAt: '2026-04-09T12:12:00.000Z' },
    );

    expect(nextSession.interpretation.supervisor?.currentRecommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'skip_premium_for_cycle',
          target: 'premium',
        }),
      ]),
    );
    expect(nextSession.interpretation.supervisor?.lastDecision?.traceCodes).toEqual(
      expect.arrayContaining(['premium_error', 'premium_low_signal_cycle']),
    );
  });
});
