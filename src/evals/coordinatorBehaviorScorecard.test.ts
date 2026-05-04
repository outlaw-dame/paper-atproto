import { afterEach, describe, expect, it } from 'vitest';
import {
  COORDINATOR_BEHAVIOR_BUDGET_MS,
  COORDINATOR_BEHAVIOR_FIXTURES,
  COORDINATOR_BEHAVIOR_SCORECARD,
  type CoordinatorBehaviorFixture,
} from './coordinatorBehaviorFixtures';
import { intelligenceCoordinator } from '../intelligence/coordinator/intelligenceCoordinator';
import { buildSessionBrief } from '../intelligence/coordinator/sessionBrief';
import {
  __resetIntelligenceEventsForTesting,
  getIntelligenceEventBufferSnapshot,
  type IntelligenceEvent,
} from '../intelligence/coordinator/intelligenceEvents';
import { isLaneEligibleForTask } from '../intelligence/coordinator/capabilityRegistry';
import { setFunctionGemmaRouterRuntime } from '../runtime/routerOrchestrator';
import { executeThinkingPlan } from '../intelligence/coordinator/thinkingLane';
import type { RuntimeCapability } from '../runtime/capabilityProbe';

const HIGH_CAPABILITY: RuntimeCapability = {
  webgpu: true,
  tier: 'high',
  generationAllowed: true,
  multimodalAllowed: true,
  deviceMemoryGiB: 16,
};

afterEach(() => {
  __resetIntelligenceEventsForTesting();
  setFunctionGemmaRouterRuntime(null);
});

async function adviseFixture(fx: CoordinatorBehaviorFixture) {
  const brief = buildSessionBrief({
    surface: fx.surface,
    intent: fx.intent,
    ...(fx.withCapability ? { capability: HIGH_CAPABILITY } : {}),
    ...(fx.sourceToken ? { freshness: { sourceToken: fx.sourceToken } } : {}),
  });
  const options = fx.stale ? { expectedSourceToken: 'src-fresh' } : { silentRouterAudit: true };
  switch (fx.surface) {
    case 'session':
      return intelligenceCoordinator.adviseOnSession(brief, options);
    case 'composer':
      return intelligenceCoordinator.adviseOnComposer(brief, options);
    case 'search':
      return intelligenceCoordinator.adviseOnSearch(brief, options);
    case 'media':
      return intelligenceCoordinator.adviseOnMedia(brief, options);
  }
}

describe('coordinator behaviour scorecard', () => {
  it('publishes a stable, weighted scorecard', () => {
    expect(COORDINATOR_BEHAVIOR_SCORECARD.length).toBeGreaterThan(0);
    const ids = new Set(COORDINATOR_BEHAVIOR_SCORECARD.map((c) => c.id));
    expect(ids.size).toBe(COORDINATOR_BEHAVIOR_SCORECARD.length);
    for (const item of COORDINATOR_BEHAVIOR_SCORECARD) {
      expect(item.weight).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(10);
    }
  });

  for (const fx of COORDINATOR_BEHAVIOR_FIXTURES) {
    it(`upholds coordinator seams for fixture ${fx.id}`, async () => {
      const advice = await adviseFixture(fx);

      // router_policy_agreement
      expect(isLaneEligibleForTask(fx.intent, advice.lane)).toBe(true);

      // latency_budget_respected
      expect(Number.isFinite(advice.event.durationMs ?? 0)).toBe(true);
      expect(advice.event.durationMs ?? 0).toBeLessThan(COORDINATOR_BEHAVIOR_BUDGET_MS);

      // telemetry_event_emitted (exactly one primary event for this advice;
      // surface_intent_mismatch is a follow-up that we do not produce here)
      const snapshot = getIntelligenceEventBufferSnapshot();
      const matching = snapshot.events.filter(
        (e: IntelligenceEvent) => e.surface === advice.event.surface && e.task === fx.intent,
      );
      expect(matching.length).toBe(1);
      expect(matching[0]?.eventId).toBe(advice.event.eventId);

      // source_token_freshness — when brief carries a token, event must too
      if (fx.sourceToken && !fx.stale) {
        expect(advice.event.sourceToken).toBe(fx.sourceToken);
      } else if (!fx.sourceToken) {
        expect(advice.event.sourceToken).toBeUndefined();
      }

      // fallback_correctness — without a registered router runtime, the
      // facade must fall back deterministically (never throw, never pick
      // a contract safety route as the *primary*).
      expect(advice.deterministicFallback).toBe(true);

      // stale_discard_correctness
      if (fx.stale) {
        expect(advice.event.status).toBe('stale_discarded');
        expect(advice.reasonCodes).toContain('stale_source_token');
        expect(advice.routerResult).toBeUndefined();
        expect(advice.edgePlan).toBeUndefined();
      } else {
        expect(advice.event.status).not.toBe('stale_discarded');
      }
    });
  }
});

describe('coordinator behaviour scorecard — thinking lane bounded', () => {
  it('respects the total budget and falls back when the verifier rejects', async () => {
    const result = await executeThinkingPlan({
      id: 'sc_thinking_budget',
      requesterSurface: 'composer',
      totalBudgetMs: 60,
      steps: [
        {
          id: 'a',
          kind: 'analyze',
          budgetMs: 100,
          run: async () => {
            await new Promise((r) => setTimeout(r, 80));
            return 'late';
          },
        },
        { id: 'b', kind: 'extract', budgetMs: 50, run: () => 'never_runs' },
      ],
      verifier: () => ({ ok: false, reasonCode: 'too_late', useFallback: true }),
      fallback: () => 'safe',
    });

    expect(result.budgetExceeded).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.value).toBe('safe');
    expect(result.reasonCodes).toContain('thinking_budget_exceeded');
    expect(result.reasonCodes).toContain('thinking_fallback_used');
    // never throws → ok=true with fallback
    expect(result.ok).toBe(true);
  });

  it('isolates a throwing step without aborting the lane', async () => {
    const result = await executeThinkingPlan({
      id: 'sc_thinking_throw',
      requesterSurface: 'writer',
      totalBudgetMs: 500,
      steps: [
        {
          id: 'a',
          kind: 'analyze',
          budgetMs: 100,
          run: () => {
            throw new Error('upstream_offline');
          },
        },
        { id: 'b', kind: 'synthesize', budgetMs: 100, run: () => 'recovered' },
      ],
    });
    expect(result.steps[0]?.result.status).toBe('errored');
    expect(result.value).toBe('recovered');
    expect(result.ok).toBe(true);
  });
});

describe('coordinator behaviour scorecard — premium verification bounded', () => {
  it('never raises confidence above the input cap and emits a frozen verdict', async () => {
    const { verifyPremiumDeepInterpolatorResult } = await import(
      '../intelligence/verification/premiumVerificationLane'
    );
    const result = await verifyPremiumDeepInterpolatorResult(
      {
        summary: 'A reasonably detailed summary explaining the trajectory of the conversation thoroughly.',
        perspectiveGaps: ['gap-a', 'gap-b'],
        followUpQuestions: ['q-a'],
        confidence: 0.55,
        provider: 'gemini',
        updatedAt: new Date('2026-05-03T00:00:00Z').toISOString(),
      } as Parameters<typeof verifyPremiumDeepInterpolatorResult>[0],
      {
        actorDid: 'did:plc:tester',
        interpretiveBrief: { summaryMode: 'normal', supports: [], limits: [] },
      } as Parameters<typeof verifyPremiumDeepInterpolatorResult>[1],
    );
    expect(result.verdict.suggestedConfidenceCap).toBeLessThanOrEqual(0.55);
    expect(Object.isFrozen(result)).toBe(true);
    for (const code of result.verdict.reasonCodes) {
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
      expect(code.length).toBeLessThanOrEqual(64);
    }
  });

  it('falls back to unverified when the underlying signal is pre-aborted', async () => {
    const { verifyPremiumDeepInterpolatorResult } = await import(
      '../intelligence/verification/premiumVerificationLane'
    );
    const controller = new AbortController();
    controller.abort();
    const result = await verifyPremiumDeepInterpolatorResult(
      {
        summary: 'Summary that would otherwise verify cleanly under normal budget.',
        perspectiveGaps: ['gap-a'],
        followUpQuestions: ['q-a'],
        confidence: 0.7,
        provider: 'gemini',
        updatedAt: new Date('2026-05-03T00:00:00Z').toISOString(),
      } as Parameters<typeof verifyPremiumDeepInterpolatorResult>[0],
      {
        actorDid: 'did:plc:tester',
        interpretiveBrief: { summaryMode: 'normal', supports: [], limits: [] },
      } as Parameters<typeof verifyPremiumDeepInterpolatorResult>[1],
      { signal: controller.signal },
    );
    expect(result.verdict.trust).toBe('unverified');
    expect(result.verdict.suggestedConfidenceCap).toBeLessThanOrEqual(0.7);
  });
});

describe('coordinator behaviour scorecard — supervisor planner bounded', () => {
  it('returns no_actions when the supervisor produced no recommendations', async () => {
    const { planSupervisorNextStep } = await import('../conversation/supervisorNextStepPlanner');
    const { plan } = await planSupervisorNextStep({
      summary: {
        summaryMode: 'descriptive_fallback',
        confidence: null,
        didMeaningfullyChange: false,
        changeMagnitude: 0.1,
        activeTasks: [],
        errorTasks: [],
        premiumStatus: 'idle',
        multimodalAuthority: 'none',
        hasMutationChurn: false,
        mutationRevision: 0,
      },
      baseActions: [],
      traceCodes: [],
    });
    expect(plan.nextStep).toBeNull();
    expect(plan.holdAll).toBe(false);
    expect(plan.reasonCodes).toContain('supervisor_plan_no_actions');
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it('holds all when multiple errors race mutation churn', async () => {
    const { planSupervisorNextStep } = await import('../conversation/supervisorNextStepPlanner');
    const { plan } = await planSupervisorNextStep({
      summary: {
        summaryMode: 'descriptive_fallback',
        confidence: null,
        didMeaningfullyChange: true,
        changeMagnitude: 0.5,
        activeTasks: [],
        errorTasks: ['writer', 'premium'],
        premiumStatus: 'error',
        multimodalAuthority: 'none',
        hasMutationChurn: true,
        mutationRevision: 4,
      },
      baseActions: [
        {
          type: 'rerun_writer_with_safe_fallback',
          priority: 'high',
          reason: 'writer error',
          target: 'writer',
        },
        {
          type: 'hold_premium_until_fresh',
          priority: 'medium',
          reason: 'premium error',
          target: 'premium',
        },
      ],
      traceCodes: ['writer_error', 'premium_error', 'mutation_churn'],
    });
    expect(plan.holdAll).toBe(true);
    expect(plan.nextStep).toBeNull();
    expect(plan.reasonCodes).toContain('supervisor_plan_hold_all');
  });
});

describe('coordinator behaviour scorecard — decision feed bounded', () => {
  it('publishes lane verdicts to the unified feed without leaking faults', async () => {
    const { planSupervisorNextStep } = await import('../conversation/supervisorNextStepPlanner');
    const {
      __resetDecisionFeedForTesting,
      getDecisionFeedSnapshot,
      publishSupervisorNextStepDecision,
      subscribeToDecisionFeed,
    } = await import('../intelligence/coordinator/decisionFeed');

    __resetDecisionFeedForTesting();
    const errors: unknown[] = [];
    subscribeToDecisionFeed(() => {
      throw new Error('observer should not break publish');
    });
    subscribeToDecisionFeed((r) => {
      if (!Object.isFrozen(r)) errors.push('record_not_frozen');
    });

    const result = await planSupervisorNextStep({
      summary: {
        summaryMode: 'descriptive_fallback',
        confidence: null,
        didMeaningfullyChange: false,
        changeMagnitude: 0.05,
        activeTasks: [],
        errorTasks: [],
        premiumStatus: 'idle',
        multimodalAuthority: 'none',
        hasMutationChurn: false,
        mutationRevision: 0,
      },
      baseActions: [],
      traceCodes: [],
    });

    expect(() => publishSupervisorNextStepDecision({ result })).not.toThrow();
    const snap = getDecisionFeedSnapshot();
    expect(snap.records.length).toBe(1);
    expect(snap.records[0]?.surface).toBe('supervisor_next_step');
    expect(errors).toEqual([]);
    __resetDecisionFeedForTesting();
  });
});
