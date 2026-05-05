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

function expectDeterministicOnlyAuthority(profile: ReturnType<typeof selectAiStackProfile>) {
  expect(profile.diagnostics.authorityMode).toBe('deterministic_only');
  expect(profile.routerAuthorities.map((authority) => authority.id)).toEqual(['deterministic_policy']);
  expect(profile.router.id).toBe('deterministic_policy');
}

function expectDeterministicAndFunctionGemmaAuthority(profile: ReturnType<typeof selectAiStackProfile>) {
  expect(profile.diagnostics.authorityMode).toBe('deterministic_policy_and_functiongemma');
  expect(profile.routerAuthorities.map((authority) => authority.id)).toEqual([
    'deterministic_policy',
    'functiongemma_270m',
  ]);
  expect(profile.router.id).toBe('functiongemma_270m');
}

describe('selectAiStackProfile', () => {
  it('enforces coordinator priority: Workers AI on edge tiers, Phi-4 mini on local browser tier', () => {
    const edgeProfile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'best_quality',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
      availableStorageGiB: 16,
    });
    const localProfile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'balanced',
      allowLiteRt: false,
      preferLiteRt: true,
      userConsentedToLargeModels: false,
      availableStorageGiB: 8,
    });

    expect(edgeProfile.tier).toBe('edge_premium');
    expect(edgeProfile.coordinator.runtime).toBe('workers_ai');
    expect(edgeProfile.coordinator.id).toBe('cf_llama_3_3_70b_instruct');
    expect(edgeProfile.fallbackCoordinator.id).toBe('phi4_mini');

    expect(localProfile.tier).toBe('browser_default');
    expect(localProfile.coordinator.runtime).toBe('webllm');
    expect(localProfile.coordinator.id).toBe('phi4_mini');
  });

  it('falls back to deterministic baseline when WebGPU or generation is unavailable', () => {
    const profile = selectAiStackProfile(LOW_CAPABILITY, {
      settingsMode: 'balanced',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
    });

    expect(profile.tier).toBe('baseline');
    expect(profile.runtime).toBe('deterministic');
    expectDeterministicOnlyAuthority(profile);
    expect(profile.coordinator.id).toBe('none');
    expect(profile.diagnostics.degradeReasons).toContain('no_webgpu');
    expect(profile.diagnostics.degradeReasons).toContain('generation_disabled');
  });

  it('uses Phi-4 mini as the local coordinator when LiteRT is unavailable', () => {
    const profile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'balanced',
      allowLiteRt: false,
      preferLiteRt: true,
      availableStorageGiB: 8,
    });

    expect(profile.tier).toBe('browser_default');
    expect(profile.runtime).toBe('webllm');
    expectDeterministicAndFunctionGemmaAuthority(profile);
    expect(profile.router.runtime).toBe('webllm');
    expect(profile.coordinator.id).toBe('phi4_mini');
    expect(profile.diagnostics.degradeReasons).toContain('litert_unavailable');
  });

  it('selects a Workers AI edge coordinator on high-capability LiteRT path without large-model consent', () => {
    const profile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'balanced',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: false,
      availableStorageGiB: 8,
    });

    expect(profile.tier).toBe('edge_strong');
    expect(profile.runtime).toBe('litert');
    expectDeterministicAndFunctionGemmaAuthority(profile);
    expect(profile.router.runtime).toBe('litert');
    expect(profile.coordinator.id).toBe('cf_llama_3_1_8b_instruct');
    expect(profile.coordinator.requiresExplicitConsent).toBe(false);
    expect(profile.fallbackCoordinator.id).toBe('phi4_mini');
  });

  it('selects the stronger Workers AI edge coordinator on a consented high-capability LiteRT path', () => {
    const profile = selectAiStackProfile(HIGH_CAPABILITY, {
      settingsMode: 'best_quality',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
      availableStorageGiB: 16,
    });

    expect(profile.tier).toBe('edge_premium');
    expect(profile.runtime).toBe('litert');
    expectDeterministicAndFunctionGemmaAuthority(profile);
    expect(profile.router.runtime).toBe('litert');
    expect(profile.coordinator.id).toBe('cf_llama_3_3_70b_instruct');
    expect(profile.coordinator.requiresExplicitConsent).toBe(false);
    expect(profile.fallbackCoordinator.id).toBe('phi4_mini');
    expect(profile.fallbackCoordinator.requiresExplicitConsent).toBe(false);
  });

  it('uses a Workers AI coordinator on mid-tier LiteRT after large-model consent', () => {
    const profile = selectAiStackProfile(MID_CAPABILITY, {
      settingsMode: 'balanced',
      allowLiteRt: true,
      preferLiteRt: true,
      userConsentedToLargeModels: true,
      availableStorageGiB: 8,
    });

    expect(profile.tier).toBe('edge_strong');
    expectDeterministicAndFunctionGemmaAuthority(profile);
    expect(profile.coordinator.id).toBe('cf_llama_3_1_8b_instruct');
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
    expectDeterministicOnlyAuthority(profile);
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
    expectDeterministicOnlyAuthority(profile);
    expect(profile.diagnostics.degradeReasons).toContain('settings_fast_mode');
  });
});

describe('getBackgroundUpgradeCandidate', () => {
  it('offers a non-consent Workers AI upgrade from the browser default', () => {
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
    expect(candidate?.coordinator.id).toBe('cf_llama_3_1_8b_instruct');
    expect(candidate?.requiresConsent).toBe(false);
    expect(candidate?.canStartNow).toBe(true);
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
