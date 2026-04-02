import { describe, expect, it } from 'vitest';
import {
  computeThreadChangeDelta,
  selectContributorsAlgorithmic,
  computeEntityCentralityScores,
  type ThreadStateSnapshot,
  type EntityInfo,
} from './index';

describe('algorithm resilience', () => {
  it('fails closed for contributor selection when inputs are invalid', () => {
    const result = selectContributorsAlgorithmic([], {});
    expect(result.selectedContributors).toEqual([]);
    expect(result.rejectedContributors).toEqual([]);
    expect(result.coveredStances).toEqual([]);
    expect(result.diversity).toBe(0);
  });

  it('returns finite, bounded delta values for malformed timestamps', () => {
    const previous: ThreadStateSnapshot = {
      timestamp: 'not-a-date',
      threadUri: 'at://did:example/app.bsky.feed.post/old',
      rootAuthorDid: 'did:example:alice',
      replyCount: 4,
      topContributorDids: ['did:example:alice'],
      dominantStance: 'clarifier',
      minorityStancesPresent: false,
      hasFactualContent: true,
      sourceBackedClarity: 0.4,
      heat: 0.2,
      threadMaturity: 'forming',
      topEntityIds: ['q1'],
      entityCount: 1,
      overallConfidence: 0.5,
    };

    const current: ThreadStateSnapshot = {
      ...previous,
      timestamp: 'also-not-a-date',
      replyCount: 10,
      heat: 0.7,
      topContributorDids: ['did:example:alice', 'did:example:bob'],
      topEntityIds: ['q1', 'q2'],
      entityCount: 2,
      threadMaturity: 'developing',
    };

    const delta = computeThreadChangeDelta(previous, current);

    expect(Number.isFinite(delta.elapsedSeconds)).toBe(true);
    expect(delta.elapsedSeconds).toBeGreaterThanOrEqual(0);
    expect(delta.changeMagnitude).toBeGreaterThanOrEqual(0);
    expect(delta.changeMagnitude).toBeLessThanOrEqual(1);
  });

  it('sanitizes invalid entities and keeps centrality outputs bounded', () => {
    const entities: EntityInfo[] = [
      { id: 'q1', label: 'Valid Entity', type: 'topic', mentionCount: 3 },
      { id: '', label: 'invalid', type: 'topic', mentionCount: 2 },
      { id: 'q2', label: 'Also Valid', type: 'person', mentionCount: 2 },
    ];

    const scores = computeEntityCentralityScores(
      entities,
      'Valid Entity appears in root',
      new Set(['q1']),
      [
        {
          did: 'did:example:alice',
          handle: 'alice.test',
          avgUsefulnessScore: 0.9,
          totalReplies: 1,
          dominantRole: 'clarifying',
          factualContributions: 1,
        },
      ],
      {
        'did:example:alice': {
          role: 'clarifying',
          usefulnessScore: 0.9,
          finalInfluenceScore: 0.9,
          sourceSupport: 0.7,
          clarificationValue: 0.8,
          novelty: 0.4,
          redundancy: 0.1,
          fairness: 0.9,
          politeness: 0.8,
          entityImpacts: [],
          factual: {
            factualState: 'well-supported',
            confidence: 0.8,
          },
        },
      } as any,
      ['did:example:alice'],
      new Map([
        ['did:example:alice', new Set(['q1', 'q2'])],
      ]),
      new Map([
        ['q1', 0.9],
        ['q2', 0.7],
      ]),
    );

    expect(scores.length).toBeGreaterThan(0);
    expect(scores.every((entry) => entry.entityId.length > 0)).toBe(true);
    expect(scores.every((entry) => entry.centralityScore >= 0 && entry.centralityScore <= 1)).toBe(true);
    expect(scores.every((entry) => entry.confidence >= 0 && entry.confidence <= 1)).toBe(true);
  });
});
