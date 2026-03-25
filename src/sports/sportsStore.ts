import { reactive, ref, watch } from 'vue';
import { LiveGame, LiveEventUpdate, PlayerStats } from '../sports/types.js';

/**
 * Real-time sports data store
 * Manages live game state and external API updates
 */
class SportsStore {
  /**
   * Current active games
   */
  private liveGames = ref<Map<string, LiveGame>>(new Map());

  /**
   * Game update subscribers
   */
  private subscribers = new Set<(games: LiveGame[]) => void>();

  /**
   * Update history for replay/debugging
   */
  private updateHistory = ref<Array<{ timestamp: number; update: LiveEventUpdate }>>(
    []
  );

  /**
   * Polling interval (milliseconds)
   */
  private pollingInterval = 3000; // 3 seconds

  /**
   * Active polling timers
   */
  private pollingTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Get all current live games
   */
  getGames(): LiveGame[] {
    return Array.from(this.liveGames.value.values());
  }

  /**
   * Get a specific game by ID
   */
  getGame(gameId: string): LiveGame | undefined {
    return this.liveGames.value.get(gameId);
  }

  /**
   * Get games by league
   */
  getGamesByLeague(leagueId: string): LiveGame[] {
    return this.getGames().filter((g) => g.leagueId === leagueId);
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
    const gameId = game.gameId;
    const previous = this.liveGames.value.get(gameId);

    this.liveGames.value.set(gameId, game);

    // Track changes
    if (previous && previous.homeScore !== game.homeScore) {
      const update: LiveEventUpdate = {
        type: 'score_change',
        gameId,
        data: {
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          previousHomeScore: previous.homeScore,
          previousAwayScore: previous.awayScore,
        },
        timestamp: new Date(),
      };
      this.recordUpdate(update);
    }

    if (previous && previous.status !== game.status) {
      const update: LiveEventUpdate = {
        type: 'status_change',
        gameId,
        data: {
          status: game.status,
          previousStatus: previous.status,
        },
        timestamp: new Date(),
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
  async updateFromExternalAPI(gameId: string, apiProvider: 'espn' | 'nfl' | 'nba'): Promise<void> {
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
      await this.updateFromExternalAPI(gameId, apiProvider as any);
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
    this.updateHistory.value.push({
      timestamp: Date.now(),
      update,
    });

    // Keep last 1000 updates
    if (this.updateHistory.value.length > 1000) {
      this.updateHistory.value.shift();
    }
  }

  /**
   * Get update history (for debugging/replay)
   */
  getUpdateHistory(gameId?: string, limit: number = 100): Array<{ timestamp: number; update: LiveEventUpdate }> {
    let history = this.updateHistory.value;

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
    this.liveGames.value.clear();
    this.updateHistory.value = [];
  }

  /**
   * Mock game state fetching (for development/testing)
   */
  private mockFetchGameState(gameId: string, provider: string): LiveGame | null {
    const game = this.liveGames.value.get(gameId);
    if (!game) return null;

    // Simulate dynamic score updates for live games
    if (game.status === 'live') {
      const updated = { ...game };

      // Random score update (small probability)
      if (Math.random() < 0.3) {
        updated.homeScore += Math.random() > 0.5 ? 1 : 0;
      }
      if (Math.random() < 0.3) {
        updated.awayScore += Math.random() > 0.5 ? 1 : 0;
      }

      // Random period/quarter advance
      if (Math.random() < 0.1 && updated.period < 4) {
        updated.period += 1;
        updated.clock = '0:00';
      }

      // Update clock
      const [minutes, seconds] = updated.clock.split(':').map(Number);
      let newSeconds = seconds - 1;
      let newMinutes = minutes;

      if (newSeconds < 0) {
        newSeconds = 59;
        newMinutes -= 1;
      }

      updated.clock = `${newMinutes}:${newSeconds.toString().padStart(2, '0')}`;

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
    const inTwoHours = new Date(now.getTime() + 2 * 60000);

    const sampleGames: LiveGame[] = [
      {
        gameId: 'nba-lakers-celtics-20240115',
        leagueId: 'NBA',
        sport: 'basketball',
        homeTeam: {
          id: 'lakers',
          name: 'Los Angeles Lakers',
          abbreviation: 'LAL',
          logo: '🟣',
        },
        awayTeam: {
          id: 'celtics',
          name: 'Boston Celtics',
          abbreviation: 'BOS',
          logo: '🟢',
        },
        homeScore: 98,
        awayScore: 102,
        status: 'live',
        period: 3,
        clock: '5:32',
        venue: 'TD Garden',
        hashtags: ['LakesCeltics', 'NBA', 'NBARegularSeason'],
        startTime: inTwoHours,
        expectedEndTime: new Date(inTwoHours.getTime() + 2.5 * 60 * 60000),
      },
      {
        gameId: 'nfl-chiefs-ravens-20240115',
        leagueId: 'NFL',
        sport: 'football',
        homeTeam: {
          id: 'chiefs',
          name: 'Kansas City Chiefs',
          abbreviation: 'KC',
          logo: '🏈',
        },
        awayTeam: {
          id: 'ravens',
          name: 'Baltimore Ravens',
          abbreviation: 'BAL',
          logo: '🏈',
        },
        homeScore: 17,
        awayScore: 14,
        status: 'scheduled',
        period: 1,
        clock: '0:00',
        venue: 'Arrowhead Stadium',
        hashtags: ['ChiefsRavens', 'NFL', 'NFLPlayoffs'],
        startTime: inTenMinutes,
        expectedEndTime: new Date(inTenMinutes.getTime() + 3.5 * 60 * 60000),
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
