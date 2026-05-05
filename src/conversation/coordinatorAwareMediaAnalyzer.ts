import type { IntelligenceAdvice } from '../intelligence/coordinator/intelligenceCoordinator';
import type { MediaAnalysisRequest, MediaAnalysisResult } from '../intelligence/llmContracts';
import { runEdgeExecution } from '../intelligence/edge/edgeProviderRuntime';
import type { MediaClassifyEdgeResponse } from '../intelligence/edge/edgeProviderContracts';

export type ConversationMediaAnalyzer = (
  request: MediaAnalysisRequest,
  signal?: AbortSignal,
) => Promise<MediaAnalysisResult>;

type EdgeMediaExecutor = typeof runEdgeExecution;

function resolveEdgeMediaPlan(advice: IntelligenceAdvice | null | undefined) {
  const plan = advice?.edgePlan;
  if (!plan) return null;
  if (plan.capability !== 'media_classify') return null;
  if (plan.provider !== 'cloudflare-workers-ai') return null;
  return plan;
}

export function shouldUseCoordinatorEdgeMediaPlan(advice: IntelligenceAdvice | null | undefined): boolean {
  return resolveEdgeMediaPlan(advice) !== null;
}

export function createCoordinatorAwareMediaAnalyzer(params: {
  advice: IntelligenceAdvice | null | undefined;
  fallbackAnalyzeMedia: ConversationMediaAnalyzer;
  edgeExecutor?: EdgeMediaExecutor;
  onEdgeFallback?: ((error: unknown) => void) | undefined;
  /**
   * When provided, any request with `overflow: true` is forwarded here instead
   * of to the edge or the local Qwen3-VL fallback. Intended for premium API
   * vision models (e.g. Gemini Flash) that handle images 3+ in long threads.
   */
  premiumAnalyzeMedia?: ConversationMediaAnalyzer;
}): ConversationMediaAnalyzer {
  const edgePlan = resolveEdgeMediaPlan(params.advice);
  const edgeExecutor = params.edgeExecutor ?? runEdgeExecution;

  return async (request, signal) => {
    // Overflow images are always premium — skip edge and local entirely.
    if (request.overflow && params.premiumAnalyzeMedia) {
      return params.premiumAnalyzeMedia(request, signal);
    }

    if (!edgePlan) {
      return params.fallbackAnalyzeMedia(request, signal);
    }

    try {
      const response = await edgeExecutor(edgePlan, {
        capability: 'media_classify',
        input: request,
      }, signal);
      return (response as MediaClassifyEdgeResponse).output;
    } catch (error) {
      params.onEdgeFallback?.(error);
      return params.fallbackAnalyzeMedia(request, signal);
    }
  };
}