import { describe, expect, it } from 'vitest';
import type { RuntimeCapability } from './capabilityProbe';
import { selectAiStackProfile } from './aiStackProfile';
import { chooseModelForTask } from './modelPolicy';
import { buildCoordinationContract } from './routerCoordinatorContract';
import {
  evaluateCoordinatorShadowRecommendation,
  evaluateRouterCoordinatorShadow,
  evaluateRouterShadowDecision,
} from './routerCoordinatorShadowEvaluator';

const HIGH_CAPABILITY: RuntimeCapability = {
  webgpu: true,
  tier: 'high',
  generationAllowed: true,
  multimodalAllowed: true,
  browserFamily: 'chromium',
  deviceMemoryGiB: 16,
  hardwareConcurrency: 12,
};

function createContract() {
  const policyDecision = chooseModelForTask({
    capability: HIGH_CAPABILITY,
    settingsMode: 'best_quality',
    task: 'text_generation',
  });
  const stackProfile = selectAiStackProfile(HIGH_CAPABILITY, {
    settingsMode: 'best_quality',
    allowLiteRt: true,
    preferLiteRt: true,
    userConsentedToLargeModels: true,
    availableStorageGiB: 16,
  });

  return buildCoordinationContract({ policyDecision, stackProfile, nowEpochMs: 1_000, ttlMs: 10_000 });
}

describe('evaluateRouterShadowDecision', () => {
  it('accepts a valid router advisory route but keeps deterministic selection authoritative', () => {
    const contract = createContract();
    const result = evaluateRouterShadowDecision({
      contract,
      nowEpochMs: 1_500,
      decision: {
        schemaVersion: 1,
        decisionType: 'route',
        selectedRouteId: 'model:smollm3_3b',
        confidence: 0.82,
        reasonCodes: ['policy_selected_fallback'],
        ttlMs: 2_000,
      },
    });

    expect(result.status).toBe('accepted');
    expect(result.advisoryRouteId).toBe('model:smollm3_3b');
    expect(result.deterministicRouteId).toBe('model:qwen3_4b');
    expect(result.selectedRouteId).toBe('model:qwen3_4b');
    expect(result.advisoryMatchedDeterministic).toBe(false);
  });

  it('rejects invalid router advisory output without changing deterministic route', () => {
    const contract = createContract();
    const result = evaluateRouterShadowDecision({
      contract,
      nowEpochMs: 1_500,
      decision: {
        schemaVersion: 1,
        decisionType: 'route',
        selectedRouteId: 'model:not_in_contract',
        confidence: 0.82,
        reasonCodes: [],
        ttlMs: 2_000,
      },
    });

    expect(result.status).toBe('rejected');
    expect(result.advisoryRouteId).toBeNull();
    expect(result.selectedRouteId).toBe('model:qwen3_4b');
    expect(result.reasonCodes).toEqual(['validator_rejected_unknown_route']);
  });

  it('reports not_provided when no router advisory exists yet', () => {
    const contract = createContract();
    const result = evaluateRouterShadowDecision({ contract, nowEpochMs: 1_500 });

    expect(result.status).toBe('not_provided');
    expect(result.advisoryRouteId).toBeNull();
    expect(result.selectedRouteId).toBe('model:qwen3_4b');
  });
});

describe('evaluateCoordinatorShadowRecommendation', () => {
  it('accepts a coordinator recommendation while keeping deterministic selection authoritative', () => {
    const contract = createContract();
    const result = evaluateCoordinatorShadowRecommendation({
      contract,
      nowEpochMs: 1_500,
      recommendation: {
        schemaVersion: 1,
        recommendation: 'accept_route',
        selectedRouteId: 'model:qwen3_4b',
        confidence: 0.74,
        reasonCodes: ['policy_selected_primary'],
        monitoringPlan: {
          watchFlags: ['low_confidence', 'model_error'],
          maxRetries: 1,
          fallbackRouteId: 'model:smollm3_3b',
        },
        ttlMs: 2_000,
      },
    });

    expect(result.status).toBe('accepted');
    expect(result.recommendation).toBe('accept_route');
    expect(result.advisoryRouteId).toBe('model:qwen3_4b');
    expect(result.deterministicRouteId).toBe('model:qwen3_4b');
    expect(result.selectedRouteId).toBe('model:qwen3_4b');
    expect(result.advisoryMatchedDeterministic).toBe(true);
    expect(result.monitoringPlan?.maxRetries).toBe(1);
  });

  it('rejects coordinator recommendations outside contract bounds', () => {
    const contract = createContract();
    const result = evaluateCoordinatorShadowRecommendation({
      contract,
      nowEpochMs: 1_500,
      recommendation: {
        schemaVersion: 1,
        recommendation: 'accept_route',
        selectedRouteId: 'model:qwen3_4b',
        confidence: 0.74,
        reasonCodes: [],
        monitoringPlan: {
          watchFlags: ['model_error'],
          maxRetries: 2,
          fallbackRouteId: 'model:smollm3_3b',
        },
        ttlMs: 2_000,
      },
    });

    expect(result.status).toBe('rejected');
    expect(result.recommendation).toBeNull();
    expect(result.monitoringPlan).toBeNull();
    expect(result.selectedRouteId).toBe('model:qwen3_4b');
    expect(result.reasonCodes).toEqual(['validator_rejected_schema']);
  });
});

describe('evaluateRouterCoordinatorShadow', () => {
  it('keeps router and coordinator evaluations separate in one shadow snapshot', () => {
    const contract = createContract();
    const result = evaluateRouterCoordinatorShadow({
      contract,
      nowEpochMs: 1_500,
      routerDecision: {
        schemaVersion: 1,
        decisionType: 'route',
        selectedRouteId: 'model:smollm3_3b',
        confidence: 0.82,
        reasonCodes: ['policy_selected_fallback'],
        ttlMs: 2_000,
      },
      coordinatorRecommendation: {
        schemaVersion: 1,
        recommendation: 'accept_route',
        selectedRouteId: 'model:qwen3_4b',
        confidence: 0.74,
        reasonCodes: ['policy_selected_primary'],
        monitoringPlan: {
          watchFlags: ['low_confidence'],
          maxRetries: 0,
          fallbackRouteId: 'model:smollm3_3b',
        },
        ttlMs: 2_000,
      },
    });

    expect(result.deterministicRouteId).toBe('model:qwen3_4b');
    expect(result.router.role).toBe('router');
    expect(result.router.status).toBe('accepted');
    expect(result.router.advisoryRouteId).toBe('model:smollm3_3b');
    expect(result.router.advisoryMatchedDeterministic).toBe(false);
    expect(result.coordinator.role).toBe('coordinator');
    expect(result.coordinator.status).toBe('accepted');
    expect(result.coordinator.advisoryRouteId).toBe('model:qwen3_4b');
    expect(result.coordinator.advisoryMatchedDeterministic).toBe(true);
  });
});
