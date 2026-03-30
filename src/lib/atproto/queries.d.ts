import { type InfiniteData } from '@tanstack/react-query';
import type { MockPost } from '../../data/mockData.js';
import type { LiveNotification } from '../../atproto/mappers.js';
import type { AppBskyFeedDefs, AppBskyGraphDefs } from '@atproto/api';
export declare const qk: {
    timeline: (mode: string) => readonly ["feed", "timeline", string];
    authorFeed: (did: string) => readonly ["feed", "author", string];
    customFeed: (uri: string) => readonly ["feed", "custom", string];
    notifications: () => readonly ["notifications"];
    profile: (actor: string) => readonly ["profile", string];
    thread: (uri: string) => readonly ["thread", string];
    likes: (actor: string) => readonly ["likes", string];
    actorFeeds: (actor: string) => readonly ["actorFeeds", string];
    savedFeeds: () => readonly ["savedFeeds"];
    listMutes: () => readonly ["listMutes"];
    listBlocks: () => readonly ["listBlocks"];
    search: (q: string) => readonly ["search", string];
    suggestions: () => readonly ["suggestions"];
    suggestedFeeds: () => readonly ["suggestedFeeds"];
    preferences: () => readonly ["preferences"];
    mutes: () => readonly ["mutes"];
    blocks: () => readonly ["blocks"];
};
export declare function useTimelineFeed(mode: 'Following' | 'Discover' | 'Feeds'): import("@tanstack/react-query").UseInfiniteQueryResult<InfiniteData<MockPost[], unknown>, Error>;
export declare function useNotifications(): import("@tanstack/react-query").UseQueryResult<LiveNotification[], Error>;
export declare function useProfile(actor: string | undefined): import("@tanstack/react-query").UseQueryResult<import("@atproto/api/dist/client/types/app/bsky/actor/defs.js").ProfileViewDetailed, Error>;
export declare function useThread(uri: string | undefined): import("@tanstack/react-query").UseQueryResult<import("@atproto/api").$Typed<AppBskyFeedDefs.ThreadViewPost> | import("@atproto/api").$Typed<AppBskyFeedDefs.NotFoundPost> | import("@atproto/api").$Typed<AppBskyFeedDefs.BlockedPost> | {
    $type: string;
}, Error>;
export declare function useLikes(actor: string | undefined): import("@tanstack/react-query").UseQueryResult<any, Error>;
export declare function useActorFeeds(actor: string | undefined): import("@tanstack/react-query").UseQueryResult<AppBskyFeedDefs.GeneratorView[], Error>;
export declare function useSavedFeeds(): import("@tanstack/react-query").UseQueryResult<AppBskyFeedDefs.GeneratorView[], Error>;
export declare function useSubscribedLists(): import("@tanstack/react-query").UseQueryResult<{
    muted: AppBskyGraphDefs.ListView[];
    blocked: AppBskyGraphDefs.ListView[];
}, Error>;
export declare function useSearchPosts(query: string): import("@tanstack/react-query").UseQueryResult<MockPost[], Error>;
export declare function useSuggestedActors(): import("@tanstack/react-query").UseQueryResult<import("@atproto/api/dist/client/types/app/bsky/actor/defs.js").ProfileView[], Error>;
export declare function useSuggestedFeeds(): import("@tanstack/react-query").UseQueryResult<AppBskyFeedDefs.GeneratorView[], Error>;
export declare function useMarkNotificationsSeen(): import("@tanstack/react-query").UseMutationResult<import("@atproto/api/dist/client/types/app/bsky/notification/updateSeen.js").Response, Error, void, unknown>;
export declare function usePreferences(): import("@tanstack/react-query").UseQueryResult<import("@atproto/api").BskyPreferences, Error>;
export declare function useSyncMutedWords(): import("@tanstack/react-query").UseMutationResult<number, Error, {
    phrase: string;
    enabled: boolean;
    expiresAt: string | null;
}[], unknown>;
export declare function useImportMutedWords(): import("@tanstack/react-query").UseMutationResult<import("@atproto/api/dist/client/types/app/bsky/actor/defs.js").MutedWord[], Error, Set<string>, unknown>;
export declare function useSetThreadViewPrefs(): import("@tanstack/react-query").UseMutationResult<void, Error, {
    sort?: string;
}, unknown>;
export declare function useSetFeedViewPrefs(): import("@tanstack/react-query").UseMutationResult<void, Error, {
    feed: string;
    pref: Partial<{
        hideReplies: boolean;
        hideRepliesByUnfollowed: boolean;
        hideRepliesByLikeCount: number;
        hideReposts: boolean;
        hideQuotePosts: boolean;
    }>;
}, unknown>;
export declare function useGetMutes(): import("@tanstack/react-query").UseQueryResult<import("@atproto/api/dist/client/types/app/bsky/graph/getMutes.js").Response, Error>;
export declare function useMuteActor(): import("@tanstack/react-query").UseMutationResult<void, Error, {
    did: string;
    durationMs: number | null;
}, unknown>;
export declare function useUnmuteActor(): import("@tanstack/react-query").UseMutationResult<void, Error, {
    did: string;
}, unknown>;
export declare function useGetBlocks(): import("@tanstack/react-query").UseQueryResult<import("@atproto/api/dist/client/types/app/bsky/graph/getBlocks.js").Response, Error>;
export declare function useBlockActor(): import("@tanstack/react-query").UseMutationResult<void, Error, {
    did: string;
}, unknown>;
export declare function useUnblockActor(): import("@tanstack/react-query").UseMutationResult<void, Error, {
    did: string;
}, unknown>;
export declare function useTimedMuteWatcher(): void;
//# sourceMappingURL=queries.d.ts.map