import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeCapability } from './capabilityProbe';
import { ROUTER_PROMPT_ID, ROUTER_PROMPT_VERSION } from './prompts';
import {
  getFunctionGemmaRouterRuntime,
  routeTaskWithRouter,
  setFunctionGemmaRouterRuntime,
} from './routerOrchestrator';
import type { FunctionGemmaRouterRuntime } from './functionGemmaRouterInvoker';

const HIGH_CAPABILITY: RuntimeCapability = {
  webgpu: true,
  tier: 'high',
  generationAllowed: true,
  multimodalAllowed: true,
  browserFamily: 'chromium',
  deviceMemoryGiB: 16,
  hardwareConcurrency: 12,
};

function staticRouterRuntime(buildOutput: (contractId: string) => unknown): FunctionGemmaRouterRuntime {
  return {
    id: 'functiongemma_270m',
    available: true,
    route: vi.fn(async (request) => buildOutput((request.input as { contractId: string }).contractId)),
  };
}

afterEach(() => {
  setFunctionGemmaRouterRuntime(null);
});

describe('routeTaskWithRouter', () => {
  it('returns the deterministic policy primary when no FunctionGemma runtime is registered', async () => {
    const result = await routeTaskWithRouter({
      task: 'text_generation',
      capability: HIGH_CAPABILITY,
      settingsMode: 'best_quality',
      stackProfileOptions: { allowLiteRt: true, preferLiteRt: true, userConsentedToLargeModels: true },
      silent: true,
    });

    expect(result.status).toBe('unavailable');
    expect(result.deterministicFallback).toBe(true);
    expect(result.selectedRouteId).toBe(`model:${result.policyDecision.choice}`);
    expect(result.modelCandidates[0]).toBe(result.policyDecision.choice);
    expect(result.modelCandidates).toEqual([
      result.policyDecision.choice,
      ...result.policyDecision.fallbackChoices,
    ]);
    expect(result.contractId).toMatch(/^coord:text_generation:/);
  });

  it('honors a registered FunctionGemma runtime and accepts a valid route selection', async () => {
    setFunctionGemmaRouterRuntime(
      staticRouterRuntime((contractId) => ({
        schemaVersion: 1,
        promptId: ROUTER_PROMPT_ID,
        promptVersion: ROUTER_PROMPT_VERSION,
        contractId,
        decisionType: 'route',
        selectedRouteId: 'model:smollm3_3b',
        confidence: 0.92,
        reasonCodes: ['policy_selected_fallback'],
        ttlMs: 1_000,
      })),
    );
    expect(getFunctionGemmaRouterRuntime()).not.toBeNull();

    const result = await routeTaskWithRouter({
      task: 'text_generation',
      capability: HIGH_CAPABILITY,
      settingsMode: 'best_quality',
      stackProfileOptions: { allowLiteRt: true, preferLiteRt: true, userConsentedToLargeModels: true },
      silent: true,
    });

    expect(result.status).toBe('accepted');
    expect(result.deterministicFallback).toBe(false);
    expect(result.selectedRouteId).toBe('model:smollm3_3b');
    expect(result.selectedModel).toBe('smollm3_3b');
    // SmolLM picked first, then policy primary, then any remaining fallbacks.
    expect(result.modelCandidates[0]).toBe('smollm3_3b');
    expect(result.modelCandidates).toContain(result.policyDecision.choice);
  });

  it('falls back deterministically when the runtime returns an invalid envelope', async () => {
    setFunctionGemmaRouterRuntime(staticRouterRuntime(() => ({ not: 'a router envelope' })));

    const result = await routeTaskWithRouter({
      task: 'text_generation',
      capability: HIGH_CAPABILITY,
      settingsMode: 'best_quality',
      stackProfileOptions: { allowLiteRt: true, preferLiteRt: true, userConsentedToLargeModels: true },
      silent: true,
    });

    expect(result.status).toBe('fallback');
    expect(result.deterministicFallback).toBe(true);
    expect(result.invocation.execution.fallbackReason).toBe('schema_rejected');
    // Bad router output -> the contract's safety fallback (a different but
    // allowed route), not the primary. The orchestrator must keep the
    // deterministic policy primary in the candidate list as a backup.
    expect(result.selectedModel).not.toBeNull();
    expect(result.modelCandidates).toContain(result.policyDecision.choice);
  });
});
