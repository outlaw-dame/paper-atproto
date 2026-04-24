import { describe, expect, it } from 'vitest';
import type { RuntimeCapability } from './capabilityProbe';
import { selectAiStackProfile } from './aiStackProfile';
import { chooseModelForTask } from './modelPolicy';
import {
  buildCoordinationContract,
  validateCoordinatorRecommendation,
  validateRouterDecision,
  type CoordinatorRecommendationEnvelope,
  type RouterDecisionEnvelope,
} from './routerCoordinatorContract';

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

describe('buildCoordinationContract', () => {
  it('derives allowed routes from deterministic model policy', () => {
    const contract = createContract();

    expect(contract.defaultRouteId).toBe('model:qwen3_4b');
    expect(contract.allowedRoutes.map((route) => route.id)).toEqual([
      'model:qwen3_4b',
      'model:smollm3_3b',
      'model:phi4_mini',
      'remote:fallback',
    ]);
    expect(contract.constraints).toContain('no_new_routes');
    expect(contract.constraints).toContain('deterministic_policy_is_authority');
    expect(contract.constraints).toContain('shadow_mode_only');
  });

  it('keeps hot path scoring on the deterministic worker route', () => {
    const policyDecision = chooseModelForTask({
      capability: HIGH_CAPABILITY,
      settingsMode: 'best_quality',
      task: 'hot_path_scoring',
    });
    const stackProfile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'best_quality',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
      availableStorageGiB: 16,
    });
    const contract = buildCoordinationContract({ policyDecision, stackProfile, nowEpochMs: 100 });

    expect(contract.allowedRoutes).toHaveLength(1);
    expect(contract.allowedRoutes[0]).toMatchObject({
      id: 'worker_local_only',
      kind: 'deterministic_only',
      allowed: true,
    });
  });
});

describe('validateRouterDecision', () => {
  it('accepts only contract-owned router route choices', () => {
    const contract = createContract();
    const decision: RouterDecisionEnvelope = {
      schemaVersion: 1,
      decisionType: 'route',
      selectedRouteId: 'model:smollm3_3b',
      confidence: 0.82,
      reasonCodes: ['policy_selected_fallback'],
      ttlMs: 2_000,
    };

    const result = validateRouterDecision(contract, decision, 1_500);

    expect(result.accepted).toBe(true);
    expect(result.selectedRoute.id).toBe('model:smollm3_3b');
  });

  it('rejects unknown router routes and falls back safely', () => {
    const contract = createContract();
    const result = validateRouterDecision(contract, {
      schemaVersion: 1,
      decisionType: 'route',
      selectedRouteId: 'model:not_in_contract',
      confidence: 0.9,
      reasonCodes: [],
      ttlMs: 2_000,
    }, 1_500);

    expect(result.accepted).toBe(false);
    expect(result.selectedRoute.id).toBe(contract.fallbackRouteId);
    expect(result.reasonCodes).toEqual(['validator_rejected_unknown_route']);
  });

  it('rejects malformed, expired, or out-of-range router output', () => {
    const contract = createContract();

    expect(validateRouterDecision(contract, { selectedRouteId: 'model:qwen3_4b' }, 1_500).reasonCodes)
      .toEqual(['validator_rejected_schema']);

    expect(validateRouterDecision(contract, {
      schemaVersion: 1,
      decisionType: 'route',
      selectedRouteId: 'model:qwen3_4b',
      confidence: 1.2,
      reasonCodes: [],
      ttlMs: 2_000,
    }, 1_500).reasonCodes).toEqual(['validator_rejected_confidence']);

    expect(validateRouterDecision(contract, {
      schemaVersion: 1,
      decisionType: 'route',
      selectedRouteId: 'model:qwen3_4b',
      confidence: 0.8,
      reasonCodes: [],
      ttlMs: 2_000,
    }, 20_000).reasonCodes).toEqual(['validator_rejected_ttl']);
  });

  it('rejects router reason codes outside the contract enum', () => {
    const contract = createContract();
    const result = validateRouterDecision(contract, {
      schemaVersion: 1,
      decisionType: 'route',
      selectedRouteId: 'model:qwen3_4b',
      confidence: 0.8,
      reasonCodes: ['arbitrary_model_text'],
      ttlMs: 2_000,
    }, 1_500);

    expect(result.accepted).toBe(false);
    expect(result.reasonCodes).toEqual(['validator_rejected_schema']);
  });

  it('deduplicates accepted router reason codes before returning telemetry-safe output', () => {
    const contract = createContract();
    const result = validateRouterDecision(contract, {
      schemaVersion: 1,
      decisionType: 'route',
      selectedRouteId: 'model:qwen3_4b',
      confidence: 0.8,
      reasonCodes: ['policy_selected_primary', 'policy_selected_primary'],
      ttlMs: 2_000,
    }, 1_500);

    expect(result.accepted).toBe(true);
    expect(result.reasonCodes).toEqual(['policy_selected_primary']);
  });
});

describe('validateCoordinatorRecommendation', () => {
  it('accepts bounded coordinator recommendations for allowed routes', () => {
    const contract = createContract();
    const recommendation: CoordinatorRecommendationEnvelope = {
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
    };

    const result = validateCoordinatorRecommendation(contract, recommendation, 1_500);

    expect(result.accepted).toBe(true);
    expect(result.selectedRoute.id).toBe('model:qwen3_4b');
  });

  it('rejects coordinator recommendations with routes outside the contract', () => {
    const contract = createContract();
    const result = validateCoordinatorRecommendation(contract, {
      schemaVersion: 1,
      recommendation: 'accept_route',
      selectedRouteId: 'model:qwen3_4b',
      confidence: 0.74,
      reasonCodes: [],
      monitoringPlan: {
        watchFlags: ['model_error'],
        maxRetries: 1,
        fallbackRouteId: 'model:not_in_contract',
      },
      ttlMs: 2_000,
    }, 1_500);

    expect(result.accepted).toBe(false);
    expect(result.reasonCodes).toEqual(['validator_rejected_disallowed_route']);
  });

  it('rejects coordinator recommendations with more than one retry as schema violations', () => {
    const contract = createContract();
    const result = validateCoordinatorRecommendation(contract, {
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
    }, 1_500);

    expect(result.accepted).toBe(false);
    expect(result.reasonCodes).toEqual(['validator_rejected_schema']);
  });

  it('rejects coordinator recommendations with missing maxRetries as schema violations', () => {
    const contract = createContract();
    const result = validateCoordinatorRecommendation(contract, {
      schemaVersion: 1,
      recommendation: 'accept_route',
      selectedRouteId: 'model:qwen3_4b',
      confidence: 0.74,
      reasonCodes: [],
      monitoringPlan: {
        watchFlags: ['model_error'],
        fallbackRouteId: 'model:smollm3_3b',
      },
      ttlMs: 2_000,
    }, 1_500);

    expect(result.accepted).toBe(false);
    expect(result.reasonCodes).toEqual(['validator_rejected_schema']);
  });

  it('rejects coordinator reason codes outside the contract enum', () => {
    const contract = createContract();
    const result = validateCoordinatorRecommendation(contract, {
      schemaVersion: 1,
      recommendation: 'accept_route',
      selectedRouteId: 'model:qwen3_4b',
      confidence: 0.74,
      reasonCodes: ['freeform_model_reason'],
      monitoringPlan: {
        watchFlags: ['model_error'],
        maxRetries: 1,
        fallbackRouteId: 'model:smollm3_3b',
      },
      ttlMs: 2_000,
    }, 1_500);

    expect(result.accepted).toBe(false);
    expect(result.reasonCodes).toEqual(['validator_rejected_schema']);
  });
});
