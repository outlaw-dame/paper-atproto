import { describe, expect, it } from 'vitest';
import type { RuntimeCapability } from './capabilityProbe';
import { selectAiStackProfile } from './aiStackProfile';
import { chooseModelForTask } from './modelPolicy';
import { buildCoordinationContract, type CoordinationRouteId } from './routerCoordinatorContract';
import { decideEnhancerQualityFallback } from './enhancerQualityFallback';

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

function snapshot(params: Partial<Parameters<typeof decideEnhancerQualityFallback>[0]['snapshot']> = {}) {
  return {
    status: 'succeeded' as const,
    routeId: 'model:qwen3_4b' as CoordinationRouteId,
    qualityScore: 0.9,
    startedAtEpochMs: 1_000,
    completedAtEpochMs: 1_500,
    attempts: 0,
    errorKind: 'none' as const,
    ...params,
  };
}

describe('decideEnhancerQualityFallback', () => {
  it('accepts current enhancer output when quality meets the threshold', () => {
    const result = decideEnhancerQualityFallback({
      contract: createContract(),
      snapshot: snapshot({ qualityScore: 0.86 }),
      nowEpochMs: 2_000,
    });

    expect(result.action).toBe('accept_current');
    expect(result.reason).toBe('quality_acceptable');
    expect(result.retryAllowed).toBe(false);
    expect(result.selectedRouteId).toBe('model:qwen3_4b');
  });

  it('retries the same route when quality is low but retryable', () => {
    const result = decideEnhancerQualityFallback({
      contract: createContract(),
      snapshot: snapshot({ status: 'quality_below_threshold', qualityScore: 0.6, attempts: 0 }),
      nowEpochMs: 2_000,
    });

    expect(result.action).toBe('retry_same_route');
    expect(result.reason).toBe('quality_below_threshold');
    expect(result.retryAllowed).toBe(true);
    expect(result.selectedRouteId).toBe('model:qwen3_4b');
  });

  it('falls back when quality is too low to retry', () => {
    const result = decideEnhancerQualityFallback({
      contract: createContract(),
      snapshot: snapshot({ status: 'quality_below_threshold', qualityScore: 0.2, attempts: 0 }),
      nowEpochMs: 2_000,
    });

    expect(result.action).toBe('fallback_route');
    expect(result.reason).toBe('quality_below_threshold');
    expect(result.retryAllowed).toBe(false);
    expect(result.selectedRouteId).toBe('model:smollm3_3b');
  });

  it('falls back when retry budget is exhausted', () => {
    const result = decideEnhancerQualityFallback({
      contract: createContract(),
      snapshot: snapshot({ status: 'failed', qualityScore: null, attempts: 2, errorKind: 'model_error' }),
      nowEpochMs: 2_000,
    });

    expect(result.action).toBe('fallback_route');
    expect(result.reason).toBe('retry_budget_exhausted');
    expect(result.retryAllowed).toBe(false);
    expect(result.selectedRouteId).toBe('model:smollm3_3b');
  });

  it('retries stale output only within retry budget', () => {
    const result = decideEnhancerQualityFallback({
      contract: createContract(),
      snapshot: snapshot({ status: 'stale_result', attempts: 0 }),
      nowEpochMs: 2_000,
    });

    expect(result.action).toBe('retry_same_route');
    expect(result.reason).toBe('stale_result');
    expect(result.retryAllowed).toBe(true);
  });

  it('uses deterministic-safe fallback for policy violations or disallowed routes', () => {
    const contract = createContract();
    const policyViolation = decideEnhancerQualityFallback({
      contract,
      snapshot: snapshot({ status: 'failed', qualityScore: null, errorKind: 'policy_violation' }),
      nowEpochMs: 2_000,
    });
    const disallowed = decideEnhancerQualityFallback({
      contract,
      snapshot: snapshot({ routeId: 'model:not_in_contract' as CoordinationRouteId }),
      nowEpochMs: 2_000,
    });

    expect(policyViolation.action).toBe('deterministic_only');
    expect(policyViolation.reason).toBe('policy_violation');
    expect(policyViolation.reasonCodes).toEqual(['validator_rejected_constraints']);
    expect(disallowed.action).toBe('deterministic_only');
    expect(disallowed.reason).toBe('policy_violation');
    expect(disallowed.reasonCodes).toEqual(['validator_rejected_disallowed_route']);
  });
});
