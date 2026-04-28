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
