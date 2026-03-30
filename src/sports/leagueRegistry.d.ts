/**
 * Official sports league registry
 * Maps league names to their official Bluesky DIDs and metadata
 * Community-curated for verification purposes
 */
export interface LeagueAccount {
    id: string;
    name: string;
    did: string;
    handle: string;
    logo?: string;
    sport: 'basketball' | 'football' | 'baseball' | 'hockey' | 'soccer' | 'other';
    verified: boolean;
    officialLeagueWebsite?: string;
}
export interface TeamAccount {
    id: string;
    name: string;
    did: string;
    handle: string;
    league: string;
    logo?: string;
    verified: boolean;
}
/**
 * Official league registry
 * In production, this would be fetched from a centralized service
 * For now, it's curated based on known official accounts
 */
export declare const OFFICIAL_LEAGUES: Record<string, LeagueAccount>;
/**
 * Official team registry (sample)
 * In production, this would be much larger and dynamically fetched
 */
export declare const OFFICIAL_TEAMS: Record<string, TeamAccount>;
/**
 * Check if a DID is an official league account
 */
export declare function isOfficialLeague(did: string): boolean;
/**
 * Check if a DID is an official team account
 */
export declare function isOfficialTeam(did: string): boolean;
/**
 * Get league details by DID
 */
export declare function getLeagueByDid(did: string): LeagueAccount | null;
/**
 * Get team details by DID
 */
export declare function getTeamByDid(did: string): TeamAccount | null;
/**
 * Get team details by team ID (e.g., "nba-lakers")
 */
export declare function getTeamById(teamId: string): TeamAccount | null;
/**
 * Get all teams for a league
 */
export declare function getTeamsByLeague(leagueId: string): TeamAccount[];
//# sourceMappingURL=leagueRegistry.d.ts.map