import { describe, expect, it } from 'vitest';

import { buildThreadStateForWriter } from './writerInput';
import type { InterpolatorState } from './interpolatorTypes';
import type { ThreadNode } from '../lib/resolver/atproto';

function makeReply(params: {
  uri: string;
  text: string;
  authorDid: string;
  authorHandle: string;
  likeCount?: number;
  replyCount?: number;
}): ThreadNode {
  return {
    uri: params.uri,
    cid: `${params.uri}-cid`,
    authorDid: params.authorDid,
    authorHandle: params.authorHandle,
    text: params.text,
    createdAt: '2026-04-07T00:00:00.000Z',
    likeCount: params.likeCount ?? 0,
    replyCount: params.replyCount ?? 0,
    repostCount: 0,
    facets: [],
    embed: null,
    labels: [],
    depth: 1,
    replies: [],
  };
}

describe('buildThreadStateForWriter', () => {
  it('carries sanitized media findings into the writer contract', () => {
    const state: InterpolatorState = {
      rootUri: 'at://root',
      summaryText: '',
      salientClaims: [],
      salientContributors: [],
      clarificationsAdded: [],
      newAnglesAdded: [],
      repetitionLevel: 0,
      heatLevel: 0,
      sourceSupportPresent: false,
      updatedAt: new Date().toISOString(),
      version: 1,
      replyScores: {},
      entityLandscape: [],
      topContributors: [],
      evidencePresent: false,
      factualSignalPresent: false,
      lastTrigger: null,
      triggerHistory: [],
    };

    const output = buildThreadStateForWriter(
      'thread-1',
      'Root text about a screenshot',
      state,
      {},
      [],
      {
        surfaceConfidence: 0.7,
        entityConfidence: 0.6,
        interpretiveConfidence: 0.6,
      },
      undefined,
      'root.test',
      {
        summaryMode: 'normal',
        mediaFindings: [
          {
            mediaType: 'document',
            summary: '  This image shows a redlined policy draft with effective dates and highlighted changes.  ',
            confidence: 2,
            extractedText: '   EFFECTIVE JANUARY 1 FOR FEDERAL CONTRACTORS   ',
            cautionFlags: ['  partial-view  ', 'partial-view', 'cropped context'],
          },
        ],
      },
    );

    expect(output.mediaFindings).toEqual([
      {
        mediaType: 'document',
        summary: 'This image shows a redlined policy draft with effective dates and highlighted changes.',
        confidence: 1,
        extractedText: 'EFFECTIVE JANUARY 1 FOR FEDERAL CONTRACTORS',
        cautionFlags: ['partial-view', 'cropped context'],
      },
    ]);
  });

  it('includes contributor point excerpts and crowd resonance cues', () => {
    const state: InterpolatorState = {
      rootUri: 'at://root',
      summaryText: '',
      salientClaims: [],
      salientContributors: [],
      clarificationsAdded: [],
      newAnglesAdded: [],
      repetitionLevel: 0,
      heatLevel: 0,
      sourceSupportPresent: false,
      updatedAt: new Date().toISOString(),
      version: 1,
      replyScores: {},
      entityLandscape: [],
      topContributors: [
        {
          did: 'did:plc:bob',
          handle: 'bob.test',
          totalReplies: 2,
          avgUsefulnessScore: 0.79,
          dominantRole: 'useful_counterpoint',
          factualContributions: 1,
        },
      ],
      evidencePresent: true,
      factualSignalPresent: true,
      lastTrigger: null,
      triggerHistory: [],
    };

    const replies = [
      makeReply({
        uri: 'at://reply/1',
        text: 'Other tournaments have the same quality dip, but people still love the title game.',
        authorDid: 'did:plc:bob',
        authorHandle: 'bob.test',
        likeCount: 11,
        replyCount: 3,
      }),
      makeReply({
        uri: 'at://reply/2',
        text: 'The media narrative is louder than what players and fans actually felt watching it.',
        authorDid: 'did:plc:bob',
        authorHandle: 'bob.test',
        likeCount: 7,
        replyCount: 1,
      }),
    ];

    const output = buildThreadStateForWriter(
      'thread-2',
      'Root post about championship quality debates.',
      state,
      {
        'at://reply/1': {
          uri: 'at://reply/1',
          role: 'useful_counterpoint',
          finalInfluenceScore: 0.86,
          clarificationValue: 0.62,
          sourceSupport: 0.58,
          visibleChips: [],
          factual: null,
          usefulnessScore: 0.82,
          abuseScore: 0,
          evidenceSignals: [],
          entityImpacts: [],
          scoredAt: new Date().toISOString(),
        },
        'at://reply/2': {
          uri: 'at://reply/2',
          role: 'useful_counterpoint',
          finalInfluenceScore: 0.74,
          clarificationValue: 0.45,
          sourceSupport: 0.3,
          visibleChips: [],
          factual: null,
          usefulnessScore: 0.72,
          abuseScore: 0,
          evidenceSignals: [],
          entityImpacts: [],
          scoredAt: new Date().toISOString(),
        },
      },
      replies,
      {
        surfaceConfidence: 0.72,
        entityConfidence: 0.66,
        interpretiveConfidence: 0.64,
      },
      undefined,
      'alice.test',
      { summaryMode: 'normal' },
    );

    expect(output.topContributors).toHaveLength(1);
    expect(output.topContributors[0]?.stanceSummary).toContain('main point:');
    expect(output.topContributors[0]?.stanceExcerpt).toContain('Other tournaments have the same quality dip');
    expect(output.topContributors[0]?.resonance).toBe('high');
    expect(output.topContributors[0]?.agreementSignal).toBe('resonated strongly with other participants');
  });
});
