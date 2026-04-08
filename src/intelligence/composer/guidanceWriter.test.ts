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
    expect(request.parentSignals).toEqual(expect.arrayContaining([
      'Parent is asking for specifics',
      'Deep context: Transit riders are worried about weekend service gaps.',
      'Missing context: No visible reply from riders who depend on late-night service',
      'Open question: Did the agency publish ridership data for weekends?',
    ]));
  });
});
