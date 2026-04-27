import { describe, expect, it } from 'vitest';
import type {
  InterpolatorWriterEvalCandidateOutput,
  InterpolatorWriterEvalFixture,
} from './interpolatorWriterEvalContract';
import { compareInterpolatorWriterCandidates } from './interpolatorWriterEvalHarness';

function fixture(overrides: Partial<InterpolatorWriterEvalFixture> = {}): InterpolatorWriterEvalFixture {
  return {
    schemaVersion: 1,
    id: 'fixture-thread-1',
    mode: 'normal',
    title: 'writer candidate comparison fixture',
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
      allowProviderHiddenThinking: true,
      requireClaimEvidence: true,
      requireRequiredEntityCoverage: true,
      maxUnsupportedClaims: 0,
      maxInventedEntities: 0,
    },
    ...overrides,
  };
}

function output(overrides: Partial<InterpolatorWriterEvalCandidateOutput> = {}): InterpolatorWriterEvalCandidateOutput {
  return {
    schemaVersion: 1,
    fixtureId: 'fixture-thread-1',
    provider: 'qwen3_4b_ollama',
    route: {
      provider: 'qwen3_4b_ollama',
      executionClass: 'local_ollama',
      remote: false,
      requiresExplicitConsent: false,
    },
    thinkingMode: 'off',
    text: 'Alice says the launch is delayed, grounded in the root post.',
    usedEntityIds: ['user:alice.example'],
    usedClaimIds: ['claim:root-launch-delay'],
    citedEvidenceIds: ['evidence:root-post'],
    selfReportedQuality: 0.82,
    latencyMs: 800,
    outputTokens: 80,
    ...overrides,
  };
}

describe('interpolator writer eval harness', () => {
  it('returns no_candidates when no candidate outputs are provided', () => {
    const summary = compareInterpolatorWriterCandidates({ fixture: fixture(), candidates: [] });

    expect(summary.status).toBe('no_candidates');
    expect(summary.winner).toBeNull();
    expect(summary.reasonCodes).toContain('no_candidate_outputs');
  });

  it('returns all_failed when every candidate violates the eval contract', () => {
    const summary = compareInterpolatorWriterCandidates({
      fixture: fixture(),
      candidates: [
        { output: output({ usedEntityIds: ['user:invented.example'] }) },
        { output: output({ usedClaimIds: ['claim:invented'] }) },
      ],
    });

    expect(summary.status).toBe('all_failed');
    expect(summary.winner).toBeNull();
    expect(summary.reasonCodes).toContain('candidate_failed_contract');
  });

  it('marks fixture-mismatched outputs and ranks them as failed', () => {
    const summary = compareInterpolatorWriterCandidates({
      fixture: fixture(),
      candidates: [
        { output: output({ fixtureId: 'different-fixture' }) },
        { output: output({ selfReportedQuality: 0.7 }) },
      ],
    });

    expect(summary.status).toBe('winner_selected');
    expect(summary.winner?.provider).toBe('qwen3_4b_ollama');
    expect(summary.rankedCandidates[1]?.reasonCodes).toContain('candidate_fixture_mismatch');
    expect(summary.rankedCandidates[1]?.result.passed).toBe(false);
  });

  it('selects the highest scoring passing candidate', () => {
    const summary = compareInterpolatorWriterCandidates({
      fixture: fixture(),
      candidates: [
        { output: output({ provider: 'qwen3_4b_ollama', selfReportedQuality: 0.65 }) },
        {
          output: output({
            provider: 'gemma_writer_local_or_litert',
            route: {
              provider: 'gemma_writer_local_or_litert',
              executionClass: 'device_edge_litert',
              remote: false,
              requiresExplicitConsent: false,
            },
            selfReportedQuality: 0.95,
            latencyMs: 700,
          }),
        },
      ],
    });

    expect(summary.status).toBe('winner_selected');
    expect(summary.winner?.provider).toBe('gemma_writer_local_or_litert');
    expect(summary.reasonCodes).toContain('winner_selected_by_score');
  });

  it('uses provider priority when passing candidates have equal final scores', () => {
    const summary = compareInterpolatorWriterCandidates({
      fixture: fixture(),
      candidates: [
        { output: output({ provider: 'qwen3_4b_ollama' }), providerPriority: 2 },
        {
          output: output({
            provider: 'cloudflare_workers_ai_writer',
            route: {
              provider: 'cloudflare_workers_ai_writer',
              executionClass: 'cloud_edge_workers_ai',
              remote: true,
              requiresExplicitConsent: false,
            },
          }),
          providerPriority: 1,
        },
      ],
    });

    expect(summary.status).toBe('winner_selected');
    expect(summary.winner?.provider).toBe('cloudflare_workers_ai_writer');
    expect(summary.reasonCodes).toContain('winner_selected_by_provider_priority');
  });

  it('requires review when equal passing candidates also share provider priority', () => {
    const summary = compareInterpolatorWriterCandidates({
      fixture: fixture(),
      scoreTieTolerance: 0.25,
      candidates: [
        { output: output({ provider: 'qwen3_4b_ollama' }), providerPriority: 1 },
        {
          output: output({
            provider: 'cloudflare_workers_ai_writer',
            route: {
              provider: 'cloudflare_workers_ai_writer',
              executionClass: 'cloud_edge_workers_ai',
              remote: true,
              requiresExplicitConsent: false,
            },
            selfReportedQuality: 0.821,
          }),
          providerPriority: 1,
        },
      ],
    });

    expect(summary.status).toBe('tie_requires_review');
    expect(summary.winner).toBeNull();
    expect(summary.reasonCodes).toContain('tie_requires_review');
  });

  it('reports when a thinking candidate beats a non-thinking candidate', () => {
    const summary = compareInterpolatorWriterCandidates({
      fixture: fixture(),
      candidates: [
        { output: output({ provider: 'qwen3_4b_ollama', selfReportedQuality: 0.65 }) },
        {
          output: output({
            provider: 'openai_writer',
            route: {
              provider: 'openai_writer',
              executionClass: 'external_api_enhancer',
              remote: true,
              requiresExplicitConsent: true,
            },
            thinkingMode: 'provider_hidden',
            selfReportedQuality: 0.95,
          }),
        },
      ],
    });

    expect(summary.reasonCodes).toContain('thinking_candidate_beats_non_thinking');
  });

  it('reports when a thinking candidate loses to a non-thinking candidate', () => {
    const summary = compareInterpolatorWriterCandidates({
      fixture: fixture(),
      candidates: [
        { output: output({ provider: 'qwen3_4b_ollama', selfReportedQuality: 0.95 }) },
        {
          output: output({
            provider: 'openai_writer',
            route: {
              provider: 'openai_writer',
              executionClass: 'external_api_enhancer',
              remote: true,
              requiresExplicitConsent: true,
            },
            thinkingMode: 'provider_hidden',
            text: 'Alice says the launch is delayed. My chain of thought is hidden here.',
            selfReportedQuality: 0.99,
          }),
        },
      ],
    });

    expect(summary.reasonCodes).toContain('thinking_candidate_loses_to_non_thinking');
  });
});
