/**
 * Sports-specific types and interfaces for live event feeds
 */

/**
 * Represents a live sports game/event
 */
export interface LiveGame {
  id: string; // Unique game identifier (e.g., "nba-20250324-lakers-celtics")
  league: string; // League ID (e.g., "nba")
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
  period?: number; // Quarter/Period/Inning (sport-specific)
  clock?: string; // Time remaining (e.g., "2:34" or "Bottom of 6th")
  startTime: string; // ISO timestamp
  endTime?: string; // ISO timestamp when game ended
  venue?: string;
  lastUpdated: string; // ISO timestamp of last score update
  externalUrl?: string; // Link to ESPN/official scoreboard
  hashtags: string[]; // Related hashtags (e.g., ["NBA", "Lakers", "Celtics"])
}

/**
 * Sports feed metadata for custom feeds
 */
export interface SportsFeedContext {
  feedType: 'league' | 'team' | 'sport' | 'live-games';
  league?: string; // League ID if league/team specific
  team?: string; // Team ID if team specific
  sport?: string; // Sport type
  activeGamesOnly?: boolean; // Filter to only live games
  includeAnalysis?: boolean; // Include analysis posts
  includeHighlights?: boolean; // Include highlight posts
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
  relatedGames: string[]; // Game IDs mentioned in post
  postType: 'score-update' | 'commentary' | 'highlight' | 'analysis' | 'prediction' | 'reaction';
  engagement: {
    likes: number;
    reposts: number;
    replies: number;
  };
  isLive: boolean; // Posted during active game
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
  yards?: number; // Football
  touchdowns?: number; // Football
  hits?: number; // Baseball
  runs?: number; // Baseball
  goals?: number; // Soccer
  saves?: number; // Soccer/Hockey
  lastUpdated: string;
}

/**
 * Filter options for sports feed queries
 */
export interface SportsFeedFilter {
  leagues?: string[];
  teams?: string[];
  sports?: ('basketball' | 'football' | 'baseball' | 'hockey' | 'soccer')[];
  includeOfficial?: boolean; // Only posts from official league/team accounts
  postTypes?: ('score-update' | 'commentary' | 'highlight' | 'analysis')[];
  hasVideo?: boolean;
  hasImage?: boolean;
  minEngagement?: number; // Minimum likes + reposts + replies
  sortBy?: 'recency' | 'engagement' | 'official-first';
}
