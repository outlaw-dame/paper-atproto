import type {
  InterpolatorWriterEvalCandidateOutput,
  InterpolatorWriterEvalFixture,
  InterpolatorWriterEvalResult,
  InterpolatorWriterThinkingMode,
} from './interpolatorWriterEvalContract';
import { evaluateInterpolatorWriterOutput } from './interpolatorWriterEvalContract';
import type { InterpolatorWriterProviderId } from './interpolatorWriterRoutingPolicy';

export const INTERPOLATOR_WRITER_EVAL_HARNESS_VERSION = 1 as const;

export type InterpolatorWriterEvalHarnessStatus =
  | 'no_candidates'
  | 'all_failed'
  | 'winner_selected'
  | 'tie_requires_review';

export type InterpolatorWriterEvalHarnessReasonCode =
  | 'candidate_fixture_mismatch'
  | 'candidate_failed_contract'
  | 'candidate_passed_contract'
  | 'no_candidate_outputs'
  | 'winner_selected_by_score'
  | 'winner_selected_by_provider_priority'
  | 'tie_requires_review'
  | 'thinking_candidate_beats_non_thinking'
  | 'thinking_candidate_loses_to_non_thinking';

export interface InterpolatorWriterEvalHarnessCandidate {
  output: InterpolatorWriterEvalCandidateOutput;
  providerPriority?: number;
}

export interface InterpolatorWriterEvalHarnessInput {
  fixture: InterpolatorWriterEvalFixture;
  candidates: InterpolatorWriterEvalHarnessCandidate[];
  scoreTieTolerance?: number;
}

export interface InterpolatorWriterEvalHarnessCandidateResult {
  provider: InterpolatorWriterProviderId;
  thinkingMode: InterpolatorWriterThinkingMode;
  providerPriority: number;
  result: InterpolatorWriterEvalResult;
  reasonCodes: InterpolatorWriterEvalHarnessReasonCode[];
}

export interface InterpolatorWriterEvalHarnessSummary {
  schemaVersion: typeof INTERPOLATOR_WRITER_EVAL_HARNESS_VERSION;
  fixtureId: string;
  status: InterpolatorWriterEvalHarnessStatus;
  winner: InterpolatorWriterEvalHarnessCandidateResult | null;
  rankedCandidates: InterpolatorWriterEvalHarnessCandidateResult[];
  reasonCodes: InterpolatorWriterEvalHarnessReasonCode[];
}

const DEFAULT_SCORE_TIE_TOLERANCE = 0.015;

export function compareInterpolatorWriterCandidates(
  input: InterpolatorWriterEvalHarnessInput,
): InterpolatorWriterEvalHarnessSummary {
  const scoreTieTolerance = sanitizeTieTolerance(input.scoreTieTolerance);
  const candidateResults = input.candidates.map((candidate, index) => evaluateCandidate(input.fixture, candidate, index));
  const rankedCandidates = rankHarnessCandidates(candidateResults, scoreTieTolerance);

  if (rankedCandidates.length === 0) {
    return {
      schemaVersion: INTERPOLATOR_WRITER_EVAL_HARNESS_VERSION,
      fixtureId: input.fixture.id,
      status: 'no_candidates',
      winner: null,
      rankedCandidates,
      reasonCodes: ['no_candidate_outputs'],
    };
  }

  const passingCandidates = rankedCandidates.filter((candidate) => candidate.result.passed);
  if (passingCandidates.length === 0) {
    return {
      schemaVersion: INTERPOLATOR_WRITER_EVAL_HARNESS_VERSION,
      fixtureId: input.fixture.id,
      status: 'all_failed',
      winner: null,
      rankedCandidates,
      reasonCodes: unique([
        'candidate_failed_contract',
        ...deriveThinkingComparisonReasonCodes(rankedCandidates),
      ]),
    };
  }

  const winner = passingCandidates[0]!;
  const runnerUp = passingCandidates[1];
  const scoreWithinTolerance = Boolean(
    runnerUp
    && Math.abs(winner.result.scores.finalScore - runnerUp.result.scores.finalScore) <= scoreTieTolerance,
  );
  const tied = Boolean(scoreWithinTolerance && runnerUp && winner.providerPriority === runnerUp.providerPriority);

  if (tied) {
    return {
      schemaVersion: INTERPOLATOR_WRITER_EVAL_HARNESS_VERSION,
      fixtureId: input.fixture.id,
      status: 'tie_requires_review',
      winner: null,
      rankedCandidates,
      reasonCodes: unique([
        'tie_requires_review',
        ...deriveThinkingComparisonReasonCodes(rankedCandidates),
      ]),
    };
  }

  return {
    schemaVersion: INTERPOLATOR_WRITER_EVAL_HARNESS_VERSION,
    fixtureId: input.fixture.id,
    status: 'winner_selected',
    winner,
    rankedCandidates,
    reasonCodes: unique([
      scoreWithinTolerance ? 'winner_selected_by_provider_priority' : 'winner_selected_by_score',
      ...deriveThinkingComparisonReasonCodes(rankedCandidates),
    ]),
  };
}

function evaluateCandidate(
  fixture: InterpolatorWriterEvalFixture,
  candidate: InterpolatorWriterEvalHarnessCandidate,
  index: number,
): InterpolatorWriterEvalHarnessCandidateResult {
  const result = evaluateInterpolatorWriterOutput(fixture, candidate.output);
  const reasonCodes: InterpolatorWriterEvalHarnessReasonCode[] = [];

  if (candidate.output.fixtureId !== fixture.id) reasonCodes.push('candidate_fixture_mismatch');
  reasonCodes.push(result.passed ? 'candidate_passed_contract' : 'candidate_failed_contract');

  return {
    provider: candidate.output.provider,
    thinkingMode: candidate.output.thinkingMode,
    providerPriority: sanitizeProviderPriority(candidate.providerPriority, index),
    result,
    reasonCodes,
  };
}

function rankHarnessCandidates(
  candidates: readonly InterpolatorWriterEvalHarnessCandidateResult[],
  scoreTieTolerance: number,
): InterpolatorWriterEvalHarnessCandidateResult[] {
  return [...candidates].sort((a, b) => {
    if (a.result.passed !== b.result.passed) return a.result.passed ? -1 : 1;

    const scoreOrder = b.result.scores.finalScore - a.result.scores.finalScore;
    if (Math.abs(scoreOrder) > scoreTieTolerance) return scoreOrder;

    const priorityOrder = a.providerPriority - b.providerPriority;
    if (priorityOrder !== 0) return priorityOrder;

    return 0;
  });
}

function deriveThinkingComparisonReasonCodes(
  rankedCandidates: readonly InterpolatorWriterEvalHarnessCandidateResult[],
): InterpolatorWriterEvalHarnessReasonCode[] {
  const bestThinkingCandidate = rankedCandidates.find((candidate) => candidate.thinkingMode !== 'off');
  const bestNonThinkingCandidate = rankedCandidates.find((candidate) => candidate.thinkingMode === 'off');

  if (!bestThinkingCandidate || !bestNonThinkingCandidate) return [];
  if (!bestThinkingCandidate.result.passed && !bestNonThinkingCandidate.result.passed) return [];

  if (bestThinkingCandidate.result.passed && !bestNonThinkingCandidate.result.passed) {
    return ['thinking_candidate_beats_non_thinking'];
  }
  if (!bestThinkingCandidate.result.passed && bestNonThinkingCandidate.result.passed) {
    return ['thinking_candidate_loses_to_non_thinking'];
  }
  return bestThinkingCandidate.result.scores.finalScore > bestNonThinkingCandidate.result.scores.finalScore
    ? ['thinking_candidate_beats_non_thinking']
    : ['thinking_candidate_loses_to_non_thinking'];
}

function sanitizeProviderPriority(priority: number | undefined, index: number): number {
  if (priority == null || !Number.isFinite(priority)) return index;
  return Math.max(0, Math.floor(priority));
}

function sanitizeTieTolerance(tolerance: number | undefined): number {
  if (tolerance == null || !Number.isFinite(tolerance)) return DEFAULT_SCORE_TIE_TOLERANCE;
  return Math.max(0, Math.min(0.25, tolerance));
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
