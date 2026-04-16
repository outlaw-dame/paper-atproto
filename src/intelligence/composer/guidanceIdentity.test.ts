import { describe, expect, it } from 'vitest';
import type { ComposerContext } from './types';
import {
  createComposerContextFingerprint,
  createComposerDraftId,
} from './guidanceIdentity';

function makeReplyContext(): ComposerContext {
  return {
    mode: 'reply',
    draftText: 'Draft a careful reply',
    directParent: {
      uri: 'at://did:plc:reply/app.bsky.feed.post/reply',
      text: 'Parent reply text',
      authorHandle: 'reply.test',
    },
    summaries: {
      threadSummary: 'People are debating whether the memo is authentic.',
      premiumContext: {
        groundedContext: 'Riders are worried about weekend service gaps.',
        perspectiveGaps: ['No agency response yet'],
        followUpQuestions: ['Did the agency publish ridership data?'],
        confidence: 0.78,
      },
      mediaContext: {
        summary: 'A screenshot of a redlined transit policy memo.',
        primaryKind: 'document',
        cautionFlags: ['partial-view'],
        confidence: 0.74,
      },
    },
  };
}

describe('composer guidance identity helpers', () => {
  it('keeps draft identity stable across background context churn for the same draft', () => {
    const base = makeReplyContext();
    const changed = {
      ...base,
      summaries: {
        ...base.summaries,
        threadSummary: 'People are now debating whether the memo text matches an earlier draft.',
        premiumContext: {
          ...base.summaries!.premiumContext!,
          followUpQuestions: ['Did the agency publish the final memo?'],
        },
      },
    } satisfies ComposerContext;

    expect(createComposerDraftId('compose-sheet', base)).toBe(
      createComposerDraftId('compose-sheet', changed),
    );
    expect(createComposerContextFingerprint(base)).not.toBe(
      createComposerContextFingerprint(changed),
    );
  });

  it('changes draft identity when the reply target changes', () => {
    const base = makeReplyContext();
    const changed = {
      ...base,
      directParent: {
        ...base.directParent!,
        uri: 'at://did:plc:reply/app.bsky.feed.post/other-reply',
      },
    } satisfies ComposerContext;

    expect(createComposerDraftId('compose-sheet', base)).not.toBe(
      createComposerDraftId('compose-sheet', changed),
    );
  });
});
