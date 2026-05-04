import {
  executeThinkingPlan,
  type ThinkingPlan,
  type ThinkingResult,
} from '../coordinator/thinkingLane';
import type { ComposerContext, ComposerGuidanceResult } from './types';

/**
 * Bounded, deterministic pre-flight reasoning for the composer guidance writer.
 *
 * The writer (`maybeWriteComposerGuidance`) issues a server LLM call that costs
 * latency + tokens. In a narrow class of low-signal cases the writer's output is
 * almost certainly redundant with the deterministic UI copy. This pre-flight runs
 * a tiny bounded thinking plan over the existing guidance/context to decide
 * whether the writer call is likely to add value.
 *
 * Design rules:
 *  - No I/O, no model calls. Pure analysis over structured guidance.
 *  - Total budget: 50ms (typical run < 1ms).
 *  - Skip is *restrictive*: only when the writer cannot meaningfully improve copy.
 *  - On any internal error, lane falls back to `proceed: true` (current behavior).
 *  - Emits one `intelligence_event` per step under `surface='thinking'`.
 */

export type ComposerWriterPreflightDecision =
  | { proceed: true; reasonCodes: readonly string[] }
  | { proceed: false; reasonCodes: readonly string[] };

export interface ComposerWriterPreflightResult {
  decision: ComposerWriterPreflightDecision;
  thinking: ThinkingResult<ComposerWriterPreflightDecision>;
}

const PREFLIGHT_TOTAL_BUDGET_MS = 50;
const PREFLIGHT_STEP_BUDGET_MS = 25;
const SHORT_DRAFT_THRESHOLD = 60;

interface PreflightSignals {
  uiState: ComposerGuidanceResult['ui']['state'];
  level: ComposerGuidanceResult['level'];
  draftLength: number;
  hasParentSignals: boolean;
  hasConstructive: boolean;
  hasSupportive: boolean;
  hasPremiumContext: boolean;
  hasMediaContext: boolean;
  hasEpistemicHints: boolean;
  hasMentalHealthCrisis: boolean;
  targetedNegativity: number;
}

function extractSignals(
  context: ComposerContext,
  guidance: ComposerGuidanceResult,
): PreflightSignals {
  const draftLength = context.draftText.trim().length;
  const heuristics = guidance.heuristics;
  const summaries = context.summaries;
  return {
    uiState: guidance.ui.state,
    level: guidance.level,
    draftLength,
    hasParentSignals: heuristics.parentSignals.length > 0,
    hasConstructive: heuristics.constructiveSignals.length > 0,
    hasSupportive: heuristics.supportiveReplySignals.length > 0,
    hasPremiumContext: Boolean(summaries?.premiumContext),
    hasMediaContext: Boolean(summaries?.mediaContext),
    hasEpistemicHints: Boolean(
      summaries?.epistemicSummary
      && (summaries.epistemicSummary.missingContextHints.length > 0
        || summaries.epistemicSummary.confidenceWarnings.length > 0),
    ),
    hasMentalHealthCrisis: Boolean(heuristics.hasMentalHealthCrisis),
    targetedNegativity: guidance.scores.targetedNegativity ?? 0,
  };
}

function decide(signals: PreflightSignals): ComposerWriterPreflightDecision {
  // Defence-in-depth — never suppress safety-critical writer calls.
  if (signals.hasMentalHealthCrisis) {
    return { proceed: true, reasonCodes: ['safety_override'] };
  }
  if (signals.uiState === 'alert' || signals.uiState === 'warning') {
    return { proceed: true, reasonCodes: ['high_severity_state'] };
  }

  // Restrictive skip: caution-state with no auxiliary signals on a tiny draft.
  // In this case the writer has no premium/media/parent material to riff on,
  // so its output is essentially redundant with deterministic UI copy.
  const noAuxSignals =
    !signals.hasParentSignals
    && !signals.hasConstructive
    && !signals.hasSupportive
    && !signals.hasPremiumContext
    && !signals.hasMediaContext
    && !signals.hasEpistemicHints;

  if (
    signals.uiState === 'caution'
    && noAuxSignals
    && signals.draftLength < SHORT_DRAFT_THRESHOLD
    && signals.targetedNegativity < 0.3
  ) {
    return {
      proceed: false,
      reasonCodes: ['caution_low_signal_short_draft'],
    };
  }

  return { proceed: true, reasonCodes: ['signals_present'] };
}

function isPreflightDecision(
  value: unknown,
): value is ComposerWriterPreflightDecision {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.proceed === 'boolean'
    && Array.isArray(record.reasonCodes)
  );
}

/**
 * Runs the bounded pre-flight. Always resolves; on any internal failure or
 * budget exhaustion, the fallback returns `{ proceed: true }` so the writer
 * pipeline keeps working exactly as before.
 */
export async function evaluateComposerWriterPreflight(
  context: ComposerContext,
  guidance: ComposerGuidanceResult,
  options?: { signal?: AbortSignal; sessionId?: string; sourceToken?: string },
): Promise<ComposerWriterPreflightResult> {
  const plan: ThinkingPlan<ComposerWriterPreflightDecision> = {
    id: 'composer_writer_preflight',
    requesterSurface: 'composer',
    totalBudgetMs: PREFLIGHT_TOTAL_BUDGET_MS,
    ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    ...(options?.sourceToken !== undefined ? { sourceToken: options.sourceToken } : {}),
    steps: [
      {
        id: 'analyze_signals',
        kind: 'analyze',
        budgetMs: PREFLIGHT_STEP_BUDGET_MS,
        run: () => extractSignals(context, guidance),
      },
      {
        id: 'plan_decision',
        kind: 'plan',
        budgetMs: PREFLIGHT_STEP_BUDGET_MS,
        run: ({ previous }) => {
          // `previous` is the analyze step's wrapped result.
          const signals = previous?.value as PreflightSignals | undefined;
          if (!signals || typeof signals !== 'object') {
            return { proceed: true, reasonCodes: ['signals_unavailable'] };
          }
          return decide(signals);
        },
      },
    ],
    verifier: ({ finalValue }) => {
      if (!isPreflightDecision(finalValue)) {
        return { ok: false, reasonCode: 'preflight_shape_invalid', useFallback: true };
      }
      return { ok: true };
    },
    fallback: () => ({
      proceed: true,
      reasonCodes: ['preflight_unavailable'],
    }),
  };

  const thinking = await executeThinkingPlan<ComposerWriterPreflightDecision>(plan, {
    ...(options?.signal ? { signal: options.signal } : {}),
  });

  const decision: ComposerWriterPreflightDecision =
    thinking.value ?? { proceed: true, reasonCodes: ['preflight_no_value'] };

  return Object.freeze({
    decision: Object.freeze({
      proceed: decision.proceed,
      reasonCodes: Object.freeze([...decision.reasonCodes]),
    }) as ComposerWriterPreflightDecision,
    thinking,
  });
}
