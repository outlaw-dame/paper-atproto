import { describe, expect, it } from 'vitest';

import { buildInterpolatorSummary } from './buildInterpolatorSummary';
import { scoreAllReplies } from './scoreThread';
import type { ThreadNode } from '../lib/resolver/atproto';

function makeReply(params: {
  uri: string;
  authorDid: string;
  authorHandle: string;
  text: string;
  likeCount?: number;
}): ThreadNode {
  return {
    uri: params.uri,
    cid: `${params.uri}-cid`,
    authorDid: params.authorDid,
    authorHandle: params.authorHandle,
    text: params.text,
    createdAt: '2026-04-08T00:00:00.000Z',
    likeCount: params.likeCount ?? 0,
    replyCount: 0,
    repostCount: 0,
    facets: [],
    embed: null,
    labels: [],
    depth: 1,
    replies: [],
  };
}

describe('buildInterpolatorSummary perspective gaps', () => {
  it('grounds source gaps in the actual claim instead of generic visible-reply text', () => {
    const rootText = 'New Claude found zero-days in OpenBSD, ffmpeg, Linux and FreeBSD.';
    const replies = [
      makeReply({
        uri: 'at://reply/1',
        authorDid: 'did:plc:reply.one',
        authorHandle: 'reply.one',
        text: 'This sounds like earlier AI exploit reports unless someone posts the advisory.',
        likeCount: 8,
      }),
      makeReply({
        uri: 'at://reply/2',
        authorDid: 'did:plc:reply.two',
        authorHandle: 'reply.two',
        text: 'One reply points to a blog post but not the primary disclosure.',
        likeCount: 7,
      }),
    ];
    const scores = scoreAllReplies(rootText, replies);

    const summary = buildInterpolatorSummary(rootText, replies, scores);

    expect(summary.perspectiveGaps ?? []).toEqual(
      expect.arrayContaining([
        expect.stringContaining('direct sourcing or verifiable evidence'),
        expect.stringContaining('counterpoint'),
      ]),
    );
    expect((summary.perspectiveGaps ?? []).join(' ')).not.toContain('Visible replies add limited new context beyond the root claim so far.');
  });
});
