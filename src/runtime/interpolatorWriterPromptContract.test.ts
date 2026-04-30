import { describe, expect, it } from 'vitest';
import {
  buildInterpolatorWriterPromptContract,
  buildRawInterpolatorWriterOutputJsonSchema,
  INTERPOLATOR_WRITER_PROMPT_CONTRACT_VERSION,
  RAW_INTERPOLATOR_WRITER_OUTPUT_SCHEMA_VERSION,
} from './interpolatorWriterPromptContract';

type PromptInput = Parameters<typeof buildInterpolatorWriterPromptContract>[0];
type Fixture = PromptInput['fixture'];

function fixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    schemaVersion: 1,
    id: 'fixture-thread-1',
    mode: 'normal',
    title: 'prompt contract fixture',
    allowedEntities: [
      { id: 'user:alice.example', label: 'Alice', source: 'post_author', required: true },
      { id: 'user:bob.example', label: 'Bob', source: 'reply_author', required: false },
      { id: 'wd:Q42', label: 'Douglas Adams', source: 'wikidata', required: false },
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

function input(overrides: Partial<PromptInput> = {}): PromptInput {
  return {
    fixture: fixture(),
    mode: 'normal',
    thinkingMode: 'off',
    ...overrides,
  };
}

describe('buildInterpolatorWriterPromptContract', () => {
  it('builds a stable JSON output schema for raw writer candidates', () => {
    const contract = buildInterpolatorWriterPromptContract(input());

    expect(contract.schemaVersion).toBe(INTERPOLATOR_WRITER_PROMPT_CONTRACT_VERSION);
    expect(contract.outputJsonSchema.type).toBe('object');
    expect(contract.outputJsonSchema.additionalProperties).toBe(false);
    expect(contract.requiredOutputKeys).toEqual([
      'schemaVersion',
      'fixtureId',
      'text',
      'usedEntityIds',
      'usedClaimIds',
      'citedEvidenceIds',
      'selfReportedQuality',
    ]);
    expect(contract.outputJsonSchema.properties.schemaVersion.const).toBe(RAW_INTERPOLATOR_WRITER_OUTPUT_SCHEMA_VERSION);
    expect(contract.outputJsonSchema.properties.fixtureId.const).toBe('fixture-thread-1');
    expect(contract.outputJsonSchema.properties.selfReportedQuality.minimum).toBe(0);
    expect(contract.outputJsonSchema.properties.selfReportedQuality.maximum).toBe(1);
  });

  it('returns a fresh fixture-specific schema for every call', () => {
    const first = buildRawInterpolatorWriterOutputJsonSchema('fixture-one');
    const second = buildRawInterpolatorWriterOutputJsonSchema('fixture-two');

    expect(first).not.toBe(second);
    expect(first.required).not.toBe(second.required);
    expect(first.properties).not.toBe(second.properties);
    expect(first.properties.fixtureId).not.toBe(second.properties.fixtureId);
    expect(first.properties.fixtureId.const).toBe('fixture-one');
    expect(second.properties.fixtureId.const).toBe('fixture-two');

    first.properties.fixtureId.const = 'mutated';
    expect(buildRawInterpolatorWriterOutputJsonSchema('fixture-one').properties.fixtureId.const).toBe('fixture-one');
    expect(second.properties.fixtureId.const).toBe('fixture-two');
  });

  it('projects fixture IDs into policy', () => {
    const contract = buildInterpolatorWriterPromptContract(input());

    expect(contract.policy.role).toBe('interpolator_writer');
    expect(contract.policy.fixtureId).toBe('fixture-thread-1');
    expect(contract.policy.allowedEntityIds).toEqual(['user:alice.example', 'user:bob.example', 'wd:Q42']);
    expect(contract.policy.requiredEntityIds).toEqual(['user:alice.example']);
    expect(contract.policy.allowedClaimIds).toEqual(['claim:root-launch-delay', 'claim:reply-cost-concern']);
    expect(contract.policy.requiredClaimIds).toEqual(['claim:root-launch-delay']);
    expect(contract.policy.allowedEvidenceIds).toEqual(['evidence:root-post', 'evidence:reply-1']);
    expect(contract.policy.requiredEvidenceIds).toEqual(['evidence:root-post']);
    expect(contract.policy.callerOwnsProviderMetadata).toBe(true);
  });

  it('serializes fixture payload without route fields', () => {
    const contract = buildInterpolatorWriterPromptContract(input());
    const payload = JSON.parse(contract.fixturePayloadJson) as Record<string, unknown>;

    expect(contract.fixturePayloadJson).not.toContain('\n');
    expect(payload.fixtureId).toBe('fixture-thread-1');
    expect(payload.title).toBe('prompt contract fixture');
    expect(payload.allowedEntities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'user:alice.example', required: true }),
    ]));
    expect(payload).not.toHaveProperty('provider');
    expect(payload).not.toHaveProperty('route');
    expect(payload).not.toHaveProperty('remote');
  });

  it('escapes fixture IDs before embedding them in instruction text', () => {
    const fixtureId = 'fixture\nwith\rbreak\u2028and "quotes"';
    const contract = buildInterpolatorWriterPromptContract(input({
      fixture: fixture({ id: fixtureId }),
    }));

    const fixtureInstruction = contract.instruction
      .split('\n')
      .find((line) => line.startsWith('Use fixtureId exactly'));

    expect(contract.outputJsonSchema.properties.fixtureId.const).toBe(fixtureId);
    expect(fixtureInstruction).toBe('Use fixtureId exactly as this JSON string value: "fixture\\nwith\\rbreak\\u2028and \\"quotes\\"".');
    expect(contract.instruction).not.toContain('fixture\nwith');
    expect(contract.instruction).not.toContain('with\rbreak');
    expect(contract.instruction).not.toContain('\u2028');
  });

  it('emits mode-specific reason codes', () => {
    expect(buildInterpolatorWriterPromptContract(input({ mode: 'normal' })).reasonCodes).toContain('writer_prompt_mode_normal');
    expect(buildInterpolatorWriterPromptContract(input({ mode: 'descriptive_fallback' })).reasonCodes).toContain('writer_prompt_mode_descriptive');
    expect(buildInterpolatorWriterPromptContract(input({ mode: 'minimal_fallback' })).reasonCodes).toContain('writer_prompt_mode_minimal');
  });

  it('emits retry-specific reason codes', () => {
    expect(buildInterpolatorWriterPromptContract(input({ retryInstruction: 'stricter_schema' })).reasonCodes).toContain('writer_prompt_retry_schema');
    expect(buildInterpolatorWriterPromptContract(input({ retryInstruction: 'stricter_grounding' })).reasonCodes).toContain('writer_prompt_retry_grounding');
  });

  it('sanitizes max text characters in policy and instruction', () => {
    expect(buildInterpolatorWriterPromptContract(input()).policy.maxTextChars).toBe(8000);

    const bounded = buildInterpolatorWriterPromptContract(input({ maxTextChars: 123.9 }));
    expect(bounded.policy.maxTextChars).toBe(123);
    expect(bounded.instruction).toContain('123 characters');

    expect(buildInterpolatorWriterPromptContract(input({ maxTextChars: -10 })).policy.maxTextChars).toBe(1);
  });
});
