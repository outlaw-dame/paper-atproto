// ─── TanStack Query hooks for ATProto data ────────────────────────────────
// Each hook encapsulates one logical data concern:
//   • query key  — stable, serialisable, invalidation-friendly
//   • fetcher    — goes through atpCall for retry + error normalization
//   • options    — sensible staleTime / gcTime defaults per data type
//
// Hooks that need a cursor for infinite scroll use useInfiniteQuery.

import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { atpCall, atpMutate } from './client';
import { mapFeedViewPost, mapNotification, hasDisplayableRecordContent } from '../../atproto/mappers';
import type { MockPost } from '../../data/mockData';
import type { LiveNotification } from '../../atproto/mappers';
import { AtUri } from '@atproto/syntax';
import { useModerationStore } from '../../store/moderationStore';
import type { AppBskyFeedDefs, AppBskyGraphDefs } from '@atproto/api';

// ─── Query key factory ─────────────────────────────────────────────────────
export const qk = {
  timeline:      (mode: string)         => ['feed', 'timeline', mode] as const,
  authorFeed:    (did: string)           => ['feed', 'author', did] as const,
  customFeed:    (uri: string)           => ['feed', 'custom', uri] as const,
  notifications: ()                      => ['notifications'] as const,
  profile:       (actor: string)         => ['profile', actor] as const,
  thread:        (uri: string)           => ['thread', uri] as const,
  likes:         (actor: string)         => ['likes', actor] as const,
  actorFeeds:    (actor: string)         => ['actorFeeds', actor] as const,
  savedFeeds:    ()                      => ['savedFeeds'] as const,
  listMutes:     ()                      => ['listMutes'] as const,
  listBlocks:    ()                      => ['listBlocks'] as const,
  search:        (q: string)             => ['search', q] as const,
  suggestions:   ()                      => ['suggestions'] as const,
  suggestedFeeds: ()                     => ['suggestedFeeds'] as const,
  preferences:    ()                     => ['preferences'] as const,
  labelerServices: (didsKey: string)     => ['labelerServices', didsKey] as const,
  mutes:          ()                     => ['mutes'] as const,
  blocks:         ()                     => ['blocks'] as const,
};

// ─── Timeline (infinite scroll) ────────────────────────────────────────────
const DISCOVER_URI = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';

export function useTimelineFeed(mode: 'Following' | 'Discover' | 'Feeds') {
  const { agent, session } = useSessionStore();

  return useInfiniteQuery<MockPost[], Error, InfiniteData<MockPost[]>, ReturnType<typeof qk.timeline>, string | undefined>({
    queryKey: qk.timeline(mode),
    queryFn: async ({ pageParam, signal }) => {
      if (!session) return [];
      let feed: any[] = [];
      let _cursor: string | undefined;

      if (mode === 'Following') {
        const res = await atpCall(s => agent.getTimeline({ limit: 30, cursor: pageParam }), { signal });
        feed = res.data.feed;
        _cursor = res.data.cursor;
      } else if (mode === 'Discover') {
        const res = await atpCall(s => agent.app.bsky.feed.getFeed({ feed: DISCOVER_URI, limit: 30, cursor: pageParam }), { signal });
        feed = res.data.feed;
        _cursor = res.data.cursor;
      } else {
        const res = await atpCall(s => agent.getAuthorFeed({ actor: session.did, limit: 30, cursor: pageParam }), { signal });
        feed = res.data.feed;
        _cursor = res.data.cursor;
      }

      return feed
        .filter((item: any) => hasDisplayableRecordContent(item.post?.record))
        .map(mapFeedViewPost);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (_lastPage, _allPages, _lastParam, allParamPages) => {
      // We need the raw cursor from the last page — store it via a workaround
      // by keeping a ref in the queryFn closure. Instead, we use a meta approach:
      // TanStack Query v5 supports returning { data, nextCursor } from queryFn.
      // For simplicity here we return the posts array and track cursor separately.
      // A full implementation would use a custom queryFn that returns { posts, cursor }.
      return undefined; // cursor tracking handled in HomeTab via direct agent calls
    },
    enabled: !!session,
    staleTime: 1000 * 60 * 2,   // 2 minutes
    gcTime: 1000 * 60 * 10,     // 10 minutes
  });
}

// ─── Notifications ─────────────────────────────────────────────────────────
export function useNotifications() {
  const { agent, session } = useSessionStore();

  return useQuery<LiveNotification[], Error>({
    queryKey: qk.notifications(),
    queryFn: async ({ signal }) => {
      const res = await atpCall(s => agent.listNotifications({ limit: 50 }), { signal });
      return res.data.notifications.map(mapNotification);
    },
    enabled: !!session,
    staleTime: 1000 * 30,       // 30 seconds
    gcTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60, // poll every minute
  });
}

// ─── Profile ───────────────────────────────────────────────────────────────
export function useProfile(actor: string | undefined) {
  const { agent, session } = useSessionStore();

  return useQuery({
    queryKey: qk.profile(actor ?? ''),
    queryFn: async ({ signal }) => {
      const res = await atpCall(s => agent.getProfile({ actor: actor! }), { signal });
      return res.data;
    },
    enabled: !!session && !!actor,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}

// ─── Post thread ───────────────────────────────────────────────────────────
export function useThread(uri: string | undefined) {
  const { agent, session } = useSessionStore();

  return useQuery({
    queryKey: qk.thread(uri ?? ''),
    queryFn: async ({ signal }) => {
      const res = await atpCall(s => agent.getPostThread({ uri: uri!, depth: 6 }), { signal });
      return res.data.thread;
    },
    enabled: !!session && !!uri,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  });
}

// ─── Likes (Library saved items) ───────────────────────────────────────────
export function useLikes(actor: string | undefined) {
  const { agent, session } = useSessionStore();

  return useQuery({
    queryKey: qk.likes(actor ?? ''),
    queryFn: async ({ signal }) => {
      const res = await atpCall(s => agent.listRecords({
        repo: actor!,
        collection: 'app.bsky.feed.like',
        limit: 50,
      }), { signal });
      return res.data.records;
    },
    enabled: !!session && !!actor,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}

// ─── Actor's feed generators ───────────────────────────────────────────────
export function useActorFeeds(actor: string | undefined) {
  const { agent, session } = useSessionStore();

  return useQuery({
    queryKey: qk.actorFeeds(actor ?? ''),
    queryFn: async ({ signal }) => {
      const res = await atpCall(s => agent.app.bsky.feed.getActorFeeds({ actor: actor! }), { signal });
      return res.data.feeds;
    },
    enabled: !!session && !!actor,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
  });
}

// ─── Saved/subscribed feed generators (viewer) ───────────────────────────
export function useSavedFeeds() {
  const { agent, session } = useSessionStore();

  return useQuery<AppBskyFeedDefs.GeneratorView[], Error>({
    queryKey: qk.savedFeeds(),
    queryFn: async ({ signal }) => {
      const res = await atpCall(
        s => agent.app.bsky.feed.getSavedFeeds({ limit: 100 }),
        { signal, maxAttempts: 4, baseDelayMs: 250, capDelayMs: 8_000 },
      );
      return res.data.feeds ?? [];
    },
    enabled: !!session,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}

// ─── Subscribed lists for moderation (viewer list mutes + blocks) ────────
export function useSubscribedLists() {
  const { agent, session } = useSessionStore();

  return useQuery<{
    muted: AppBskyGraphDefs.ListView[];
    blocked: AppBskyGraphDefs.ListView[];
  }, Error>({
    queryKey: ['subscribedLists'],
    queryFn: async ({ signal }) => {
      const [mutedRes, blockedRes] = await Promise.all([
        atpCall(
          s => agent.app.bsky.graph.getListMutes({ limit: 100 }),
          { signal, maxAttempts: 4, baseDelayMs: 250, capDelayMs: 8_000 },
        ),
        atpCall(
          s => agent.app.bsky.graph.getListBlocks({ limit: 100 }),
          { signal, maxAttempts: 4, baseDelayMs: 250, capDelayMs: 8_000 },
        ),
      ]);

      return {
        muted: mutedRes.data.lists ?? [],
        blocked: blockedRes.data.lists ?? [],
      };
    },
    enabled: !!session,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}

// ─── Search posts ──────────────────────────────────────────────────────────
export function useSearchPosts(query: string) {
  const { agent, session } = useSessionStore();

  return useQuery({
    queryKey: qk.search(query),
    queryFn: async ({ signal }) => {
      const res = await atpCall(s => agent.app.bsky.feed.searchPosts({ q: query, limit: 25 }), { signal });
      return (res.data.posts ?? []).map((post: any) => mapFeedViewPost({ post, reply: undefined, reason: undefined }));
    },
    enabled: !!session && query.trim().length > 1,
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 5,
  });
}

// ─── Suggested actors ──────────────────────────────────────────────────────
export function useSuggestedActors() {
  const { agent, session } = useSessionStore();

  return useQuery({
    queryKey: qk.suggestions(),
    queryFn: async ({ signal }) => {
      const res = await atpCall(s => agent.getSuggestions({ limit: 10 }), { signal });
      return res.data.actors;
    },
    enabled: !!session,
    staleTime: 1000 * 60 * 15,
    gcTime: 1000 * 60 * 60,
  });
}

// ─── Suggested feeds ───────────────────────────────────────────────────────
export function useSuggestedFeeds() {
  const { agent, session } = useSessionStore();

  return useQuery({
    queryKey: qk.suggestedFeeds(),
    queryFn: async ({ signal }) => {
      const res = await atpCall(s => agent.app.bsky.feed.getSuggestedFeeds({ limit: 10 }), { signal });
      return res.data.feeds;
    },
    enabled: !!session,
    staleTime: 1000 * 60 * 15,
    gcTime: 1000 * 60 * 60,
  });
}

// ─── Mark notifications as seen ────────────────────────────────────────────
export function useMarkNotificationsSeen() {
  const { agent } = useSessionStore();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => atpCall(s => agent.updateSeenNotifications()),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications() }),
  });
}

// ─── Account preferences ───────────────────────────────────────────────────
export function usePreferences() {
  const { agent, session } = useSessionStore();

  return useQuery({
    queryKey: qk.preferences(),
    queryFn: () => atpCall(() => agent.getPreferences()),
    enabled: !!session,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}

export function useLabelerServices(dids: string[]) {
  const { agent, session } = useSessionStore();
  const sortedDids = [...dids].sort();
  const didsKey = sortedDids.join(',');

  return useQuery({
    queryKey: qk.labelerServices(didsKey),
    queryFn: () => atpCall(() => agent.app.bsky.labeler.getServices({ dids: sortedDids, detailed: true })),
    enabled: !!session && sortedDids.length > 0,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}

export function useSetContentLabelPref() {
  const { agent } = useSessionStore();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      label,
      visibility,
      labelerDid,
    }: {
      label: string;
      visibility: 'hide' | 'warn' | 'ignore';
      labelerDid?: string;
    }) => atpCall(
      () => agent.setContentLabelPref(label, visibility, labelerDid),
      {
        // Explicit jittered retry configuration for transient policy write failures.
        maxAttempts: 3,
        baseDelayMs: 250,
        capDelayMs: 3_000,
      },
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.preferences() }),
  });
}

export function useAddLabeler() {
  const { agent } = useSessionStore();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ did }: { did: string }) => atpCall(() => agent.addLabeler(did)),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.preferences() }),
  });
}

export function useRemoveLabeler() {
  const { agent } = useSessionStore();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ did }: { did: string }) => atpCall(() => agent.removeLabeler(did)),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.preferences() }),
  });
}

export function useRemoveLabelers() {
  const { agent } = useSessionStore();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ dids }: { dids: string[] }) => atpCall(() => Promise.all(dids.map((did) => agent.removeLabeler(did)))),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.preferences() }),
  });
}

// ─── Sync local filter rules → Bluesky muted words ─────────────────────────
// Adds any enabled local rules not yet present in the account's muted words list.
// Returns the count of words added; 0 means already up-to-date.
export function useSyncMutedWords() {
  const { agent } = useSessionStore();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (rules: Array<{ phrase: string; enabled: boolean; expiresAt: string | null }>) => {
      const prefs = await atpCall(() => agent.getPreferences());
      const existing = new Set(prefs.moderationPrefs.mutedWords.map((w) => w.value.toLowerCase()));
      const toAdd = rules.filter((r) => r.enabled && !existing.has(r.phrase.toLowerCase()));
      for (const rule of toAdd) {
        await atpCall(() => agent.addMutedWord({
          value: rule.phrase,
          targets: ['content'],
          actorTarget: 'all',
          ...(rule.expiresAt ? { expiresAt: rule.expiresAt } : {}),
        }));
      }
      return toAdd.length;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.preferences() }),
  });
}

// ─── Import Bluesky muted words → local filter rules ─────────────────────
// Returns the subset of Bluesky muted words not present in existingPhrases.
// Caller is responsible for calling addRule() for each returned word.
export function useImportMutedWords() {
  const { agent } = useSessionStore();

  return useMutation({
    mutationFn: async (existingPhrases: Set<string>) => {
      const prefs = await atpCall(() => agent.getPreferences());
      return prefs.moderationPrefs.mutedWords.filter(
        (w) => !existingPhrases.has(w.value.toLowerCase()),
      );
    },
  });
}

// ─── Set thread view preferences ───────────────────────────────────────────
export function useSetThreadViewPrefs() {
  const { agent } = useSessionStore();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (pref: { sort?: string }) => atpCall(() => agent.setThreadViewPrefs(pref)),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.preferences() }),
  });
}

// ─── Set feed view preferences ─────────────────────────────────────────────
export function useSetFeedViewPrefs() {
  const { agent } = useSessionStore();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ feed, pref }: {
      feed: string;
      pref: Partial<{ hideReplies: boolean; hideRepliesByUnfollowed: boolean; hideRepliesByLikeCount: number; hideReposts: boolean; hideQuotePosts: boolean }>;
    }) => atpCall(() => agent.setFeedViewPrefs(feed, pref)),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.preferences() }),
  });
}

// ─── Muted accounts ────────────────────────────────────────────────────────
export function useGetMutes() {
  const { session, agent } = useSessionStore();
  return useQuery({
    queryKey: qk.mutes(),
    queryFn: () => atpCall(() => agent.app.bsky.graph.getMutes({ limit: 100 })),
    enabled: !!session,
    staleTime: 60_000,
  });
}

export function useMuteActor() {
  const { agent } = useSessionStore();
  const qc = useQueryClient();
  const addTimedMute = useModerationStore((s) => s.addTimedMute);

  return useMutation({
    mutationFn: ({ did, durationMs }: { did: string; durationMs: number | null }) =>
      atpCall(async () => {
        await agent.mute(did);
        addTimedMute(did, durationMs);
      }),
    onSuccess: (_data, { did }) => {
      void qc.invalidateQueries({ queryKey: qk.mutes() });
      void qc.invalidateQueries({ queryKey: qk.profile(did) });
    },
  });
}

export function useMuteList() {
  const { agent } = useSessionStore();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ listUri }: { listUri: string }) =>
      atpCall(async () => {
        await agent.app.bsky.graph.muteActorList({ list: listUri });
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.listMutes() });
      void qc.invalidateQueries({ queryKey: ['subscribedLists'] });
    },
  });
}

export function useUnmuteActor() {
  const { agent } = useSessionStore();
  const qc = useQueryClient();
  const removeTimedMute = useModerationStore((s) => s.removeTimedMute);

  return useMutation({
    mutationFn: ({ did }: { did: string }) =>
      atpCall(async () => {
        await agent.unmute(did);
        removeTimedMute(did);
      }),
    onSuccess: (_data, { did }) => {
      void qc.invalidateQueries({ queryKey: qk.mutes() });
      void qc.invalidateQueries({ queryKey: qk.profile(did) });
    },
  });
}

export function useUnmuteList() {
  const { agent } = useSessionStore();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ listUri }: { listUri: string }) =>
      atpCall(async () => {
        await agent.app.bsky.graph.unmuteActorList({ list: listUri });
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.listMutes() });
      void qc.invalidateQueries({ queryKey: ['subscribedLists'] });
    },
  });
}

// ─── Blocked accounts ─────────────────────────────────────────────────────
export function useGetBlocks() {
  const { session, agent } = useSessionStore();
  return useQuery({
    queryKey: qk.blocks(),
    queryFn: () => atpCall(() => agent.app.bsky.graph.getBlocks({ limit: 100 })),
    enabled: !!session,
    staleTime: 60_000,
  });
}

async function resolveActorBlockRkey(
  agent: ReturnType<typeof useSessionStore.getState>['agent'],
  did: string,
): Promise<string | undefined> {
  const profileRes = await atpCall(() => agent.getProfile({ actor: did }));
  const profileBlockingUri = profileRes.data.viewer?.blocking;
  if (profileBlockingUri) {
    return new AtUri(profileBlockingUri).rkey;
  }

  let cursor: string | undefined;
  do {
    const res = await atpCall(() => agent.app.bsky.graph.getBlocks({ limit: 100, ...(cursor ? { cursor } : {}) }));
    const record = res.data.blocks.find((b) => b.did === did);
    const blockingUri = record?.viewer?.blocking;
    if (blockingUri) {
      return new AtUri(blockingUri).rkey;
    }
    cursor = res.data.cursor;
  } while (cursor);

  return undefined;
}

export function useBlockActor() {
  const { session, agent } = useSessionStore();
  const qc = useQueryClient();
  const setBlockRkey = useModerationStore((s) => s.setBlockRkey);

  return useMutation({
    mutationFn: ({ did }: { did: string }) =>
      atpCall(async () => {
        const res = await agent.app.bsky.graph.block.create(
          { repo: session!.did },
          { subject: did, createdAt: new Date().toISOString() },
        );
        const rkey = new AtUri(res.uri).rkey;
        setBlockRkey(did, rkey);
      }),
    onSuccess: (_data, { did }) => {
      void qc.invalidateQueries({ queryKey: qk.blocks() });
      void qc.invalidateQueries({ queryKey: qk.profile(did) });
    },
  });
}

export function useUnblockActor() {
  const { session, agent } = useSessionStore();
  const qc = useQueryClient();
  const blockRkeys = useModerationStore((s) => s.blockRkeys);
  const deleteBlockRkey = useModerationStore((s) => s.deleteBlockRkey);

  return useMutation({
    mutationFn: ({ did }: { did: string }) =>
      atpCall(async () => {
        // Try cached rkey first; otherwise resolve from profile or paginated block list.
        let rkey = blockRkeys[did];
        if (!rkey) {
          rkey = await resolveActorBlockRkey(agent, did);
        }
        if (!rkey) throw new Error(`No block record found for ${did}`);
        await agent.app.bsky.graph.block.delete({ repo: session!.did, rkey });
        deleteBlockRkey(did);
      }),
    onSuccess: (_data, { did }) => {
      void qc.invalidateQueries({ queryKey: qk.blocks() });
      void qc.invalidateQueries({ queryKey: qk.profile(did) });
    },
  });
}

export function useBlockList() {
  const { session, agent } = useSessionStore();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ listUri }: { listUri: string }) =>
      atpCall(async () => {
        await agent.app.bsky.graph.listblock.create(
          { repo: session!.did },
          { subject: listUri, createdAt: new Date().toISOString() },
        );
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.listBlocks() });
      void qc.invalidateQueries({ queryKey: ['subscribedLists'] });
    },
  });
}

async function resolveListBlockRkey(
  agent: ReturnType<typeof useSessionStore.getState>['agent'],
  listUri: string,
): Promise<string | undefined> {
  let cursor: string | undefined;

  do {
    const res = await atpCall(() => agent.app.bsky.graph.getListBlocks({ limit: 100, ...(cursor ? { cursor } : {}) }));
    const record = res.data.lists.find((l) => l.uri === listUri);
    const blockedUri = (record?.viewer as any)?.blocked ?? (record?.viewer as any)?.blocking;
    if (typeof blockedUri === 'string' && blockedUri.length > 0) {
      return new AtUri(blockedUri).rkey;
    }
    cursor = res.data.cursor;
  } while (cursor);

  return undefined;
}

export function useUnblockList() {
  const { session, agent } = useSessionStore();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ listUri }: { listUri: string }) =>
      atpCall(async () => {
        const rkey = await resolveListBlockRkey(agent, listUri);
        if (!rkey) throw new Error(`No list block record found for ${listUri}`);
        await agent.app.bsky.graph.listblock.delete({ repo: session!.did, rkey });
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.listBlocks() });
      void qc.invalidateQueries({ queryKey: ['subscribedLists'] });
    },
  });
}

// ─── Timed mute watcher ───────────────────────────────────────────────────
// Mount once at the app level (e.g. in App.tsx) to auto-unmute expired mutes.
export function useTimedMuteWatcher() {
  const { session, agent } = useSessionStore();
  const qc = useQueryClient();
  const getExpiredMutes = useModerationStore((s) => s.getExpiredMutes);
  const removeTimedMute = useModerationStore((s) => s.removeTimedMute);

  useEffect(() => {
    if (!session) return;

    async function sweep() {
      const expired = getExpiredMutes();
      if (!expired.length) return;
      await Promise.allSettled(
        expired.map(async (did) => {
          try {
            await agent.unmute(did);
          } finally {
            removeTimedMute(did);
          }
        }),
      );
      void qc.invalidateQueries({ queryKey: qk.mutes() });
    }

    void sweep();
    const id = setInterval(sweep, 60_000);
    return () => clearInterval(id);
  }, [session, agent, getExpiredMutes, removeTimedMute, qc]);
}
