import { describe, expect, it } from 'vitest';
import type {
  InterpolatorWriterEvalFixture,
  InterpolatorWriterThinkingMode,
} from './interpolatorWriterEvalContract';
import type { InterpolatorWriterRouteCandidate } from './interpolatorWriterRoutingPolicy';
import { finalizeInterpolatorWriterCandidate } from './interpolatorWriterExecutionFinalizer';

type TrustedWriterRoute = Pick<InterpolatorWriterRouteCandidate, 'provider' | 'executionClass' | 'remote' | 'requiresExplicitConsent'>;

function fixture(overrides: Partial<InterpolatorWriterEvalFixture> = {}): InterpolatorWriterEvalFixture {
  return {
    schemaVersion: 1,
    id: 'fixture-thread-1',
    mode: 'normal',
    title: 'writer execution finalizer fixture',
    allowedEntities: [
      { id: 'user:alice.example', label: 'Alice', source: 'post_author', required: true },
      { id: 'user:bob.example', label: 'Bob', source: 'reply_author', required: false },
    ],
    allowedClaims: [
      { id: 'claim:root-launch-delay', evidenceIds: ['evidence:root-post'], required: true },
      { id: 'claim:reply-cost-concern', evidenceIds: ['evidence:reply-1'], required: false },
    ],
    allowedEvidence: [
      { id: 'evidence:root-post', sourceType: 'post', required: true },
      { id: 'evidence:reply-1', sourceType: 'reply', required: false },
    ],
    policy: {
      allowProviderHiddenThinking: false,
      requireClaimEvidence: true,
      requireRequiredEntityCoverage: true,
      maxUnsupportedClaims: 0,
      maxInventedEntities: 0,
    },
    ...overrides,
  };
}

function route(overrides: Partial<TrustedWriterRoute> = {}): TrustedWriterRoute {
  return {
    provider: 'qwen3_4b_ollama',
    executionClass: 'local_ollama',
    remote: false,
    requiresExplicitConsent: false,
    ...overrides,
  };
}

function rawOutput(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    fixtureId: 'fixture-thread-1',
    text: 'Alice says the launch is delayed, grounded in the root post.',
    usedEntityIds: ['user:alice.example'],
    usedClaimIds: ['claim:root-launch-delay'],
    citedEvidenceIds: ['evidence:root-post'],
    selfReportedQuality: 0.84,
    ...overrides,
  };
}

function finalize(
  raw: unknown,
  overrides: Partial<{
    fixture: InterpolatorWriterEvalFixture;
    route: TrustedWriterRoute;
    thinkingMode: InterpolatorWriterThinkingMode;
    latencyMs: number | null;
    outputTokens: number | null;
    maxTextChars: number;
    maxReferenceIds: number;
  }> = {},
) {
  return finalizeInterpolatorWriterCandidate({
    fixture: overrides.fixture ?? fixture(),
    rawOutput: raw,
    route: overrides.route ?? route(),
    thinkingMode: overrides.thinkingMode ?? 'off',
    latencyMs: overrides.latencyMs ?? 850,
    outputTokens: overrides.outputTokens ?? 74,
    maxTextChars: overrides.maxTextChars,
    maxReferenceIds: overrides.maxReferenceIds,
  });
}

describe('finalizeInterpolatorWriterCandidate', () => {
  it('exposes acceptedText only when adapter and eval contract accept output', () => {
    const result = finalize(rawOutput());

    expect(result.status).toBe('accepted');
    expect(result.acceptedText).toBe('Alice says the launch is delayed, grounded in the root post.');
    expect(result.adaptedOutput.status).toBe('accepted');
    expect(result.diagnostics.fallbackRequired).toBe(false);
    expect(result.reasonCodes).toContain('writer_execution_accepted');
  });

  it('uses caller-owned route metadata and never trusts raw provider metadata', () => {
    const result = finalize(rawOutput({
      provider: 'openai_writer',
      route: {
        provider: 'openai_writer',
        executionClass: 'external_api_enhancer',
        remote: true,
        requiresExplicitConsent: true,
      },
    }), {
      route: route({
        provider: 'gemma_writer_local_or_litert',
        executionClass: 'device_edge_litert',
        remote: false,
        requiresExplicitConsent: false,
      }),
    });

    expect(result.status).toBe('accepted');
    expect(result.adaptedOutput.candidateOutput.provider).toBe('gemma_writer_local_or_litert');
    expect(result.diagnostics.trustedProvider).toBe('gemma_writer_local_or_litert');
    expect(result.diagnostics.remote).toBe(false);
  });

  it('requires fallback and exposes no acceptedText for malformed raw output', () => {
    const result = finalize({ not: 'a valid writer output' });

    expect(result.status).toBe('fallback_required');
    expect(result.acceptedText).toBeNull();
    expect(result.adaptedOutput.status).toBe('schema_rejected');
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'writer_execution_fallback_required',
      'writer_execution_schema_rejected',
      'writer_output_schema_rejected',
    ]));
    expect(result.diagnostics.schemaAccepted).toBe(false);
    expect(result.diagnostics.contractAccepted).toBe(false);
    expect(result.diagnostics.fallbackRequired).toBe(true);
  });

  it('requires fallback for fixture mismatch contract rejection', () => {
    const result = finalize(rawOutput({ fixtureId: 'different-fixture' }));

    expect(result.status).toBe('fallback_required');
    expect(result.acceptedText).toBeNull();
    expect(result.adaptedOutput.status).toBe('contract_rejected');
    expect(result.adaptedOutput.evalResult.violations.map((violation) => violation.code)).toContain('fixture_id_mismatch');
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'writer_execution_fallback_required',
      'writer_execution_contract_rejected',
      'writer_output_fixture_id_mismatch',
    ]));
  });

  it('requires fallback for invented entity contract rejection', () => {
    const result = finalize(rawOutput({
      usedEntityIds: ['user:alice.example', 'user:invented.example'],
    }));

    expect(result.status).toBe('fallback_required');
    expect(result.acceptedText).toBeNull();
    expect(result.adaptedOutput.evalResult.violations.map((violation) => violation.code)).toContain('invented_entity_id');
    expect(result.reasonCodes).toContain('writer_execution_contract_rejected');
  });

  it('requires fallback for unsupported claim contract rejection', () => {
    const result = finalize(rawOutput({
      usedClaimIds: ['claim:root-launch-delay', 'claim:invented'],
    }));

    expect(result.status).toBe('fallback_required');
    expect(result.acceptedText).toBeNull();
    expect(result.adaptedOutput.evalResult.violations.map((violation) => violation.code)).toContain('unsupported_claim_id');
    expect(result.reasonCodes).toContain('writer_execution_contract_rejected');
  });

  it('requires fallback when hidden thinking is not permitted by fixture policy', () => {
    const result = finalize(rawOutput(), { thinkingMode: 'provider_hidden' });

    expect(result.status).toBe('fallback_required');
    expect(result.acceptedText).toBeNull();
    expect(result.adaptedOutput.evalResult.violations.map((violation) => violation.code)).toContain('forbidden_thinking_disclosure');
    expect(result.reasonCodes).toContain('writer_execution_contract_rejected');
  });

  it('passes adapter bounds through the finalizer', () => {
    const result = finalize(rawOutput({
      text: 'Alice says the launch is delayed. This extra text should be trimmed.',
      usedEntityIds: ['user:alice.example', 'user:bob.example'],
      usedClaimIds: ['claim:root-launch-delay', 'claim:reply-cost-concern'],
      citedEvidenceIds: ['evidence:root-post', 'evidence:reply-1'],
    }), {
      maxTextChars: 32,
      maxReferenceIds: 1,
    });

    expect(result.status).toBe('accepted');
    expect(result.acceptedText).toBe('Alice says the launch is delayed');
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'writer_output_text_trimmed',
      'writer_output_reference_ids_truncated',
      'writer_execution_accepted',
    ]));
  });
});
