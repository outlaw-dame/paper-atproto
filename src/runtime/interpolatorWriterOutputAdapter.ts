import type {
  InterpolatorWriterEvalCandidateOutput,
  InterpolatorWriterEvalFixture,
  InterpolatorWriterEvalResult,
  InterpolatorWriterThinkingMode,
} from './interpolatorWriterEvalContract';
import { evaluateInterpolatorWriterOutput } from './interpolatorWriterEvalContract';
import type { InterpolatorWriterRouteCandidate } from './interpolatorWriterRoutingPolicy';

export const INTERPOLATOR_WRITER_OUTPUT_ADAPTER_VERSION = 1 as const;

export type InterpolatorWriterOutputAdapterStatus =
  | 'accepted'
  | 'schema_rejected'
  | 'contract_rejected';

export type InterpolatorWriterOutputAdapterReasonCode =
  | 'writer_output_accepted'
  | 'writer_output_schema_rejected'
  | 'writer_output_contract_rejected'
  | 'writer_output_fallback_candidate_created'
  | 'writer_output_fixture_id_mismatch'
  | 'writer_output_text_trimmed'
  | 'writer_output_control_chars_removed'
  | 'writer_output_duplicate_reference_ids_removed'
  | 'writer_output_invalid_reference_ids_dropped'
  | 'writer_output_reference_ids_truncated';

export interface InterpolatorWriterOutputAdapterOptions {
  fixture: InterpolatorWriterEvalFixture;
  rawOutput: unknown;
  route: Pick<InterpolatorWriterRouteCandidate, 'provider' | 'executionClass' | 'remote' | 'requiresExplicitConsent'>;
  thinkingMode: InterpolatorWriterThinkingMode;
  latencyMs: number | null;
  outputTokens: number | null;
  maxTextChars?: number;
  maxReferenceIds?: number;
}

export interface InterpolatorWriterOutputAdapterResult {
  schemaVersion: typeof INTERPOLATOR_WRITER_OUTPUT_ADAPTER_VERSION;
  status: InterpolatorWriterOutputAdapterStatus;
  candidateOutput: InterpolatorWriterEvalCandidateOutput;
  evalResult: InterpolatorWriterEvalResult;
  reasonCodes: InterpolatorWriterOutputAdapterReasonCode[];
  diagnostics: {
    schemaAccepted: boolean;
    contractAccepted: boolean;
    trustedProvider: InterpolatorWriterRouteCandidate['provider'];
    trustedExecutionClass: InterpolatorWriterRouteCandidate['executionClass'];
    remote: boolean;
    requiresExplicitConsent: boolean;
  };
}

interface ParsedRawWriterOutput {
  fixtureId: string;
  text: string;
  usedEntityIds: unknown[];
  usedClaimIds: unknown[];
  citedEvidenceIds: unknown[];
  selfReportedQuality: number;
}

interface ParseFailure {
  ok: false;
  reasonCode: 'writer_output_schema_rejected';
}

interface ParseSuccess {
  ok: true;
  value: ParsedRawWriterOutput;
}

type ParseResult = ParseFailure | ParseSuccess;

const RAW_WRITER_OUTPUT_SCHEMA_VERSION = 1;
const DEFAULT_MAX_TEXT_CHARS = 8_000;
const DEFAULT_MAX_REFERENCE_IDS = 128;
const MAX_REFERENCE_ID_CHARS = 256;

export function adaptInterpolatorWriterOutput(
  options: InterpolatorWriterOutputAdapterOptions,
): InterpolatorWriterOutputAdapterResult {
  const maxTextChars = sanitizePositiveInteger(options.maxTextChars, DEFAULT_MAX_TEXT_CHARS);
  const maxReferenceIds = sanitizePositiveInteger(options.maxReferenceIds, DEFAULT_MAX_REFERENCE_IDS);
  const parseResult = parseRawWriterOutput(options.rawOutput);

  if (!parseResult.ok) {
    const candidateOutput = buildRejectedCandidateOutput(options);
    const evalResult = evaluateInterpolatorWriterOutput(options.fixture, candidateOutput);

    return {
      schemaVersion: INTERPOLATOR_WRITER_OUTPUT_ADAPTER_VERSION,
      status: 'schema_rejected',
      candidateOutput,
      evalResult,
      reasonCodes: ['writer_output_schema_rejected', 'writer_output_fallback_candidate_created'],
      diagnostics: buildDiagnostics(options, false, false),
    };
  }

  const reasonCodes: InterpolatorWriterOutputAdapterReasonCode[] = [];
  const text = normalizeText(parseResult.value.text, maxTextChars, reasonCodes);

  if (text.length === 0) {
    const candidateOutput = buildRejectedCandidateOutput(options);
    const evalResult = evaluateInterpolatorWriterOutput(options.fixture, candidateOutput);

    return {
      schemaVersion: INTERPOLATOR_WRITER_OUTPUT_ADAPTER_VERSION,
      status: 'schema_rejected',
      candidateOutput,
      evalResult,
      reasonCodes: unique([
        ...reasonCodes,
        'writer_output_schema_rejected',
        'writer_output_fallback_candidate_created',
      ]),
      diagnostics: buildDiagnostics(options, false, false),
    };
  }

  const usedEntityIds = normalizeReferenceIds(parseResult.value.usedEntityIds, maxReferenceIds, reasonCodes);
  const usedClaimIds = normalizeReferenceIds(parseResult.value.usedClaimIds, maxReferenceIds, reasonCodes);
  const citedEvidenceIds = normalizeReferenceIds(parseResult.value.citedEvidenceIds, maxReferenceIds, reasonCodes);

  const candidateOutput: InterpolatorWriterEvalCandidateOutput = {
    schemaVersion: 1,
    fixtureId: parseResult.value.fixtureId.trim(),
    provider: options.route.provider,
    route: {
      provider: options.route.provider,
      executionClass: options.route.executionClass,
      remote: options.route.remote,
      requiresExplicitConsent: options.route.requiresExplicitConsent,
    },
    thinkingMode: options.thinkingMode,
    text,
    usedEntityIds,
    usedClaimIds,
    citedEvidenceIds,
    selfReportedQuality: parseResult.value.selfReportedQuality,
    latencyMs: sanitizeNullableNonNegativeNumber(options.latencyMs),
    outputTokens: sanitizeNullableNonNegativeNumber(options.outputTokens),
  };

  const evalResult = evaluateInterpolatorWriterOutput(options.fixture, candidateOutput);
  const accepted = evalResult.passed;

  return {
    schemaVersion: INTERPOLATOR_WRITER_OUTPUT_ADAPTER_VERSION,
    status: accepted ? 'accepted' : 'contract_rejected',
    candidateOutput,
    evalResult,
    reasonCodes: unique([
      ...reasonCodes,
      accepted ? 'writer_output_accepted' : 'writer_output_contract_rejected',
      ...(candidateOutput.fixtureId !== options.fixture.id ? ['writer_output_fixture_id_mismatch' as const] : []),
    ]),
    diagnostics: buildDiagnostics(options, true, accepted),
  };
}

function parseRawWriterOutput(rawOutput: unknown): ParseResult {
  if (!isRecord(rawOutput)) return { ok: false, reasonCode: 'writer_output_schema_rejected' };
  if (rawOutput.schemaVersion !== RAW_WRITER_OUTPUT_SCHEMA_VERSION) return { ok: false, reasonCode: 'writer_output_schema_rejected' };
  if (typeof rawOutput.fixtureId !== 'string' || rawOutput.fixtureId.trim().length === 0) return { ok: false, reasonCode: 'writer_output_schema_rejected' };
  if (typeof rawOutput.text !== 'string') return { ok: false, reasonCode: 'writer_output_schema_rejected' };
  if (!Array.isArray(rawOutput.usedEntityIds)) return { ok: false, reasonCode: 'writer_output_schema_rejected' };
  if (!Array.isArray(rawOutput.usedClaimIds)) return { ok: false, reasonCode: 'writer_output_schema_rejected' };
  if (!Array.isArray(rawOutput.citedEvidenceIds)) return { ok: false, reasonCode: 'writer_output_schema_rejected' };
  if (typeof rawOutput.selfReportedQuality !== 'number' || !Number.isFinite(rawOutput.selfReportedQuality)) return { ok: false, reasonCode: 'writer_output_schema_rejected' };
  if (rawOutput.selfReportedQuality < 0 || rawOutput.selfReportedQuality > 1) return { ok: false, reasonCode: 'writer_output_schema_rejected' };

  return {
    ok: true,
    value: {
      fixtureId: rawOutput.fixtureId,
      text: rawOutput.text,
      usedEntityIds: rawOutput.usedEntityIds,
      usedClaimIds: rawOutput.usedClaimIds,
      citedEvidenceIds: rawOutput.citedEvidenceIds,
      selfReportedQuality: rawOutput.selfReportedQuality,
    },
  };
}

function buildRejectedCandidateOutput(
  options: InterpolatorWriterOutputAdapterOptions,
): InterpolatorWriterEvalCandidateOutput {
  return {
    schemaVersion: 1,
    fixtureId: options.fixture.id,
    provider: options.route.provider,
    route: {
      provider: options.route.provider,
      executionClass: options.route.executionClass,
      remote: options.route.remote,
      requiresExplicitConsent: options.route.requiresExplicitConsent,
    },
    thinkingMode: options.thinkingMode,
    text: '',
    usedEntityIds: [],
    usedClaimIds: [],
    citedEvidenceIds: [],
    selfReportedQuality: 0,
    latencyMs: sanitizeNullableNonNegativeNumber(options.latencyMs),
    outputTokens: sanitizeNullableNonNegativeNumber(options.outputTokens),
  };
}

function buildDiagnostics(
  options: InterpolatorWriterOutputAdapterOptions,
  schemaAccepted: boolean,
  contractAccepted: boolean,
): InterpolatorWriterOutputAdapterResult['diagnostics'] {
  return {
    schemaAccepted,
    contractAccepted,
    trustedProvider: options.route.provider,
    trustedExecutionClass: options.route.executionClass,
    remote: options.route.remote,
    requiresExplicitConsent: options.route.requiresExplicitConsent,
  };
}

function normalizeText(
  value: string,
  maxTextChars: number,
  reasonCodes: InterpolatorWriterOutputAdapterReasonCode[],
): string {
  const withoutNulls = value.replace(/\u0000/g, '');
  if (withoutNulls.length !== value.length) reasonCodes.push('writer_output_control_chars_removed');

  const normalizedNewlines = withoutNulls.replace(/\r\n?/g, '\n');
  const trimmed = normalizedNewlines.trim();
  if (trimmed.length <= maxTextChars) return trimmed;

  reasonCodes.push('writer_output_text_trimmed');
  return trimmed.slice(0, maxTextChars).trimEnd();
}

function normalizeReferenceIds(
  values: readonly unknown[],
  maxReferenceIds: number,
  reasonCodes: InterpolatorWriterOutputAdapterReasonCode[],
): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (normalized.length >= maxReferenceIds) {
      reasonCodes.push('writer_output_reference_ids_truncated');
      break;
    }

    if (typeof value !== 'string') {
      reasonCodes.push('writer_output_invalid_reference_ids_dropped');
      continue;
    }

    const referenceId = value.trim();
    if (referenceId.length === 0 || referenceId.length > MAX_REFERENCE_ID_CHARS) {
      reasonCodes.push('writer_output_invalid_reference_ids_dropped');
      continue;
    }

    if (seen.has(referenceId)) {
      reasonCodes.push('writer_output_duplicate_reference_ids_removed');
      continue;
    }

    seen.add(referenceId);
    normalized.push(referenceId);
  }

  return normalized;
}

function sanitizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function sanitizeNullableNonNegativeNumber(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  return Math.max(0, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
