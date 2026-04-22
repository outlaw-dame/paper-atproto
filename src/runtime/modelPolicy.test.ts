import { describe, expect, it } from 'vitest';
import { chooseModelForTask } from './modelPolicy';
import type { RuntimeCapability } from './capabilityProbe';

const HIGH_CAPABILITY: RuntimeCapability = {
  webgpu: true,
  tier: 'high',
  generationAllowed: true,
  multimodalAllowed: true,
};

describe('chooseModelForTask', () => {
  it('keeps the hot path on the existing worker stack', () => {
    const decision = chooseModelForTask({
      capability: HIGH_CAPABILITY,
      settingsMode: 'best_quality',
      task: 'hot_path_scoring',
    });

    expect(decision.choice).toBe('worker_local_only');
    expect(decision.localAllowed).toBe(true);
    expect(decision.remoteFallbackAllowed).toBe(false);
  });

  it('prefers Qwen3-4B on high-tier best-quality text generation', () => {
    const decision = chooseModelForTask({
      capability: HIGH_CAPABILITY,
      settingsMode: 'best_quality',
      task: 'text_generation',
      explicitUserAction: true,
    });

    expect(decision.choice).toBe('qwen3_4b');
    expect(decision.fallbackChoices).toEqual(['smollm3_3b', 'phi4_mini']);
  });

  it('keeps low-tier text generation off until explicitly requested', () => {
    const decision = chooseModelForTask({
      capability: {
        webgpu: true,
        tier: 'low',
        generationAllowed: true,
        multimodalAllowed: true,
      },
      settingsMode: 'balanced',
      task: 'text_generation',
      explicitUserAction: false,
    });

    expect(decision.choice).toBe('worker_local_only');
    expect(decision.remoteFallbackAllowed).toBe(true);
  });

  it('requires explicit user action for multimodal analysis', () => {
    const decision = chooseModelForTask({
      capability: HIGH_CAPABILITY,
      settingsMode: 'balanced',
      task: 'multimodal_analysis',
      explicitUserAction: false,
    });

    expect(decision.choice).toBe('worker_local_only');
    expect(decision.requiresExplicitUserAction).toBe(true);
  });

  it('routes mid-tier multimodal to the lighter Qwen3.5 path', () => {
    const decision = chooseModelForTask({
      capability: {
        webgpu: true,
        tier: 'mid',
        generationAllowed: true,
        multimodalAllowed: true,
      },
      settingsMode: 'balanced',
      task: 'multimodal_analysis',
      explicitUserAction: true,
    });

    expect(decision.choice).toBe('qwen35_2b_mm');
    expect(decision.fallbackChoices).toEqual(['qwen35_08b_mm']);
  });
});
