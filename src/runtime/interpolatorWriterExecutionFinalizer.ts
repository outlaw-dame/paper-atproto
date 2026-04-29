import type {
  InterpolatorWriterEvalFixture,
  InterpolatorWriterThinkingMode,
} from './interpolatorWriterEvalContract';
import type {
  InterpolatorWriterOutputAdapterOptions,
  InterpolatorWriterOutputAdapterReasonCode,
  InterpolatorWriterOutputAdapterResult,
} from './interpolatorWriterOutputAdapter';
import { adaptInterpolatorWriterOutput } from './interpolatorWriterOutputAdapter';
import type { InterpolatorWriterRouteCandidate } from './interpolatorWriterRoutingPolicy';

export const INTERPOLATOR_WRITER_EXECUTION_FINALIZER_VERSION = 1 as const;

export type InterpolatorWriterExecutionStatus = 'accepted' | 'fallback_required';

export type InterpolatorWriterExecutionReasonCode =
  | InterpolatorWriterOutputAdapterReasonCode
  | 'writer_execution_accepted'
  | 'writer_execution_fallback_required'
  | 'writer_execution_schema_rejected'
  | 'writer_execution_contract_rejected';

export interface InterpolatorWriterExecutionFinalizerOptions {
  fixture: InterpolatorWriterEvalFixture;
  rawOutput: unknown;
  route: Pick<InterpolatorWriterRouteCandidate, 'provider' | 'executionClass' | 'remote' | 'requiresExplicitConsent'>;
  thinkingMode: InterpolatorWriterThinkingMode;
  latencyMs: number | null;
  outputTokens: number | null;
  maxTextChars?: number | undefined;
  maxReferenceIds?: number | undefined;
}

export interface InterpolatorWriterExecutionResult {
  schemaVersion: typeof INTERPOLATOR_WRITER_EXECUTION_FINALIZER_VERSION;
  status: InterpolatorWriterExecutionStatus;
  acceptedText: string | null;
  adaptedOutput: InterpolatorWriterOutputAdapterResult;
  reasonCodes: InterpolatorWriterExecutionReasonCode[];
  diagnostics: {
    schemaAccepted: boolean;
    contractAccepted: boolean;
    trustedProvider: InterpolatorWriterRouteCandidate['provider'];
    trustedExecutionClass: InterpolatorWriterRouteCandidate['executionClass'];
    remote: boolean;
    requiresExplicitConsent: boolean;
    fallbackRequired: boolean;
  };
}

export function finalizeInterpolatorWriterCandidate(
  options: InterpolatorWriterExecutionFinalizerOptions,
): InterpolatorWriterExecutionResult {
  const adaptedOutput = adaptInterpolatorWriterOutput(buildAdapterOptions(options));
  const accepted = adaptedOutput.status === 'accepted';

  return {
    schemaVersion: INTERPOLATOR_WRITER_EXECUTION_FINALIZER_VERSION,
    status: accepted ? 'accepted' : 'fallback_required',
    acceptedText: accepted ? adaptedOutput.candidateOutput.text : null,
    adaptedOutput,
    reasonCodes: unique([
      ...adaptedOutput.reasonCodes,
      accepted ? 'writer_execution_accepted' : 'writer_execution_fallback_required',
      ...(adaptedOutput.status === 'schema_rejected' ? ['writer_execution_schema_rejected' as const] : []),
      ...(adaptedOutput.status === 'contract_rejected' ? ['writer_execution_contract_rejected' as const] : []),
    ]),
    diagnostics: {
      schemaAccepted: adaptedOutput.diagnostics.schemaAccepted,
      contractAccepted: adaptedOutput.diagnostics.contractAccepted,
      trustedProvider: adaptedOutput.diagnostics.trustedProvider,
      trustedExecutionClass: adaptedOutput.diagnostics.trustedExecutionClass,
      remote: adaptedOutput.diagnostics.remote,
      requiresExplicitConsent: adaptedOutput.diagnostics.requiresExplicitConsent,
      fallbackRequired: !accepted,
    },
  };
}

function buildAdapterOptions(
  options: InterpolatorWriterExecutionFinalizerOptions,
): InterpolatorWriterOutputAdapterOptions {
  return {
    fixture: options.fixture,
    rawOutput: options.rawOutput,
    route: options.route,
    thinkingMode: options.thinkingMode,
    latencyMs: options.latencyMs,
    outputTokens: options.outputTokens,
    maxTextChars: options.maxTextChars,
    maxReferenceIds: options.maxReferenceIds,
  };
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
