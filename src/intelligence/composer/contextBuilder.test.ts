import { describe, expect, it } from 'vitest';

import type { ComposerContext } from './types';
import { toAnalyzeOptions } from './contextBuilder';

describe('composer contextBuilder', () => {
  it('includes premium and media summary signals in analyze options', () => {
    const context: ComposerContext = {
      mode: 'reply',
      draftText: 'Draft reply',
      directParent: {
        text: 'Parent text',
        authorHandle: 'author.test',
      },
      threadContext: {
        rootText: 'Root text',
        ancestorTexts: ['Ancestor text'],
        branchTexts: ['Branch text'],
      },
      replyContext: {
        siblingReplyTexts: ['Sibling one'],
        selectedCommentTexts: ['Selected one'],
        totalReplyCount: 12,
        totalCommentCount: 18,
        totalThreadCount: 7,
      },
      summaries: {
        premiumContext: {
          groundedContext: 'Riders are asking whether the service memo is authentic.',
          perspectiveGaps: ['No agency response is visible yet.'],
          followUpQuestions: ['Did the agency publish the full memo?'],
          confidence: 0.82,
        },
        mediaContext: {
          summary: 'A screenshot of a transit memo with weekend cuts highlighted.',
          primaryKind: 'document',
          cautionFlags: ['partial-view'],
          confidence: 0.73,
          analysisStatus: 'degraded',
          moderationStatus: 'unavailable',
        },
      },
      threadState: {
        dominantTone: 'contested',
        conversationPhase: 'active',
      },
    };

    const options = toAnalyzeOptions(context);

    expect(options.targetText).toBe('@author.test');
    expect(options.contextSignals).toEqual(expect.arrayContaining([
      'Deep context: Riders are asking whether the service memo is authentic.',
      'Missing context: No agency response is visible yet.',
      'Open question: Did the agency publish the full memo?',
      'Media context: A screenshot of a transit memo with weekend cuts highlighted. (low-authority hint)',
      'Media caution: partial-view',
      'Thread state: active / contested',
    ]));
  });
});
