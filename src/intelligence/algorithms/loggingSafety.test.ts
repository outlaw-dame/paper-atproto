import { describe, expect, it, vi } from 'vitest';
import {
  computeEntityCentralityScores,
  computeThreadChangeDelta,
  clusterStanceCoverage,
  selectContributorsAlgorithmic,
  type EntityInfo,
  type ThreadStateSnapshot,
} from './index';

describe('algorithm logging safety', () => {
  it('contributor selection logs sanitized unknown-error metadata on fatal errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const badContributor: any = {
      handle: 'bad.test',
      totalReplies: 1,
      avgUsefulnessScore: 0.8,
      dominantRole: 'clarifying',
      factualContributions: 1,
    };

    Object.defineProperty(badContributor, 'did', {
      get() {
        throw { secret: 'RAW_SECRET_SHOULD_NOT_LEAK' };
      },
    });

    const result = selectContributorsAlgorithmic([badContributor], {} as any);

    expect(result.selectedContributors).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();

    const [prefix, meta] = errorSpy.mock.calls[0] ?? [];
    expect(String(prefix)).toContain('[contributorSelection] selection_fatal_error');
    expect(meta).toEqual({
      name: 'UnknownError',
      message: 'Unknown algorithm error',
    });
  });

  it('change detection safely handles malformed timestamps without logging raw errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const previous: any = {
      get timestamp() {
        throw { secret: 'DELTA_TIMESTAMP_SECRET' };
      },
      threadUri: 'at://did:example/app.bsky.feed.post/old',
      rootAuthorDid: 'did:example:alice',
      replyCount: 1,
      topContributorDids: ['did:example:alice'],
      dominantStance: 'clarifier',
      minorityStancesPresent: false,
      hasFactualContent: true,
      sourceBackedClarity: 0.5,
      heat: 0.1,
      threadMaturity: 'forming',
      topEntityIds: ['q1'],
      entityCount: 1,
      overallConfidence: 0.4,
    };

    const current: ThreadStateSnapshot = {
      timestamp: new Date().toISOString(),
      threadUri: 'at://did:example/app.bsky.feed.post/new',
      rootAuthorDid: 'did:example:alice',
      replyCount: 2,
      topContributorDids: ['did:example:alice'],
      dominantStance: 'clarifier',
      minorityStancesPresent: false,
      hasFactualContent: true,
      sourceBackedClarity: 0.6,
      heat: 0.2,
      threadMaturity: 'developing',
      topEntityIds: ['q1'],
      entityCount: 1,
      overallConfidence: 0.5,
    };

    const delta = computeThreadChangeDelta(previous, current);

    expect(delta.shouldUpdate).toBe(false);
    expect(delta.elapsedSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(delta.elapsedSeconds)).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('entity centrality logs sanitized metadata when collaborator map throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const entities: EntityInfo[] = [
      { id: 'q1', label: 'Entity One', type: 'topic', mentionCount: 2 },
    ];

    const throwingMentionsMap: any = {
      get() {
        throw { secret: 'MENTIONS_MAP_SECRET' };
      },
    };

    const scores = computeEntityCentralityScores(
      entities,
      'Entity One in root',
      new Set(['q1']),
      [{ did: 'did:example:alice', handle: 'alice.test', totalReplies: 1, avgUsefulnessScore: 0.8, dominantRole: 'clarifying', factualContributions: 1 }],
      {
        'did:example:alice': {
          role: 'clarifying',
          usefulnessScore: 0.8,
          finalInfluenceScore: 0.8,
          sourceSupport: 0.7,
          clarificationValue: 0.6,
          novelty: 0.4,
          redundancy: 0.1,
          fairness: 0.8,
          politeness: 0.8,
          entityImpacts: [],
          factual: {
            factualState: 'well-supported',
            confidence: 0.8,
          },
        },
      } as any,
      ['did:example:alice'],
      throwingMentionsMap,
      new Map([['q1', 0.9]]),
    );

    expect(scores).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();

    const lastCall = errorSpy.mock.calls.at(-1) ?? [];
    expect(String(lastCall[0])).toContain('[entityCentrality]');
    expect(lastCall[1]).toEqual({
      name: 'UnknownError',
      message: 'Unknown algorithm error',
    });
  });

  it('stance clustering logs sanitized metadata when contributor slicing fails', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const contributors: any[] = [
      {
        did: 'did:example:alice',
        handle: 'alice.test',
        totalReplies: 1,
        avgUsefulnessScore: 0.9,
        dominantRole: 'clarifying',
        factualContributions: 1,
      },
    ];

    contributors.slice = () => {
      throw { secret: 'STANCE_SECRET' };
    };

    const result = clusterStanceCoverage(contributors as any, {} as any);

    expect(result.clusters).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();

    const [prefix, meta] = errorSpy.mock.calls[0] ?? [];
    expect(String(prefix)).toContain('[stanceClustering] clustering_fatal_error');
    expect(meta).toEqual({
      name: 'UnknownError',
      message: 'Unknown algorithm error',
    });
  });
});
