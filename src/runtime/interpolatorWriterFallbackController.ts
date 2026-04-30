import type { InterpolatorWriterEvalViolationCode } from './interpolatorWriterEvalContract';
import type { InterpolatorWriterExecutionResult } from './interpolatorWriterExecutionFinalizer';
import { unique } from './interpolatorWriterRoutingPolicy';

export const INTERPOLATOR_WRITER_FALLBACK_CONTROLLER_VERSION = 1 as const;

export type InterpolatorWriterFallbackAction =
  | 'continue'
  | 'retry_with_stricter_schema'
  | 'retry_with_stricter_grounding'
  | 'disable_thinking_and_retry'
  | 'fallback_to_descriptive'
  | 'fallback_to_minimal'
  | 'fallback_to_deterministic_projection'
  | 'human_review_required';

export type InterpolatorWriterFallbackReasonCode =
  | 'writer_accepted'
  | 'schema_rejected_retry_available'
  | 'schema_rejected_retry_exhausted'
  | 'empty_output_retry_available'
  | 'empty_output_retry_exhausted'
  | 'fixture_mismatch_no_retry'
  | 'thinking_policy_retry_available'
  | 'thinking_policy_retry_exhausted'
  | 'grounding_retry_available'
  | 'grounding_retry_exhausted'
  | 'unknown_failure_review_required'
  | 'unknown_failure_deterministic_fallback'
  | 'retry_budget_available'
  | 'retry_budget_exhausted';

export interface InterpolatorWriterFallbackControllerOptions {
  execution: InterpolatorWriterExecutionResult;
  previousAttempts: number;
  maxRetries: number;
  allowHumanReview?: boolean;
}

export interface InterpolatorWriterFallbackDecision {
  schemaVersion: typeof INTERPOLATOR_WRITER_FALLBACK_CONTROLLER_VERSION;
  action: InterpolatorWriterFallbackAction;
  retryAllowed: boolean;
  nextAttempt: number | null;
  final: boolean;
  reasonCodes: InterpolatorWriterFallbackReasonCode[];
  diagnostics: {
    executionStatus: InterpolatorWriterExecutionResult['status'];
    adapterStatus: InterpolatorWriterExecutionResult['adaptedOutput']['status'];
    previousAttempts: number;
    maxRetries: number;
    remainingRetries: number;
    violationCodes: InterpolatorWriterEvalViolationCode[];
  };
}

const MAX_SAFE_RETRIES = 2;

const SCHEMA_VIOLATIONS = new Set<InterpolatorWriterEvalViolationCode>([
  'missing_output_text',
  'quality_score_out_of_range',
]);

const GROUNDING_VIOLATIONS = new Set<InterpolatorWriterEvalViolationCode>([
  'invented_entity_id',
  'unsupported_claim_id',
  'uncited_claim_id',
  'unsupported_evidence_id',
]);

export function selectInterpolatorWriterFallback(
  options: InterpolatorWriterFallbackControllerOptions,
): InterpolatorWriterFallbackDecision {
  const previousAttempts = sanitizeAttempts(options.previousAttempts);
  const maxRetries = sanitizeMaxRetries(options.maxRetries);
  const remainingRetries = Math.max(0, maxRetries - previousAttempts);
  const retryAvailable = remainingRetries > 0;
  const violationCodes = unique(options.execution.adaptedOutput.evalResult.violations.map((violation) => violation.code));
  const baseDiagnostics = {
    executionStatus: options.execution.status,
    adapterStatus: options.execution.adaptedOutput.status,
    previousAttempts,
    maxRetries,
    remainingRetries,
    violationCodes,
  };

  if (options.execution.status === 'accepted') {
    return buildDecision({
      action: 'continue',
      retryAllowed: false,
      final: true,
      reasonCodes: ['writer_accepted'],
      diagnostics: baseDiagnostics,
    });
  }

  if (violationCodes.includes('fixture_id_mismatch')) {
    return buildDecision({
      action: 'fallback_to_deterministic_projection',
      retryAllowed: false,
      final: true,
      reasonCodes: ['fixture_mismatch_no_retry'],
      diagnostics: baseDiagnostics,
    });
  }

  if (violationCodes.includes('forbidden_thinking_disclosure')) {
    return retryAvailable
      ? buildDecision({
        action: 'disable_thinking_and_retry',
        retryAllowed: true,
        final: false,
        reasonCodes: ['thinking_policy_retry_available', 'retry_budget_available'],
        diagnostics: baseDiagnostics,
      })
      : buildDecision({
        action: 'fallback_to_descriptive',
        retryAllowed: false,
        final: true,
        reasonCodes: ['thinking_policy_retry_exhausted', 'retry_budget_exhausted'],
        diagnostics: baseDiagnostics,
      });
  }

  if (options.execution.adaptedOutput.status === 'schema_rejected' || hasAnyViolation(violationCodes, SCHEMA_VIOLATIONS)) {
    const emptyOutput = violationCodes.includes('missing_output_text');
    return retryAvailable
      ? buildDecision({
        action: 'retry_with_stricter_schema',
        retryAllowed: true,
        final: false,
        reasonCodes: [
          emptyOutput ? 'empty_output_retry_available' : 'schema_rejected_retry_available',
          'retry_budget_available',
        ],
        diagnostics: baseDiagnostics,
      })
      : buildDecision({
        action: 'fallback_to_minimal',
        retryAllowed: false,
        final: true,
        reasonCodes: [
          emptyOutput ? 'empty_output_retry_exhausted' : 'schema_rejected_retry_exhausted',
          'retry_budget_exhausted',
        ],
        diagnostics: baseDiagnostics,
      });
  }

  if (hasAnyViolation(violationCodes, GROUNDING_VIOLATIONS)) {
    return retryAvailable
      ? buildDecision({
        action: 'retry_with_stricter_grounding',
        retryAllowed: true,
        final: false,
        reasonCodes: ['grounding_retry_available', 'retry_budget_available'],
        diagnostics: baseDiagnostics,
      })
      : buildDecision({
        action: 'fallback_to_descriptive',
        retryAllowed: false,
        final: true,
        reasonCodes: ['grounding_retry_exhausted', 'retry_budget_exhausted'],
        diagnostics: baseDiagnostics,
      });
  }

  if (options.allowHumanReview === true) {
    return buildDecision({
      action: 'human_review_required',
      retryAllowed: false,
      final: true,
      reasonCodes: ['unknown_failure_review_required'],
      diagnostics: baseDiagnostics,
    });
  }

  return buildDecision({
    action: 'fallback_to_deterministic_projection',
    retryAllowed: false,
    final: true,
    reasonCodes: ['unknown_failure_deterministic_fallback'],
    diagnostics: baseDiagnostics,
  });
}

function buildDecision(params: Omit<InterpolatorWriterFallbackDecision, 'schemaVersion' | 'nextAttempt'>): InterpolatorWriterFallbackDecision {
  return {
    schemaVersion: INTERPOLATOR_WRITER_FALLBACK_CONTROLLER_VERSION,
    ...params,
    nextAttempt: params.retryAllowed ? params.diagnostics.previousAttempts + 1 : null,
    reasonCodes: unique(params.reasonCodes),
  };
}

function hasAnyViolation(
  violationCodes: readonly InterpolatorWriterEvalViolationCode[],
  target: ReadonlySet<InterpolatorWriterEvalViolationCode>,
): boolean {
  return violationCodes.some((code) => target.has(code));
}

function sanitizeAttempts(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function sanitizeMaxRetries(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_SAFE_RETRIES, Math.floor(value)));
}
