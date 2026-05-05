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

  it('scores evidence signals from quoted post text, not just the author commentary', () => {
    // Author only wrote brief commentary — the actual source lives in the quoted post.
    const quoteReply: ThreadNode = {
      uri: 'at://reply/quote',
      cid: 'at://reply/quote-cid',
      authorDid: 'did:plc:quote.author',
      authorHandle: 'quote.author',
      text: 'This confirms it.',
      createdAt: '2026-04-08T00:00:00.000Z',
      likeCount: 12,
      replyCount: 0,
      repostCount: 0,
      facets: [],
      embed: {
        kind: 'record',
        quotedUri: 'at://original/post',
        quotedAuthorDid: 'did:plc:original',
        quotedAuthorHandle: 'original.author',
        quotedText: 'I posted the full advisory PDF from NIST showing the CVE details and patch timeline.',
      },
      labels: [],
      depth: 1,
      replies: [],
    };

    const scores = scoreAllReplies(
      'Critical zero-day vulnerability disclosed by NIST.',
      [quoteReply],
    );

    // Should be scored as a source_bringer because the quoted post carries citation signals,
    // even though the author's own text ("This confirms it.") has none.
    expect(scores[quoteReply.uri]?.role).toMatch(/source_bringer|rule_source|new_information|useful_counterpoint/);
    expect(scores[quoteReply.uri]?.factualContribution).toBeGreaterThan(0);
  });

  it('includes entities mentioned in quoted post in the entity impact list', () => {
    const quoteReply: ThreadNode = {
      uri: 'at://reply/entity-quote',
      cid: 'at://reply/entity-quote-cid',
      authorDid: 'did:plc:reposter',
      authorHandle: 'reposter',
      text: 'Worth reading.',
      createdAt: '2026-04-08T00:00:00.000Z',
      likeCount: 5,
      replyCount: 0,
      repostCount: 0,
      facets: [],
      embed: {
        kind: 'recordWithMedia',
        quotedUri: 'at://original/media-post',
        quotedAuthorDid: 'did:plc:original2',
        quotedAuthorHandle: 'original2.author',
        quotedText: 'The European Commission issued a statement on AI regulation enforcement.',
        mediaImages: [{ url: 'https://example.com/img.jpg', alt: '' }],
      },
      labels: [],
      depth: 1,
      replies: [],
    };

    const scores = scoreAllReplies(
      'EU regulatory news.',
      [quoteReply],
    );

    // Entity extraction should pick up "European Commission" from the quoted text.
    const entityTexts = (scores[quoteReply.uri]?.entityImpacts ?? []).map(e => e.entityText.toLowerCase());
    const hasCommission = entityTexts.some(t => t.includes('european') || t.includes('commission') || t.includes('eu'));
    expect(hasCommission).toBe(true);
  });
});
