import type {
  InterpolatorWriterMode,
  InterpolatorWriterProviderId,
  InterpolatorWriterRouteCandidate,
} from './interpolatorWriterRoutingPolicy';

export const INTERPOLATOR_WRITER_EVAL_CONTRACT_VERSION = 1 as const;

export type InterpolatorWriterThinkingMode = 'off' | 'provider_hidden' | 'explicit_scratchpad_forbidden';

export type InterpolatorWriterEvalSeverity = 'info' | 'warning' | 'error';

export type InterpolatorWriterEvalViolationCode =
  | 'fixture_id_mismatch'
  | 'invented_entity_id'
  | 'missing_required_entity_id'
  | 'unsupported_claim_id'
  | 'uncited_claim_id'
  | 'unsupported_evidence_id'
  | 'forbidden_thinking_disclosure'
  | 'missing_output_text'
  | 'quality_score_out_of_range';

export interface InterpolatorWriterEvalEntity {
  id: string;
  label: string;
  source: 'post_author' | 'reply_author' | 'mention' | 'wikidata' | 'dbpedia' | 'source_document' | 'media_observation' | 'verified_external_source';
  required: boolean;
}

export interface InterpolatorWriterEvalClaim {
  id: string;
  evidenceIds: string[];
  required: boolean;
}

export interface InterpolatorWriterEvalEvidence {
  id: string;
  sourceType: 'post' | 'reply' | 'quote' | 'media_observation' | 'wikidata' | 'dbpedia' | 'fact_check' | 'external_source';
  required: boolean;
}

export interface InterpolatorWriterEvalFixture {
  schemaVersion: typeof INTERPOLATOR_WRITER_EVAL_CONTRACT_VERSION;
  id: string;
  mode: InterpolatorWriterMode;
  title: string;
  allowedEntities: InterpolatorWriterEvalEntity[];
  allowedClaims: InterpolatorWriterEvalClaim[];
  allowedEvidence: InterpolatorWriterEvalEvidence[];
  policy: {
    allowProviderHiddenThinking: boolean;
    requireClaimEvidence: boolean;
    requireRequiredEntityCoverage: boolean;
    maxUnsupportedClaims: number;
    maxInventedEntities: number;
  };
}

export interface InterpolatorWriterEvalCandidateOutput {
  schemaVersion: typeof INTERPOLATOR_WRITER_EVAL_CONTRACT_VERSION;
  fixtureId: string;
  provider: InterpolatorWriterProviderId;
  route: Pick<InterpolatorWriterRouteCandidate, 'provider' | 'executionClass' | 'remote' | 'requiresExplicitConsent'>;
  thinkingMode: InterpolatorWriterThinkingMode;
  text: string;
  usedEntityIds: string[];
  usedClaimIds: string[];
  citedEvidenceIds: string[];
  selfReportedQuality: number;
  latencyMs: number | null;
  outputTokens: number | null;
}

export interface InterpolatorWriterEvalViolation {
  code: InterpolatorWriterEvalViolationCode;
  severity: InterpolatorWriterEvalSeverity;
  message: string;
  id?: string;
}

export interface InterpolatorWriterEvalScores {
  entityPrecision: number;
  entityRecall: number;
  claimPrecision: number;
  evidenceCoverage: number;
  groundedness: number;
  quality: number;
  efficiency: number;
  finalScore: number;
}

export interface InterpolatorWriterEvalResult {
  schemaVersion: typeof INTERPOLATOR_WRITER_EVAL_CONTRACT_VERSION;
  fixtureId: string;
  provider: InterpolatorWriterProviderId;
  thinkingMode: InterpolatorWriterThinkingMode;
  passed: boolean;
  scores: InterpolatorWriterEvalScores;
  violations: InterpolatorWriterEvalViolation[];
}

const FORBIDDEN_THINKING_MARKERS = [
  '<scratchpad',
  '</scratchpad>',
  'chain of thought',
  'hidden reasoning',
  'my reasoning is',
  'step-by-step reasoning',
] as const;

export function evaluateInterpolatorWriterOutput(
  fixture: InterpolatorWriterEvalFixture,
  output: InterpolatorWriterEvalCandidateOutput,
): InterpolatorWriterEvalResult {
  const violations: InterpolatorWriterEvalViolation[] = [];
  const allowedEntityIds = new Set(fixture.allowedEntities.map((entity) => entity.id));
  const requiredEntityIds = new Set(fixture.allowedEntities.filter((entity) => entity.required).map((entity) => entity.id));
  const allowedClaimIds = new Set(fixture.allowedClaims.map((claim) => claim.id));
  const allowedEvidenceIds = new Set(fixture.allowedEvidence.map((evidence) => evidence.id));
  const requiredEvidenceIds = new Set(fixture.allowedEvidence.filter((evidence) => evidence.required).map((evidence) => evidence.id));
  const citedEvidenceIds = new Set(output.citedEvidenceIds);

  if (output.fixtureId !== fixture.id) {
    violations.push({
      code: 'fixture_id_mismatch',
      severity: 'error',
      message: `Writer output fixtureId ${output.fixtureId} does not match fixture ${fixture.id}.`,
      id: output.fixtureId,
    });
  }

  if (output.text.trim().length === 0) {
    violations.push({ code: 'missing_output_text', severity: 'error', message: 'Writer output text is empty.' });
  }

  if (!Number.isFinite(output.selfReportedQuality) || output.selfReportedQuality < 0 || output.selfReportedQuality > 1) {
    violations.push({ code: 'quality_score_out_of_range', severity: 'error', message: 'Self-reported quality must be between 0 and 1.' });
  }

  for (const entityId of unique(output.usedEntityIds)) {
    if (!allowedEntityIds.has(entityId)) {
      violations.push({ code: 'invented_entity_id', severity: 'error', message: `Writer used an entity not present in the fixture: ${entityId}`, id: entityId });
    }
  }

  if (fixture.policy.requireRequiredEntityCoverage) {
    for (const entityId of requiredEntityIds) {
      if (!output.usedEntityIds.includes(entityId)) {
        violations.push({ code: 'missing_required_entity_id', severity: 'warning', message: `Writer omitted a required fixture entity: ${entityId}`, id: entityId });
      }
    }
  }

  for (const claimId of unique(output.usedClaimIds)) {
    const claim = fixture.allowedClaims.find((candidate) => candidate.id === claimId);
    if (!claim || !allowedClaimIds.has(claimId)) {
      violations.push({ code: 'unsupported_claim_id', severity: 'error', message: `Writer used a claim not present in the fixture: ${claimId}`, id: claimId });
      continue;
    }
    if (fixture.policy.requireClaimEvidence && !claim.evidenceIds.some((evidenceId) => citedEvidenceIds.has(evidenceId))) {
      violations.push({ code: 'uncited_claim_id', severity: 'error', message: `Writer used a claim without citing any supporting evidence: ${claimId}`, id: claimId });
    }
  }

  for (const evidenceId of unique(output.citedEvidenceIds)) {
    if (!allowedEvidenceIds.has(evidenceId)) {
      violations.push({ code: 'unsupported_evidence_id', severity: 'error', message: `Writer cited evidence not present in the fixture: ${evidenceId}`, id: evidenceId });
    }
  }

  if (!fixture.policy.allowProviderHiddenThinking && output.thinkingMode !== 'off') {
    violations.push({
      code: 'forbidden_thinking_disclosure',
      severity: 'error',
      message: 'This fixture does not allow thinking-enabled writer candidates.',
    });
  }

  if (output.thinkingMode === 'explicit_scratchpad_forbidden' || containsForbiddenThinkingDisclosure(output.text)) {
    violations.push({
      code: 'forbidden_thinking_disclosure',
      severity: 'error',
      message: 'Writer output appears to disclose scratchpad or chain-of-thought content.',
    });
  }

  const entityPrecision = safeRatio(countAllowed(output.usedEntityIds, allowedEntityIds), unique(output.usedEntityIds).length);
  const entityRecall = safeRatio(countAllowed([...requiredEntityIds], new Set(output.usedEntityIds)), requiredEntityIds.size);
  const claimPrecision = safeRatio(countAllowed(output.usedClaimIds, allowedClaimIds), unique(output.usedClaimIds).length);
  const evidenceCoverage = safeRatio(countAllowed([...requiredEvidenceIds], citedEvidenceIds), requiredEvidenceIds.size);
  const groundedness = average([entityPrecision, claimPrecision, evidenceCoverage]);
  const quality = clamp01(output.selfReportedQuality);
  const efficiency = estimateEfficiencyScore(output.latencyMs, output.outputTokens);
  const violationPenalty = calculateViolationPenalty(violations);
  const finalScore = clamp01((groundedness * 0.55) + (entityRecall * 0.15) + (quality * 0.2) + (efficiency * 0.1) - violationPenalty);

  const maxInventedEntityViolations = countViolations(violations, 'invented_entity_id');
  const maxUnsupportedClaimViolations = countViolations(violations, 'unsupported_claim_id');
  const hardErrors = violations.some((violation) => violation.severity === 'error');

  return {
    schemaVersion: INTERPOLATOR_WRITER_EVAL_CONTRACT_VERSION,
    fixtureId: fixture.id,
    provider: output.provider,
    thinkingMode: output.thinkingMode,
    passed: !hardErrors
      && maxInventedEntityViolations <= fixture.policy.maxInventedEntities
      && maxUnsupportedClaimViolations <= fixture.policy.maxUnsupportedClaims,
    scores: {
      entityPrecision,
      entityRecall,
      claimPrecision,
      evidenceCoverage,
      groundedness,
      quality,
      efficiency,
      finalScore,
    },
    violations,
  };
}

export function rankInterpolatorWriterEvalResults(results: readonly InterpolatorWriterEvalResult[]): InterpolatorWriterEvalResult[] {
  return [...results].sort((a, b) => {
    if (a.passed !== b.passed) return a.passed ? -1 : 1;
    return b.scores.finalScore - a.scores.finalScore;
  });
}

function containsForbiddenThinkingDisclosure(text: string): boolean {
  const normalized = text.toLowerCase();
  return FORBIDDEN_THINKING_MARKERS.some((marker) => normalized.includes(marker));
}

function calculateViolationPenalty(violations: readonly InterpolatorWriterEvalViolation[]): number {
  return violations.reduce((penalty, violation) => penalty + (violation.severity === 'error' ? 0.35 : violation.severity === 'warning' ? 0.08 : 0.02), 0);
}

function estimateEfficiencyScore(latencyMs: number | null, outputTokens: number | null): number {
  const latencyScore = latencyMs === null ? 0.75 : clamp01(1 - (Math.max(0, latencyMs) / 12000));
  const tokenScore = outputTokens === null ? 0.75 : clamp01(1 - (Math.max(0, outputTokens - 220) / 780));
  return average([latencyScore, tokenScore]);
}

function countAllowed(values: readonly string[], allowed: ReadonlySet<string>): number {
  return unique(values).filter((value) => allowed.has(value)).length;
}

function countViolations(violations: readonly InterpolatorWriterEvalViolation[], code: InterpolatorWriterEvalViolationCode): number {
  return violations.filter((violation) => violation.code === code).length;
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator === 0) return 1;
  return clamp01(numerator / denominator);
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
