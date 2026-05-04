import { describe, expect, it } from 'vitest';

import { buildThreadStateForWriter } from './writerInput';
import type { ConversationDeltaDecision } from './conversationDelta';
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

  it('adds the author and strong contributors as person entities', () => {
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
          did: 'did:plc:source',
          handle: 'source.helper',
          totalReplies: 1,
          avgUsefulnessScore: 0.83,
          dominantRole: 'source_bringer',
          factualContributions: 1,
        },
        {
          did: 'did:plc:reactor',
          handle: 'just.reacting',
          totalReplies: 1,
          avgUsefulnessScore: 0.28,
          dominantRole: 'direct_response',
          factualContributions: 0,
        },
      ],
      evidencePresent: true,
      factualSignalPresent: true,
      lastTrigger: null,
      triggerHistory: [],
    };

    const replies = [
      makeReply({
        uri: 'at://reply/source',
        text: 'Here is the internal memo that backs up the claim.',
        authorDid: 'did:plc:source',
        authorHandle: 'source.helper',
        likeCount: 9,
        replyCount: 2,
      }),
      makeReply({
        uri: 'at://reply/reactor',
        text: 'wow if true',
        authorDid: 'did:plc:reactor',
        authorHandle: 'just.reacting',
      }),
    ];

    const output = buildThreadStateForWriter(
      'thread-3',
      'Root post about an internal memo leak.',
      state,
      {
        'at://reply/source': {
          uri: 'at://reply/source',
          role: 'source_bringer',
          finalInfluenceScore: 0.86,
          clarificationValue: 0.44,
          sourceSupport: 0.76,
          visibleChips: [],
          factual: null,
          usefulnessScore: 0.82,
          abuseScore: 0,
          evidenceSignals: [],
          entityImpacts: [],
          scoredAt: new Date().toISOString(),
        },
        'at://reply/reactor': {
          uri: 'at://reply/reactor',
          role: 'direct_response',
          finalInfluenceScore: 0.22,
          clarificationValue: 0.1,
          sourceSupport: 0.05,
          visibleChips: [],
          factual: null,
          usefulnessScore: 0.22,
          abuseScore: 0,
          evidenceSignals: [],
          entityImpacts: [],
          scoredAt: new Date().toISOString(),
        },
      },
      replies,
      {
        surfaceConfidence: 0.66,
        entityConfidence: 0.54,
        interpretiveConfidence: 0.49,
      },
      undefined,
      'author.test',
      { summaryMode: 'descriptive_fallback' },
    );

    expect(output.safeEntities.map((entity) => entity.label)).toContain('@author.test');
    expect(output.safeEntities.map((entity) => entity.label)).toContain('@source.helper');
    expect(output.safeEntities.map((entity) => entity.label)).not.toContain('@just.reacting');
  });

  it('carries bounded perspective gaps into the writer contract', () => {
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
      perspectiveGaps: [
        '  No visible reply brings direct sourcing or verifiable evidence yet.  ',
        'Only a narrow slice of participants is shaping the visible thread so far.',
        'Only a narrow slice of participants is shaping the visible thread so far.',
        'Visible replies add limited new context beyond the root claim so far.',
      ],
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
      'thread-4',
      'Root post about a suspicious claim.',
      state,
      {},
      [],
      {
        surfaceConfidence: 0.42,
        entityConfidence: 0.35,
        interpretiveConfidence: 0.22,
      },
      undefined,
      'author.test',
      { summaryMode: 'descriptive_fallback' },
    );

    expect(output.perspectiveGaps).toEqual([
      'No visible reply brings direct sourcing or verifiable evidence yet.',
      'Only a narrow slice of participants is shaping the visible thread so far.',
      'Visible replies add limited new context beyond the root claim so far.',
    ]);
  });

  it('falls back to canonical delta reasons when local what-changed heuristics stay thin', () => {
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
          did: 'did:plc:source',
          handle: 'source.helper',
          totalReplies: 1,
          avgUsefulnessScore: 0.82,
          dominantRole: 'source_bringer',
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
        uri: 'at://reply/source',
        text: 'The memo header is attached in the reply above.',
        authorDid: 'did:plc:source',
        authorHandle: 'source.helper',
        likeCount: 9,
      }),
    ];
    const deltaDecision: ConversationDeltaDecision = {
      didMeaningfullyChange: true,
      changeMagnitude: 0.71,
      changeReasons: ['source_backed_clarification'],
      confidence: {
        surfaceConfidence: 0.7,
        entityConfidence: 0.6,
        interpretiveConfidence: 0.62,
      },
      summaryMode: 'normal',
      computedAt: '2026-04-08T12:00:00.000Z',
    };

    const output = buildThreadStateForWriter(
      'thread-5',
      'Root post about a memo leak.',
      state,
      {
        'at://reply/source': {
          uri: 'at://reply/source',
          role: 'direct_response',
          finalInfluenceScore: 0.48,
          clarificationValue: 0.2,
          sourceSupport: 0.1,
          visibleChips: [],
          factual: null,
          usefulnessScore: 0.48,
          abuseScore: 0,
          evidenceSignals: [],
          entityImpacts: [],
          scoredAt: new Date().toISOString(),
        },
      },
      replies,
      {
        surfaceConfidence: 0.7,
        entityConfidence: 0.6,
        interpretiveConfidence: 0.62,
      },
      undefined,
      'author.test',
      {
        summaryMode: 'normal',
        deltaDecision,
      },
    );

    expect(output.whatChangedSignals).toEqual(
      expect.arrayContaining([
        expect.stringContaining('source cited:'),
      ]),
    );
  });

  it('preserves a source-gap factual highlight for descriptive threads without hard evidence', () => {
    const state: InterpolatorState = {
      rootUri: 'at://root',
      summaryText: '',
      salientClaims: [],
      salientContributors: [],
      clarificationsAdded: [
        'Visible replies ask for a public order before accepting the claim.',
      ],
      newAnglesAdded: [],
      repetitionLevel: 0,
      heatLevel: 0,
      sourceSupportPresent: false,
      perspectiveGaps: [
        'The visible thread still lacks direct sourcing or verifiable evidence for the claim.',
      ],
      updatedAt: new Date().toISOString(),
      version: 1,
      replyScores: {},
      entityLandscape: [],
      topContributors: [
        {
          did: 'did:plc:skeptic',
          handle: 'skeptic.one',
          totalReplies: 1,
          avgUsefulnessScore: 0.74,
          dominantRole: 'clarifying',
          factualContributions: 0,
        },
      ],
      evidencePresent: false,
      factualSignalPresent: false,
      lastTrigger: null,
      triggerHistory: [],
    };

    const replies = [
      makeReply({
        uri: 'at://reply/source-gap',
        text: 'Do you have the order? I only see people quoting each other and asking for the notice.',
        authorDid: 'did:plc:skeptic',
        authorHandle: 'skeptic.one',
        likeCount: 6,
      }),
    ];

    const output = buildThreadStateForWriter(
      'thread-source-gap',
      'County is banning all night events starting tonight.',
      state,
      {
        'at://reply/source-gap': {
          uri: 'at://reply/source-gap',
          role: 'clarifying',
          finalInfluenceScore: 0.52,
          clarificationValue: 0.66,
          sourceSupport: 0.04,
          visibleChips: [],
          factual: null,
          usefulnessScore: 0.58,
          abuseScore: 0,
          evidenceSignals: [],
          entityImpacts: [],
          scoredAt: new Date().toISOString(),
        },
      },
      replies,
      {
        surfaceConfidence: 0.56,
        entityConfidence: 0.63,
        interpretiveConfidence: 0.34,
      },
      undefined,
      'nightlife.watch',
      { summaryMode: 'descriptive_fallback' },
    );

    expect(output.factualHighlights).toContain(
      'The visible thread still lacks direct sourcing or verifiable evidence for the claim.',
    );
  });

  it('adds a clarification signal from counterpoint-like corrective text when clarificationsAdded is empty', () => {
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
      perspectiveGaps: [],
      updatedAt: new Date().toISOString(),
      version: 1,
      replyScores: {},
      entityLandscape: [],
      topContributors: [],
      evidencePresent: true,
      factualSignalPresent: true,
      lastTrigger: null,
      triggerHistory: [],
    };

    const replies = [
      makeReply({
        uri: 'at://reply/counterpoint',
        text: 'This looks narrower than the post: walk-ins ended, but appointments are still open next week.',
        authorDid: 'did:plc:hours.one',
        authorHandle: 'hours.one',
        likeCount: 4,
      }),
    ];

    const output = buildThreadStateForWriter(
      'thread-clarification-fallback',
      'Clinic stopped all boosters today.',
      state,
      {
        'at://reply/counterpoint': {
          uri: 'at://reply/counterpoint',
          role: 'direct_response',
          finalInfluenceScore: 0.66,
          clarificationValue: 0.52,
          sourceSupport: 0.22,
          visibleChips: [],
          factual: null,
          usefulnessScore: 0.66,
          abuseScore: 0,
          evidenceSignals: [],
          entityImpacts: [],
          scoredAt: new Date().toISOString(),
        },
      },
      replies,
      {
        surfaceConfidence: 0.72,
        entityConfidence: 0.7,
        interpretiveConfidence: 0.66,
      },
      undefined,
      'clinic.watch',
      {
        summaryMode: 'normal',
        deltaDecision: {
          didMeaningfullyChange: true,
          changeMagnitude: 0.64,
          changeReasons: ['thread_direction_reversed'],
          confidence: {
            surfaceConfidence: 0.72,
            entityConfidence: 0.7,
            interpretiveConfidence: 0.66,
          },
          summaryMode: 'normal',
          computedAt: '2026-05-03T22:04:00.000Z',
        },
      },
    );

    expect(output.whatChangedSignals).toEqual(
      expect.arrayContaining([
        expect.stringContaining('counterpoint:'),
        expect.stringContaining('clarification:'),
      ]),
    );
    expect(output.threadSignalSummary.clarificationsCount).toBeGreaterThan(0);
  });
});
