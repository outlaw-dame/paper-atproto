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
  it('uses a valid router route after validation', () => {
    const result = evaluateRouterShadowDecision({
      contract: createContract(),
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
    expect(result.routerRouteId).toBe('model:smollm3_3b');
    expect(result.deterministicRouteId).toBe('model:qwen3_4b');
    expect(result.selectedRouteId).toBe('model:smollm3_3b');
    expect(result.authorityApplied).toBe(true);
    expect(result.routerMatchedDeterministic).toBe(false);
  });

  it('falls back to the deterministic route when router output is invalid or absent', () => {
    const contract = createContract();
    const rejected = evaluateRouterShadowDecision({
      contract,
      nowEpochMs: 1_500,
      decision: {
        schemaVersion: 1,
        decisionType: 'route',
        selectedRouteId: 'model:unknown',
        confidence: 0.82,
        reasonCodes: [],
        ttlMs: 2_000,
      },
    });
    const missing = evaluateRouterShadowDecision({ contract, nowEpochMs: 1_500 });

    expect(rejected.status).toBe('rejected');
    expect(rejected.routerRouteId).toBeNull();
    expect(rejected.selectedRouteId).toBe('model:qwen3_4b');
    expect(rejected.authorityApplied).toBe(false);
    expect(missing.status).toBe('not_provided');
    expect(missing.routerRouteId).toBeNull();
    expect(missing.selectedRouteId).toBe('model:qwen3_4b');
    expect(missing.authorityApplied).toBe(false);
  });
});

describe('evaluateCoordinatorShadowRecommendation', () => {
  it('evaluates coordinator recommendations without changing route selection', () => {
    const result = evaluateCoordinatorShadowRecommendation({
      contract: createContract(),
      nowEpochMs: 1_500,
      recommendation: {
        schemaVersion: 1,
        recommendation: 'accept_route',
        selectedRouteId: 'model:qwen3_4b',
        confidence: 0.74,
        reasonCodes: ['policy_selected_primary'],
        monitoringPlan: {
          watchFlags: ['low_confidence'],
          maxRetries: 1,
          fallbackRouteId: 'model:smollm3_3b',
        },
        ttlMs: 2_000,
      },
    });

    expect(result.status).toBe('accepted');
    expect(result.recommendation).toBe('accept_route');
    expect(result.recommendationRouteId).toBe('model:qwen3_4b');
    expect(result.selectedRouteId).toBe('model:qwen3_4b');
    expect(result.recommendationMatchedDeterministic).toBe(true);
    expect(result.monitoringPlan?.maxRetries).toBe(1);
  });
});

describe('evaluateRouterCoordinatorShadow', () => {
  it('keeps router and coordinator outputs separate in one snapshot', () => {
    const result = evaluateRouterCoordinatorShadow({
      contract: createContract(),
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
    expect(result.selectedRouteId).toBe('model:smollm3_3b');
    expect(result.router.routerRouteId).toBe('model:smollm3_3b');
    expect(result.router.authorityApplied).toBe(true);
    expect(result.coordinator.recommendationRouteId).toBe('model:qwen3_4b');
  });
});
