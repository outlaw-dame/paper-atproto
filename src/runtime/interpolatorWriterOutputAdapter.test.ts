import { describe, expect, it } from 'vitest';
import type {
  InterpolatorWriterEvalFixture,
  InterpolatorWriterThinkingMode,
} from './interpolatorWriterEvalContract';
import type { InterpolatorWriterRouteCandidate } from './interpolatorWriterRoutingPolicy';
import { adaptInterpolatorWriterOutput } from './interpolatorWriterOutputAdapter';

type TrustedWriterRoute = Pick<InterpolatorWriterRouteCandidate, 'provider' | 'executionClass' | 'remote' | 'requiresExplicitConsent'>;

function fixture(overrides: Partial<InterpolatorWriterEvalFixture> = {}): InterpolatorWriterEvalFixture {
  return {
    schemaVersion: 1,
    id: 'fixture-thread-1',
    mode: 'normal',
    title: 'writer output adapter fixture',
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

function trustedRoute(overrides: Partial<TrustedWriterRoute> = {}): TrustedWriterRoute {
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

function adapt(
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
  return adaptInterpolatorWriterOutput({
    fixture: overrides.fixture ?? fixture(),
    rawOutput: raw,
    route: overrides.route ?? trustedRoute(),
    thinkingMode: overrides.thinkingMode ?? 'off',
    latencyMs: overrides.latencyMs ?? 800,
    outputTokens: overrides.outputTokens ?? 72,
    ...(overrides.maxTextChars === undefined ? {} : { maxTextChars: overrides.maxTextChars }),
    ...(overrides.maxReferenceIds === undefined ? {} : { maxReferenceIds: overrides.maxReferenceIds }),
  });
}

describe('adaptInterpolatorWriterOutput', () => {
  it('accepts schema-valid and contract-valid writer output', () => {
    const result = adapt(rawOutput());

    expect(result.status).toBe('accepted');
    expect(result.evalResult.passed).toBe(true);
    expect(result.candidateOutput.provider).toBe('qwen3_4b_ollama');
    expect(result.candidateOutput.route.executionClass).toBe('local_ollama');
    expect(result.reasonCodes).toContain('writer_output_accepted');
    expect(result.diagnostics.schemaAccepted).toBe(true);
    expect(result.diagnostics.contractAccepted).toBe(true);
  });

  it('rejects schema-invalid raw output and creates a contract-failing fallback candidate', () => {
    const result = adapt({ random: 'bad' });

    expect(result.status).toBe('schema_rejected');
    expect(result.candidateOutput.text).toBe('');
    expect(result.evalResult.passed).toBe(false);
    expect(result.evalResult.violations.map((violation) => violation.code)).toContain('missing_output_text');
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'writer_output_schema_rejected',
      'writer_output_fallback_candidate_created',
    ]));
    expect(result.diagnostics.schemaAccepted).toBe(false);
    expect(result.diagnostics.contractAccepted).toBe(false);
  });

  it('rejects empty text after sanitation instead of accepting a blank candidate', () => {
    const result = adapt(rawOutput({ text: `${String.fromCharCode(0)}   ` }));

    expect(result.status).toBe('schema_rejected');
    expect(result.candidateOutput.text).toBe('');
    expect(result.evalResult.violations.map((violation) => violation.code)).toContain('missing_output_text');
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'writer_output_control_chars_removed',
      'writer_output_schema_rejected',
    ]));
  });

  it('uses caller-owned route metadata and ignores raw provider or route fields', () => {
    const result = adapt(rawOutput({
      provider: 'openai_writer',
      route: {
        provider: 'openai_writer',
        executionClass: 'external_api_enhancer',
        remote: true,
        requiresExplicitConsent: true,
      },
    }), {
      route: trustedRoute({
        provider: 'gemma_writer_local_or_litert',
        executionClass: 'device_edge_litert',
        remote: false,
        requiresExplicitConsent: false,
      }),
    });

    expect(result.status).toBe('accepted');
    expect(result.candidateOutput.provider).toBe('gemma_writer_local_or_litert');
    expect(result.candidateOutput.route).toEqual({
      provider: 'gemma_writer_local_or_litert',
      executionClass: 'device_edge_litert',
      remote: false,
      requiresExplicitConsent: false,
    });
    expect(result.diagnostics.trustedProvider).toBe('gemma_writer_local_or_litert');
    expect(result.diagnostics.remote).toBe(false);
  });

  it('normalizes text and reference ids without inventing new references', () => {
    const result = adapt(rawOutput({
      text: `${String.fromCharCode(0)}  Alice says the launch is delayed.\r\nGrounded in the root post.  `,
      usedEntityIds: [' user:alice.example ', 'user:alice.example', 42, '', 'x'.repeat(257)],
      usedClaimIds: ['claim:root-launch-delay', 'claim:root-launch-delay'],
      citedEvidenceIds: ['evidence:root-post', ' evidence:root-post ', 'evidence:reply-1'],
    }));

    expect(result.status).toBe('accepted');
    expect(result.candidateOutput.text).toBe('Alice says the launch is delayed.\nGrounded in the root post.');
    expect(result.candidateOutput.usedEntityIds).toEqual(['user:alice.example']);
    expect(result.candidateOutput.usedClaimIds).toEqual(['claim:root-launch-delay']);
    expect(result.candidateOutput.citedEvidenceIds).toEqual(['evidence:root-post', 'evidence:reply-1']);
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'writer_output_control_chars_removed',
      'writer_output_duplicate_reference_ids_removed',
      'writer_output_invalid_reference_ids_dropped',
    ]));
  });

  it('bounds text and reference lists before evaluating output', () => {
    const result = adapt(rawOutput({
      text: 'Alice says the launch is delayed. This text should be bounded.',
      usedEntityIds: ['user:alice.example', 'user:bob.example'],
      usedClaimIds: ['claim:root-launch-delay', 'claim:reply-cost-concern'],
      citedEvidenceIds: ['evidence:root-post', 'evidence:reply-1'],
    }), {
      maxTextChars: 31,
      maxReferenceIds: 1,
    });

    expect(result.status).toBe('accepted');
    expect(result.candidateOutput.text).toBe('Alice says the launch is delayed');
    expect(result.candidateOutput.usedEntityIds).toEqual(['user:alice.example']);
    expect(result.candidateOutput.usedClaimIds).toEqual(['claim:root-launch-delay']);
    expect(result.candidateOutput.citedEvidenceIds).toEqual(['evidence:root-post']);
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'writer_output_text_trimmed',
      'writer_output_reference_ids_truncated',
    ]));
  });

  it('marks fixture mismatches as contract rejected', () => {
    const result = adapt(rawOutput({ fixtureId: 'different-fixture' }));

    expect(result.status).toBe('contract_rejected');
    expect(result.evalResult.passed).toBe(false);
    expect(result.evalResult.violations.map((violation) => violation.code)).toContain('fixture_id_mismatch');
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'writer_output_contract_rejected',
      'writer_output_fixture_id_mismatch',
    ]));
  });

  it('lets the eval contract reject trusted disallowed thinking mode', () => {
    const result = adapt(rawOutput(), { thinkingMode: 'explicit_scratchpad_forbidden' });

    expect(result.status).toBe('contract_rejected');
    expect(result.evalResult.passed).toBe(false);
    expect(result.evalResult.violations.map((violation) => violation.code)).toContain('forbidden_thinking_disclosure');
    expect(result.reasonCodes).toContain('writer_output_contract_rejected');
  });
});
