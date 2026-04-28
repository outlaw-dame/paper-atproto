import {
  analyzeComposeTone,
  analyzeComposeToneImmediate,
  type ComposeToneAnalysis,
} from '../composeTonePipeline';
import { toAnalyzeOptions } from './contextBuilder';
import { buildComposerGuidanceUi } from './guidanceCopy';
import {
  createEmptyComposerGuidanceResult,
  computeComposerGuidanceScores,
  deriveComposerGuidanceState,
  normalizeToolsUsed,
  uiStateToLevel,
} from './guidanceScoring';
import type { ComposerContext, ComposerGuidanceResult } from './types';

function fromToneAnalysis(
  context: ComposerContext,
  analysis: ComposeToneAnalysis,
): ComposerGuidanceResult {
  const state = deriveComposerGuidanceState(analysis.result, analysis.ml, analysis.abuseScore);
  const scores = computeComposerGuidanceScores(analysis.result, analysis.ml, analysis.abuseScore);

  return {
    mode: context.mode,
    level: uiStateToLevel(state),
    heuristics: analysis.result,
    ml: analysis.ml,
    scores,
    toolsUsed: normalizeToolsUsed(analysis.toolsUsed),
    abuseScore: analysis.abuseScore,
    ui: buildComposerGuidanceUi(
      context,
      analysis.result,
      state,
      analysis.abuseScore,
      analysis.ml,
      scores,
    ),
  };
}

export function analyzeComposerGuidanceImmediate(
  context: ComposerContext,
): ComposerGuidanceResult {
  if (!context.draftText.trim() && context.mode !== 'reply') {
    return createEmptyComposerGuidanceResult(context.mode);
  }

  const analysis = analyzeComposeToneImmediate(
    context.draftText,
    toAnalyzeOptions(context),
  );

  return fromToneAnalysis(context, analysis);
}

export async function analyzeComposerGuidance(
  context: ComposerContext,
): Promise<ComposerGuidanceResult> {
  if (!context.draftText.trim() && context.mode !== 'reply') {
    return createEmptyComposerGuidanceResult(context.mode);
  }

  const analysis = await analyzeComposeTone(
    context.draftText,
    toAnalyzeOptions(context),
  );

  return fromToneAnalysis(context, analysis);
}
