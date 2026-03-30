import type { LiveGame, LiveEventUpdate } from './types';

type SportsApiProvider = 'espn' | 'nfl' | 'nba' | 'mock';
type EspnLeague = 'nba' | 'nfl' | 'mlb' | 'nhl';

/**
 * Real-time sports data store
 * Manages live game state and external API updates
 */
class SportsStore {
  private liveGames = new Map<string, LiveGame>();
  private espnRefreshTimer: ReturnType<typeof setInterval> | null = null;

  private getNow(): number {
    return Date.now();
  }

  private toEpoch(value?: string): number | null {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  private isActuallyLive(game: LiveGame): boolean {
    if (game.status !== 'live') return false;

    const now = this.getNow();
    const start = this.toEpoch(game.startTime);
    const end = this.toEpoch(game.endTime);
    const updated = this.toEpoch(game.lastUpdated);

    // A game cannot be live before start or after an explicit end.
    if (start !== null && now < start) return false;
    if (end !== null && now >= end) return false;

    // If updates are stale for too long, suppress the live badge.
    if (updated !== null && now - updated > 20 * 60 * 1000) return false;

    return true;
  }

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
    return this.getGames().filter((g) => this.isActuallyLive(g));
  }

  /**
   * Add or update a game
   */
  setGame(game: LiveGame): void {
    const normalized = { ...game };
    const now = this.getNow();
    const start = this.toEpoch(normalized.startTime);
    const end = this.toEpoch(normalized.endTime);

    // Normalize impossible states from upstream/mock providers.
    if (normalized.status === 'live' && start !== null && now < start) {
      normalized.status = 'scheduled';
      normalized.period = 1;
      normalized.clock = '0:00';
    } else if (normalized.status === 'live' && end !== null && now >= end) {
      normalized.status = 'final';
      normalized.clock = '0:00';
    }

    const previous = this.liveGames.get(normalized.id);
    this.liveGames.set(normalized.id, normalized);

    // Track changes
    if (
      previous &&
      (previous.homeTeam.score !== normalized.homeTeam.score || previous.awayTeam.score !== normalized.awayTeam.score)
    ) {
      const update: LiveEventUpdate = {
        updateType: 'score',
        gameId: normalized.id,
        details: {
          homeScore: normalized.homeTeam.score,
          awayScore: normalized.awayTeam.score,
          previousHomeScore: previous.homeTeam.score,
          previousAwayScore: previous.awayTeam.score,
        },
        timestamp: new Date().toISOString(),
      };
      this.recordUpdate(update);
    }

    if (previous && previous.status !== normalized.status) {
      const update: LiveEventUpdate = {
        updateType: normalized.status === 'live' ? 'start-game' : normalized.status === 'final' ? 'end-game' : 'period-change',
        gameId: normalized.id,
        details: {
          status: normalized.status,
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
    apiProvider: SportsApiProvider = 'mock'
  ): Promise<void> {
    try {
      if (apiProvider === 'mock') {
        const game = this.mockFetchGameState(gameId, apiProvider);
        if (game) this.setGame(game);
        return;
      }

      const league: EspnLeague = apiProvider === 'espn' ? 'nba' : apiProvider;
      await this.syncEspnLeague(league);
    } catch (error) {
      console.error(`Failed to update game ${gameId} from ${apiProvider}:`, error);
    }
  }

  /**
   * Start polling for game updates
   */
  startPolling(gameId: string, apiProvider: SportsApiProvider = 'mock'): void {
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

  async loadFromEspn(leagues: EspnLeague[] = ['nba', 'nfl']): Promise<void> {
    await Promise.all(leagues.map((league) => this.syncEspnLeague(league)));
  }

  startEspnAutoRefresh(leagues: EspnLeague[] = ['nba', 'nfl'], intervalMs = 45_000): void {
    this.stopEspnAutoRefresh();
    this.loadFromEspn(leagues).catch(() => {
      // Swallow refresh bootstrap errors and keep app responsive.
    });
    this.espnRefreshTimer = setInterval(() => {
      this.loadFromEspn(leagues).catch(() => {
        // Ignore transient API failures and retry on next tick.
      });
    }, intervalMs);
  }

  stopEspnAutoRefresh(): void {
    if (!this.espnRefreshTimer) return;
    clearInterval(this.espnRefreshTimer);
    this.espnRefreshTimer = null;
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
    this.stopEspnAutoRefresh();
    this.liveGames.clear();
    this.updateHistory = [];
  }

  private getEspnSportPath(league: EspnLeague): string {
    switch (league) {
      case 'nba':
        return 'basketball/nba';
      case 'nfl':
        return 'football/nfl';
      case 'mlb':
        return 'baseball/mlb';
      case 'nhl':
        return 'hockey/nhl';
      default:
        return 'basketball/nba';
    }
  }

  private detectSportByLeague(league: EspnLeague): LiveGame['sport'] {
    switch (league) {
      case 'nba':
        return 'basketball';
      case 'nfl':
        return 'football';
      case 'mlb':
        return 'baseball';
      case 'nhl':
        return 'hockey';
      default:
        return 'other';
    }
  }

  private toPositiveInt(raw: unknown): number {
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }

  private toTag(value: string): string {
    return value.replace(/[^a-zA-Z0-9]/g, '');
  }

  private mapEspnStatus(statusRaw: string, detailRaw: string): LiveGame['status'] {
    const status = statusRaw.toLowerCase();
    const detail = detailRaw.toLowerCase();
    if (status === 'in') {
      if (detail.includes('halftime')) return 'halftime';
      return 'live';
    }
    if (status === 'post' || status === 'final') return 'final';
    if (status === 'pre') return 'scheduled';
    if (status === 'postponed') return 'postponed';
    if (status === 'cancelled') return 'cancelled';
    return 'scheduled';
  }

  private mapEspnEventToLiveGame(event: any, league: EspnLeague): LiveGame | null {
    const competition = Array.isArray(event?.competitions) ? event.competitions[0] : null;
    const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
    const home = competitors.find((entry: any) => entry?.homeAway === 'home');
    const away = competitors.find((entry: any) => entry?.homeAway === 'away');
    if (!home || !away) return null;

    const statusType = competition?.status?.type;
    const state = String(statusType?.state || 'pre');
    const detail = String(competition?.status?.type?.shortDetail || competition?.status?.type?.detail || '');
    const leagueTag = league.toUpperCase();
    const homeAbbrev = String(home?.team?.abbreviation || home?.team?.name || '').trim();
    const awayAbbrev = String(away?.team?.abbreviation || away?.team?.name || '').trim();

    return {
      id: `${league}-${String(event?.id || `${awayAbbrev}-${homeAbbrev}`)}`,
      league,
      sport: this.detectSportByLeague(league),
      homeTeam: {
        id: String(home?.team?.id || homeAbbrev || 'home'),
        name: String(home?.team?.displayName || home?.team?.name || 'Home'),
        score: this.toPositiveInt(home?.score),
        ...(typeof home?.team?.logo === 'string' && home.team.logo ? { logo: String(home.team.logo) } : {}),
      },
      awayTeam: {
        id: String(away?.team?.id || awayAbbrev || 'away'),
        name: String(away?.team?.displayName || away?.team?.name || 'Away'),
        score: this.toPositiveInt(away?.score),
        ...(typeof away?.team?.logo === 'string' && away.team.logo ? { logo: String(away.team.logo) } : {}),
      },
      status: this.mapEspnStatus(state, detail),
      ...(Number.isFinite(Number(competition?.status?.period)) ? { period: Number(competition.status.period) } : {}),
      ...(typeof competition?.status?.displayClock === 'string' && competition.status.displayClock
        ? { clock: String(competition.status.displayClock) }
        : {}),
      startTime: String(event?.date || new Date().toISOString()),
      ...(state === 'post' ? { endTime: new Date().toISOString() } : {}),
      ...(typeof competition?.venue?.fullName === 'string' && competition.venue.fullName
        ? { venue: String(competition.venue.fullName) }
        : {}),
      ...(typeof event?.links?.[0]?.href === 'string' && event.links[0].href
        ? { externalUrl: String(event.links[0].href) }
        : {}),
      hashtags: [
        this.toTag(leagueTag),
        this.toTag(`${awayAbbrev}${homeAbbrev}`),
      ].filter(Boolean),
      lastUpdated: new Date().toISOString(),
    };
  }

  private async syncEspnLeague(league: EspnLeague): Promise<void> {
    const sportPath = this.getEspnSportPath(league);
    const endpoint = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard`;
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`ESPN scoreboard request failed for ${league}: ${response.status}`);
    }

    const payload = await response.json() as { events?: any[] };
    const events = Array.isArray(payload.events) ? payload.events : [];
    events.forEach((event) => {
      const mapped = this.mapEspnEventToLiveGame(event, league);
      if (!mapped) return;
      this.setGame(mapped);
    });
  }

  /**
   * Mock game state fetching (for development/testing)
   */
  private mockFetchGameState(gameId: string, _provider: string): LiveGame | null {
    const game = this.liveGames.get(gameId);
    if (!game) return null;

    // Simulate dynamic score updates for live games
    if (this.isActuallyLive(game)) {
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
    const startedNinetyMinutesAgo = new Date(now.getTime() - 90 * 60000);

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
        startTime: startedNinetyMinutesAgo.toISOString(),
        endTime: new Date(now.getTime() + 60 * 60000).toISOString(),
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
    loadFromEspn: sportsStore.loadFromEspn.bind(sportsStore),
    startEspnAutoRefresh: sportsStore.startEspnAutoRefresh.bind(sportsStore),
    stopEspnAutoRefresh: sportsStore.stopEspnAutoRefresh.bind(sportsStore),
    subscribe: sportsStore.subscribe.bind(sportsStore),
    loadSampleGames: sportsStore.loadSampleGames.bind(sportsStore),
    clear: sportsStore.clear.bind(sportsStore),
  };
}

export default sportsStore;
