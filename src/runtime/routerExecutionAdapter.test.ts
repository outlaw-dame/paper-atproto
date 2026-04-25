import { describe, expect, it } from 'vitest';
import type { RuntimeCapability } from './capabilityProbe';
import { selectAiStackProfile } from './aiStackProfile';
import { chooseModelForTask } from './modelPolicy';
import { buildCoordinationContract } from './routerCoordinatorContract';
import { evaluateRouterPromptOutput } from './routerExecutionAdapter';
import { ROUTER_PROMPT_ID, ROUTER_PROMPT_VERSION } from './prompts';

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

describe('evaluateRouterPromptOutput', () => {
  it('accepts schema-valid router output only after contract validation', () => {
    const result = evaluateRouterPromptOutput({
      contract: createContract(),
      contractId: 'contract:test',
      nowEpochMs: 1_500,
      output: {
        schemaVersion: 1,
        promptId: ROUTER_PROMPT_ID,
        promptVersion: ROUTER_PROMPT_VERSION,
        contractId: 'contract:test',
        decisionType: 'route',
        selectedRouteId: 'model:smollm3_3b',
        confidence: 0.82,
        reasonCodes: ['policy_selected_fallback'],
        ttlMs: 2_000,
      },
    });

    expect(result.status).toBe('accepted');
    expect(result.selectedRouteId).toBe('model:smollm3_3b');
    expect(result.routerDecision?.selectedRouteId).toBe('model:smollm3_3b');
    expect(result.diagnostics.acceptedBySchema).toBe(true);
    expect(result.diagnostics.acceptedByContract).toBe(true);
    expect(result.fallbackReason).toBeNull();
  });

  it('falls back when output is missing or schema-invalid', () => {
    const contract = createContract();
    const missing = evaluateRouterPromptOutput({ contract, contractId: 'contract:test', output: null, nowEpochMs: 1_500 });
    const invalid = evaluateRouterPromptOutput({
      contract,
      contractId: 'contract:test',
      nowEpochMs: 1_500,
      output: {
        schemaVersion: 1,
        promptId: ROUTER_PROMPT_ID,
        promptVersion: ROUTER_PROMPT_VERSION,
        contractId: 'contract:test',
        decisionType: 'route',
        selectedRouteId: 'model:smollm3_3b',
        confidence: 0.82,
        reasonCodes: ['random_string'],
        ttlMs: 2_000,
      },
    });

    expect(missing.status).toBe('fallback');
    expect(missing.fallbackReason).toBe('missing_output');
    expect(missing.reasonCodes).toEqual([]);
    expect(invalid.status).toBe('fallback');
    expect(invalid.fallbackReason).toBe('schema_rejected');
    expect(invalid.reasonCodes).toEqual(['validator_rejected_schema']);
    expect(invalid.diagnostics.acceptedBySchema).toBe(false);
  });

  it('falls back when prompt or contract identity does not match', () => {
    const contract = createContract();
    const wrongPrompt = evaluateRouterPromptOutput({
      contract,
      contractId: 'contract:test',
      nowEpochMs: 1_500,
      output: {
        schemaVersion: 1,
        promptId: ROUTER_PROMPT_ID,
        promptVersion: ROUTER_PROMPT_VERSION + 1,
        contractId: 'contract:test',
        decisionType: 'route',
        selectedRouteId: 'model:smollm3_3b',
        confidence: 0.82,
        reasonCodes: ['policy_selected_fallback'],
        ttlMs: 2_000,
      },
    });
    const wrongContract = evaluateRouterPromptOutput({
      contract,
      contractId: 'contract:test',
      nowEpochMs: 1_500,
      output: {
        schemaVersion: 1,
        promptId: ROUTER_PROMPT_ID,
        promptVersion: ROUTER_PROMPT_VERSION,
        contractId: 'contract:stale',
        decisionType: 'route',
        selectedRouteId: 'model:smollm3_3b',
        confidence: 0.82,
        reasonCodes: ['policy_selected_fallback'],
        ttlMs: 2_000,
      },
    });

    expect(wrongPrompt.status).toBe('fallback');
    expect(wrongPrompt.fallbackReason).toBe('schema_rejected');
    expect(wrongContract.status).toBe('fallback');
    expect(wrongContract.fallbackReason).toBe('contract_identity_mismatch');
    expect(wrongContract.reasonCodes).toEqual(['validator_rejected_constraints']);
  });

  it('falls back when schema-valid output is outside the coordination contract', () => {
    const result = evaluateRouterPromptOutput({
      contract: createContract(),
      contractId: 'contract:test',
      nowEpochMs: 1_500,
      output: {
        schemaVersion: 1,
        promptId: ROUTER_PROMPT_ID,
        promptVersion: ROUTER_PROMPT_VERSION,
        contractId: 'contract:test',
        decisionType: 'route',
        selectedRouteId: 'model:not_in_contract',
        confidence: 0.82,
        reasonCodes: ['policy_selected_fallback'],
        ttlMs: 2_000,
      },
    });

    expect(result.status).toBe('fallback');
    expect(result.fallbackReason).toBe('contract_rejected');
    expect(result.diagnostics.acceptedBySchema).toBe(true);
    expect(result.diagnostics.acceptedByContract).toBe(false);
    expect(result.reasonCodes).toEqual(['validator_rejected_unknown_route']);
  });
});
