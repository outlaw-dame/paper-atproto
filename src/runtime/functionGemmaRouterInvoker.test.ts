import { describe, expect, it, vi } from 'vitest';
import type { RuntimeCapability } from './capabilityProbe';
import { selectAiStackProfile } from './aiStackProfile';
import { chooseModelForTask } from './modelPolicy';
import { buildCoordinationContract } from './routerCoordinatorContract';
import {
  invokeFunctionGemmaRouter,
  type FunctionGemmaRouterRuntime,
} from './functionGemmaRouterInvoker';
import { ROUTER_PROMPT_ID, ROUTER_PROMPT_VERSION, type RouterPromptInput } from './prompts';

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

function promptInput(): RouterPromptInput {
  const contract = createContract();
  return {
    contractId: 'contract:test',
    contract,
    taskSummary: 'Route a text generation job.',
    userVisibleIntent: 'Generate concise text.',
    inputStats: {
      textLength: 120,
      estimatedPromptTokens: 64,
      hasImages: false,
      hasLinks: false,
      hasCode: false,
      hasSensitiveLocalData: false,
    },
    runtimeHealth: {
      batterySaver: false,
      thermalState: 'nominal',
      sustainedLatencyMs: null,
      storageAvailableGiB: 16,
    },
  };
}

function runtime(output: unknown): FunctionGemmaRouterRuntime {
  return {
    id: 'functiongemma_270m',
    available: true,
    route: vi.fn(async () => output),
  };
}

describe('invokeFunctionGemmaRouter', () => {
  it('falls back without invoking when the FunctionGemma runtime is unavailable', async () => {
    const contract = createContract();
    const result = await invokeFunctionGemmaRouter({
      contract,
      contractId: 'contract:test',
      promptInput: promptInput(),
      runtime: null,
      nowEpochMs: 1_500,
    });

    expect(result.status).toBe('unavailable');
    expect(result.execution.status).toBe('fallback');
    expect(result.execution.fallbackReason).toBe('missing_output');
    expect(result.diagnostics.runtimeAvailable).toBe(false);
  });

  it('accepts valid FunctionGemma router output after schema and contract validation', async () => {
    const contract = createContract();
    const model = runtime({
      schemaVersion: 1,
      promptId: ROUTER_PROMPT_ID,
      promptVersion: ROUTER_PROMPT_VERSION,
      contractId: 'contract:test',
      decisionType: 'route',
      selectedRouteId: 'model:smollm3_3b',
      confidence: 0.82,
      reasonCodes: ['policy_selected_fallback'],
      ttlMs: 2_000,
    });

    const result = await invokeFunctionGemmaRouter({
      contract,
      contractId: 'contract:test',
      promptInput: promptInput(),
      runtime: model,
      nowEpochMs: 1_500,
    });

    expect(model.route).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('accepted');
    expect(result.execution.selectedRouteId).toBe('model:smollm3_3b');
    expect(result.execution.diagnostics.acceptedByContract).toBe(true);
  });

  it('falls back when FunctionGemma returns schema-invalid output', async () => {
    const result = await invokeFunctionGemmaRouter({
      contract: createContract(),
      contractId: 'contract:test',
      promptInput: promptInput(),
      runtime: runtime({ random: 'bad' }),
      nowEpochMs: 1_500,
    });

    expect(result.status).toBe('fallback');
    expect(result.execution.fallbackReason).toBe('schema_rejected');
    expect(result.execution.reasonCodes).toEqual(['validator_rejected_schema']);
  });

  it('times out and falls back when the runtime does not resolve quickly enough', async () => {
    vi.useFakeTimers();
    const slowRuntime: FunctionGemmaRouterRuntime = {
      id: 'functiongemma_270m',
      available: true,
      route: vi.fn(() => new Promise(() => undefined)),
    };

    const promise = invokeFunctionGemmaRouter({
      contract: createContract(),
      contractId: 'contract:test',
      promptInput: promptInput(),
      runtime: slowRuntime,
      timeoutMs: 5,
      nowEpochMs: 1_500,
    });

    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;
    vi.useRealTimers();

    expect(result.status).toBe('timed_out');
    expect(result.execution.status).toBe('fallback');
    expect(result.diagnostics.timedOut).toBe(true);
  });

  it('aborts and falls back when the caller aborts the invocation', async () => {
    const controller = new AbortController();
    const abortingRuntime: FunctionGemmaRouterRuntime = {
      id: 'functiongemma_270m',
      available: true,
      route: vi.fn((_request) => new Promise((_resolve, reject) => {
        _request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      })),
    };

    const promise = invokeFunctionGemmaRouter({
      contract: createContract(),
      contractId: 'contract:test',
      promptInput: promptInput(),
      runtime: abortingRuntime,
      timeoutMs: 1_000,
      nowEpochMs: 1_500,
      signal: controller.signal,
    });

    controller.abort('test_abort');
    const result = await promise;

    expect(result.status).toBe('aborted');
    expect(result.execution.status).toBe('fallback');
    expect(result.diagnostics.aborted).toBe(true);
  });
});
