import { describe, expect, it, vi } from 'vitest';
import type { ConversationSession } from './sessionTypes';
import {
  createSessionAiDiagnostics,
  markConversationModelLoading,
} from './modelExecution';
import {
  summarizeConversationCoordinatorRuntimeAdvisory,
} from './sessionAssembler';
import {
  planConversationCoordinatorMediaStage,
  executeConversationCoordinatorMediaStage,
  CONVERSATION_COORDINATOR_MEDIA_STAGE_VERSION,
} from './coordinatorMediaStageExecutor';
import type { ConversationCoordinatorMediaAnalyzer } from './coordinatorMediaStageExecutor';
import {
  executeConversationCoordinatorWriterStage,
  CONVERSATION_COORDINATOR_WRITER_STAGE_VERSION,
} from './coordinatorWriterStageExecutor';
import type { InterpolatorWriteResult, ThreadStateForWriter } from '../intelligence/llmContracts';

const ROOT_URI = 'at://did:plc:test/app.bsky.feed.post/root';

function createSession(overrides?: Partial<ConversationSession>): ConversationSession {
  return {
    id: ROOT_URI,
    mode: 'thread',
    graph: {
      rootUri: ROOT_URI,
      nodesByUri: {},
      childUrisByParent: {},
      parentUriByChild: {},
      subtreeEndHints: {},
    },
    structure: {
      focusedAnchorUri: ROOT_URI,
      visibleUris: [],
      deferredUris: [],
      hiddenUris: [],
      revealedWarnUris: [],
      unresolvedChildCountsByUri: {},
    },
    interpretation: {
      interpolator: null,
      scoresByUri: {},
      writerResult: null,
      confidence: null,
      summaryMode: 'normal',
      threadState: null,
      interpretiveExplanation: null,
      lastComputedAt: '2026-05-01T20:00:00.000Z',
      aiDiagnostics: createSessionAiDiagnostics(),
      premium: {
        status: 'idle',
      },
      ...(overrides?.interpretation ?? {}),
    },
    evidence: {
      verificationByUri: {},
      rootVerification: null,
    },
    entities: {
      writerEntities: [],
      canonicalEntities: [],
      entityLandscape: [],
    },
    contributors: {
      contributors: [],
      topContributorDids: [],
    },
    translations: {
      byUri: {},
    },
    trajectory: {
      direction: 'forming',
      heatLevel: 0,
      repetitionLevel: 0,
      activityVelocity: 0,
      turningPoints: [],
      snapshots: [],
    },
    mutations: {
      revision: 0,
      recent: [],
    },
    meta: {
      status: 'ready',
      error: null,
      lastHydratedAt: '2026-05-01T20:00:01.000Z',
    },
    ...overrides,
  };
}

describe('session assembler coordinator runtime advisory', () => {
  it('summarizes loading-stage decisions without mutating the session', () => {
    const loading = markConversationModelLoading(createSession(), 'writer', {
      sourceToken: 'token-1',
      requestedAt: '2026-05-01T20:00:02.000Z',
    });

    const advisory = summarizeConversationCoordinatorRuntimeAdvisory(loading);

    expect(advisory).toMatchObject({
      action: 'wait_for_active_model_stage',
      activeStageCount: 1,
      errorStageCount: 0,
      staleStageCount: 0,
    });
    expect(advisory.reasonCodes).toEqual(expect.arrayContaining(['writer_loading']));
    expect(loading.interpretation.aiDiagnostics?.writer.status).toBe('loading');
  });
});

// ---------------------------------------------------------------------------
// Item 4: coordinatorMediaStageExecutor delegation
// Validates that the plan/execute functions now wired into sessionAssembler
// produce the same outcomes the old inline planThreadMediaAnalysis /
// executeThreadMediaAnalysis produced, with no behavior drift.
// ---------------------------------------------------------------------------

const THREAD_ID = 'at://did:plc:test/app.bsky.feed.post/media-thread';

describe('planConversationCoordinatorMediaStage', () => {
  it('returns shouldRun:false with reason multimodal_not_needed when root has no media', () => {
    // Minimal root with no embed/images → detectMediaSignals returns no signals
    const root = { uri: THREAD_ID, text: 'plain text post', embed: null } as any;
    const plan = planConversationCoordinatorMediaStage({
      threadId: THREAD_ID,
      root,
      replies: [],
      scores: {},
      nearbyTextByUri: {},
    });

    expect(plan.shouldRun).toBe(false);
    expect(plan.schemaVersion).toBe(CONVERSATION_COORDINATOR_MEDIA_STAGE_VERSION);
    if (!plan.shouldRun) {
      expect(plan.reason).toBe('multimodal_not_needed');
      expect(plan.requests).toHaveLength(0);
      expect(plan.requestCount).toBe(0);
    }
  });
});

describe('executeConversationCoordinatorMediaStage', () => {
  it('returns error outcome when no requests are supplied', async () => {
    const analyzeMedia: ConversationCoordinatorMediaAnalyzer = vi.fn();
    const outcome = await executeConversationCoordinatorMediaStage({
      threadId: THREAD_ID,
      requests: [],
      analyzeMedia,
    });

    expect(outcome.status).toBe('error');
    expect(outcome.attempted).toBe(0);
    expect(outcome.failures).toBe(0);
    expect(outcome.reasonCodes).toContain('no_media_requests');
    expect(analyzeMedia).not.toHaveBeenCalled();
  });

  it('returns ready outcome with findings when all requests succeed', async () => {
    const fakeResult = { uri: 'at://image1', description: 'a cat' } as any;
    const analyzeMedia: ConversationCoordinatorMediaAnalyzer = vi.fn().mockResolvedValue(fakeResult);

    const outcome = await executeConversationCoordinatorMediaStage({
      threadId: THREAD_ID,
      requests: [{ uri: 'at://image1' } as any],
      analyzeMedia,
    });

    expect(outcome.status).toBe('ready');
    expect(outcome.attempted).toBe(1);
    expect(outcome.failures).toBe(0);
    expect(outcome.reasonCodes).toContain('media_analysis_ready');
  });

  it('returns error outcome when all requests fail', async () => {
    const analyzeMedia: ConversationCoordinatorMediaAnalyzer = vi.fn().mockRejectedValue(new Error('network'));
    const logFailure = vi.fn();

    const outcome = await executeConversationCoordinatorMediaStage({
      threadId: THREAD_ID,
      requests: [{ uri: 'at://image1' } as any],
      analyzeMedia,
      logFailure,
    });

    expect(outcome.status).toBe('error');
    expect(outcome.attempted).toBe(1);
    expect(outcome.failures).toBe(1);
    expect(outcome.reasonCodes).toContain('all_selected_media_failed');
    expect(logFailure).toHaveBeenCalledOnce();
    expect(logFailure).toHaveBeenCalledWith(expect.objectContaining({
      event: 'conversation.multimodal.degraded',
      threadId: THREAD_ID,
      attempted: 1,
      failures: 1,
    }));
  });

  it('returns ready outcome with partial_media_failures when some requests fail', async () => {
    const fakeResult = { uri: 'at://image1', description: 'a dog' } as any;
    const analyzeMedia: ConversationCoordinatorMediaAnalyzer = vi.fn()
      .mockResolvedValueOnce(fakeResult)
      .mockRejectedValueOnce(new Error('timeout'));
    const logFailure = vi.fn();

    const outcome = await executeConversationCoordinatorMediaStage({
      threadId: THREAD_ID,
      requests: [{ uri: 'at://image1' } as any, { uri: 'at://image2' } as any],
      analyzeMedia,
      logFailure,
    });

    expect(outcome.status).toBe('ready');
    expect(outcome.attempted).toBe(2);
    expect(outcome.failures).toBe(1);
    expect(outcome.reasonCodes).toContain('media_analysis_ready');
    expect(outcome.reasonCodes).toContain('partial_media_failures');
    expect(logFailure).toHaveBeenCalledOnce();
  });

  it('re-throws AbortError without counting as a failure', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    const analyzeMedia: ConversationCoordinatorMediaAnalyzer = vi.fn().mockRejectedValue(abortError);
    const controller = new AbortController();
    controller.abort();

    await expect(
      executeConversationCoordinatorMediaStage({
        threadId: THREAD_ID,
        requests: [{ uri: 'at://image1' } as any],
        analyzeMedia,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Item 5: coordinatorWriterStageExecutor delegation
// Validates that the writer stage now delegated by sessionAssembler produces
// the same ready/error outcomes the inline writer call did, plus the new
// defensive validation/normalization guards.
// ---------------------------------------------------------------------------

const WRITER_INPUT_STUB = {
  rootUri: THREAD_ID,
  rootText: 'root',
  replies: [],
  scores: {},
  contributors: [],
  safeEntities: [],
  summaryMode: 'normal',
} as unknown as ThreadStateForWriter;

function buildWriterResult(overrides?: Partial<InterpolatorWriteResult>): InterpolatorWriteResult {
  return {
    collapsedSummary: 'a tidy summary of the thread',
    expandedSummary: 'a longer expanded summary',
    whatChanged: ['something changed'],
    contributorBlurbs: [{ handle: 'alice.bsky', blurb: 'agreed' }],
    abstained: false,
    mode: 'normal',
    ...overrides,
  };
}

describe('executeConversationCoordinatorWriterStage', () => {
  it('returns ready outcome and exposes redacted result when redactor is provided', async () => {
    const redacted = buildWriterResult({ collapsedSummary: 'redacted summary' });
    const write = vi.fn().mockResolvedValue(buildWriterResult());
    const redactResult = vi.fn().mockReturnValue(redacted);

    const outcome = await executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT_STUB,
      write,
      redactResult,
    });

    expect(outcome.status).toBe('ready');
    expect(outcome.schemaVersion).toBe(CONVERSATION_COORDINATOR_WRITER_STAGE_VERSION);
    expect(write).toHaveBeenCalledOnce();
    expect(redactResult).toHaveBeenCalledOnce();
    if (outcome.status === 'ready') {
      expect(outcome.result.collapsedSummary).toBe('redacted summary');
      expect(outcome.diagnostics.redacted).toBe(true);
      expect(outcome.reasonCodes).toContain('writer_result_ready');
      expect(outcome.reasonCodes).toContain('writer_result_redacted');
    }
  });

  it('returns error outcome when writer returns an empty summary', async () => {
    const write = vi.fn().mockResolvedValue(buildWriterResult({ collapsedSummary: '' }));

    const outcome = await executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT_STUB,
      write,
    });

    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') {
      expect(outcome.reasonCodes).toContain('writer_result_missing_summary');
    }
  });

  it('returns error outcome when writer returns an invalid shape', async () => {
    const write = vi.fn().mockResolvedValue({ collapsedSummary: 42 });

    const outcome = await executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT_STUB,
      write,
    });

    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') {
      expect(outcome.reasonCodes).toContain('writer_result_invalid');
    }
  });

  it('returns error outcome when writer throws a non-abort error', async () => {
    const write = vi.fn().mockRejectedValue(new Error('boom'));

    const outcome = await executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT_STUB,
      write,
    });

    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') {
      expect(outcome.reasonCodes).toContain('writer_execution_failed');
      expect(outcome.error).toContain('boom');
    }
  });

  it('re-throws AbortError instead of swallowing it', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const write = vi.fn().mockRejectedValue(abortError);

    await expect(
      executeConversationCoordinatorWriterStage({
        writerInput: WRITER_INPUT_STUB,
        write,
      }),
    ).rejects.toThrow();
  });

  it('flags normalized output when collapsedSummary contains control chars', async () => {
    const write = vi.fn().mockResolvedValue(buildWriterResult({ collapsedSummary: 'noisy\u0000summary' }));

    const outcome = await executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT_STUB,
      write,
    });

    expect(outcome.status).toBe('ready');
    if (outcome.status === 'ready') {
      expect(outcome.diagnostics.normalized).toBe(true);
      expect(outcome.reasonCodes).toContain('writer_result_normalized');
      expect(outcome.result.collapsedSummary).not.toContain('\u0000');
    }
  });
});
