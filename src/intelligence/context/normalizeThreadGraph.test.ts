import { describe, expect, it } from 'vitest';
import type { ThreadNode } from '../../lib/resolver/atproto';
import { normalizeThreadGraph } from './normalizeThreadGraph';

function node(overrides: Partial<ThreadNode> & { uri: string }): ThreadNode {
  return {
    uri: overrides.uri,
    authorDid: overrides.authorDid ?? 'did:example:author',
    authorHandle: overrides.authorHandle ?? 'author.test',
    authorName: overrides.authorName,
    text: overrides.text ?? '',
    likeCount: overrides.likeCount ?? 0,
    replyCount: overrides.replyCount ?? 0,
    embed: overrides.embed,
    replies: overrides.replies ?? [],
  } as ThreadNode;
}

describe('normalizeThreadGraph resilience', () => {
  it('marks external-link presence for external embed posts', () => {
    const root = node({
      uri: 'at://did:example/app.bsky.feed.post/root',
      embed: { kind: 'external' } as any,
    });

    const graph = normalizeThreadGraph(root);
    expect(graph.root.hasExternalLink).toBe(true);
  });

  it('includes direct parent and siblings for non-root focal posts', () => {
    const focal = node({
      uri: 'at://did:example/app.bsky.feed.post/focal',
      authorDid: 'did:example:focal',
      authorHandle: 'focal.test',
      text: 'focal post',
    });

    const sibling = node({
      uri: 'at://did:example/app.bsky.feed.post/sibling',
      authorDid: 'did:example:sibling',
      authorHandle: 'sibling.test',
      text: 'sibling post',
      likeCount: 2,
      replyCount: 1,
    });

    const root = node({
      uri: 'at://did:example/app.bsky.feed.post/root',
      text: 'root',
      replyCount: 2,
      replies: [focal, sibling],
    });

    const graph = normalizeThreadGraph(root, focal.uri);

    expect(graph.directParent?.uri).toBe(root.uri);
    expect(graph.siblingReplies.some((entry) => entry.uri === sibling.uri)).toBe(true);
  });

  it('fails closed and does not throw for malformed input', () => {
    const malformed = { uri: 'at://malformed/root' } as ThreadNode;

    const graph = normalizeThreadGraph(malformed);

    expect(graph.root.uri).toBe('at://malformed/root');
    expect(Array.isArray(graph.ancestors)).toBe(true);
    expect(Array.isArray(graph.branch)).toBe(true);
    expect(Array.isArray(graph.siblingReplies)).toBe(true);
    expect(graph.totalReplyCount).toBeGreaterThanOrEqual(0);
  });
});
