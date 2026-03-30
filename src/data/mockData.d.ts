import type { ResolvedFacet } from '../lib/resolver/atproto.js';
export interface MockPost {
    id: string;
    cid?: string;
    author: {
        did: string;
        handle: string;
        displayName: string;
        avatar?: string;
        verified?: boolean;
    };
    content: string;
    /** ATProto facets resolved from the post record — drives byte-accurate link/mention/hashtag rendering. */
    facets?: ResolvedFacet[];
    createdAt: string;
    timestamp?: string;
    likeCount: number;
    replyCount: number;
    repostCount: number;
    bookmarkCount: number;
    media?: {
        type: 'image';
        url: string;
        alt?: string;
        aspectRatio?: number;
    }[];
    images?: string[];
    embed?: {
        type: 'external';
        url: string;
        title: string;
        description: string;
        thumb?: string;
        domain: string;
        authorName?: string;
        authorUrl?: string;
        publisher?: string;
    } | {
        type: 'video';
        url: string;
        thumb?: string;
        title?: string;
        description?: string;
        domain: string;
        aspectRatio?: number;
    } | {
        type: 'quote';
        post: Omit<MockPost, 'replyTo' | 'threadRoot'>;
        externalLink?: {
            url: string;
            title?: string;
            description?: string;
            thumb?: string;
            domain: string;
        };
    };
    chips: ChipType[];
    contentLabels?: string[];
    sensitiveMedia?: {
        isSensitive: boolean;
        reasons: string[];
    };
    threadCount?: number;
    replyTo?: MockPost;
    threadRoot?: MockPost;
    viewer?: {
        like?: string;
        repost?: string;
        bookmark?: string;
    };
    /** Optional conversation-session context used to seed composer guidance. */
    glympseComposerContext?: unknown;
    article?: {
        title?: string;
        body: string;
        banner?: string;
    };
}
export type ChipType = 'thread' | 'topic' | 'feed' | 'pack' | 'related' | 'story';
export declare const MOCK_POSTS: MockPost[];
export declare const MOCK_TRENDING: {
    id: string;
    label: string;
    count: number;
    color: string;
}[];
export declare const MOCK_FEEDS: {
    id: string;
    name: string;
    creator: string;
    count: number;
    icon: string;
}[];
export declare const MOCK_PACKS: {
    id: string;
    name: string;
    creator: string;
    memberCount: number;
    icon: string;
}[];
export declare const MOCK_NOTIFICATIONS: {
    id: string;
    type: string;
    actor: string;
    displayName: string;
    content: string;
    time: string;
    read: boolean;
}[];
export declare function formatCount(n: number): string;
export declare function formatTime(iso: string): string;
//# sourceMappingURL=mockData.d.ts.map