import { getLeagueByDid, getTeamByDid } from '../sports/leagueRegistry.js';
import type { LiveGame, SportsFeedFilter } from '../sports/types.js';

/**
 * Custom feed generator for sports content
 * Filters posts by sports relevance and ranks by live status
 */
export class SportsFeedService {
  private getPostText(post: any): string {
    return String(post?.record?.text ?? post?.content ?? '');
  }

  private getPostCreatedAt(post: any): string {
    return String(post?.record?.createdAt ?? post?.createdAt ?? new Date(0).toISOString());
  }

  private hasVideo(post: any): boolean {
    return post?.record?.embed?.type?.includes?.('video') || post?.embed?.type === 'video';
  }

  /**
   * Extract cashtags from post text
   * Looks for $SYMBOL patterns
   */
  private extractCashtags(text: string): string[] {
    const matches = text.match(/\$[A-Z]+/g);
    return matches ? matches.map((m) => m.substring(1)) : [];
  }

  /**
   * Check if a post is sports-related
   */
  isSportsPost(post: any): boolean {
    const text = this.getPostText(post);
    if (!text.trim()) {
      return false;
    }

    // Check for live game indicators
    if (
      /\b(live|game|score|final|q\d|inning|period|halftime|overtime|championship|playoffs)\b/i.test(
        text
      )
    ) {
      return true;
    }

    // Check for sports terminology
    if (
      /\b(touchdown|field goal|home run|goal|assist|rebound|basket|wicket|birdie|ace|slam|serve)\b/i.test(
        text
      )
    ) {
      return true;
    }

    // Check for team/league names
    const leagues = [
      'NBA',
      'WNBA',
      'NFL',
      'MLB',
      'NHL',
      'MLS',
      'Premier League',
      'LaLiga',
      'Serie A',
      'UFC',
      'WWE',
    ];
    if (leagues.some((league) => text.includes(league))) {
      return true;
    }

    // Check for cashtags (sports gambling/stats)
    if (/\$[A-Z]{1,5}\b/.test(text)) {
      return true;
    }

    return false;
  }

  /**
   * Score a sports post for ranking
   * Higher scores = higher in feed
   */
  scoreSportsPost(post: any, liveGames?: LiveGame[]): number {
    let score = 0;

    const text = this.getPostText(post);
    const authorDid = post.author?.did;

    // Official league/team posts get major boost
    if (authorDid && (getLeagueByDid(authorDid) || getTeamByDid(authorDid))) {
      score += 1000;
    }

    // Live game commentary gets massive boost
    if (/\blive\b/i.test(text)) {
      score += 500;
    }

    // Highlight videos get boost
    if (this.hasVideo(post) || /highlight|clip|goal/i.test(text)) {
      score += 300;
    }

    // Score update posts
    if (/\bfinal\b|\bscore\b/i.test(text)) {
      score += 200;
    }

    // Posts mentioning active games
    if (liveGames) {
      for (const game of liveGames) {
        if (
          text.includes(game.homeTeam.name) ||
          text.includes(game.awayTeam.name) ||
          game.hashtags.some((tag) => text.includes(`#${tag}`))
        ) {
          score += 250;
          break;
        }
      }
    }

    // Boost by engagement
    const like_count = post.likeCount || 0;
    const reply_count = post.replyCount || 0;
    const repost_count = post.repostCount || 0;

    score += like_count * 2 + reply_count * 4 + repost_count * 3;

    // Recent posts get slight boost
    const postAge = Date.now() - new Date(this.getPostCreatedAt(post)).getTime();
    const hoursOld = postAge / (1000 * 60 * 60);
    if (hoursOld < 1) {
      score += 100;
    } else if (hoursOld < 4) {
      score += 50;
    }

    return score;
  }

  /**
   * Filter posts by sports criteria
   */
  filterPosts(
    posts: any[],
    filter: SportsFeedFilter,
    liveGames?: LiveGame[]
  ): any[] {
    return posts
      .filter((post) => {
        // Must be sports-related
        if (!this.isSportsPost(post)) {
          return false;
        }

        const text = this.getPostText(post).toLowerCase();

        // Filter by leagues if specified
        if (filter.leagues && filter.leagues.length > 0) {
          const matchesLeague = filter.leagues.some((league) =>
            text.includes(league.toLowerCase())
          );
          if (!matchesLeague) {
            return false;
          }
        }

        // Filter by sports if specified
        if (filter.sports && filter.sports.length > 0) {
          const matchesSport = filter.sports.some((sport) =>
            text.includes(sport.toLowerCase())
          );
          if (!matchesSport) {
            return false;
          }
        }

        // Filter by minimum engagement
        if (filter.minEngagement) {
          const totalEngagement =
            (post.likeCount || 0) +
            (post.replyCount || 0) * 2 +
            (post.repostCount || 0) * 3;
          if (totalEngagement < filter.minEngagement) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        // Apply sort order
        if (filter.sortBy === 'engagement') {
          const engagementA =
            (a.likeCount || 0) +
            (a.replyCount || 0) * 2 +
            (a.repostCount || 0) * 3;
          const engagementB =
            (b.likeCount || 0) +
            (b.replyCount || 0) * 2 +
            (b.repostCount || 0) * 3;
          return engagementB - engagementA;
        } else if (filter.sortBy === 'recency') {
          return (
            new Date(this.getPostCreatedAt(b)).getTime() -
            new Date(this.getPostCreatedAt(a)).getTime()
          );
        } else if (filter.sortBy === 'official-first') {
          const officialDelta =
            Number(!!(getLeagueByDid(b.author?.did) || getTeamByDid(b.author?.did))) -
            Number(!!(getLeagueByDid(a.author?.did) || getTeamByDid(a.author?.did)));
          if (officialDelta !== 0) return officialDelta;
          return (
            this.scoreSportsPost(b, liveGames) -
            this.scoreSportsPost(a, liveGames)
          );
        }

        // Default: relevance
        return (
          this.scoreSportsPost(b, liveGames) -
          this.scoreSportsPost(a, liveGames)
        );
      });
  }

  /**
   * Generate a sports feed skeleton for custom feed generator
   * Compatible with app.bsky.feed.getFeedSkeleton response
   */
  generateFeedSkeleton(
    posts: any[],
    filter: SportsFeedFilter,
    liveGames?: LiveGame[]
  ): any {
    const filtered = this.filterPosts(posts, filter, liveGames);

    return {
      feed: filtered.map((post) => ({
        post: post.uri,
        reason: {
          $type: 'app.bsky.feed.defs#skeletonReasonPost',
          by: post.author?.did,
        },
      })),
      cursor: filtered[filtered.length - 1]?.cid || undefined,
    };
  }

  /**
   * Extract sports metadata from a post for display
   */
  extractSportsMetadata(post: any) {
    const text = this.getPostText(post);
    const authorDid = post.author?.did;

    return {
      league: this.detectLeague(text),
      postType: this.detectPostType(text),
      isLive: /\blive\b/i.test(text),
      hasHighlight: /highlight|clip|goal|score|highlight-reel/i.test(text),
      cashtags: this.extractCashtags(text),
      isOfficial: !!(authorDid && (getLeagueByDid(authorDid) || getTeamByDid(authorDid))),
      isSports: this.isSportsPost(post),
    };
  }

  /**
   * Detect league from post text
   */
  private detectLeague(text: string): string | null {
    const leagues = ['NBA', 'WNBA', 'NFL', 'MLB', 'NHL', 'MLS'];
    for (const league of leagues) {
      if (text.includes(league)) {
        return league;
      }
    }
    return null;
  }

  /**
   * Detect post type from content
   */
  private detectPostType(
    text: string
  ): 'score-update' | 'commentary' | 'highlight' | 'analysis' | 'prediction' | 'reaction' {
    if (/\bfinal\b|\bscore(\s+update)?\b/i.test(text)) {
      return 'score-update';
    }
    if (/highlight|clip|video/i.test(text)) {
      return 'highlight';
    }
    if (/analysis|breakdown|stats/i.test(text)) {
      return 'analysis';
    }
    if (/prediction|predict|betting|odds/i.test(text)) {
      return 'prediction';
    }
    if (/love|hate|terrible|amazing|insane/i.test(text)) {
      return 'reaction';
    }
    return 'commentary';
  }
}

// Singleton instance
export const sportsFeedService = new SportsFeedService();

export default sportsFeedService;
