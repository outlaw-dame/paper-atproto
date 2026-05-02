import { describe, expect, it } from 'vitest';
import type { MediaAnalysisRequest } from '../intelligence/llmContracts';
import type { PremiumAiEntitlements } from '../intelligence/premiumContracts';
import type { ConversationSession } from './sessionTypes';
import { createSessionAiDiagnostics } from './modelExecution';
import { planConversationCoordinatorModelStages } from './coordinatorModelStagePlanner';

const ROOT_URI = 'at://did:plc:test/app.bsky.feed.post/root';

const FREE_ENTITLEMENTS: PremiumAiEntitlements = {
  tier: 'free',
  capabilities: [],
  providerAvailable: false,
};

const PRO_ENTITLEMENTS: PremiumAiEntitlements = {
  tier: 'pro',
  capabilities: ['deep_interpolator'],
  providerAvailable: true,
  provider: 'gemini',
  availableProviders: ['gemini'],
};

const MEDIA_REQUEST: MediaAnalysisRequest = {
  threadId: ROOT_URI,
  mediaUrl: 'https://example.test/image.jpg',
  nearbyText: 'Nearby translated context.',
  candidateEntities: ['Example Entity'],
  factualHints: ['A sourced factual hint.'],
};

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

function plan(overrides?: Partial<Parameters<typeof planConversationCoordinatorModelStages>[0]>) {
  return planConversationCoordinatorModelStages({
    session: createSession(),
    replyCount: 4,
    interpolatorEnabled: true,
    didMeaningfullyChange: true,
    multimodalPlan: {
      shouldRun: true,
      requests: [MEDIA_REQUEST],
    },
    premiumEntitlements: PRO_ENTITLEMENTS,
    ...overrides,
  });
}

describe('coordinator model stage planner', () => {
  it('skips every model stage when interpolator is disabled', () => {
    const result = plan({ interpolatorEnabled: false });

    expect(result.shouldRunAny).toBe(false);
    expect(result.reasonCodes).toEqual(['interpolator_disabled']);
    expect(result.plans.writer).toMatchObject({
      stage: 'writer',
      action: 'skip',
      reason: 'interpolator_disabled',
    });
    expect(result.plans.multimodal).toMatchObject({
      stage: 'multimodal',
      action: 'skip',
      reason: 'interpolator_disabled',
    });
    expect(result.plans.premium).toMatchObject({
      stage: 'premium',
      action: 'skip',
      reason: 'interpolator_disabled',
    });
  });

  it('reuses existing outputs when the session did not meaningfully change', () => {
    const session = createSession({
      interpretation: {
        ...createSession().interpretation,
        writerResult: {
          collapsedSummary: 'Existing summary.',
          whatChanged: [],
          contributorBlurbs: [],
          abstained: false,
          mode: 'normal',
        },
      },
    });

    const result = plan({ session, didMeaningfullyChange: false });

    expect(result.shouldRunAny).toBe(false);
    expect(result.reasonCodes).toEqual(['reuse_existing_outputs']);
    expect(result.plans.writer.reason).toBe('no_meaningful_change');
    expect(result.plans.multimodal.reason).toBe('no_meaningful_change');
    expect(result.plans.premium.reason).toBe('no_meaningful_change');
  });

  it('blocks downstream stages with the writer gate reason when the writer gate rejects the session', () => {
    const result = plan({
      replyCount: 0,
      premiumEntitlements: PRO_ENTITLEMENTS,
      multimodalPlan: {
        shouldRun: true,
        requests: [MEDIA_REQUEST],
      },
    });

    expect(result.shouldRunAny).toBe(false);
    expect(result.reasonCodes).toEqual(['writer_gate_blocked']);
    expect(result.plans.writer).toMatchObject({
      action: 'skip',
      reason: 'insufficient_signal',
    });
    expect(result.plans.multimodal).toMatchObject({
      action: 'skip',
      reason: 'insufficient_signal',
    });
    expect(result.plans.premium).toMatchObject({
      action: 'skip',
      reason: 'insufficient_signal',
    });
  });

  it('plans writer, multimodal, and premium stages when all gates pass', () => {
    const result = plan();

    expect(result.schemaVersion).toBe(1);
    expect(result.shouldRunAny).toBe(true);
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'writer_gate_allowed',
      'multimodal_plan_available',
      'premium_entitled',
    ]));
    expect(result.plans.writer).toMatchObject({
      action: 'run',
      reason: 'run_ready',
    });
    expect(result.plans.multimodal).toMatchObject({
      action: 'run',
      reason: 'run_ready',
      requestCount: 1,
    });
    expect(result.plans.premium).toMatchObject({
      action: 'run',
      reason: 'run_ready',
    });
  });

  it('skips multimodal when the media plan reports no candidates', () => {
    const result = plan({
      multimodalPlan: {
        shouldRun: false,
        reason: 'no_media_candidates',
      },
    });

    expect(result.plans.writer.action).toBe('run');
    expect(result.plans.multimodal).toMatchObject({
      action: 'skip',
      reason: 'no_media_candidates',
      reasonCodes: ['multimodal_plan_no_candidates'],
    });
  });

  it('skips premium when entitlement provider is unavailable', () => {
    const result = plan({ premiumEntitlements: FREE_ENTITLEMENTS });

    expect(result.plans.writer.action).toBe('run');
    expect(result.plans.premium).toMatchObject({
      action: 'skip',
      reason: 'not_entitled',
      reasonCodes: ['premium_provider_unavailable'],
    });
  });

  it('skips premium with insufficient_signal while preserving a premium-specific reason code', () => {
    const result = plan({ replyCount: 1 });

    expect(result.plans.writer.action).toBe('run');
    expect(result.plans.premium).toMatchObject({
      action: 'skip',
      reason: 'insufficient_signal',
      reasonCodes: ['premium_signal_insufficient'],
    });
  });

  it('does not mutate the session while planning', () => {
    const session = createSession();
    const before = JSON.stringify(session);

    plan({ session });

    expect(JSON.stringify(session)).toBe(before);
    expect(session.interpretation.aiDiagnostics?.writer.status).toBe('idle');
  });
});
