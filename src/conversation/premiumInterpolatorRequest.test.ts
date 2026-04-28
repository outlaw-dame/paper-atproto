import { describe, expect, it } from 'vitest';

import { buildThreadStateForWriter } from '../intelligence/writerInput';
import type { InterpolatorState } from '../intelligence/interpolatorTypes';
import type { ThreadNode } from '../lib/resolver/atproto';
import {
  buildPremiumInterpolatorRequest,
} from './sessionAssembler';
import { buildUserPrompt } from '../../server/src/ai/providers/deepInterpolatorShared.js';

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
    createdAt: '2026-04-08T18:00:00.000Z',
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

describe('buildPremiumInterpolatorRequest', () => {
  it('preserves writer-shaped ML signals into the premium prompt contract', () => {
    const state: InterpolatorState = {
      rootUri: 'at://root',
      summaryText: '',
      salientClaims: [],
      salientContributors: [],
      clarificationsAdded: ['The notice only confirms restricted access during the inspection window.'],
      newAnglesAdded: ['Staff may move remote while classes and library operations are handled separately.'],
      repetitionLevel: 0.16,
      heatLevel: 0.18,
      sourceSupportPresent: true,
      updatedAt: new Date().toISOString(),
      version: 1,
      replyScores: {},
      entityLandscape: [
        {
          entityText: 'City Hall',
          entityKind: 'org',
          sentimentShift: 0,
          isNewEntity: false,
          mentionCount: 4,
          canonicalEntityId: 'org-city-hall',
          canonicalLabel: 'City Hall',
          matchConfidence: 0.91,
        },
        {
          entityText: 'gas inspection',
          entityKind: 'concept',
          sentimentShift: 0,
          isNewEntity: true,
          mentionCount: 3,
          canonicalEntityId: 'topic-gas-inspection',
          canonicalLabel: 'gas inspection',
          matchConfidence: 0.86,
        },
      ],
      topContributors: [
        {
          did: 'did:plc:source',
          handle: 'source.one',
          totalReplies: 1,
          avgUsefulnessScore: 0.91,
          dominantRole: 'source_bringer',
          factualContributions: 1,
        },
        {
          did: 'did:plc:clarify',
          handle: 'clarify.two',
          totalReplies: 1,
          avgUsefulnessScore: 0.82,
          dominantRole: 'clarifying',
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
        text: 'I posted the memo header and the building notice. It names a Friday closure tied to the inspection.',
        authorDid: 'did:plc:source',
        authorHandle: 'source.one',
        likeCount: 12,
        replyCount: 2,
      }),
      makeReply({
        uri: 'at://reply/clarify',
        text: 'City utility has not confirmed a shutdown yet. The notice only mentions access restrictions during the inspection window.',
        authorDid: 'did:plc:clarify',
        authorHandle: 'clarify.two',
        likeCount: 8,
        replyCount: 1,
      }),
    ];

    const writerInput = buildThreadStateForWriter(
      'thread-premium-1',
      'Leaked memo says city hall will close Friday after the gas inspection.',
      state,
      {
        'at://reply/source': {
          uri: 'at://reply/source',
          role: 'source_bringer',
          finalInfluenceScore: 0.93,
          clarificationValue: 0.42,
          sourceSupport: 0.91,
          visibleChips: [],
          factual: {
            claimPresent: true,
            claimType: 'document-backed claim',
            knownFactCheckMatch: false,
            factCheckMatchConfidence: 0,
            sourcePresence: 0.95,
            sourceType: 'document',
            sourceDomain: 'city.example',
            sourceQuality: 0.86,
            quoteFidelity: 0.7,
            corroborationLevel: 0.62,
            contradictionLevel: 0.08,
            mediaContextConfidence: 0.84,
            entityGrounding: 0.75,
            contextValue: 0.68,
            correctionValue: 0.3,
            citedUrls: [],
            quotedTextSpans: [],
            factualContributionScore: 0.78,
            factualConfidence: 0.84,
            factualState: 'well-supported',
            reasons: ['document-backed'],
          },
          usefulnessScore: 0.9,
          abuseScore: 0,
          evidenceSignals: [{ kind: 'citation', confidence: 0.92 }],
          entityImpacts: [
            {
              entityText: 'City Hall',
              entityKind: 'org',
              sentimentShift: 0,
              isNewEntity: false,
              mentionCount: 2,
              canonicalEntityId: 'org-city-hall',
              canonicalLabel: 'City Hall',
              matchConfidence: 0.91,
            },
          ],
          scoredAt: new Date().toISOString(),
        },
        'at://reply/clarify': {
          uri: 'at://reply/clarify',
          role: 'clarifying',
          finalInfluenceScore: 0.84,
          clarificationValue: 0.89,
          sourceSupport: 0.58,
          visibleChips: [],
          factual: {
            claimPresent: true,
            claimType: 'clarification',
            knownFactCheckMatch: false,
            factCheckMatchConfidence: 0,
            sourcePresence: 0.71,
            sourceType: 'notice',
            sourceDomain: 'city.example',
            sourceQuality: 0.74,
            quoteFidelity: 0.68,
            corroborationLevel: 0.51,
            contradictionLevel: 0.14,
            mediaContextConfidence: 0.73,
            entityGrounding: 0.64,
            contextValue: 0.77,
            correctionValue: 0.62,
            citedUrls: [],
            quotedTextSpans: [],
            factualContributionScore: 0.69,
            factualConfidence: 0.72,
            factualState: 'source-backed-clarification',
            reasons: ['clarifies scope'],
          },
          usefulnessScore: 0.81,
          abuseScore: 0,
          evidenceSignals: [{ kind: 'citation', confidence: 0.71 }],
          entityImpacts: [
            {
              entityText: 'gas inspection',
              entityKind: 'concept',
              sentimentShift: 0,
              isNewEntity: false,
              mentionCount: 2,
              canonicalEntityId: 'topic-gas-inspection',
              canonicalLabel: 'gas inspection',
              matchConfidence: 0.86,
            },
          ],
          scoredAt: new Date().toISOString(),
        },
      },
      replies,
      {
        surfaceConfidence: 0.76,
        entityConfidence: 0.72,
        interpretiveConfidence: 0.69,
      },
      undefined,
      'memo.author',
      {
        summaryMode: 'normal',
        mediaFindings: [
          {
            mediaType: 'document',
            summary: 'Screenshot of the memo header and building notice.',
            confidence: 0.88,
            extractedText: 'Friday closure tied to inspection',
          },
        ],
      },
    );

    const request = buildPremiumInterpolatorRequest({
      actorDid: 'did:plc:test',
      writerInput,
      baseSummary: 'A leaked memo is being read as a Friday City Hall closure after a gas inspection.',
      threadState: {
        dominantTone: 'contested',
        informationDensity: 'high',
        evidencePresence: true,
        topContributors: ['did:plc:source', 'did:plc:clarify'],
        conversationPhase: 'active',
        interpolatorConfidence: {
          surfaceConfidence: 0.76,
          entityConfidence: 0.72,
          interpretiveConfidence: 0.69,
        },
      },
      interpretiveExplanation: {
        score: 0.69,
        mode: 'normal',
        factors: {
          semanticCoherence: 0.74,
          evidenceAdequacy: 0.71,
          contextCompleteness: 0.52,
          perspectiveBreadth: 0.63,
          ambiguityPenalty: 0.24,
          contradictionPenalty: 0.2,
          repetitionPenalty: 0.11,
          heatPenalty: 0.12,
          coverageGapPenalty: 0.28,
          freshnessPenalty: 0.19,
          sourceIntegritySupport: 0.78,
          userLabelSupport: 0.2,
          modelAgreement: 0.61,
        },
        rationale: [],
        boostedBy: ['source_integrity', 'perspective_breadth'],
        degradedBy: ['missing_context'],
      },
    });

    expect(request.topContributors.map((contributor) => contributor.handle)).toEqual([
      'source.one',
      'clarify.two',
    ]);
    expect(request.safeEntities.map((entity) => entity.label)).toContain('@memo.author');
    expect(request.safeEntities.map((entity) => entity.label)).toContain('@source.one');
    expect(request.threadSignalSummary).toEqual({
      newAnglesCount: 1,
      clarificationsCount: 1,
      sourceBackedCount: 2,
      factualSignalPresent: true,
      evidencePresent: true,
    });
    expect(request.interpretiveBrief.supports).toContain('credible source support');
    expect(request.interpretiveBrief.limits).toContain('missing context');

    const prompt = buildUserPrompt(request);

    expect(prompt).toContain('PRIORITY PARTICIPANTS TO NAME WHEN MATERIAL:');
    expect(prompt).toContain('@memo.author (root author)');
    expect(prompt).toContain('@source.one (source-bringer)');
    expect(prompt).toContain('THREAD SIGNAL SUMMARY: new_angles=1 clarifications=1 source_backed=2 factual=yes evidence=yes');
    expect(prompt).toContain('INTERPRETIVE SUPPORTS:');
    expect(prompt).toContain('- credible source support');
    expect(prompt).toContain('INTERPRETIVE LIMITS:');
    expect(prompt).toContain('- missing context');
    expect(prompt).toContain('MEDIA FINDINGS:');
  });
});
