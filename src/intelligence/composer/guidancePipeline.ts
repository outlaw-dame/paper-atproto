import {
  analyzeComposeTone,
  analyzeComposeToneImmediate,
  type ComposeToneAnalysis,
} from '../composeTonePipeline';
import { toAnalyzeOptions } from './contextBuilder';
import { callComposerEdgeClassifier } from './edgeClassifierClient';
import { buildComposerGuidanceUi } from './guidanceCopy';
import {
  createEmptyComposerGuidanceResult,
  computeComposerGuidanceScores,
  deriveComposerGuidanceState,
  normalizeToolsUsed,
  uiStateToLevel,
} from './guidanceScoring';
import type { ComposerEdgeClassifierRequest, ComposerEdgeClassifierResponse } from './edgeClassifierContracts';
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

function buildEdgeClassifierRequest(context: ComposerContext): ComposerEdgeClassifierRequest {
  const options = toAnalyzeOptions(context);

  return {
    mode: context.mode,
    draftText: context.draftText,
    ...(options.parentText ? { parentText: options.parentText } : {}),
    ...(options.targetText ? { targetText: options.targetText } : {}),
    ...(options.contextSignals && options.contextSignals.length > 0
      ? { contextSignals: options.contextSignals.slice(0, 4) }
      : {}),
  };
}

function mergeEdgeClassifierResult(
  context: ComposerContext,
  baseGuidance: ComposerGuidanceResult,
  edgeResult: ComposerEdgeClassifierResponse,
): ComposerGuidanceResult {
  const ml = {
    ...baseGuidance.ml,
    ...edgeResult.ml,
  };
  const abuseScore = edgeResult.abuseScore ?? baseGuidance.abuseScore;
  const state = deriveComposerGuidanceState(baseGuidance.heuristics, ml, abuseScore);
  const scores = computeComposerGuidanceScores(baseGuidance.heuristics, ml, abuseScore);

  return {
    ...baseGuidance,
    level: uiStateToLevel(state),
    ml,
    scores,
    toolsUsed: normalizeToolsUsed([
      ...baseGuidance.toolsUsed,
      ...edgeResult.toolsUsed,
    ]),
    abuseScore,
    ui: buildComposerGuidanceUi(
      context,
      baseGuidance.heuristics,
      state,
      abuseScore,
      ml,
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

export async function analyzeComposerGuidanceWithEdgeClassifier(
  context: ComposerContext,
  baseGuidance: ComposerGuidanceResult,
  signal?: AbortSignal,
): Promise<ComposerGuidanceResult> {
  if (!context.draftText.trim() && context.mode !== 'reply') {
    return baseGuidance;
  }

  const edgeResult = await callComposerEdgeClassifier(buildEdgeClassifierRequest(context), signal);
  return mergeEdgeClassifierResult(context, baseGuidance, edgeResult);
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
