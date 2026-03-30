import type { ConfidenceState } from './llmContracts.js';
import type { InterpolatorState, ContributionScores } from './interpolatorTypes.js';
export interface InterpretiveConfidenceInputs {
    themeConfidence: number;
    contributorConfidence: number;
    entityConfidence: number;
    evidenceConfidence: number;
    signalDensity: number;
    repetitionLevel: number;
}
/**
 * Weighted formula from the architecture spec:
 * 0.25*theme + 0.20*contributors + 0.20*entities + 0.15*evidence
 *   + 0.10*signal_density − 0.10*repetition
 */
export declare function computeInterpretiveConfidence(i: InterpretiveConfidenceInputs): number;
/**
 * Derived from observable signals only — no entity resolution or theme inference.
 * Based on root text quality, reply count, and reaction pattern consistency.
 */
export declare function computeSurfaceConfidence(state: InterpolatorState): number;
/**
 * Aggregate quality of the resolved entity landscape.
 * Based on average match confidence of the top 5 entities plus a density bonus.
 */
export declare function computeEntityConfidence(state: InterpolatorState): number;
/**
 * Computes all three confidence values from a completed InterpolatorState.
 * Called after the Phase 1/3 pipeline has run and before building writer input.
 */
export declare function computeConfidenceState(state: InterpolatorState, _scores: Record<string, ContributionScores>): ConfidenceState;
//# sourceMappingURL=confidence.d.ts.map