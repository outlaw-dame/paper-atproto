import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversationNode, ConversationSession } from './sessionTypes';
import { useConversationSessionStore } from './sessionStore';
import {
  insertOptimisticReply,
  reconcileOptimisticReply,
  rollbackOptimisticReply,
} from './sessionMutations';

const ROOT_URI = 'at://did:plc:root/app.bsky.feed.post/root';
const SESSION_ID = ROOT_URI;

function createNode(overrides: Partial<ConversationNode>): ConversationNode {
  return {
    uri: overrides.uri ?? ROOT_URI,
    cid: overrides.cid ?? 'cid-root',
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
    ...(overrides.isOptimistic ? { isOptimistic: true } : {}),
  };
}

function createSession(): ConversationSession {
  const root = createNode({});
  return {
    id: SESSION_ID,
    mode: 'thread',
    graph: {
      rootUri: ROOT_URI,
      nodesByUri: {
        [ROOT_URI]: root,
      },
      childUrisByParent: {
        [ROOT_URI]: [],
      },
      parentUriByChild: {
        [ROOT_URI]: undefined,
      },
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
      interpolator: null,
      scoresByUri: {},
      writerResult: null,
      confidence: null,
      summaryMode: null,
      threadState: null,
      interpretiveExplanation: null,
      premium: {
        status: 'idle',
      },
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
      direction: 'forming',
      heatLevel: 0,
      repetitionLevel: 0,
      activityVelocity: 0,
      turningPoints: [],
      snapshots: [],
    },
    mutations: {
      revision: 0,
      recent: [],
    },
    meta: {
      status: 'ready',
      error: null,
      lastHydratedAt: '2026-03-30T12:00:00.000Z',
    },
  };
}

beforeEach(() => {
  useConversationSessionStore.setState({
    byId: {
      [SESSION_ID]: createSession(),
    },
  });
});

describe('session optimistic reply mutations', () => {
  it('inserts an optimistic reply into the session graph', () => {
    const optimisticUri = 'at://did:plc:alice/app.bsky.feed.post/optimistic-1';

    insertOptimisticReply({
      sessionId: SESSION_ID,
      parentUri: ROOT_URI,
      replyNode: {
        uri: optimisticUri,
        cid: '',
        authorDid: 'did:plc:alice',
        authorHandle: 'alice.test',
        text: 'Optimistic reply',
        createdAt: '2026-03-30T12:01:00.000Z',
        likeCount: 0,
        replyCount: 0,
        repostCount: 0,
        facets: [],
        embed: null,
        labels: [],
        depth: 1,
        replies: [],
        parentUri: ROOT_URI,
        parentAuthorHandle: 'root.test',
      },
    });

    const updated = useConversationSessionStore.getState().getSession(SESSION_ID)!;
    expect(updated.graph.childUrisByParent[ROOT_URI]).toEqual([optimisticUri]);
    expect(updated.graph.nodesByUri[optimisticUri]?.isOptimistic).toBe(true);
    expect(updated.graph.nodesByUri[ROOT_URI]?.replyCount).toBe(1);
    expect(updated.graph.nodesByUri[ROOT_URI]?.replies[0]?.uri).toBe(optimisticUri);
    expect(updated.mutations.revision).toBe(1);
    expect(updated.mutations.recent.at(-1)?.kind).toBe('optimistic_reply_inserted');
    expect(updated.mutations.recent.at(-1)?.summary).toBe('A reply is being sent.');
  });

  it('reconciles an optimistic reply with the persisted server uri', () => {
    const optimisticUri = 'at://did:plc:alice/app.bsky.feed.post/optimistic-1';
    const persistedUri = 'at://did:plc:alice/app.bsky.feed.post/persisted-1';

    insertOptimisticReply({
      sessionId: SESSION_ID,
      parentUri: ROOT_URI,
      replyNode: {
        uri: optimisticUri,
        cid: '',
        authorDid: 'did:plc:alice',
        authorHandle: 'alice.test',
        text: 'Optimistic reply',
        createdAt: '2026-03-30T12:01:00.000Z',
        likeCount: 0,
        replyCount: 0,
        repostCount: 0,
        facets: [],
        embed: null,
        labels: [],
        depth: 1,
        replies: [],
        parentUri: ROOT_URI,
        parentAuthorHandle: 'root.test',
      },
    });

    reconcileOptimisticReply({
      sessionId: SESSION_ID,
      optimisticUri,
      persistedNode: {
        uri: persistedUri,
        cid: 'cid-persisted',
        authorDid: 'did:plc:alice',
        authorHandle: 'alice.test',
        text: 'Persisted reply',
        createdAt: '2026-03-30T12:01:05.000Z',
        likeCount: 0,
        replyCount: 0,
        repostCount: 0,
        facets: [],
        embed: null,
        labels: [],
        depth: 1,
        replies: [],
        parentUri: ROOT_URI,
        parentAuthorHandle: 'root.test',
      },
    });

    const updated = useConversationSessionStore.getState().getSession(SESSION_ID)!;
    expect(updated.graph.nodesByUri[optimisticUri]).toBeUndefined();
    expect(updated.graph.nodesByUri[persistedUri]?.isOptimistic).not.toBe(true);
    expect(updated.graph.childUrisByParent[ROOT_URI]).toEqual([persistedUri]);
    expect(updated.graph.nodesByUri[ROOT_URI]?.replies[0]?.uri).toBe(persistedUri);
    expect(updated.mutations.revision).toBe(2);
    expect(updated.mutations.recent.at(-1)?.kind).toBe('optimistic_reply_reconciled');
  });

  it('rolls back an optimistic reply on failure', () => {
    const optimisticUri = 'at://did:plc:alice/app.bsky.feed.post/optimistic-1';

    insertOptimisticReply({
      sessionId: SESSION_ID,
      parentUri: ROOT_URI,
      replyNode: {
        uri: optimisticUri,
        cid: '',
        authorDid: 'did:plc:alice',
        authorHandle: 'alice.test',
        text: 'Optimistic reply',
        createdAt: '2026-03-30T12:01:00.000Z',
        likeCount: 0,
        replyCount: 0,
        repostCount: 0,
        facets: [],
        embed: null,
        labels: [],
        depth: 1,
        replies: [],
        parentUri: ROOT_URI,
        parentAuthorHandle: 'root.test',
      },
    });

    rollbackOptimisticReply({
      sessionId: SESSION_ID,
      optimisticUri,
    });

    const updated = useConversationSessionStore.getState().getSession(SESSION_ID)!;
    expect(updated.graph.nodesByUri[optimisticUri]).toBeUndefined();
    expect(updated.graph.childUrisByParent[ROOT_URI]).toEqual([]);
    expect(updated.graph.nodesByUri[ROOT_URI]?.replyCount).toBe(0);
    expect(updated.mutations.revision).toBe(2);
    expect(updated.mutations.recent.at(-1)?.kind).toBe('optimistic_reply_rolled_back');
    expect(updated.mutations.recent.at(-1)?.summary).toBe('A pending reply failed to send.');
  });
});
