import type { LiveGame, LiveEventUpdate } from './types.js';
type SportsApiProvider = 'espn' | 'nfl' | 'nba' | 'mock';
type EspnLeague = 'nba' | 'nfl' | 'mlb' | 'nhl';
/**
 * Real-time sports data store
 * Manages live game state and external API updates
 */
declare class SportsStore {
    private liveGames;
    private espnRefreshTimer;
    private getNow;
    private toEpoch;
    private isActuallyLive;
    /**
     * Game update subscribers
     */
    private subscribers;
    /**
     * Update history for replay/debugging
     */
    private updateHistory;
    /**
     * Polling interval (milliseconds)
     */
    private pollingInterval;
    /**
     * Active polling timers
     */
    private pollingTimers;
    /**
     * Get all current live games
     */
    getGames(): LiveGame[];
    /**
     * Get a specific game by ID
     */
    getGame(gameId: string): LiveGame | undefined;
    /**
     * Get games by league
     */
    getGamesByLeague(leagueId: string): LiveGame[];
    /**
     * Get currently live games
     */
    getLiveGames(): LiveGame[];
    /**
     * Add or update a game
     */
    setGame(game: LiveGame): void;
    /**
     * Update game state from external API
     * Example: ESPN API, official league API
     */
    updateFromExternalAPI(gameId: string, apiProvider?: SportsApiProvider): Promise<void>;
    /**
     * Start polling for game updates
     */
    startPolling(gameId: string, apiProvider?: SportsApiProvider): void;
    /**
     * Stop polling for a game
     */
    stopPolling(gameId: string): void;
    /**
     * Stop all polling
     */
    stopAllPolling(): void;
    loadFromEspn(leagues?: EspnLeague[]): Promise<void>;
    startEspnAutoRefresh(leagues?: EspnLeague[], intervalMs?: number): void;
    stopEspnAutoRefresh(): void;
    /**
     * Subscribe to game updates
     */
    subscribe(callback: (games: LiveGame[]) => void): () => void;
    /**
     * Notify all subscribers
     */
    private notifySubscribers;
    /**
     * Record an update in history
     */
    private recordUpdate;
    /**
     * Get update history (for debugging/replay)
     */
    getUpdateHistory(gameId?: string, limit?: number): Array<{
        timestamp: number;
        update: LiveEventUpdate;
    }>;
    /**
     * Clear all data
     */
    clear(): void;
    private getEspnSportPath;
    private detectSportByLeague;
    private toPositiveInt;
    private toTag;
    private mapEspnStatus;
    private mapEspnEventToLiveGame;
    private syncEspnLeague;
    /**
     * Mock game state fetching (for development/testing)
     */
    private mockFetchGameState;
    /**
     * Pre-populate with sample games (for demo)
     */
    loadSampleGames(): void;
}
export declare const sportsStore: SportsStore;
/**
 * React hook for using sports store
 */
export declare function useSportsStore(): {
    games: LiveGame[];
    liveGames: LiveGame[];
    getGame: (gameId: string) => LiveGame | undefined;
    getGamesByLeague: (leagueId: string) => LiveGame[];
    setGame: (game: LiveGame) => void;
    startPolling: (gameId: string, apiProvider?: SportsApiProvider) => void;
    stopPolling: (gameId: string) => void;
    loadFromEspn: (leagues?: EspnLeague[]) => Promise<void>;
    startEspnAutoRefresh: (leagues?: EspnLeague[], intervalMs?: number) => void;
    stopEspnAutoRefresh: () => void;
    subscribe: (callback: (games: LiveGame[]) => void) => () => void;
    loadSampleGames: () => void;
    clear: () => void;
};
export default sportsStore;
//# sourceMappingURL=sportsStore.d.ts.map