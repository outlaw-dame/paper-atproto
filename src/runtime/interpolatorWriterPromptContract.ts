import type {
  InterpolatorWriterEvalFixture,
  InterpolatorWriterThinkingMode,
} from './interpolatorWriterEvalContract';
import type { InterpolatorWriterMode } from './interpolatorWriterRoutingPolicy';

export const INTERPOLATOR_WRITER_PROMPT_CONTRACT_VERSION = 1 as const;
export const RAW_INTERPOLATOR_WRITER_OUTPUT_SCHEMA_VERSION = 1 as const;

export type InterpolatorWriterRetryInstruction =
  | 'none'
  | 'stricter_schema'
  | 'stricter_grounding'
  | 'thinking_disabled';

export type InterpolatorWriterPromptReasonCode =
  | 'writer_prompt_contract_built'
  | 'writer_prompt_mode_normal'
  | 'writer_prompt_mode_descriptive'
  | 'writer_prompt_mode_minimal'
  | 'writer_prompt_retry_schema'
  | 'writer_prompt_retry_grounding'
  | 'writer_prompt_retry_thinking_disabled'
  | 'writer_prompt_assisted_mode_allowed'
  | 'writer_prompt_assisted_mode_disallowed';

type OutputKey =
  | 'schemaVersion'
  | 'fixtureId'
  | 'text'
  | 'usedEntityIds'
  | 'usedClaimIds'
  | 'citedEvidenceIds'
  | 'selfReportedQuality';

export interface InterpolatorWriterPromptContractInput {
  fixture: InterpolatorWriterEvalFixture;
  mode: InterpolatorWriterMode;
  thinkingMode: InterpolatorWriterThinkingMode;
  retryInstruction?: InterpolatorWriterRetryInstruction | undefined;
  maxTextChars?: number | undefined;
}

export interface JsonSchemaLikeProperty {
  type: 'string' | 'number' | 'integer' | 'array';
  const?: string | number;
  minimum?: number;
  maximum?: number;
  items?: { type: 'string' };
}

export interface RawInterpolatorWriterOutputJsonSchema {
  type: 'object';
  additionalProperties: false;
  required: readonly OutputKey[];
  properties: Record<OutputKey, JsonSchemaLikeProperty>;
}

export interface InterpolatorWriterPromptContractPolicy {
  role: 'interpolator_writer';
  outputSchemaVersion: typeof RAW_INTERPOLATOR_WRITER_OUTPUT_SCHEMA_VERSION;
  requireJsonOnly: true;
  fixtureId: string;
  maxTextChars: number;
  allowedEntityIds: string[];
  allowedClaimIds: string[];
  allowedEvidenceIds: string[];
  requiredEntityIds: string[];
  requiredClaimIds: string[];
  requiredEvidenceIds: string[];
  callerOwnsProviderMetadata: true;
}

export interface InterpolatorWriterPromptContract {
  schemaVersion: typeof INTERPOLATOR_WRITER_PROMPT_CONTRACT_VERSION;
  instruction: string;
  fixturePayloadJson: string;
  outputJsonSchema: RawInterpolatorWriterOutputJsonSchema;
  requiredOutputKeys: readonly OutputKey[];
  policy: InterpolatorWriterPromptContractPolicy;
  reasonCodes: InterpolatorWriterPromptReasonCode[];
}

const DEFAULT_MAX_TEXT_CHARS = 8_000;

const REQUIRED_OUTPUT_KEYS = [
  'schemaVersion',
  'fixtureId',
  'text',
  'usedEntityIds',
  'usedClaimIds',
  'citedEvidenceIds',
  'selfReportedQuality',
] as const satisfies readonly OutputKey[];

export const RAW_INTERPOLATOR_WRITER_OUTPUT_JSON_SCHEMA: RawInterpolatorWriterOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: REQUIRED_OUTPUT_KEYS,
  properties: {
    schemaVersion: { type: 'integer', const: RAW_INTERPOLATOR_WRITER_OUTPUT_SCHEMA_VERSION },
    fixtureId: { type: 'string' },
    text: { type: 'string' },
    usedEntityIds: { type: 'array', items: { type: 'string' } },
    usedClaimIds: { type: 'array', items: { type: 'string' } },
    citedEvidenceIds: { type: 'array', items: { type: 'string' } },
    selfReportedQuality: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export function buildInterpolatorWriterPromptContract(
  input: InterpolatorWriterPromptContractInput,
): InterpolatorWriterPromptContract {
  const retryInstruction = input.retryInstruction ?? 'none';
  const maxTextChars = sanitizeMaxTextChars(input.maxTextChars);
  const policy = buildPolicy(input.fixture, maxTextChars);

  return {
    schemaVersion: INTERPOLATOR_WRITER_PROMPT_CONTRACT_VERSION,
    instruction: buildInstruction(input.fixture, input.mode, input.thinkingMode, retryInstruction, maxTextChars),
    fixturePayloadJson: JSON.stringify(buildFixturePayload(input.fixture), null, 2),
    outputJsonSchema: RAW_INTERPOLATOR_WRITER_OUTPUT_JSON_SCHEMA,
    requiredOutputKeys: REQUIRED_OUTPUT_KEYS,
    policy,
    reasonCodes: buildReasonCodes(input.mode, input.thinkingMode, input.fixture, retryInstruction),
  };
}

function buildPolicy(
  fixture: InterpolatorWriterEvalFixture,
  maxTextChars: number,
): InterpolatorWriterPromptContractPolicy {
  return {
    role: 'interpolator_writer',
    outputSchemaVersion: RAW_INTERPOLATOR_WRITER_OUTPUT_SCHEMA_VERSION,
    requireJsonOnly: true,
    fixtureId: fixture.id,
    maxTextChars,
    allowedEntityIds: fixture.allowedEntities.map((entity) => entity.id),
    allowedClaimIds: fixture.allowedClaims.map((claim) => claim.id),
    allowedEvidenceIds: fixture.allowedEvidence.map((evidence) => evidence.id),
    requiredEntityIds: fixture.allowedEntities.filter((entity) => entity.required).map((entity) => entity.id),
    requiredClaimIds: fixture.allowedClaims.filter((claim) => claim.required).map((claim) => claim.id),
    requiredEvidenceIds: fixture.allowedEvidence.filter((evidence) => evidence.required).map((evidence) => evidence.id),
    callerOwnsProviderMetadata: true,
  };
}

function buildInstruction(
  fixture: InterpolatorWriterEvalFixture,
  mode: InterpolatorWriterMode,
  thinkingMode: InterpolatorWriterThinkingMode,
  retryInstruction: InterpolatorWriterRetryInstruction,
  maxTextChars: number,
): string {
  return [
    'Role: Interpolator Writer.',
    'Return exactly one JSON object with the required keys.',
    'Be accurate, helpful, and careful.',
    'Do not drift from the supplied fixture.',
    'Use only supplied entity IDs, claim IDs, and evidence IDs.',
    'Do not invent entities, users, claims, evidence, sources, facts, or relationships.',
    'Do not include text outside the JSON object.',
    'Provider and route metadata are caller-owned and must not be included.',
    `Use fixtureId exactly: ${fixture.id}.`,
    `Keep text at or below ${maxTextChars} characters.`,
    getModeInstruction(mode),
    getAssistedModeInstruction(thinkingMode, fixture),
    getRetryInstruction(retryInstruction),
  ].join('\n');
}

function buildFixturePayload(fixture: InterpolatorWriterEvalFixture): unknown {
  return {
    schemaVersion: fixture.schemaVersion,
    fixtureId: fixture.id,
    mode: fixture.mode,
    title: fixture.title,
    allowedEntities: fixture.allowedEntities,
    allowedClaims: fixture.allowedClaims,
    allowedEvidence: fixture.allowedEvidence,
    policy: fixture.policy,
  };
}

function getModeInstruction(mode: InterpolatorWriterMode): string {
  switch (mode) {
    case 'normal':
      return 'Mode: normal. Produce the clearest useful grounded text.';
    case 'descriptive_fallback':
      return 'Mode: descriptive_fallback. Be cautious and descriptive.';
    case 'minimal_fallback':
      return 'Mode: minimal_fallback. Produce the smallest useful grounded text.';
  }
}

function getAssistedModeInstruction(
  thinkingMode: InterpolatorWriterThinkingMode,
  fixture: InterpolatorWriterEvalFixture,
): string {
  if (thinkingMode === 'provider_hidden' && fixture.policy.allowProviderHiddenThinking) {
    return 'Provider-assisted mode may be used only when supported; output remains JSON only.';
  }

  return 'Provider-assisted mode is not enabled; output remains JSON only.';
}

function getRetryInstruction(retryInstruction: InterpolatorWriterRetryInstruction): string {
  switch (retryInstruction) {
    case 'none':
      return 'Retry: none. Follow the base contract exactly.';
    case 'stricter_schema':
      return 'Retry: stricter_schema. Prioritize valid JSON shape and required keys.';
    case 'stricter_grounding':
      return 'Retry: stricter_grounding. Use fewer claims if needed; every used claim must use supplied evidence IDs.';
    case 'thinking_disabled':
      return 'Retry: thinking_disabled. Do not use provider-assisted mode.';
  }
}

function buildReasonCodes(
  mode: InterpolatorWriterMode,
  thinkingMode: InterpolatorWriterThinkingMode,
  fixture: InterpolatorWriterEvalFixture,
  retryInstruction: InterpolatorWriterRetryInstruction,
): InterpolatorWriterPromptReasonCode[] {
  const reasonCodes: InterpolatorWriterPromptReasonCode[] = ['writer_prompt_contract_built'];

  if (mode === 'normal') reasonCodes.push('writer_prompt_mode_normal');
  if (mode === 'descriptive_fallback') reasonCodes.push('writer_prompt_mode_descriptive');
  if (mode === 'minimal_fallback') reasonCodes.push('writer_prompt_mode_minimal');

  if (retryInstruction === 'stricter_schema') reasonCodes.push('writer_prompt_retry_schema');
  if (retryInstruction === 'stricter_grounding') reasonCodes.push('writer_prompt_retry_grounding');
  if (retryInstruction === 'thinking_disabled') reasonCodes.push('writer_prompt_retry_thinking_disabled');

  reasonCodes.push(
    thinkingMode === 'provider_hidden' && fixture.policy.allowProviderHiddenThinking
      ? 'writer_prompt_assisted_mode_allowed'
      : 'writer_prompt_assisted_mode_disallowed',
  );

  return reasonCodes;
}

function sanitizeMaxTextChars(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_TEXT_CHARS;
  return Math.max(1, Math.floor(value));
}
