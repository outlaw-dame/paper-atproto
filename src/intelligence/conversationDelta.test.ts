import { describe, expect, it } from 'vitest';

import { computeConversationDeltaDecision } from './conversationDelta';
import type {
  ContributionScore,
  ContributionScores,
  ThreadInterpolatorState,
} from './interpolatorTypes';

const ROOT_URI = 'at://did:plc:root/app.bsky.feed.post/root';

function createState(
  overrides: Partial<ThreadInterpolatorState> = {},
): ThreadInterpolatorState {
  return {
    rootUri: ROOT_URI,
    summaryText: 'People are reacting to the post.',
    salientClaims: ['Root claim about a budget shift.'],
    salientContributors: ['did:plc:one'],
    clarificationsAdded: [],
    newAnglesAdded: [],
    repetitionLevel: 0.1,
    heatLevel: 0.12,
    sourceSupportPresent: false,
    updatedAt: '2026-04-08T10:00:00.000Z',
    version: 1,
    replyScores: {},
    entityLandscape: [],
    topContributors: [
      {
        did: 'did:plc:one',
        handle: 'author.test',
        totalReplies: 1,
        avgUsefulnessScore: 0.58,
        dominantRole: 'direct_response',
        factualContributions: 0,
      },
    ],
    evidencePresent: false,
    factualSignalPresent: false,
    lastTrigger: null,
    triggerHistory: [],
    ...overrides,
  };
}

function createPhase1Score(): ContributionScore {
  return {
    uri: 'at://did:plc:reply/app.bsky.feed.post/1',
    role: 'source_bringer',
    usefulnessScore: 0.84,
    abuseScore: 0.02,
    scoredAt: '2026-04-08T10:01:00.000Z',
    evidenceSignals: [
      {
        kind: 'citation',
        confidence: 0.88,
        sourceUrl: 'https://example.com/report',
      },
    ],
    entityImpacts: [
      {
        entityText: 'Budget Office',
        entityKind: 'org',
        sentimentShift: 0,
        isNewEntity: true,
        mentionCount: 2,
        canonicalEntityId: 'org-budget-office',
        canonicalLabel: 'Budget Office',
        matchConfidence: 0.92,
      },
    ],
    factualContribution: 0.78,
    knownFactCheckMatch: false,
    factCheckMatchConfidence: 0,
    mediaContextConfidence: 0,
  };
}

function createPhase3Score(): ContributionScores {
  return {
    uri: 'at://did:plc:reply/app.bsky.feed.post/1',
    role: 'source_bringer',
    finalInfluenceScore: 0.91,
    clarificationValue: 0.62,
    sourceSupport: 0.84,
    visibleChips: [],
    factual: {
      claimPresent: true,
      claimType: 'budget_shift',
      knownFactCheckMatch: false,
      factCheckMatchConfidence: 0,
      sourcePresence: 0.9,
      sourceType: 'official',
      sourceDomain: 'example.com',
      sourceQuality: 0.88,
      quoteFidelity: 0.7,
      corroborationLevel: 0.55,
      contradictionLevel: 0.05,
      mediaContextConfidence: 0,
      entityGrounding: 0.8,
      contextValue: 0.74,
      correctionValue: 0.22,
      citedUrls: ['https://example.com/report'],
      quotedTextSpans: [],
      factualContributionScore: 0.83,
      factualConfidence: 0.87,
      factualState: 'source-backed-clarification',
      reasons: ['official source cited'],
    },
    usefulnessScore: 0.84,
    abuseScore: 0.02,
    evidenceSignals: [
      {
        kind: 'citation',
        confidence: 0.88,
        sourceUrl: 'https://example.com/report',
      },
    ],
    entityImpacts: [
      {
        entityText: 'Budget Office',
        entityKind: 'org',
        sentimentShift: 0,
        isNewEntity: true,
        mentionCount: 2,
        canonicalEntityId: 'org-budget-office',
        canonicalLabel: 'Budget Office',
        matchConfidence: 0.92,
      },
    ],
    scoredAt: '2026-04-08T10:01:00.000Z',
  };
}

describe('computeConversationDeltaDecision', () => {
  it('produces the same summary mode across phase-1 and phase-3 score shapes', () => {
    const previous = createState();
    const current = createState({
      clarificationsAdded: ['official report clarifies the timing'],
      newAnglesAdded: ['replies compare the shift with prior budget transfers'],
      sourceSupportPresent: true,
      evidencePresent: true,
      factualSignalPresent: true,
      updatedAt: '2026-04-08T10:05:00.000Z',
      version: 2,
      entityLandscape: [
        {
          entityText: 'Budget Office',
          entityKind: 'org',
          sentimentShift: 0,
          isNewEntity: true,
          mentionCount: 3,
          canonicalEntityId: 'org-budget-office',
          canonicalLabel: 'Budget Office',
          matchConfidence: 0.92,
        },
      ],
      topContributors: [
        {
          did: 'did:plc:one',
          handle: 'author.test',
          totalReplies: 1,
          avgUsefulnessScore: 0.58,
          dominantRole: 'direct_response',
          factualContributions: 0,
        },
        {
          did: 'did:plc:two',
          handle: 'source.test',
          totalReplies: 1,
          avgUsefulnessScore: 0.84,
          dominantRole: 'source_bringer',
          factualContributions: 1,
        },
      ],
    });

    const phase1Decision = computeConversationDeltaDecision({
      previous,
      current,
      scores: {
        [createPhase1Score().uri]: createPhase1Score(),
      },
    });
    const phase3Decision = computeConversationDeltaDecision({
      previous,
      current,
      scores: {
        [createPhase3Score().uri]: createPhase3Score(),
      },
    });

    expect(phase1Decision.didMeaningfullyChange).toBe(true);
    expect(phase1Decision.changeReasons.length).toBeGreaterThan(0);
    expect(phase1Decision.summaryMode).toBe('normal');
    expect(phase1Decision.summaryMode).toBe(phase3Decision.summaryMode);
    expect(phase1Decision.changeReasons).toEqual(phase3Decision.changeReasons);
    expect(phase1Decision.confidence.surfaceConfidence)
      .toBeCloseTo(phase3Decision.confidence.surfaceConfidence, 6);
    expect(phase1Decision.confidence.entityConfidence)
      .toBeCloseTo(phase3Decision.confidence.entityConfidence, 6);
    expect(phase1Decision.confidence.interpretiveConfidence)
      .toBeCloseTo(phase3Decision.confidence.interpretiveConfidence, 1);
  });
});
