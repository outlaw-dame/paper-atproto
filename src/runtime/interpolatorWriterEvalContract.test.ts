import { describe, expect, it } from 'vitest';
import type {
  InterpolatorWriterEvalCandidateOutput,
  InterpolatorWriterEvalFixture,
} from './interpolatorWriterEvalContract';
import {
  evaluateInterpolatorWriterOutput,
  rankInterpolatorWriterEvalResults,
} from './interpolatorWriterEvalContract';

function fixture(overrides: Partial<InterpolatorWriterEvalFixture> = {}): InterpolatorWriterEvalFixture {
  return {
    schemaVersion: 1,
    id: 'fixture-thread-1',
    mode: 'normal',
    title: 'grounded post/thread summary fixture',
    allowedEntities: [
      { id: 'user:alice.example', label: 'Alice', source: 'post_author', required: true },
      { id: 'user:bob.example', label: 'Bob', source: 'reply_author', required: false },
      { id: 'wd:Q42', label: 'Douglas Adams', source: 'wikidata', required: false },
    ],
    allowedClaims: [
      { id: 'claim:root-author-says-launch-delayed', evidenceIds: ['evidence:root-post'], required: true },
      { id: 'claim:bob-replied-with-cost-concern', evidenceIds: ['evidence:reply-1'], required: false },
    ],
    allowedEvidence: [
      { id: 'evidence:root-post', sourceType: 'post', required: true },
      { id: 'evidence:reply-1', sourceType: 'reply', required: false },
      { id: 'evidence:wikidata-q42', sourceType: 'wikidata', required: false },
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
    usedClaimIds: ['claim:root-author-says-launch-delayed'],
    citedEvidenceIds: ['evidence:root-post'],
    selfReportedQuality: 0.84,
    latencyMs: 900,
    outputTokens: 64,
    ...overrides,
  };
}

describe('interpolator writer eval contract', () => {
  it('passes a grounded writer output that only uses allowed fixture state', () => {
    const result = evaluateInterpolatorWriterOutput(fixture(), output());

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.scores.groundedness).toBe(1);
    expect(result.scores.finalScore).toBeGreaterThan(0.8);
  });

  it('rejects invented entities', () => {
    const result = evaluateInterpolatorWriterOutput(fixture(), output({
      usedEntityIds: ['user:alice.example', 'user:invented.example'],
    }));

    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toContain('invented_entity_id');
  });

  it('rejects unsupported claims', () => {
    const result = evaluateInterpolatorWriterOutput(fixture(), output({
      usedClaimIds: ['claim:root-author-says-launch-delayed', 'claim:invented-market-impact'],
    }));

    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toContain('unsupported_claim_id');
  });

  it('rejects allowed claims when no supporting fixture evidence is cited', () => {
    const result = evaluateInterpolatorWriterOutput(fixture(), output({
      citedEvidenceIds: [],
    }));

    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toContain('uncited_claim_id');
  });

  it('rejects unsupported evidence references', () => {
    const result = evaluateInterpolatorWriterOutput(fixture(), output({
      citedEvidenceIds: ['evidence:root-post', 'evidence:invented-web-page'],
    }));

    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toContain('unsupported_evidence_id');
  });

  it('rejects scratchpad or chain-of-thought disclosure in writer text', () => {
    const result = evaluateInterpolatorWriterOutput(fixture(), output({
      text: 'Alice says the launch is delayed. My chain of thought is hidden here.',
    }));

    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toContain('forbidden_thinking_disclosure');
  });

  it('blocks provider-hidden thinking unless the fixture policy permits it', () => {
    const blocked = evaluateInterpolatorWriterOutput(fixture(), output({ thinkingMode: 'provider_hidden' }));
    expect(blocked.passed).toBe(false);
    expect(blocked.violations.map((violation) => violation.code)).toContain('forbidden_thinking_disclosure');

    const allowed = evaluateInterpolatorWriterOutput(
      fixture({
        policy: {
          allowProviderHiddenThinking: true,
          requireClaimEvidence: true,
          requireRequiredEntityCoverage: true,
          maxUnsupportedClaims: 0,
          maxInventedEntities: 0,
        },
      }),
      output({ thinkingMode: 'provider_hidden' }),
    );
    expect(allowed.passed).toBe(true);
  });

  it('flags omitted required entities without treating them as invented', () => {
    const result = evaluateInterpolatorWriterOutput(fixture(), output({
      usedEntityIds: [],
    }));

    expect(result.passed).toBe(true);
    expect(result.violations.map((violation) => violation.code)).toContain('missing_required_entity_id');
    expect(result.violations.map((violation) => violation.code)).not.toContain('invented_entity_id');
    expect(result.scores.entityRecall).toBe(0);
  });

  it('ranks passing outputs above failing outputs before considering final score', () => {
    const passing = evaluateInterpolatorWriterOutput(fixture(), output({ selfReportedQuality: 0.7 }));
    const failing = evaluateInterpolatorWriterOutput(fixture(), output({
      selfReportedQuality: 0.99,
      usedEntityIds: ['user:alice.example', 'user:invented.example'],
    }));

    const ranked = rankInterpolatorWriterEvalResults([failing, passing]);

    expect(ranked[0]).toBe(passing);
    expect(ranked[1]).toBe(failing);
  });
});
