import { describe, expect, it } from 'vitest';
import type { RuntimeCapability } from './capabilityProbe';
import {
  getBackgroundUpgradeCandidate,
  selectAiStackProfile,
  shouldDegradeAiStack,
} from './aiStackProfile';

const HIGH_CAPABILITY: RuntimeCapability = {
  webgpu: true,
  tier: 'high',
  generationAllowed: true,
  multimodalAllowed: true,
  browserFamily: 'chromium',
  deviceMemoryGiB: 16,
  hardwareConcurrency: 12,
};

const MID_CAPABILITY: RuntimeCapability = {
  webgpu: true,
  tier: 'mid',
  generationAllowed: true,
  multimodalAllowed: true,
  browserFamily: 'chromium',
  deviceMemoryGiB: 8,
  hardwareConcurrency: 8,
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

describe('selectAiStackProfile', () => {
  it('falls back to deterministic baseline when WebGPU or generation is unavailable', () => {
    const profile = selectAiStackProfile(LOW_CAPABILITY, {
      settingsMode: 'balanced',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
    });

    expect(profile.tier).toBe('baseline');
    expect(profile.runtime).toBe('deterministic');
    expect(profile.routerAuthority.id).toBe('deterministic_policy');
    expect(profile.router.id).toBe('deterministic_policy');
    expect(profile.coordinator.id).toBe('none');
    expect(profile.diagnostics.degradeReasons).toContain('no_webgpu');
    expect(profile.diagnostics.degradeReasons).toContain('generation_disabled');
  });

  it('selects the browser default coordinator and advisory FunctionGemma router when LiteRT is unavailable', () => {
    const profile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'balanced',
      allowLiteRt: false,
      preferLiteRt: true,
      availableStorageGiB: 8,
    });

    expect(profile.tier).toBe('browser_default');
    expect(profile.runtime).toBe('webllm');
    expect(profile.routerAuthority.id).toBe('deterministic_policy');
    expect(profile.router.id).toBe('functiongemma_270m');
    expect(profile.router.runtime).toBe('webllm');
    expect(profile.coordinator.id).toBe('smollm2_1_7b');
    expect(profile.diagnostics.degradeReasons).toContain('litert_unavailable');
  });

  it('selects Gemma 4 E2B and advisory FunctionGemma on a high-capability LiteRT path without large-model consent', () => {
    const profile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'balanced',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: false,
      availableStorageGiB: 8,
    });

    expect(profile.tier).toBe('edge_strong');
    expect(profile.runtime).toBe('litert');
    expect(profile.routerAuthority.id).toBe('deterministic_policy');
    expect(profile.router.id).toBe('functiongemma_270m');
    expect(profile.router.runtime).toBe('litert');
    expect(profile.coordinator.id).toBe('gemma4_e2b');
    expect(profile.coordinator.requiresExplicitConsent).toBe(true);
    expect(profile.diagnostics.degradeReasons).toContain('large_model_consent_missing');
  });

  it('selects Gemma 4 E4B on a consented high-capability LiteRT path', () => {
    const profile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'best_quality',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
      availableStorageGiB: 16,
    });

    expect(profile.tier).toBe('edge_premium');
    expect(profile.runtime).toBe('litert');
    expect(profile.routerAuthority.id).toBe('deterministic_policy');
    expect(profile.router.id).toBe('functiongemma_270m');
    expect(profile.router.runtime).toBe('litert');
    expect(profile.coordinator.id).toBe('gemma4_e4b');
    expect(profile.coordinator.requiresExplicitConsent).toBe(false);
    expect(profile.fallbackCoordinator.id).toBe('gemma4_e2b');
    expect(profile.fallbackCoordinator.requiresExplicitConsent).toBe(false);
  });

  it('uses Gemma 4 E2B on mid-tier LiteRT only after large-model consent', () => {
    const profile = selectAiStackProfile(MID_CAPABILITY, {
      settingsMode: 'balanced',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
      availableStorageGiB: 8,
    });

    expect(profile.tier).toBe('edge_strong');
    expect(profile.routerAuthority.id).toBe('deterministic_policy');
    expect(profile.router.id).toBe('functiongemma_270m');
    expect(profile.coordinator.id).toBe('gemma4_e2b');
    expect(profile.coordinator.requiresExplicitConsent).toBe(false);
  });

  it('falls back to deterministic baseline when storage cannot fit the browser coordinator', () => {
    const profile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'balanced',
      allowLiteRt: false,
      preferLiteRt: false,
      availableStorageGiB: 2,
    });

    expect(profile.tier).toBe('baseline');
    expect(profile.routerAuthority.id).toBe('deterministic_policy');
    expect(profile.router.id).toBe('deterministic_policy');
    expect(profile.coordinator.id).toBe('none');
    expect(profile.diagnostics.degradeReasons).toContain('storage_constrained');
  });

  it('degrades to baseline in fast mode instead of loading coordinator models', () => {
    const profile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'fast',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
      availableStorageGiB: 16,
    });

    expect(profile.tier).toBe('baseline');
    expect(profile.routerAuthority.id).toBe('deterministic_policy');
    expect(profile.router.id).toBe('deterministic_policy');
    expect(profile.diagnostics.degradeReasons).toContain('settings_fast_mode');
  });
});

describe('getBackgroundUpgradeCandidate', () => {
  it('offers a consent-gated LiteRT E2B upgrade from the browser default', () => {
    const current = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'balanced',
      allowLiteRt: false,
      preferLiteRt: false,
      availableStorageGiB: 8,
    });
    const candidate = getBackgroundUpgradeCandidate(current, HIGH_CAPABILITY, {
      settingsMode: 'balanced',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: false,
      availableStorageGiB: 8,
      sustainedCoordinatorLatencyMs: 800,
    });

    expect(candidate?.fromTier).toBe('browser_default');
    expect(candidate?.toTier).toBe('edge_strong');
    expect(candidate?.coordinator.id).toBe('gemma4_e2b');
    expect(candidate?.requiresConsent).toBe(true);
    expect(candidate?.canStartNow).toBe(false);
  });

  it('does not offer background upgrades under thermal pressure', () => {
    const current = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'balanced',
      allowLiteRt: false,
      preferLiteRt: false,
      availableStorageGiB: 8,
    });
    const candidate = getBackgroundUpgradeCandidate(current, HIGH_CAPABILITY, {
      settingsMode: 'balanced',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
      availableStorageGiB: 8,
      thermalState: 'serious',
    });

    expect(candidate).toBeNull();
  });
});

describe('shouldDegradeAiStack', () => {
  it('recommends degradation on latency regression', () => {
    const current = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'best_quality',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
      availableStorageGiB: 16,
    });

    expect(shouldDegradeAiStack(current, {
      settingsMode: 'balanced',
      sustainedCoordinatorLatencyMs: 2_500,
    })).toBe('latency_regression');
  });
});
