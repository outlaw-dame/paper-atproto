import { describe, expect, it } from 'vitest';
import { deriveMediaFactualHints, mergeMediaResults, selectMediaForAnalysis } from './mediaInput';

describe('selectMediaForAnalysis', () => {
  it('drops unsafe local media urls before multimodal analysis', () => {
    const requests = selectMediaForAnalysis(
      'thread-1',
      {
        uri: 'at://root',
        cid: 'cid-root',
        authorDid: 'did:example:root',
        authorHandle: 'root.test',
        text: 'Root text',
        createdAt: new Date().toISOString(),
        likeCount: 0,
        replyCount: 0,
        repostCount: 0,
        facets: [],
        embed: {
          kind: 'images',
          images: [{ url: 'http://localhost:8080/private.png', alt: 'screenshot' }],
        },
        labels: [],
        depth: 0,
        replies: [],
      } as any,
      [],
      {},
    );

    expect(requests).toEqual([]);
  });

  it('handles recordWithMedia embeds and avoids duplicate media urls', () => {
    const requests = selectMediaForAnalysis(
      'thread-1',
      {
        uri: 'at://root',
        cid: 'cid-root',
        authorDid: 'did:example:root',
        authorHandle: 'root.test',
        text: 'Root post references an agency document.',
        createdAt: new Date().toISOString(),
        likeCount: 0,
        replyCount: 0,
        repostCount: 0,
        facets: [],
        embed: {
          kind: 'recordWithMedia',
          mediaImages: [{ url: 'https://cdn.example.com/doc.png', alt: 'Policy memo screenshot' }],
        },
        labels: [],
        depth: 0,
        replies: [],
      } as any,
      [
        {
          uri: 'at://reply',
          cid: 'cid-reply',
          authorDid: 'did:example:reply',
          authorHandle: 'reply.test',
          text: 'Here is the same screenshot again.',
          createdAt: new Date().toISOString(),
          likeCount: 0,
          replyCount: 0,
          repostCount: 0,
          facets: [],
          embed: {
            kind: 'images',
            images: [{ url: 'https://cdn.example.com/doc.png', alt: 'duplicate screenshot' }],
          },
          labels: [],
          depth: 1,
          replies: [],
        } as any,
      ],
      {
        'at://reply': {
          uri: 'at://reply',
          role: 'source_bringer',
          finalInfluenceScore: 0.8,
          clarificationValue: 0.5,
          sourceSupport: 0.9,
          visibleChips: [],
          factual: null,
          usefulnessScore: 0.8,
          abuseScore: 0.01,
          evidenceSignals: [{ kind: 'citation', confidence: 0.9 }],
          entityImpacts: [],
          scoredAt: new Date().toISOString(),
        },
      },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.mediaUrl).toBe('https://cdn.example.com/doc.png');
    expect(requests[0]?.mediaAlt).toBe('Policy memo screenshot');
  });

  it('keeps the default cap at two images when overflow is not enabled', () => {
    const requests = selectMediaForAnalysis(
      'thread-overflow-default',
      {
        uri: 'at://root-default',
        cid: 'cid-root-default',
        authorDid: 'did:example:root-default',
        authorHandle: 'root-default.test',
        text: 'Root post with first image.',
        createdAt: new Date().toISOString(),
        likeCount: 0,
        replyCount: 0,
        repostCount: 0,
        facets: [],
        embed: {
          kind: 'images',
          images: [{ url: 'https://cdn.example.com/root-default.png', alt: 'root image' }],
        },
        labels: [],
        depth: 0,
        replies: [],
      } as any,
      [
        {
          uri: 'at://reply-a',
          cid: 'cid-reply-a',
          authorDid: 'did:example:reply-a',
          authorHandle: 'reply-a.test',
          text: 'Highest score reply image.',
          createdAt: new Date().toISOString(),
          likeCount: 0,
          replyCount: 0,
          repostCount: 0,
          facets: [],
          embed: { kind: 'images', images: [{ url: 'https://cdn.example.com/reply-a.png', alt: 'a' }] },
          labels: [],
          depth: 1,
          replies: [],
        } as any,
        {
          uri: 'at://reply-b',
          cid: 'cid-reply-b',
          authorDid: 'did:example:reply-b',
          authorHandle: 'reply-b.test',
          text: 'Lower score reply image.',
          createdAt: new Date().toISOString(),
          likeCount: 0,
          replyCount: 0,
          repostCount: 0,
          facets: [],
          embed: { kind: 'images', images: [{ url: 'https://cdn.example.com/reply-b.png', alt: 'b' }] },
          labels: [],
          depth: 1,
          replies: [],
        } as any,
      ],
      {
        'at://reply-a': {
          uri: 'at://reply-a',
          role: 'source_bringer',
          finalInfluenceScore: 0.9,
          clarificationValue: 0.1,
          sourceSupport: 0.5,
          visibleChips: [],
          factual: null,
          usefulnessScore: 0.9,
          abuseScore: 0.01,
          evidenceSignals: [],
          entityImpacts: [],
          scoredAt: new Date().toISOString(),
        },
        'at://reply-b': {
          uri: 'at://reply-b',
          role: 'unknown',
          finalInfluenceScore: 0.4,
          clarificationValue: 0.1,
          sourceSupport: 0.2,
          visibleChips: [],
          factual: null,
          usefulnessScore: 0.4,
          abuseScore: 0.01,
          evidenceSignals: [],
          entityImpacts: [],
          scoredAt: new Date().toISOString(),
        },
      },
    );

    expect(requests).toHaveLength(2);
    expect(requests[0]?.mediaUrl).toBe('https://cdn.example.com/root-default.png');
    expect(requests[1]?.mediaUrl).toBe('https://cdn.example.com/reply-a.png');
    expect(requests[0]?.overflow).toBeUndefined();
    expect(requests[1]?.overflow).toBeUndefined();
  });

  it('selects additional overflow images and marks only those as overflow', () => {
    const requests = selectMediaForAnalysis(
      'thread-overflow-enabled',
      {
        uri: 'at://root-overflow',
        cid: 'cid-root-overflow',
        authorDid: 'did:example:root-overflow',
        authorHandle: 'root-overflow.test',
        text: 'Root with image.',
        createdAt: new Date().toISOString(),
        likeCount: 0,
        replyCount: 0,
        repostCount: 0,
        facets: [],
        embed: {
          kind: 'images',
          images: [{ url: 'https://cdn.example.com/root-overflow.png', alt: 'root overflow image' }],
        },
        labels: [],
        depth: 0,
        replies: [],
      } as any,
      [
        {
          uri: 'at://reply-1',
          cid: 'cid-reply-1',
          authorDid: 'did:example:reply-1',
          authorHandle: 'reply-1.test',
          text: 'Top influence reply image',
          createdAt: new Date().toISOString(),
          likeCount: 0,
          replyCount: 0,
          repostCount: 0,
          facets: [],
          embed: { kind: 'images', images: [{ url: 'https://cdn.example.com/reply-1.png', alt: 'reply one' }] },
          labels: [],
          depth: 1,
          replies: [],
        } as any,
        {
          uri: 'at://reply-2',
          cid: 'cid-reply-2',
          authorDid: 'did:example:reply-2',
          authorHandle: 'reply-2.test',
          text: 'Second influence reply image',
          createdAt: new Date().toISOString(),
          likeCount: 0,
          replyCount: 0,
          repostCount: 0,
          facets: [],
          embed: { kind: 'images', images: [{ url: 'https://cdn.example.com/reply-2.png', alt: 'reply two' }] },
          labels: [],
          depth: 1,
          replies: [],
        } as any,
        {
          uri: 'at://reply-3',
          cid: 'cid-reply-3',
          authorDid: 'did:example:reply-3',
          authorHandle: 'reply-3.test',
          text: 'Third influence reply image',
          createdAt: new Date().toISOString(),
          likeCount: 0,
          replyCount: 0,
          repostCount: 0,
          facets: [],
          embed: { kind: 'images', images: [{ url: 'https://cdn.example.com/reply-3.png', alt: 'reply three' }] },
          labels: [],
          depth: 1,
          replies: [],
        } as any,
      ],
      {
        'at://reply-1': {
          uri: 'at://reply-1',
          role: 'source_bringer',
          finalInfluenceScore: 0.95,
          clarificationValue: 0.1,
          sourceSupport: 0.8,
          visibleChips: [],
          factual: null,
          usefulnessScore: 0.95,
          abuseScore: 0.01,
          evidenceSignals: [],
          entityImpacts: [],
          scoredAt: new Date().toISOString(),
        },
        'at://reply-2': {
          uri: 'at://reply-2',
          role: 'source_bringer',
          finalInfluenceScore: 0.8,
          clarificationValue: 0.1,
          sourceSupport: 0.7,
          visibleChips: [],
          factual: null,
          usefulnessScore: 0.8,
          abuseScore: 0.01,
          evidenceSignals: [],
          entityImpacts: [],
          scoredAt: new Date().toISOString(),
        },
        'at://reply-3': {
          uri: 'at://reply-3',
          role: 'unknown',
          finalInfluenceScore: 0.7,
          clarificationValue: 0.1,
          sourceSupport: 0.6,
          visibleChips: [],
          factual: null,
          usefulnessScore: 0.7,
          abuseScore: 0.01,
          evidenceSignals: [],
          entityImpacts: [],
          scoredAt: new Date().toISOString(),
        },
      },
      {
        overflowImageLimit: 2,
      },
    );

    expect(requests).toHaveLength(4);
    expect(requests.map((entry) => entry.mediaUrl)).toEqual([
      'https://cdn.example.com/root-overflow.png',
      'https://cdn.example.com/reply-1.png',
      'https://cdn.example.com/reply-2.png',
      'https://cdn.example.com/reply-3.png',
    ]);
    expect(requests[0]?.overflow).toBeUndefined();
    expect(requests[1]?.overflow).toBeUndefined();
    expect(requests[2]?.overflow).toBe(true);
    expect(requests[3]?.overflow).toBe(true);
  });

  it('derives bounded factual hints from source-heavy replies', () => {
    const hints = deriveMediaFactualHints(
      [
        {
          uri: 'at://reply-1',
          cid: 'cid-reply-1',
          authorDid: 'did:example:reply-1',
          authorHandle: 'reply1.test',
          text: 'Reuters says the memo applies only to federal contractors after January.',
          createdAt: new Date().toISOString(),
          likeCount: 0,
          replyCount: 0,
          repostCount: 0,
          facets: [],
          embed: null,
          labels: [],
          depth: 1,
          replies: [],
        } as any,
      ],
      {
        'at://reply-1': {
          uri: 'at://reply-1',
          role: 'source_bringer',
          finalInfluenceScore: 0.9,
          clarificationValue: 0.5,
          sourceSupport: 0.85,
          visibleChips: [],
          factual: null,
          usefulnessScore: 0.9,
          abuseScore: 0.01,
          evidenceSignals: [{ kind: 'citation', confidence: 0.95 }],
          entityImpacts: [],
          scoredAt: new Date().toISOString(),
        },
      },
    );

    expect(hints).toEqual([
      'Reuters says the memo applies only to federal contractors after January.',
    ]);
  });

  it('preserves degraded analysis state when merging media results', () => {
    const findings = mergeMediaResults([
      {
        mediaCentrality: 0.7,
        mediaType: 'document',
        mediaSummary: 'Fallback caption says the image shows a transit memo.',
        extractedText: 'WEEKEND SERVICE REDUCTION',
        candidateEntities: [],
        confidence: 0.66,
        cautionFlags: ['partial-view'],
        analysisStatus: 'degraded',
        moderationStatus: 'unavailable',
      },
    ]);

    expect(findings).toEqual([
      {
        mediaType: 'document',
        summary: 'Fallback caption says the image shows a transit memo.',
        confidence: 0.66,
        extractedText: 'WEEKEND SERVICE REDUCTION',
        cautionFlags: ['partial-view'],
        analysisStatus: 'degraded',
        moderationStatus: 'unavailable',
      },
    ]);
  });
});
