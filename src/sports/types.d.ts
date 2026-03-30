/**
 * Sports-specific types and interfaces for live event feeds
 */
/**
 * Represents a live sports game/event
 */
export interface LiveGame {
    id: string;
    league: string;
    sport: 'basketball' | 'football' | 'baseball' | 'hockey' | 'soccer' | 'other';
    homeTeam: {
        id: string;
        name: string;
        score: number;
        logo?: string;
    };
    awayTeam: {
        id: string;
        name: string;
        score: number;
        logo?: string;
    };
    status: 'scheduled' | 'live' | 'halftime' | 'final' | 'postponed' | 'cancelled';
    period?: number;
    clock?: string;
    startTime: string;
    endTime?: string;
    venue?: string;
    lastUpdated: string;
    externalUrl?: string;
    hashtags: string[];
}
/**
 * Sports feed metadata for custom feeds
 */
export interface SportsFeedContext {
    feedType: 'league' | 'team' | 'sport' | 'live-games';
    league?: string;
    team?: string;
    sport?: string;
    activeGamesOnly?: boolean;
    includeAnalysis?: boolean;
    includeHighlights?: boolean;
}
/**
 * Post that's marked as sports-related
 */
export interface SportsPost {
    uri: string;
    author: {
        did: string;
        handle: string;
        displayName?: string;
        avatar?: string;
        isOfficialLeague?: boolean;
        isOfficialTeam?: boolean;
    };
    text: string;
    createdAt: string;
    relatedGames: string[];
    postType: 'score-update' | 'commentary' | 'highlight' | 'analysis' | 'prediction' | 'reaction';
    engagement: {
        likes: number;
        reposts: number;
        replies: number;
    };
    isLive: boolean;
    hasVideo: boolean;
    hasImage: boolean;
}
/**
 * Represents a sports-specific feed
 */
export interface SportsFeed {
    uri: string;
    creator: {
        did: string;
        handle: string;
        displayName: string;
    };
    displayName: string;
    description: string;
    avatar?: string;
    feedContext: SportsFeedContext;
    postCount: number;
    subscriberCount: number;
    isOfficial?: boolean;
    lastUpdated: string;
}
/**
 * Real-time sports event with live updates
 */
export interface LiveEventUpdate {
    gameId: string;
    timestamp: string;
    updateType: 'score' | 'period-change' | 'injury' | 'timeout' | 'end-game' | 'start-game';
    details: Record<string, any>;
}
/**
 * Sports statistics that could be displayed
 */
export interface PlayerStats {
    playerName: string;
    team: string;
    points?: number;
    rebounds?: number;
    assists?: number;
    steals?: number;
    blocks?: number;
    yards?: number;
    touchdowns?: number;
    hits?: number;
    runs?: number;
    goals?: number;
    saves?: number;
    lastUpdated: string;
}
/**
 * Filter options for sports feed queries
 */
export interface SportsFeedFilter {
    leagues?: string[];
    teams?: string[];
    sports?: ('basketball' | 'football' | 'baseball' | 'hockey' | 'soccer')[];
    includeOfficial?: boolean;
    postTypes?: ('score-update' | 'commentary' | 'highlight' | 'analysis')[];
    hasVideo?: boolean;
    hasImage?: boolean;
    minEngagement?: number;
    sortBy?: 'recency' | 'engagement' | 'official-first';
}
//# sourceMappingURL=types.d.ts.map