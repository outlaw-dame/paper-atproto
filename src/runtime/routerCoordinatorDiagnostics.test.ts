import { describe, expect, it } from 'vitest';
import type { RuntimeCapability } from './capabilityProbe';
import { selectAiStackProfile } from './aiStackProfile';
import { chooseModelForTask } from './modelPolicy';
import { buildRouterCoordinatorDiagnosticsSnapshot } from './routerCoordinatorDiagnostics';

const HIGH_CAPABILITY: RuntimeCapability = {
  webgpu: true,
  tier: 'high',
  generationAllowed: true,
  multimodalAllowed: true,
  browserFamily: 'chromium',
  deviceMemoryGiB: 16,
  hardwareConcurrency: 12,
};

const LOW_CAPABILITY: RuntimeCapability = {
  webgpu: false,
  tier: 'low',
  generationAllowed: false,
  multimodalAllowed: false,
  browserFamily: 'safari',
  deviceMemoryGiB: 2,
  hardwareConcurrency: 4,
};

function policyFor(task: 'hot_path_scoring' | 'text_generation' | 'multimodal_analysis', capability: RuntimeCapability = HIGH_CAPABILITY) {
  return chooseModelForTask({ capability, settingsMode: 'best_quality', task });
}

describe('buildRouterCoordinatorDiagnosticsSnapshot', () => {
  it('reports coordinator shadow readiness for consented high-capability text generation', () => {
    const policyDecision = policyFor('text_generation');
    const stackProfile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'best_quality',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
      availableStorageGiB: 16,
    });

    const snapshot = buildRouterCoordinatorDiagnosticsSnapshot({
      policyDecision,
      stackProfile,
      nowEpochMs: 1_000,
      ttlMs: 10_000,
    });

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.readiness).toBe('coordinator_shadow_ready');
    expect(snapshot.blockers).toEqual([]);
    expect(snapshot.defaultRouteId).toBe('model:qwen3_4b');
    expect(snapshot.stack.coordinatorModel).toBe('gemma4_e4b');
    expect(snapshot.allowedRoutes.map((route) => route.id)).toEqual([
      'model:qwen3_4b',
      'model:smollm3_3b',
      'model:phi4_mini',
      'remote:fallback',
    ]);
  });

  it('keeps hot path scoring deterministic even on high capability devices', () => {
    const policyDecision = policyFor('hot_path_scoring');
    const stackProfile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'best_quality',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
      availableStorageGiB: 16,
    });

    const snapshot = buildRouterCoordinatorDiagnosticsSnapshot({
      policyDecision,
      stackProfile,
      nowEpochMs: 1_000,
    });

    expect(snapshot.defaultRouteId).toBe('worker_local_only');
    expect(snapshot.allowedRoutes).toHaveLength(1);
    expect(snapshot.allowedRoutes[0]).toMatchObject({
      id: 'worker_local_only',
      kind: 'deterministic_only',
    });
  });

  it('reports deterministic-only readiness for baseline devices', () => {
    const policyDecision = policyFor('text_generation', LOW_CAPABILITY);
    const stackProfile = selectAiStackProfile(LOW_CAPABILITY, {
      settingsMode: 'best_quality',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
      availableStorageGiB: 16,
    });

    const snapshot = buildRouterCoordinatorDiagnosticsSnapshot({
      policyDecision,
      stackProfile,
      nowEpochMs: 1_000,
    });

    expect(snapshot.readiness).toBe('deterministic_only');
    expect(snapshot.blockers).toContain('stack_baseline');
    expect(snapshot.blockers).toContain('coordinator_unavailable');
    expect(snapshot.stack.coordinatorModel).toBe('none');
  });

  it('surfaces consent blockers without granting coordinator shadow readiness', () => {
    const policyDecision = policyFor('text_generation');
    const stackProfile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'best_quality',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: false,
      availableStorageGiB: 16,
    });

    const snapshot = buildRouterCoordinatorDiagnosticsSnapshot({
      policyDecision,
      stackProfile,
      nowEpochMs: 1_000,
    });

    expect(snapshot.stack.coordinatorRequiresConsent).toBe(true);
    expect(snapshot.blockers).toContain('large_model_requires_consent');
    expect(snapshot.readiness).toBe('router_shadow_ready');
  });

  it('blocks shadow readiness when deterministic policy requires explicit user action', () => {
    const policyDecision = policyFor('multimodal_analysis');
    const stackProfile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'best_quality',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
      availableStorageGiB: 16,
    });

    const snapshot = buildRouterCoordinatorDiagnosticsSnapshot({
      policyDecision,
      stackProfile,
      nowEpochMs: 1_000,
    });

    expect(snapshot.policy.requiresExplicitUserAction).toBe(true);
    expect(snapshot.blockers).toContain('explicit_user_action_required');
    expect(snapshot.readiness).toBe('blocked');
  });
});
