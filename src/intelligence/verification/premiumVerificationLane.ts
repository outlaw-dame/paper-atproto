import {
  executeThinkingPlan,
  type ThinkingPlan,
  type ThinkingResult,
} from '../coordinator/thinkingLane';
import type {
  DeepInterpolatorResult,
  PremiumInterpolatorRequest,
} from '../premiumContracts';

/**
 * Bounded, deterministic verification pass for a {@link DeepInterpolatorResult}.
 *
 * Why this exists:
 *  - The premium deep-interpolator returns a self-reported `confidence` score
 *    plus a free-form summary, perspective gaps, and follow-up questions.
 *  - These outputs are non-deterministic and occasionally inconsistent (e.g.
 *    high stated confidence + zero substantive content, or duplicated
 *    perspective/follow-up text). Today the executor surfaces them as-is.
 *  - This lane runs a bounded, no-I/O thinking plan over the result's *shape*
 *    against the originating request, then emits a `PremiumVerificationVerdict`
 *    that callers MAY use to downgrade trust or trigger supervisor actions.
 *
 * Hard rules:
 *  - No network. No model calls. Pure structural analysis.
 *  - Total budget: 80ms (typical < 2ms).
 *  - Always resolves; never throws. Fallback yields `trust: 'unverified'` so
 *    callers can keep the existing behaviour.
 *  - Verdict is restrictive in the *negative* direction — it never *upgrades*
 *    confidence, only flags issues.
 *  - Frozen output, sanitized reason codes (length-capped by the lane).
 */

export type PremiumVerificationTrust =
  | 'verified'
  | 'low_confidence'
  | 'hold_until_fresh'
  | 'unverified';

export interface PremiumVerificationVerdict {
  trust: PremiumVerificationTrust;
  /** Suggested confidence cap in [0,1]. Never higher than `result.confidence`. */
  suggestedConfidenceCap: number;
  /** Whether the supervisor should hold further premium calls until inputs change. */
  holdPremiumUntilFresh: boolean;
  reasonCodes: readonly string[];
}

export interface PremiumVerificationResult {
  verdict: PremiumVerificationVerdict;
  thinking: ThinkingResult<PremiumVerificationVerdict>;
}

const PLAN_TOTAL_BUDGET_MS = 80;
const PLAN_STEP_BUDGET_MS = 30;

const MIN_USEFUL_SUMMARY_CHARS = 40;
const HIGH_CONFIDENCE_THRESHOLD = 0.75;
const SAFETY_HARD_CAP_CONFIDENCE = 0.4;

interface VerificationSignals {
  confidence: number;
  summaryLength: number;
  hasGroundedContext: boolean;
  uniquePerspectiveGaps: number;
  uniqueFollowUpQuestions: number;
  duplicatePerspectiveCount: number;
  duplicateFollowUpCount: number;
  safetyFlagged: boolean;
  requestHasInterpretiveLimits: boolean;
  requestSummaryMode: string;
}

function normalizeText(value: string | undefined): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function uniqueNonEmpty(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const norm = normalizeText(v);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function extractSignals(
  result: DeepInterpolatorResult,
  request: PremiumInterpolatorRequest,
): VerificationSignals {
  const summary = normalizeText(result.summary);
  const groundedContext = normalizeText(result.groundedContext);
  const uniquePerspectives = uniqueNonEmpty(result.perspectiveGaps);
  const uniqueFollowUps = uniqueNonEmpty(result.followUpQuestions);
  const totalPerspectives = Array.isArray(result.perspectiveGaps)
    ? result.perspectiveGaps.length
    : 0;
  const totalFollowUps = Array.isArray(result.followUpQuestions)
    ? result.followUpQuestions.length
    : 0;
  return {
    confidence: clamp01(result.confidence),
    summaryLength: summary.length,
    hasGroundedContext: groundedContext.length > 0,
    uniquePerspectiveGaps: uniquePerspectives.length,
    uniqueFollowUpQuestions: uniqueFollowUps.length,
    duplicatePerspectiveCount: Math.max(0, totalPerspectives - uniquePerspectives.length),
    duplicateFollowUpCount: Math.max(0, totalFollowUps - uniqueFollowUps.length),
    safetyFlagged: Boolean(result.safety?.flagged),
    requestHasInterpretiveLimits:
      Array.isArray(request.interpretiveBrief?.limits)
      && request.interpretiveBrief.limits.length > 0,
    requestSummaryMode: request.interpretiveBrief?.summaryMode ?? 'unknown',
  };
}

function decide(
  signals: VerificationSignals,
  inputConfidence: number,
): PremiumVerificationVerdict {
  const reasonCodes: string[] = [];
  let trust: PremiumVerificationTrust = 'verified';
  let cap = clamp01(inputConfidence);
  let hold = false;

  // Safety override: any safety flag forces a hold + heavy cap.
  if (signals.safetyFlagged) {
    trust = 'hold_until_fresh';
    cap = Math.min(cap, SAFETY_HARD_CAP_CONFIDENCE);
    hold = true;
    reasonCodes.push('premium_verification_safety_flagged');
  }

  // Stated high confidence but the body is too thin to support it.
  if (
    signals.confidence >= HIGH_CONFIDENCE_THRESHOLD
    && signals.summaryLength < MIN_USEFUL_SUMMARY_CHARS
  ) {
    if (trust === 'verified') trust = 'low_confidence';
    cap = Math.min(cap, 0.55);
    reasonCodes.push('premium_verification_summary_too_thin');
  }

  // Self-contradicting structure: high confidence yet no perspective gaps,
  // no follow-ups, AND no grounded context.
  if (
    signals.confidence >= HIGH_CONFIDENCE_THRESHOLD
    && signals.uniquePerspectiveGaps === 0
    && signals.uniqueFollowUpQuestions === 0
    && !signals.hasGroundedContext
  ) {
    if (trust === 'verified') trust = 'low_confidence';
    cap = Math.min(cap, 0.6);
    reasonCodes.push('premium_verification_no_substantive_signals');
  }

  // Duplicated content suggests the model is padding output.
  if (signals.duplicatePerspectiveCount > 0 || signals.duplicateFollowUpCount > 0) {
    if (trust === 'verified') trust = 'low_confidence';
    cap = Math.min(cap, 0.7);
    reasonCodes.push('premium_verification_duplicate_signals');
  }

  // The interpretive brief flagged limits but the model returned no follow-ups
  // or perspectives — likely glossed over the caveats.
  if (
    signals.requestHasInterpretiveLimits
    && signals.uniqueFollowUpQuestions === 0
    && signals.uniquePerspectiveGaps === 0
  ) {
    if (trust === 'verified') trust = 'low_confidence';
    cap = Math.min(cap, 0.65);
    reasonCodes.push('premium_verification_glossed_limits');
  }

  if (reasonCodes.length === 0) {
    reasonCodes.push('premium_verification_clean');
  }

  return {
    trust,
    suggestedConfidenceCap: clamp01(cap),
    holdPremiumUntilFresh: hold,
    reasonCodes,
  };
}

function isVerdict(value: unknown): value is PremiumVerificationVerdict {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.trust === 'string'
    && typeof v.suggestedConfidenceCap === 'number'
    && typeof v.holdPremiumUntilFresh === 'boolean'
    && Array.isArray(v.reasonCodes)
  );
}

/**
 * Run the bounded verification lane against a successful premium result.
 * Always resolves. On any internal failure, yields `trust: 'unverified'` with
 * `suggestedConfidenceCap` equal to the original `result.confidence` — i.e.
 * caller behaviour is preserved.
 */
export async function verifyPremiumDeepInterpolatorResult(
  result: DeepInterpolatorResult,
  request: PremiumInterpolatorRequest,
  options?: { signal?: AbortSignal; sessionId?: string; sourceToken?: string },
): Promise<PremiumVerificationResult> {
  const inputConfidence = clamp01(result.confidence);

  const plan: ThinkingPlan<PremiumVerificationVerdict> = {
    id: 'premium_deep_interpolator_verification',
    requesterSurface: 'premium',
    totalBudgetMs: PLAN_TOTAL_BUDGET_MS,
    ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    ...(options?.sourceToken !== undefined ? { sourceToken: options.sourceToken } : {}),
    steps: [
      {
        id: 'analyze_result',
        kind: 'analyze',
        budgetMs: PLAN_STEP_BUDGET_MS,
        run: () => extractSignals(result, request),
      },
      {
        id: 'verify_consistency',
        kind: 'verify',
        budgetMs: PLAN_STEP_BUDGET_MS,
        run: ({ previous }) => {
          const signals = previous?.value as VerificationSignals | undefined;
          if (!signals) {
            return {
              trust: 'unverified' as PremiumVerificationTrust,
              suggestedConfidenceCap: inputConfidence,
              holdPremiumUntilFresh: false,
              reasonCodes: ['premium_verification_signals_missing'],
            };
          }
          return decide(signals, inputConfidence);
        },
      },
    ],
    verifier: ({ finalValue }) => {
      if (!isVerdict(finalValue)) {
        return { ok: false, reasonCode: 'premium_verification_shape_invalid', useFallback: true };
      }
      return { ok: true };
    },
    fallback: () => ({
      trust: 'unverified' as PremiumVerificationTrust,
      suggestedConfidenceCap: inputConfidence,
      holdPremiumUntilFresh: false,
      reasonCodes: ['premium_verification_unavailable'],
    }),
  };

  const thinking = await executeThinkingPlan<PremiumVerificationVerdict>(plan, {
    ...(options?.signal ? { signal: options.signal } : {}),
  });

  const verdict: PremiumVerificationVerdict = thinking.value ?? {
    trust: 'unverified',
    suggestedConfidenceCap: inputConfidence,
    holdPremiumUntilFresh: false,
    reasonCodes: ['premium_verification_no_value'],
  };

  return Object.freeze({
    verdict: Object.freeze({
      trust: verdict.trust,
      suggestedConfidenceCap: clamp01(verdict.suggestedConfidenceCap),
      holdPremiumUntilFresh: Boolean(verdict.holdPremiumUntilFresh),
      reasonCodes: Object.freeze([...verdict.reasonCodes]),
    }) as PremiumVerificationVerdict,
    thinking,
  });
}
