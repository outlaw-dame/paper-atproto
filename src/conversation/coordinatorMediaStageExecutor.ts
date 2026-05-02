import type { ThreadNode } from '../lib/resolver/atproto';
import type { ContributionScores } from '../intelligence/interpolatorTypes';
import type {
  MediaAnalysisRequest,
  MediaAnalysisResult,
  WriterMediaFinding,
} from '../intelligence/llmContracts';
import {
  detectMediaSignals,
  deriveMediaFactualHints,
  mergeMediaResults,
  selectMediaForAnalysis,
  shouldRunMultimodal,
} from '../intelligence/mediaInput';

export const CONVERSATION_COORDINATOR_MEDIA_STAGE_VERSION = 1 as const;

export type ConversationCoordinatorMediaSkipReason = 'multimodal_not_needed' | 'no_media_candidates';

export type ConversationCoordinatorMediaPlan =
  | {
      schemaVersion: typeof CONVERSATION_COORDINATOR_MEDIA_STAGE_VERSION;
      shouldRun: false;
      reason: ConversationCoordinatorMediaSkipReason;
      requests: [];
      requestCount: 0;
    }
  | {
      schemaVersion: typeof CONVERSATION_COORDINATOR_MEDIA_STAGE_VERSION;
      shouldRun: true;
      requests: MediaAnalysisRequest[];
      requestCount: number;
    };

export type ConversationCoordinatorMediaOutcomeReasonCode =
  | 'media_analysis_ready'
  | 'partial_media_failures'
  | 'all_selected_media_failed'
  | 'no_media_requests';

export type ConversationCoordinatorMediaOutcome =
  | {
      schemaVersion: typeof CONVERSATION_COORDINATOR_MEDIA_STAGE_VERSION;
      status: 'ready';
      findings: WriterMediaFinding[];
      attempted: number;
      failures: number;
      reasonCodes: ConversationCoordinatorMediaOutcomeReasonCode[];
    }
  | {
      schemaVersion: typeof CONVERSATION_COORDINATOR_MEDIA_STAGE_VERSION;
      status: 'error';
      error: string;
      attempted: number;
      failures: number;
      reasonCodes: ConversationCoordinatorMediaOutcomeReasonCode[];
    };

export interface ConversationCoordinatorMediaFailureLogEvent {
  event: 'conversation.multimodal.degraded';
  threadId: string;
  attempted: number;
  failures: number;
}

export type ConversationCoordinatorMediaAnalyzer = (
  request: MediaAnalysisRequest,
  signal?: AbortSignal,
) => Promise<MediaAnalysisResult>;

export interface ConversationCoordinatorMediaPlanInput {
  threadId: string;
  root: ThreadNode;
  replies: ThreadNode[];
  scores: Record<string, ContributionScores>;
  nearbyTextByUri: Record<string, string | undefined>;
}

export interface ConversationCoordinatorMediaExecutionInput {
  threadId: string;
  requests: readonly MediaAnalysisRequest[];
  analyzeMedia: ConversationCoordinatorMediaAnalyzer;
  signal?: AbortSignal;
  logFailure?: (event: ConversationCoordinatorMediaFailureLogEvent) => void;
}

export function planConversationCoordinatorMediaStage(
  input: ConversationCoordinatorMediaPlanInput,
): ConversationCoordinatorMediaPlan {
  const mediaSignals = detectMediaSignals(input.root, input.replies, input.scores);
  if (!shouldRunMultimodal(mediaSignals)) {
    return buildSkippedPlan('multimodal_not_needed');
  }

  const requests = selectMediaForAnalysis(
    input.threadId,
    input.root,
    input.replies,
    input.scores,
    {
      nearbyTextByUri: input.nearbyTextByUri,
      factualHints: deriveMediaFactualHints(input.replies, input.scores),
    },
  );

  if (requests.length === 0) {
    return buildSkippedPlan('no_media_candidates');
  }

  return {
    schemaVersion: CONVERSATION_COORDINATOR_MEDIA_STAGE_VERSION,
    shouldRun: true,
    requests,
    requestCount: requests.length,
  };
}

export async function executeConversationCoordinatorMediaStage(
  input: ConversationCoordinatorMediaExecutionInput,
): Promise<ConversationCoordinatorMediaOutcome> {
  const requests = [...input.requests];
  if (requests.length === 0) {
    return {
      schemaVersion: CONVERSATION_COORDINATOR_MEDIA_STAGE_VERSION,
      status: 'error',
      error: 'No media analysis requests were selected.',
      attempted: 0,
      failures: 0,
      reasonCodes: ['no_media_requests'],
    };
  }

  const results: MediaAnalysisResult[] = [];
  let failures = 0;

  for (const request of requests) {
    assertNotAborted(input.signal);
    try {
      results.push(await input.analyzeMedia(request, input.signal));
    } catch (error) {
      if (isAbortError(error)) throw error;
      failures += 1;
    }
  }

  if (failures > 0) {
    input.logFailure?.({
      event: 'conversation.multimodal.degraded',
      threadId: input.threadId,
      attempted: requests.length,
      failures,
    });
  }

  if (results.length === 0) {
    return {
      schemaVersion: CONVERSATION_COORDINATOR_MEDIA_STAGE_VERSION,
      status: 'error',
      error: 'Multimodal analysis failed for all selected media.',
      attempted: requests.length,
      failures,
      reasonCodes: ['all_selected_media_failed'],
    };
  }

  return {
    schemaVersion: CONVERSATION_COORDINATOR_MEDIA_STAGE_VERSION,
    status: 'ready',
    findings: mergeMediaResults(results),
    attempted: requests.length,
    failures,
    reasonCodes: failures > 0
      ? ['media_analysis_ready', 'partial_media_failures']
      : ['media_analysis_ready'],
  };
}

function buildSkippedPlan(reason: ConversationCoordinatorMediaSkipReason): ConversationCoordinatorMediaPlan {
  return {
    schemaVersion: CONVERSATION_COORDINATOR_MEDIA_STAGE_VERSION,
    shouldRun: false,
    reason,
    requests: [],
    requestCount: 0,
  };
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw createAbortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function createAbortError(): Error {
  const error = new Error('Media analysis aborted.');
  error.name = 'AbortError';
  return error;
}
