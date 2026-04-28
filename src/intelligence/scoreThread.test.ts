import { describe, expect, it } from 'vitest';

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

describe('scoreThread deterministic role scoring', () => {
  it('treats source-gap replies as clarifying instead of sourced evidence', () => {
    const reply = makeReply({
      uri: 'at://reply/1',
      authorDid: 'did:plc:reply.one',
      authorHandle: 'reply.one',
      text: 'This sounds like earlier AI exploit reports unless someone posts the advisory.',
      likeCount: 8,
    });

    const scores = scoreAllReplies(
      'New Claude found zero-days in OpenBSD, ffmpeg, Linux and FreeBSD.',
      [reply],
    );

    expect(scores[reply.uri]?.role).toBe('clarifying');
    expect(scores[reply.uri]?.evidenceSignals.some((signal) => signal.kind === 'citation')).toBe(false);
  });

  it('distinguishes official source posts from corrective counterpoints', () => {
    const sourceReply = makeReply({
      uri: 'at://reply/source',
      authorDid: 'did:plc:pdf.source',
      authorHandle: 'pdf.source',
      text: 'I posted the board agenda PDF. It says enforcement is paused for middle schools while the policy is reviewed.',
      likeCount: 9,
    });
    const counterpointReply = makeReply({
      uri: 'at://reply/counter',
      authorDid: 'did:plc:counter.beta',
      authorHandle: 'counter.beta',
      text: 'That is narrower than a full rollback. The vote text is about enforcement timing, not repealing the policy.',
      likeCount: 8,
    });

    const scores = scoreAllReplies(
      'School board is pausing the attendance crackdown next month.',
      [sourceReply, counterpointReply],
    );

    expect(scores[sourceReply.uri]?.role).toBe('rule_source');
    expect(scores[sourceReply.uri]?.evidenceSignals.some((signal) => signal.kind === 'citation')).toBe(true);
    expect(scores[counterpointReply.uri]?.role).toBe('useful_counterpoint');
  });

  it('does not treat requests for a public order or notice as source-backed evidence', () => {
    const reply = makeReply({
      uri: 'at://reply/order-gap',
      authorDid: 'did:plc:skeptic.one',
      authorHandle: 'skeptic.one',
      text: 'Do you have the order? I only see people quoting each other and asking for the notice.',
      likeCount: 9,
    });

    const scores = scoreAllReplies(
      'County is banning all night events starting tonight.',
      [reply],
    );

    expect(scores[reply.uri]?.role).toBe('clarifying');
    expect(scores[reply.uri]?.evidenceSignals.some((signal) => signal.kind === 'citation')).toBe(false);
  });

  it('captures narrower exemption replies as useful counterpoints', () => {
    const reply = makeReply({
      uri: 'at://reply/exemption',
      authorDid: 'did:plc:counter.three',
      authorHandle: 'counter.three',
      text: 'That is not killing the policy. It is a narrower exemption.',
      likeCount: 8,
    });

    const scores = scoreAllReplies(
      'University killed the mask policy after yesterday\'s meeting.',
      [reply],
    );

    expect(scores[reply.uri]?.role).toBe('useful_counterpoint');
  });
});
