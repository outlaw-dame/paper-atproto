import { describe, expect, it } from 'vitest';
import type { MockPost } from '../../data/mockData';
import {
  projectComposeSheetComposerContext,
  projectHostedThreadComposerContext,
} from './composerProjection';

function makeReplyTarget(overrides: Partial<MockPost> = {}): MockPost {
  return {
    id: 'at://did:plc:test/app.bsky.feed.post/reply',
    cid: 'cid-reply',
    content: 'Parent post content',
    createdAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    author: {
      did: 'did:plc:test',
      handle: 'tester.bsky.social',
      displayName: 'Tester',
    },
    repostCount: 0,
    replyCount: 7,
    likeCount: 0,
    bookmarkCount: 0,
    chips: [],
    replyTo: {
      id: 'at://did:plc:test/app.bsky.feed.post/comment',
      cid: 'cid-comment',
      content: 'Nearby comment',
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      author: {
        did: 'did:plc:comment',
        handle: 'commenter.bsky.social',
        displayName: 'Commenter',
      },
      repostCount: 0,
      replyCount: 0,
      likeCount: 0,
      bookmarkCount: 0,
      chips: [],
    },
    threadRoot: {
      id: 'at://did:plc:test/app.bsky.feed.post/root',
      cid: 'cid-root',
      content: 'Root thread content',
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      author: {
        did: 'did:plc:root',
        handle: 'rooter.bsky.social',
        displayName: 'Rooter',
      },
      repostCount: 0,
      replyCount: 12,
      likeCount: 0,
      bookmarkCount: 0,
      chips: [],
    },
    ...overrides,
  };
}

describe('composerProjection helpers', () => {
  it('uses the projected session context for compose sheet guidance and sanitizes draft text', () => {
    const context = projectComposeSheetComposerContext({
      draftText: 'Hello\u0007 world',
      replyTarget: makeReplyTarget(),
      projectedContext: {
        mode: 'reply',
        draftText: '',
        directParent: {
          uri: 'at://did:plc:test/app.bsky.feed.post/reply',
          text: 'Projected parent',
          authorHandle: 'projected.bsky.social',
        },
        threadContext: {
          rootText: 'Projected root',
          ancestorTexts: ['Ancestor one'],
          branchTexts: ['Branch one'],
        },
        replyContext: {
          siblingReplyTexts: ['Sibling one'],
          selectedCommentTexts: ['Selected one'],
          totalCommentCount: 9,
        },
        summaries: {
          threadSummary: 'Summary',
        },
      },
    });

    expect(context.mode).toBe('reply');
    expect(context.draftText).toBe('Hello world');
    expect(context.directParent?.text).toBe('Projected parent');
    expect(context.threadContext?.rootText).toBe('Projected root');
    expect(context.replyContext?.selectedCommentTexts).toEqual(['Selected one']);
    expect(context.summaries?.threadSummary).toBe('Summary');
  });

  it('falls back to reply target context when no session projection exists', () => {
    const context = projectComposeSheetComposerContext({
      draftText: 'Draft reply',
      replyTarget: makeReplyTarget(),
      projectedContext: null,
    });

    expect(context.mode).toBe('reply');
    expect(context.directParent?.text).toBe('Parent post content');
    expect(context.threadContext?.rootText).toBe('Root thread content');
    expect(context.replyContext?.selectedCommentTexts).toEqual(['Nearby comment']);
    expect(context.replyContext?.totalReplyCount).toBe(7);
  });

  it('sanitizes and bounds hosted thread context', () => {
    const context = projectHostedThreadComposerContext({
      draftText: '  draft\u0007 text  ',
      prompt: `  ${'A'.repeat(340)}  `,
      description: 'Description\u0007 with control chars',
      source: '  https://example.com/story  ',
      topics: ['#alpha', '#alpha', `#${'b'.repeat(80)}`],
      audience: 'Everyone',
    });

    expect(context.mode).toBe('hosted_thread');
    expect(context.draftText).toBe('draft text');
    expect(context.hostedThread?.prompt.endsWith('...')).toBe(true);
    expect(context.hostedThread?.description).toBe('Description with control chars');
    expect(context.hostedThread?.source).toBe('https://example.com/story');
    expect(context.hostedThread?.topics?.[0]).toBe('#alpha');
    expect(context.hostedThread?.topics?.[1]?.startsWith('#')).toBe(true);
    expect(context.hostedThread?.topics?.[1]?.endsWith('...')).toBe(true);
    expect(context.hostedThread?.topics?.[1]?.length).toBeLessThanOrEqual(48);
  });
});
