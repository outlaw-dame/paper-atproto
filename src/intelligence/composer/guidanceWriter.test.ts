import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCallComposerGuidanceWriter } = vi.hoisted(() => ({
  mockCallComposerGuidanceWriter: vi.fn(),
}));

vi.mock('../modelClient', () => ({
  callComposerGuidanceWriter: mockCallComposerGuidanceWriter,
}));

import { createEmptyComposerGuidanceResult } from './guidanceScoring';
import { maybeWriteComposerGuidance } from './guidanceWriter';
import {
  __resetDecisionFeedForTesting,
  getDecisionFeedSnapshot,
} from '../coordinator/decisionFeed';
import type { ComposerContext } from './types';

describe('composer guidance writer', () => {
  beforeEach(() => {
    mockCallComposerGuidanceWriter.mockReset();
    __resetDecisionFeedForTesting();
  });

  it('passes premium Gemini context into composer writer signals', async () => {
    mockCallComposerGuidanceWriter.mockResolvedValueOnce({
      message: 'Keep it focused.',
      badges: ['Tone'],
    });

    const context: ComposerContext = {
      mode: 'reply',
      draftText: 'Draft reply text',
      directParent: {
        text: 'Parent reply',
      },
      summaries: {
        premiumContext: {
          deepSummary: 'Deep summary.',
          groundedContext: 'Transit riders are worried about weekend service gaps.',
          perspectiveGaps: [
            'No visible reply from riders who depend on late-night service',
            'No agency statement explains whether weekend cuts are temporary',
          ],
          followUpQuestions: [
            'Did the agency publish ridership data for weekends?',
            'Has the city posted the full service memo?',
          ],
          confidence: 0.78,
        },
      },
    };

    const guidance = createEmptyComposerGuidanceResult('reply');
    guidance.ui.state = 'caution';
    guidance.heuristics.parentSignals = ['Parent is asking for specifics'];

    await maybeWriteComposerGuidance(context, guidance);

    expect(mockCallComposerGuidanceWriter).toHaveBeenCalledTimes(1);
    const request = mockCallComposerGuidanceWriter.mock.calls[0]?.[0] as { parentSignals: string[] };
    const joinedSignals = request.parentSignals.join(' || ');
    expect(joinedSignals).toContain('Parent is asking for specifics');
    expect(joinedSignals).toContain('Deep context: Transit riders are worried about weekend service gaps.');
    expect(joinedSignals).toContain('Missing context: No visible reply from riders who depend on late-night service');
    expect(joinedSignals).toContain('No agency statement explains whether weekend cuts are temporary');
    expect(joinedSignals).toContain('Open questions: Did the agency publish ridership data for weekends? | Has the city posted the full service memo?');
  });

  it('passes media context into composer writer signals without displacing all thread context', async () => {
    mockCallComposerGuidanceWriter.mockResolvedValueOnce({
      message: 'Keep it grounded.',
      badges: ['Context'],
    });

    const context: ComposerContext = {
      mode: 'reply',
      draftText: 'Draft reply text',
      directParent: {
        text: 'Parent reply',
      },
      summaries: {
        mediaContext: {
          summary: 'A screenshot of a redlined transit policy memo. Visible text includes: WEEKEND SERVICE REDUCTION.',
          primaryKind: 'document',
          cautionFlags: ['partial-view'],
          confidence: 0.74,
        },
        premiumContext: {
          groundedContext: 'Transit riders are worried about weekend service gaps.',
          perspectiveGaps: ['No visible reply from riders who depend on late-night service'],
          followUpQuestions: ['Did the agency publish ridership data for weekends?'],
          confidence: 0.78,
        },
      },
    };

    const guidance = createEmptyComposerGuidanceResult('reply');
    guidance.ui.state = 'warning';
    guidance.heuristics.parentSignals = ['Parent is asking for specifics'];

    await maybeWriteComposerGuidance(context, guidance);

    const request = mockCallComposerGuidanceWriter.mock.calls[0]?.[0] as { parentSignals: string[] };
    expect(request.parentSignals.length).toBeLessThanOrEqual(4);
    expect(request.parentSignals.join(' || ')).toContain('Media context: A screenshot of a redlined transit policy memo.');
    expect(request.parentSignals.join(' || ')).toContain('Caution: partial-view.');
    expect(request.parentSignals.join(' || ')).toContain('Parent is asking for specifics');
  });

  it('reserves parent signal slots for premium and media context when heuristic signals are saturated', async () => {
    mockCallComposerGuidanceWriter.mockResolvedValueOnce({
      message: 'Keep it grounded.',
      badges: ['Context'],
    });

    const context: ComposerContext = {
      mode: 'reply',
      draftText: 'Draft reply text',
      directParent: {
        text: 'Parent reply',
      },
      summaries: {
        mediaContext: {
          summary: 'A screenshot of a redlined transit policy memo.',
          primaryKind: 'document',
          cautionFlags: ['partial-view'],
          confidence: 0.74,
          analysisStatus: 'degraded',
          moderationStatus: 'unavailable',
        },
        premiumContext: {
          deepSummary: 'Replies are debating whether the leaked memo is authentic.',
          groundedContext: 'Transit riders are worried about weekend service gaps.',
          perspectiveGaps: ['No visible reply from riders who depend on late-night service'],
          followUpQuestions: ['Did the agency publish ridership data for weekends?'],
          confidence: 0.78,
        },
      },
    };

    const guidance = createEmptyComposerGuidanceResult('reply');
    guidance.ui.state = 'warning';
    guidance.heuristics.parentSignals = [
      'Parent is asking for specifics',
      'Parent disputes the source',
      'Parent is focused on timing',
      'Parent wants a cite',
      'Parent is watching tone',
    ];

    await maybeWriteComposerGuidance(context, guidance);

    const request = mockCallComposerGuidanceWriter.mock.calls[0]?.[0] as { parentSignals: string[] };
    const joinedSignals = request.parentSignals.join(' || ');
    expect(request.parentSignals.length).toBeLessThanOrEqual(4);
    expect(joinedSignals).toContain('Deep context: Transit riders are worried about weekend service gaps.');
    expect(joinedSignals).toContain('Media context: A screenshot of a redlined transit policy memo.');
    expect(joinedSignals).toContain('Use this as a low-authority media hint.');
    expect(joinedSignals).toContain('Moderation status is unavailable.');
  });

  it('uses deep summary when grounded premium context is missing', async () => {
    mockCallComposerGuidanceWriter.mockResolvedValueOnce({
      message: 'Stay concrete.',
      badges: ['Context'],
    });

    const context: ComposerContext = {
      mode: 'reply',
      draftText: 'Draft reply text',
      directParent: {
        text: 'Parent reply',
      },
      summaries: {
        premiumContext: {
          deepSummary: 'Replies are debating whether the leaked memo is authentic.',
          perspectiveGaps: [],
          followUpQuestions: [],
          confidence: 0.7,
        },
      },
    };

    const guidance = createEmptyComposerGuidanceResult('reply');
    guidance.ui.state = 'caution';

    await maybeWriteComposerGuidance(context, guidance);

    const request = mockCallComposerGuidanceWriter.mock.calls[0]?.[0] as { parentSignals: string[] };
    expect(request.parentSignals.join(' || ')).toContain('Deep summary: Replies are debating whether the leaked memo is authentic.');
  });

  it('publishes a composer preflight decision when decision-feed instrumentation is enabled', async () => {
    const context: ComposerContext = {
      mode: 'reply',
      draftText: 'ok',
    };
    const guidance = createEmptyComposerGuidanceResult('reply');
    guidance.ui.state = 'caution';

    const output = await maybeWriteComposerGuidance(context, guidance, undefined, {
      decisionFeed: {
        enabled: true,
        sessionId: 'draft-1',
        sourceToken: 'ctx-1',
      },
    });

    expect(output).toBe(guidance);
    expect(mockCallComposerGuidanceWriter).not.toHaveBeenCalled();
    const snapshot = getDecisionFeedSnapshot();
    expect(snapshot.records.length).toBe(1);
    expect(snapshot.records[0]?.surface).toBe('composer_writer_preflight');
    expect(snapshot.records[0]?.sessionId).toBe('draft-1');
    expect(snapshot.records[0]?.sourceToken).toBe('ctx-1');
    if (snapshot.records[0]?.summary.kind !== 'composer_writer_preflight') {
      throw new Error('wrong summary kind');
    }
    expect(snapshot.records[0].summary.safeToWrite).toBe(false);
  });
});
