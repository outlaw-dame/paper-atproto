# Sports Infrastructure Integration Guide

## Overview

The sports infrastructure adds real-time live game tracking, sports post filtering, official account verification, and live moment display to paper-atproto.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    User-Facing Components                       │
├─────────────────────────────────────────────────────────────────┤
│ LiveSportsMoments │ SportsAccountBadge │ LiveGameWidget         │
└─────────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Service Layer                                │
├─────────────────────────────────────────────────────────────────┤
│ SportsFeedService (filtering) │ SportsStore (state management) │
└─────────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Data Layer                                   │
├─────────────────────────────────────────────────────────────────┤
│ LeagueRegistry (DIDs) │ Types (TypeScript interfaces)           │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
src/
├── sports/
│   ├── leagueRegistry.ts          # 6 leagues, team accounts, verification
│   ├── types.ts                   # LiveGame, SportsPost, etc.
│   └── sportsStore.ts             # Real-time game state management
├── services/
│   └── sportsFeed.ts              # Custom feed filtering & ranking
└── components/
    ├── LiveGameWidget.tsx         # Score display (2 modes)
    ├── SportsAccountBadge.tsx     # Verification badges
    └── LiveSportsMoments.tsx      # Feed section with live games
```

## Integration Points

### 1. ExploreTab Integration

Add to `src/tabs/ExploreTab.tsx`:

```typescript
import { LiveSportsMoments } from '../components/LiveSportsMoments.js';
import { sportsStore } from '../sports/sportsStore.js';

// In component render:
<LiveSportsMoments maxGames={3} onGameClick={handleGameClick} />

// Initialize sample data on mount:
useEffect(() => {
  sportsStore.loadSampleGames();
  // Start polling for updates
  sportsStore.getLiveGames().forEach(game => {
    sportsStore.startPolling(game.gameId, 'mock');
  });
}, []);
```

### 2. PostCard Integration

Add to `src/components/PostCard.tsx`:

```typescript
import { OfficialSportsBadge, SportsPostIndicator } from './SportsAccountBadge.js';
import { sportsFeedService } from '../services/sportsFeed.js';

// In PostCard render:
const sportsMetadata = sportsFeedService.extractSportsMetadata(post);

{sportsMetadata.isOfficial && (
  <OfficialSportsBadge authorDid={post.author.did} size="small" />
)}

{sportsMetadata.postType && (
  <SportsPostIndicator 
    postType={sportsMetadata.postType}
    isLive={sportsMetadata.isLive}
  />
)}
```

### 3. Feed Generation

Use `SportsFeedService` for custom feed generation:

```typescript
import { sportsFeedService } from '../services/sportsFeed.js';
import { sportsStore } from '../sports/sportsStore.js';

// Filter posts for sports content
const sportsFilter = {
  leagues: ['NBA', 'NFL'],
  sports: ['basketball', 'football'],
  minEngagement: 10,
  sortBy: 'relevance'
};

const liveGames = sportsStore.getLiveGames();
const filtered = sportsFeedService.filterPosts(posts, sportsFilter, liveGames);
```

### 4. Real-Time Updates

Subscribe to game changes:

```typescript
import { sportsStore } from '../sports/sportsStore.js';

useEffect(() => {
  const unsubscribe = sportsStore.subscribe((games) => {
    console.log('Games updated:', games);
    // Update UI with new game state
  });

  return () => unsubscribe();
}, []);
```

## Component Usage Examples

### LiveGameWidget

```typescript
<LiveGameWidget 
  game={game} 
  onClick={() => handleGameClick(game.gameId)}
  compact={false}
/>

// Compact mode (inline score display)
<LiveGameWidget game={game} compact={true} />
```

### Official Sports Badge

```typescript
// Circular badge (14px-24px)
<OfficialSportsBadge 
  authorDid={post.author.did}
  size="medium"
/>

// Text badge with label
<SportsAccountBadge
  authorDid={post.author.did}
  authorHandle={post.author.handle}
/>
```

### Sports Post Indicator

```typescript
<SportsPostIndicator
  postType="score-update"
  isLive={true}
  hasVideo={false}
/>
```

### Live Sports Moments Section

```typescript
<LiveSportsMoments 
  maxGames={3}
  onGameClick={handleGameClick}
  compact={false}
/>
```

## API Reference

### SportsStore

```typescript
// Get games
sportsStore.getGames(): LiveGame[]
sportsStore.getGame(gameId: string): LiveGame | undefined
sportsStore.getLiveGames(): LiveGame[]
sportsStore.getGamesByLeague(leagueId: string): LiveGame[]

// Update games
sportsStore.setGame(game: LiveGame): void

// Polling
sportsStore.startPolling(gameId: string, apiProvider?: string): void
sportsStore.stopPolling(gameId: string): void
sportsStore.stopAllPolling(): void

// Subscriptions
const unsubscribe = sportsStore.subscribe((games) => {
  // Handle update
});

// Utils
sportsStore.loadSampleGames(): void
sportsStore.getUpdateHistory(gameId?: string, limit?: number): UpdateHistory[]
sportsStore.clear(): void
```

### SportsFeedService

```typescript
// Check if post is sports-related
sportsFeedService.isSportsPost(post: any): boolean

// Score posts for ranking
sportsFeedService.scoreSportsPost(post: any, liveGames?: LiveGame[]): number

// Filter & rank posts
sportsFeedService.filterPosts(
  posts: any[],
  filter: SportsFeedFilter,
  liveGames?: LiveGame[]
): any[]

// Generate feed
sportsFeedService.generateFeedSkeleton(
  posts: any[],
  filter: SportsFeedFilter,
  liveGames?: LiveGame[]
): FeedSkeleton

// Extract metadata
sportsFeedService.extractSportsMetadata(post: any): SportsMetadata
```

### LeagueRegistry

```typescript
// Check if official
isOfficialLeague(did: string): boolean
isOfficialTeam(did: string): boolean

// Lookup
getLeagueByDid(did: string): LeagueAccount | undefined
getTeamByDid(did: string): TeamAccount | undefined
getTeamById(teamId: string): TeamAccount | undefined
getTeamsByLeague(leagueId: string): TeamAccount[]
```

## Data Types

### LiveGame

```typescript
interface LiveGame {
  gameId: string;
  leagueId: string;
  sport: 'basketball' | 'football' | 'baseball' | 'hockey' | 'soccer';
  homeTeam: Team;
  awayTeam: Team;
  homeScore: number;
  awayScore: number;
  status: 'scheduled' | 'live' | 'halftime' | 'final' | 'postponed';
  period: number;
  clock: string;
  venue: string;
  hashtags: string[];
  startTime: Date;
  expectedEndTime: Date;
}
```

### SportsPost

```typescript
interface SportsPost {
  uri: string;
  author: { did: string; handle: string };
  postType: 'score-update' | 'commentary' | 'highlight' | 'analysis' | 'prediction' | 'reaction';
  relatedGames?: string[];
  isLive: boolean;
  createdAt: Date;
}
```

### SportsFeedFilter

```typescript
interface SportsFeedFilter {
  leagues?: string[];
  sports?: string[];
  minEngagement?: number;
  sortBy?: 'engagement' | 'recent' | 'relevance';
}
```

## Next Steps

1. **Integrate into ExploreTab** — Add `<LiveSportsMoments />` section
2. **Update PostCard** — Display official badges and post indicators
3. **Connect ESPN API** — Replace mock polling with real data
4. **Add WebSocket layer** — Real-time updates instead of polling
5. **Test full flow** — Verify end-to-end functionality
6. **Commit & Deploy**

## Development Tips

- Load sample games: `sportsStore.loadSampleGames()`
- View update history: `sportsStore.getUpdateHistory()`
- Check filtering: `sportsFeedService.isSportsPost(post)`
- Test ranking: `sportsFeedService.scoreSportsPost(post, liveGames)`

## Extend for New Features

### Add a new league

```typescript
// In leagueRegistry.ts, add to OFFICIAL_LEAGUES:
Premier_League: {
  id: 'Premier_League',
  name: 'Premier League',
  sport: 'soccer',
  did: 'did:plc:...',
  website: 'premierleague.com',
}
```

### Add a custom evaluator

```typescript
// In SportsFeedService
private evaluateSoccerEngagement(post: any): number {
  // Custom logic for soccer posts
}
```

### Connect real API

```typescript
// In sportsStore.ts, replace mockFetchGameState:
private async fetchGameState(gameId: string, provider: string) {
  const response = await fetch(`https://api.${provider}.com/games/${gameId}`);
  return response.json();
}
```

## Troubleshooting

**Games not updating?**
- Check browser console for polling errors
- Verify `startPolling()` called on component mount
- Confirm `subscribe()` callbacks are registered

**Badges not showing?**
- Verify DIDs in leagueRegistry match post author DIDs
- Check `isOfficial` in `extractSportsMetadata()`

**Feed not filtering sports posts?**
- Ensure `isSportsPost()` regex patterns match your content
- Check `SportsFeedFilter` settings
- View `scoreSportsPost()` output to debug ranking

## Performance Considerations

- **Polling Interval**: Default 3 seconds (adjust in `sportsStore.ts`)
- **Update History**: Limited to last 1000 events (configurable)
- **Visible Games**: Load sample with `loadSampleGames()`
- **Subscribers**: Unsubscribe in `useEffect` cleanup
