import { describe, expect, it } from 'vitest';
import type {
  ConversationNode,
  ConversationSession,
} from './sessionTypes';
import {
  appendContinuitySnapshotHistory,
  buildConversationContinuitySnapshot,
  resolveCurrentContinuitySnapshot,
  updateConversationContinuitySnapshots,
} from './continuitySnapshots';

const ROOT_URI = 'at://did:plc:root/app.bsky.feed.post/root';

function createNode(overrides: Partial<ConversationNode>): ConversationNode {
  return {
    uri: overrides.uri ?? ROOT_URI,
    cid: overrides.cid ?? 'cid',
    authorDid: overrides.authorDid ?? 'did:plc:root',
    authorHandle: overrides.authorHandle ?? 'root.test',
    ...(overrides.authorName ? { authorName: overrides.authorName } : {}),
    text: overrides.text ?? 'Root text',
    createdAt: overrides.createdAt ?? '2026-03-30T12:00:00.000Z',
    likeCount: overrides.likeCount ?? 0,
    replyCount: overrides.replyCount ?? 0,
    repostCount: overrides.repostCount ?? 0,
    facets: overrides.facets ?? [],
    embed: overrides.embed ?? null,
    labels: overrides.labels ?? [],
    depth: overrides.depth ?? 0,
    replies: overrides.replies ?? [],
    branchDepth: overrides.branchDepth ?? 0,
    siblingIndex: overrides.siblingIndex ?? 0,
    descendantCount: overrides.descendantCount ?? 0,
    ...(overrides.parentUri ? { parentUri: overrides.parentUri } : {}),
    ...(overrides.parentAuthorHandle ? { parentAuthorHandle: overrides.parentAuthorHandle } : {}),
  };
}

function createSession(): ConversationSession {
  return {
    id: ROOT_URI,
    mode: 'thread',
    graph: {
      rootUri: ROOT_URI,
      nodesByUri: {
        [ROOT_URI]: createNode({}),
      },
      childUrisByParent: {},
      parentUriByChild: {},
      subtreeEndHints: {},
    },
    structure: {
      focusedAnchorUri: ROOT_URI,
      visibleUris: [ROOT_URI],
      deferredUris: [],
      hiddenUris: [],
      revealedWarnUris: [],
      unresolvedChildCountsByUri: {},
    },
    interpretation: {
      interpolator: {
        rootUri: ROOT_URI,
        summaryText: 'The thread is centering on new evidence.',
        salientClaims: [],
        salientContributors: [],
        clarificationsAdded: [],
        newAnglesAdded: [],
        repetitionLevel: 0.1,
        heatLevel: 0.2,
        sourceSupportPresent: true,
        updatedAt: '2026-03-30T12:10:00.000Z',
        version: 1,
        replyScores: {},
        entityLandscape: [],
        topContributors: [],
        evidencePresent: true,
        factualSignalPresent: true,
        lastTrigger: null,
        triggerHistory: [],
      },
      scoresByUri: {},
      writerResult: {
        collapsedSummary: 'The thread is centering on new evidence.',
        whatChanged: ['A new source entered the thread.'],
        contributorBlurbs: [],
        abstained: false,
        mode: 'normal',
      },
      confidence: {
        surfaceConfidence: 0.82,
        entityConfidence: 0.7,
        interpretiveConfidence: 0.65,
      },
      summaryMode: 'normal',
      threadState: {
        dominantTone: 'contested',
        informationDensity: 'high',
        evidencePresence: true,
        topContributors: [],
        conversationPhase: 'active',
        interpolatorConfidence: {
          surfaceConfidence: 0.82,
          entityConfidence: 0.7,
          interpretiveConfidence: 0.65,
        },
      },
      interpretiveExplanation: null,
      premium: {
        status: 'idle',
      },
      lastComputedAt: '2026-03-30T12:10:00.000Z',
    },
    evidence: {
      verificationByUri: {},
      rootVerification: null,
    },
    entities: {
      writerEntities: [],
      canonicalEntities: [],
      entityLandscape: [],
    },
    contributors: {
      contributors: [],
      topContributorDids: [],
    },
    translations: {
      byUri: {},
    },
    trajectory: {
      direction: 'clarifying',
      heatLevel: 0.2,
      repetitionLevel: 0.1,
      activityVelocity: 0.25,
      turningPoints: [
        {
          at: '2026-03-30T12:09:00.000Z',
          kind: 'new_evidence',
          uri: ROOT_URI,
        },
      ],
      snapshots: [],
    },
    mutations: {
      revision: 0,
      recent: [],
    },
    meta: {
      status: 'ready',
      error: null,
      lastHydratedAt: '2026-03-30T12:10:00.000Z',
    },
  };
}

describe('continuity snapshots', () => {
  it('builds a continuity snapshot from session state', () => {
    const snapshot = buildConversationContinuitySnapshot(createSession());

    expect(snapshot.direction).toBe('clarifying');
    expect(snapshot.sourceSupportPresent).toBe(true);
    expect(snapshot.continuityLabel).toBe('new evidence');
    expect(snapshot.whatChanged).toEqual(['A new source entered the thread.']);
  });

  it('deduplicates unchanged snapshots while keeping the latest recordedAt', () => {
    const base = buildConversationContinuitySnapshot(createSession());
    const updated = appendContinuitySnapshotHistory(
      [base],
      {
        ...base,
        recordedAt: '2026-03-30T12:11:00.000Z',
      },
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]?.recordedAt).toBe('2026-03-30T12:11:00.000Z');
  });

  it('appends a new snapshot when the continuity state meaningfully changes', () => {
    const session = createSession();
    const withInitial = updateConversationContinuitySnapshots(session);
    const changed = updateConversationContinuitySnapshots({
      ...withInitial,
      interpretation: {
        ...withInitial.interpretation,
        writerResult: {
          ...withInitial.interpretation.writerResult!,
          whatChanged: ['The thread is splitting into competing explanations.'],
        },
        lastComputedAt: '2026-03-30T12:15:00.000Z',
      },
      trajectory: {
        ...withInitial.trajectory,
        direction: 'fragmenting',
      },
    });

    expect(withInitial.trajectory.snapshots).toHaveLength(1);
    expect(changed.trajectory.snapshots).toHaveLength(2);
    expect(changed.trajectory.snapshots.at(-1)?.direction).toBe('fragmenting');
  });

  it('rebuilds snapshot history safely for legacy sessions without stored snapshots', () => {
    const legacySession = {
      ...createSession(),
      trajectory: {
        ...createSession().trajectory,
        // Simulate a pre-snapshot session object kept alive across HMR or older runtime state.
        snapshots: undefined,
      },
    } as unknown as ConversationSession;

    const updated = updateConversationContinuitySnapshots(legacySession);

    expect(updated.trajectory.snapshots).toHaveLength(1);
    expect(updated.trajectory.snapshots[0]?.direction).toBe('clarifying');
  });

  it('uses recent session mutations as continuity deltas when writer changes are absent', () => {
    const session = createSession();
    const snapshot = buildConversationContinuitySnapshot({
      ...session,
      interpretation: {
        ...session.interpretation,
        writerResult: {
          ...session.interpretation.writerResult!,
          whatChanged: [],
        },
      },
      mutations: {
        revision: 1,
        lastMutationAt: '2026-03-30T12:11:00.000Z',
        recent: [
          {
            revision: 1,
            at: '2026-03-30T12:11:00.000Z',
            kind: 'optimistic_reply_inserted',
            summary: 'A reply is being sent.',
            targetUri: ROOT_URI,
          },
        ],
      },
    });

    expect(snapshot.whatChanged).toEqual(['A reply is being sent.']);
    expect(snapshot.continuityLabel).toBe('new evidence');
  });

  it('prefers a freshly built continuity snapshot when stored history is stale', () => {
    const session = createSession();
    const stale = updateConversationContinuitySnapshots(session);

    const resolved = resolveCurrentContinuitySnapshot({
      ...stale,
      interpretation: {
        ...stale.interpretation,
        writerResult: {
          ...stale.interpretation.writerResult!,
          whatChanged: ['The thread is splitting into competing explanations.'],
        },
      },
    });

    expect(resolved.whatChanged).toEqual(['The thread is splitting into competing explanations.']);
  });
});
