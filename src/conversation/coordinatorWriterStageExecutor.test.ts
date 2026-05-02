import { describe, expect, it } from 'vitest';
import type { InterpolatorWriteResult, ThreadStateForWriter } from '../intelligence/llmContracts';
import { executeConversationCoordinatorWriterStage } from './coordinatorWriterStageExecutor';

const WRITER_INPUT: ThreadStateForWriter = {
  threadId: 'at://did:plc:test/app.bsky.feed.post/root',
  summaryMode: 'normal',
  confidence: {
    surfaceConfidence: 0.8,
    entityConfidence: 0.7,
    interpretiveConfidence: 0.6,
  },
  visibleReplyCount: 2,
  rootPost: {
    uri: 'at://did:plc:test/app.bsky.feed.post/root',
    handle: 'root.example',
    text: 'Root post text.',
    createdAt: '2026-05-01T20:00:00.000Z',
  },
  selectedComments: [],
  topContributors: [],
  safeEntities: [],
  factualHighlights: [],
  whatChangedSignals: [],
};

function createWriterResult(overrides: Partial<InterpolatorWriteResult> = {}): InterpolatorWriteResult {
  return {
    collapsedSummary: 'The thread is adding context around the root post.',
    whatChanged: ['Replies added context.'],
    contributorBlurbs: [
      {
        handle: 'reply.example',
        blurb: 'Adds useful context.',
      },
    ],
    abstained: false,
    mode: 'normal',
    ...overrides,
  };
}

describe('coordinator writer stage executor', () => {
  it('returns a ready outcome from a valid writer result', async () => {
    const result = createWriterResult();
    let calledWithSignal = false;
    const controller = new AbortController();

    const outcome = await executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT,
      signal: controller.signal,
      nowMs: createClock([10, 24]),
      write: async (input, signal) => {
        expect(input).toBe(WRITER_INPUT);
        calledWithSignal = signal === controller.signal;
        return result;
      },
    });

    expect(calledWithSignal).toBe(true);
    expect(outcome).toEqual({
      schemaVersion: 1,
      status: 'ready',
      result,
      durationMs: 14,
      reasonCodes: ['writer_result_ready'],
      diagnostics: {
        abstained: false,
        mode: 'normal',
        redacted: false,
        normalized: false,
      },
    });
  });

  it('applies an injected redactor after validating writer output', async () => {
    const outcome = await executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT,
      nowMs: createClock([0, 8]),
      write: async () => createWriterResult({
        collapsedSummary: 'This includes a blocked keyword.',
      }),
      redactResult: (result) => ({
        ...result,
        collapsedSummary: result.collapsedSummary.replace('blocked keyword', '[filtered]'),
      }),
    });

    expect(outcome).toMatchObject({
      schemaVersion: 1,
      status: 'ready',
      result: {
        collapsedSummary: 'This includes a [filtered].',
      },
      diagnostics: {
        redacted: true,
      },
    });
    expect(outcome.reasonCodes).toContain('writer_result_redacted');
  });

  it('normalizes noisy but structurally valid writer output', async () => {
    const outcome = await executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT,
      nowMs: createClock([0, 3]),
      write: async () => ({
        collapsedSummary: '  Summary\u0000 with\nspacing.  ',
        expandedSummary: ' Expanded\n\nsummary. ',
        whatChanged: [' first ', 'first', '', 12, ' second '],
        contributorBlurbs: [
          { handle: '@User.Example', blurb: '  Helpful\ncomment. ' },
          { handle: '@User.Example', blurb: '  Helpful comment. ' },
          { handle: '', blurb: 'ignored' },
        ],
        abstained: true,
        mode: 'not-a-mode',
      }),
    });

    expect(outcome).toMatchObject({
      schemaVersion: 1,
      status: 'ready',
      result: {
        collapsedSummary: 'Summary with spacing.',
        expandedSummary: 'Expanded summary.',
        whatChanged: ['first', 'second'],
        contributorBlurbs: [
          {
            handle: 'User.Example',
            blurb: 'Helpful comment.',
          },
        ],
        abstained: true,
        mode: 'normal',
      },
      diagnostics: {
        abstained: true,
        mode: 'normal',
        normalized: true,
      },
    });
    expect(outcome.reasonCodes).toContain('writer_result_normalized');
  });

  it('marks contributor blurb cleanup as normalized when count is unchanged', async () => {
    const outcome = await executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT,
      write: async () => ({
        collapsedSummary: 'Summary stays valid.',
        whatChanged: ['No structural change.'],
        contributorBlurbs: [
          { handle: '@reply.example', blurb: '  Adds\ncontext. ' },
        ],
        abstained: false,
        mode: 'normal',
      }),
    });

    expect(outcome).toMatchObject({
      status: 'ready',
      result: {
        contributorBlurbs: [
          {
            handle: 'reply.example',
            blurb: 'Adds context.',
          },
        ],
      },
      diagnostics: {
        normalized: true,
      },
    });
    expect(outcome.reasonCodes).toContain('writer_result_normalized');
  });

  it('trims handles after truncation', async () => {
    const rawHandle = `${'a'.repeat(119)}  suffix`;
    const outcome = await executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT,
      write: async () => createWriterResult({
        contributorBlurbs: [
          {
            handle: rawHandle,
            blurb: 'Still valid.',
          },
        ],
      }),
    });

    expect(outcome).toMatchObject({
      status: 'ready',
      result: {
        contributorBlurbs: [
          {
            handle: 'a'.repeat(119),
            blurb: 'Still valid.',
          },
        ],
      },
      diagnostics: {
        normalized: true,
      },
    });
  });

  it('returns an error outcome for invalid writer output', async () => {
    const outcome = await executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT,
      nowMs: createClock([4, 9]),
      write: async () => ({ collapsedSummary: 'missing fields' }),
    });

    expect(outcome).toEqual({
      schemaVersion: 1,
      status: 'error',
      error: 'Interpolator writer returned an invalid result.',
      durationMs: 5,
      reasonCodes: ['writer_result_invalid'],
      diagnostics: {
        redacted: false,
        normalized: false,
      },
    });
  });

  it('returns an error outcome for empty summaries', async () => {
    const outcome = await executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT,
      nowMs: createClock([1, 2]),
      write: async () => createWriterResult({ collapsedSummary: '   ' }),
    });

    expect(outcome).toEqual({
      schemaVersion: 1,
      status: 'error',
      error: 'Interpolator writer returned an empty summary.',
      durationMs: 1,
      reasonCodes: ['writer_result_missing_summary'],
      diagnostics: {
        redacted: false,
        normalized: false,
      },
    });
  });

  it('sanitizes thrown writer errors into a bounded error outcome', async () => {
    const outcome = await executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT,
      nowMs: createClock([0, 4]),
      write: async () => {
        throw new Error('provider\u0000failed\nwith details');
      },
    });

    expect(outcome).toEqual({
      schemaVersion: 1,
      status: 'error',
      error: 'provider failed with details',
      durationMs: 4,
      reasonCodes: ['writer_execution_failed'],
      diagnostics: {
        redacted: false,
        normalized: false,
      },
    });
  });

  it('propagates aborts before execution and from the writer function', async () => {
    const preAborted = new AbortController();
    preAborted.abort();

    await expect(executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT,
      signal: preAborted.signal,
      write: async () => createWriterResult(),
    })).rejects.toMatchObject({ name: 'AbortError' });

    const abortError = new Error('aborted');
    abortError.name = 'AbortError';

    await expect(executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT,
      write: async () => {
        throw abortError;
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not mutate the writer input while executing', async () => {
    const before = JSON.stringify(WRITER_INPUT);

    await executeConversationCoordinatorWriterStage({
      writerInput: WRITER_INPUT,
      write: async () => createWriterResult(),
    });

    expect(JSON.stringify(WRITER_INPUT)).toBe(before);
  });
});

function createClock(values: number[]): () => number {
  const queue = [...values];
  return () => queue.shift() ?? values[values.length - 1] ?? 0;
}
