import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCallComposerGuidanceWriter } = vi.hoisted(() => ({
  mockCallComposerGuidanceWriter: vi.fn(),
}));

vi.mock('../modelClient', () => ({
  callComposerGuidanceWriter: mockCallComposerGuidanceWriter,
}));

import { createEmptyComposerGuidanceResult } from './guidanceScoring';
import { maybeWriteComposerGuidance } from './guidanceWriter';
import type { ComposerContext } from './types';

describe('composer guidance writer', () => {
  beforeEach(() => {
    mockCallComposerGuidanceWriter.mockReset();
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
          perspectiveGaps: ['No visible reply from riders who depend on late-night service'],
          followUpQuestions: ['Did the agency publish ridership data for weekends?'],
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
    expect(joinedSignals).toContain('Open question: Did the agency publish ridership data for weekends?');
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
});
