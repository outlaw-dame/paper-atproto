import type { LiveGame, LiveEventUpdate } from './types.js';

/**
 * Real-time sports data store
 * Manages live game state and external API updates
 */
class SportsStore {
  private liveGames = new Map<string, LiveGame>();

  /**
   * Game update subscribers
   */
  private subscribers = new Set<(games: LiveGame[]) => void>();

  /**
   * Update history for replay/debugging
   */
  private updateHistory: Array<{ timestamp: number; update: LiveEventUpdate }> = [];

  /**
   * Polling interval (milliseconds)
   */
  private pollingInterval = 3000; // 3 seconds

  /**
   * Active polling timers
   */
  private pollingTimers = new Map<string, ReturnType<typeof setInterval>>();

  /**
   * Get all current live games
   */
  getGames(): LiveGame[] {
    return Array.from(this.liveGames.values());
  }

  /**
   * Get a specific game by ID
   */
  getGame(gameId: string): LiveGame | undefined {
    return this.liveGames.get(gameId);
  }

  /**
   * Get games by league
   */
  getGamesByLeague(leagueId: string): LiveGame[] {
    return this.getGames().filter((g) => g.league === leagueId.toLowerCase());
  }

  /**
   * Get currently live games
   */
  getLiveGames(): LiveGame[] {
    return this.getGames().filter((g) => g.status === 'live');
  }

  /**
   * Add or update a game
   */
  setGame(game: LiveGame): void {
    const previous = this.liveGames.get(game.id);
    this.liveGames.set(game.id, game);

    // Track changes
    if (
      previous &&
      (previous.homeTeam.score !== game.homeTeam.score || previous.awayTeam.score !== game.awayTeam.score)
    ) {
      const update: LiveEventUpdate = {
        updateType: 'score',
        gameId: game.id,
        details: {
          homeScore: game.homeTeam.score,
          awayScore: game.awayTeam.score,
          previousHomeScore: previous.homeTeam.score,
          previousAwayScore: previous.awayTeam.score,
        },
        timestamp: new Date().toISOString(),
      };
      this.recordUpdate(update);
    }

    if (previous && previous.status !== game.status) {
      const update: LiveEventUpdate = {
        updateType: game.status === 'live' ? 'start-game' : game.status === 'final' ? 'end-game' : 'period-change',
        gameId: game.id,
        details: {
          status: game.status,
          previousStatus: previous.status,
        },
        timestamp: new Date().toISOString(),
      };
      this.recordUpdate(update);
    }

    // Notify subscribers
    this.notifySubscribers();
  }

  /**
   * Update game state from external API
   * Example: ESPN API, official league API
   */
  async updateFromExternalAPI(
    gameId: string,
    apiProvider: 'espn' | 'nfl' | 'nba' | 'mock' = 'mock'
  ): Promise<void> {
    try {
      // Mock API call - in production, fetch from actual provider
      const game = this.mockFetchGameState(gameId, apiProvider);
      if (game) {
        this.setGame(game);
      }
    } catch (error) {
      console.error(`Failed to update game ${gameId} from ${apiProvider}:`, error);
    }
  }

  /**
   * Start polling for game updates
   */
  startPolling(gameId: string, apiProvider: 'espn' | 'nfl' | 'nba' | 'mock' = 'mock'): void {
    if (this.pollingTimers.has(gameId)) {
      return; // Already polling
    }

    const pollOnce = async () => {
      await this.updateFromExternalAPI(gameId, apiProvider);
    };

    // Initial update
    pollOnce();

    // Set up polling
    const timer = setInterval(pollOnce, this.pollingInterval);
    this.pollingTimers.set(gameId, timer);
  }

  /**
   * Stop polling for a game
   */
  stopPolling(gameId: string): void {
    const timer = this.pollingTimers.get(gameId);
    if (timer) {
      clearInterval(timer);
      this.pollingTimers.delete(gameId);
    }
  }

  /**
   * Stop all polling
   */
  stopAllPolling(): void {
    this.pollingTimers.forEach((timer) => clearInterval(timer));
    this.pollingTimers.clear();
  }

  /**
   * Subscribe to game updates
   */
  subscribe(callback: (games: LiveGame[]) => void): () => void {
    this.subscribers.add(callback);
    callback(this.getGames());
    // Return unsubscribe function
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Notify all subscribers
   */
  private notifySubscribers(): void {
    const games = this.getGames();
    this.subscribers.forEach((callback) => callback(games));
  }

  /**
   * Record an update in history
   */
  private recordUpdate(update: LiveEventUpdate): void {
    this.updateHistory.push({
      timestamp: Date.now(),
      update,
    });

    // Keep last 1000 updates
    if (this.updateHistory.length > 1000) {
      this.updateHistory.shift();
    }
  }

  /**
   * Get update history (for debugging/replay)
   */
  getUpdateHistory(gameId?: string, limit: number = 100): Array<{ timestamp: number; update: LiveEventUpdate }> {
    let history = this.updateHistory;

    if (gameId) {
      history = history.filter((h) => h.update.gameId === gameId);
    }

    return history.slice(-limit);
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.stopAllPolling();
    this.liveGames.clear();
    this.updateHistory = [];
  }

  /**
   * Mock game state fetching (for development/testing)
   */
  private mockFetchGameState(gameId: string, _provider: string): LiveGame | null {
    const game = this.liveGames.get(gameId);
    if (!game) return null;

    // Simulate dynamic score updates for live games
    if (game.status === 'live') {
      const updated = { ...game };

      // Random score update (small probability)
      if (Math.random() < 0.3) {
        updated.homeTeam.score += Math.random() > 0.5 ? 1 : 0;
      }
      if (Math.random() < 0.3) {
        updated.awayTeam.score += Math.random() > 0.5 ? 1 : 0;
      }

      // Random period/quarter advance
      const currentPeriod = updated.period ?? 1;
      if (Math.random() < 0.1 && currentPeriod < 4) {
        updated.period = currentPeriod + 1;
        updated.clock = '0:00';
      }

      // Update clock
      const clockParts = (updated.clock ?? '0:00').split(':');
      const safeMinutes = Number(clockParts[0] ?? 0);
      const safeSeconds = Number(clockParts[1] ?? 0);
      let newSeconds = safeSeconds - 1;
      let newMinutes = safeMinutes;

      if (newSeconds < 0) {
        newSeconds = 59;
        newMinutes -= 1;
      }

      updated.clock = `${Math.max(0, newMinutes)}:${newSeconds.toString().padStart(2, '0')}`;
      updated.lastUpdated = new Date().toISOString();

      return updated;
    }

    return game;
  }

  /**
   * Pre-populate with sample games (for demo)
   */
  loadSampleGames(): void {
    const now = new Date();
    const inTenMinutes = new Date(now.getTime() + 10 * 60000);
    const inTwoHours = new Date(now.getTime() + 2 * 60 * 60000);

    const sampleGames: LiveGame[] = [
      {
        id: 'nba-lakers-celtics-20240115',
        league: 'nba',
        sport: 'basketball',
        homeTeam: {
          id: 'lakers',
          name: 'Los Angeles Lakers',
          score: 98,
        },
        awayTeam: {
          id: 'celtics',
          name: 'Boston Celtics',
          score: 102,
        },
        status: 'live',
        period: 3,
        clock: '5:32',
        venue: 'TD Garden',
        hashtags: ['LakersCeltics', 'NBA', 'NBARegularSeason'],
        startTime: inTwoHours.toISOString(),
        endTime: new Date(inTwoHours.getTime() + 2.5 * 60 * 60000).toISOString(),
        lastUpdated: now.toISOString(),
      },
      {
        id: 'nfl-chiefs-ravens-20240115',
        league: 'nfl',
        sport: 'football',
        homeTeam: {
          id: 'chiefs',
          name: 'Kansas City Chiefs',
          score: 17,
        },
        awayTeam: {
          id: 'ravens',
          name: 'Baltimore Ravens',
          score: 14,
        },
        status: 'scheduled',
        period: 1,
        clock: '0:00',
        venue: 'Arrowhead Stadium',
        hashtags: ['ChiefsRavens', 'NFL', 'NFLPlayoffs'],
        startTime: inTenMinutes.toISOString(),
        endTime: new Date(inTenMinutes.getTime() + 3.5 * 60 * 60000).toISOString(),
        lastUpdated: now.toISOString(),
      },
    ];

    sampleGames.forEach((game) => this.setGame(game));
  }
}

// Singleton instance
export const sportsStore = new SportsStore();

/**
 * React hook for using sports store
 */
export function useSportsStore() {
  return {
    games: sportsStore.getGames(),
    liveGames: sportsStore.getLiveGames(),
    getGame: sportsStore.getGame.bind(sportsStore),
    getGamesByLeague: sportsStore.getGamesByLeague.bind(sportsStore),
    setGame: sportsStore.setGame.bind(sportsStore),
    startPolling: sportsStore.startPolling.bind(sportsStore),
    stopPolling: sportsStore.stopPolling.bind(sportsStore),
    subscribe: sportsStore.subscribe.bind(sportsStore),
    loadSampleGames: sportsStore.loadSampleGames.bind(sportsStore),
    clear: sportsStore.clear.bind(sportsStore),
  };
}

export default sportsStore;
