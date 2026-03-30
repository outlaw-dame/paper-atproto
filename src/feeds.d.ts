/**
 * Feed Service for consuming and generating ATOM, RSS, JSON, RDF/XML, and JSON-LD feeds.
 * Supports news, podcasts, and video content.
 */
export declare class FeedService {
    private getFirstChildByLocalName;
    private parsePodcast20Metadata;
    private getPodcast20ForItem;
    /**
     * Parse JSON-LD feed data into standard feed items.
     */
    private parseJsonLdFeed;
    /**
     * Parse RDF/XML feed data into standard feed items.
     */
    private parseRdfXmlFeed;
    /**
     * Fetch and parse an external feed (RSS, ATOM, JSON, RDF/XML, JSON-LD).
     * Uses a CORS proxy for browser compatibility.
     */
    addFeed(url: string, category?: string): Promise<{
        feedId: any;
        title: any;
        itemCount: any;
    }>;
    /**
     * Generate a feed from local ATProto posts in multiple formats.
     */
    generateLocalFeed(type?: 'rss' | 'atom' | 'json' | 'jsonld' | 'rdf'): Promise<unknown>;
    /**
     * Generate JSON-LD format feed.
     */
    private generateJsonLdFeed;
    /**
     * Generate RDF/XML format feed (RSS RDF).
     */
    private generateRdfXmlFeed;
    /**
     * Escape XML special characters.
     */
    private escapeXml;
    /**
     * Get all subscribed feeds.
     */
    getFeeds(): Promise<unknown[]>;
    /**
     * Get items for a specific feed.
     */
    getFeedItems(feedId: string): Promise<unknown[]>;
    /**
     * Get recent feed items across all subscribed feeds.
     */
    getRecentFeedItems(limit?: number): Promise<unknown[]>;
}
export declare const feedService: FeedService;
//# sourceMappingURL=feeds.d.ts.map