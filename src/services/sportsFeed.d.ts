import type { LiveGame, SportsFeedFilter } from '../sports/types.js';
/**
 * Custom feed generator for sports content
 * Filters posts by sports relevance and ranks by live status
 */
export declare class SportsFeedService {
    private getPostText;
    private getPostCreatedAt;
    private hasVideo;
    /**
     * Extract cashtags from post text
     * Looks for $SYMBOL patterns
     */
    private extractCashtags;
    /**
     * Check if a post is sports-related
     */
    isSportsPost(post: any): boolean;
    /**
     * Score a sports post for ranking
     * Higher scores = higher in feed
     */
    scoreSportsPost(post: any, liveGames?: LiveGame[]): number;
    /**
     * Filter posts by sports criteria
     */
    filterPosts(posts: any[], filter: SportsFeedFilter, liveGames?: LiveGame[]): any[];
    /**
     * Generate a sports feed skeleton for custom feed generator
     * Compatible with app.bsky.feed.getFeedSkeleton response
     */
    generateFeedSkeleton(posts: any[], filter: SportsFeedFilter, liveGames?: LiveGame[]): any;
    /**
     * Extract sports metadata from a post for display
     */
    extractSportsMetadata(post: any): {
        league: string | null;
        postType: "score-update" | "commentary" | "highlight" | "analysis" | "prediction" | "reaction";
        isLive: boolean;
        hasHighlight: boolean;
        cashtags: string[];
        isOfficial: boolean;
        isSports: boolean;
    };
    /**
     * Detect league from post text
     */
    private detectLeague;
    /**
     * Detect post type from content
     */
    private detectPostType;
}
export declare const sportsFeedService: SportsFeedService;
export default sportsFeedService;
//# sourceMappingURL=sportsFeed.d.ts.map