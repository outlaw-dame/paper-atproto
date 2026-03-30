import type { BskyAgent } from '@atproto/api';
export interface TrendingTopic {
    /** Lowercase slug without the # prefix */
    slug: string;
    displayName: string;
    link?: string;
}
export interface HashtagInsight {
    tag: string;
    /** 0–100 blended composite score */
    score: number;
    /** 0–100 normalised search-volume score */
    volumeScore: number;
    /** 0–100 cosine-similarity relevance to post text */
    relevanceScore: number;
    /** True when the tag appears in the live trending-topics response */
    isTrending: boolean;
    label: 'Trending' | 'Popular' | 'Active';
}
/**
 * Fetches Bluesky's live trending topics.
 * Results are cached for TRENDING_TTL_MS. On failure returns [].
 */
export declare function fetchTrendingTopics(agent: BskyAgent): Promise<TrendingTopic[]>;
/**
 * Returns a 0–100 volume score for a single hashtag by querying
 * `searchPosts` for `#tag` and using the `hitsTotal` from the response.
 * Results are cached per tag for VOLUME_TTL_MS.
 */
export declare function fetchHashtagVolume(agent: BskyAgent, tag: string): Promise<number>;
/**
 * Runs all three intelligence signals in parallel and returns a blended
 * HashtagInsight for every tag in `tags`.
 *
 * Blend weights:
 *   50% volume (real Bluesky search-post hit count)
 *   35% relevance (local MiniLM cosine similarity to post text)
 *   15% trending bonus (flat boost when tag is in live trending topics)
 */
export declare function getHashtagInsights(agent: BskyAgent, tags: string[], postText: string): Promise<HashtagInsight[]>;
//# sourceMappingURL=hashtagInsights.d.ts.map