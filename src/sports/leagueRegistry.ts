/**
 * Official sports league registry
 * Maps league names to their official Bluesky DIDs and metadata
 * Community-curated for verification purposes
 */

export interface LeagueAccount {
  id: string; // Unique identifier (e.g., "nba", "nfl", "mlb")
  name: string; // Display name
  did: string; // Official Bluesky DID
  handle: string; // Bluesky handle
  logo?: string; // URL to league logo
  sport: 'basketball' | 'football' | 'baseball' | 'hockey' | 'soccer' | 'other';
  verified: boolean; // Community/admin verified
  officialLeagueWebsite?: string;
}

export interface TeamAccount {
  id: string; // Unique identifier (e.g., "nba-lakers")
  name: string; // Team name
  did: string; // Official Bluesky DID
  handle: string; // Bluesky handle
  league: string; // Parent league ID
  logo?: string; // Team logo URL
  verified: boolean;
}

/**
 * Official league registry
 * In production, this would be fetched from a centralized service
 * For now, it's curated based on known official accounts
 */
export const OFFICIAL_LEAGUES: Record<string, LeagueAccount> = {
  nba: {
    id: 'nba',
    name: 'NBA',
    did: 'did:plc:nba_official_did_placeholder', // Would be real DID
    handle: 'nba.bsky.social',
    sport: 'basketball',
    verified: true,
    officialLeagueWebsite: 'https://nba.com'
  },
  wnba: {
    id: 'wnba',
    name: 'WNBA',
    did: 'did:plc:wnba_official_did_placeholder',
    handle: 'wnba.bsky.social',
    sport: 'basketball',
    verified: true,
    officialLeagueWebsite: 'https://wnba.com'
  },
  nfl: {
    id: 'nfl',
    name: 'NFL',
    did: 'did:plc:nfl_official_did_placeholder',
    handle: 'nfl.bsky.social',
    sport: 'football',
    verified: true,
    officialLeagueWebsite: 'https://nfl.com'
  },
  mlb: {
    id: 'mlb',
    name: 'MLB',
    did: 'did:plc:mlb_official_did_placeholder',
    handle: 'mlb.bsky.social',
    sport: 'baseball',
    verified: true,
    officialLeagueWebsite: 'https://mlb.com'
  },
  nhl: {
    id: 'nhl',
    name: 'NHL',
    did: 'did:plc:nhl_official_did_placeholder',
    handle: 'nhl.bsky.social',
    sport: 'hockey',
    verified: true,
    officialLeagueWebsite: 'https://nhl.com'
  },
  mls: {
    id: 'mls',
    name: 'MLS',
    did: 'did:plc:mls_official_did_placeholder',
    handle: 'mls.bsky.social',
    sport: 'soccer',
    verified: true,
    officialLeagueWebsite: 'https://mlssoccer.com'
  },
};

/**
 * Official team registry (sample)
 * In production, this would be much larger and dynamically fetched
 */
export const OFFICIAL_TEAMS: Record<string, TeamAccount> = {
  'nba-lakers': {
    id: 'nba-lakers',
    name: 'Los Angeles Lakers',
    did: 'did:plc:lakers_official_did_placeholder',
    handle: 'lakers.bsky.social',
    league: 'nba',
    verified: true,
  },
  'nba-celtics': {
    id: 'nba-celtics',
    name: 'Boston Celtics',
    did: 'did:plc:celtics_official_did_placeholder',
    handle: 'celtics.bsky.social',
    league: 'nba',
    verified: true,
  },
  'nfl-chiefs': {
    id: 'nfl-chiefs',
    name: 'Kansas City Chiefs',
    did: 'did:plc:chiefs_official_did_placeholder',
    handle: 'chiefs.bsky.social',
    league: 'nfl',
    verified: true,
  },
  'mlb-yankees': {
    id: 'mlb-yankees',
    name: 'New York Yankees',
    did: 'did:plc:yankees_official_did_placeholder',
    handle: 'yankees.bsky.social',
    league: 'mlb',
    verified: true,
  },
};

/**
 * Check if a DID is an official league account
 */
export function isOfficialLeague(did: string): boolean {
  return Object.values(OFFICIAL_LEAGUES).some(league => league.did === did);
}

/**
 * Check if a DID is an official team account
 */
export function isOfficialTeam(did: string): boolean {
  return Object.values(OFFICIAL_TEAMS).some(team => team.did === did);
}

/**
 * Get league details by DID
 */
export function getLeagueByDid(did: string): LeagueAccount | null {
  return Object.values(OFFICIAL_LEAGUES).find(league => league.did === did) || null;
}

/**
 * Get team details by DID
 */
export function getTeamByDid(did: string): TeamAccount | null {
  return Object.values(OFFICIAL_TEAMS).find(team => team.did === did) || null;
}

/**
 * Get team details by team ID (e.g., "nba-lakers")
 */
export function getTeamById(teamId: string): TeamAccount | null {
  return OFFICIAL_TEAMS[teamId] || null;
}

/**
 * Get all teams for a league
 */
export function getTeamsByLeague(leagueId: string): TeamAccount[] {
  return Object.values(OFFICIAL_TEAMS).filter(team => team.league === leagueId);
}
