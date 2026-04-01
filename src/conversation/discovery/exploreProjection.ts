import type { AppBskyActorDefs } from '@atproto/api';
import type { MockPost } from '../../data/mockData';
import { getPrimaryPostText } from './exploreDiscovery';

export interface ExploreLiveCluster {
  title: string;
  summary: string;
  count: number;
  id: string;
}

export interface ExploreDomainCard {
  domain: string;
  description: string;
}

export interface ExploreDiscoverProjection {
  trendingTopics: string[];
  liveClusters: ExploreLiveCluster[];
  domains: ExploreDomainCard[];
  hasVisibleDiscoverContent: boolean;
}

function deriveStableCount(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(index);
    hash |= 0;
  }
  return 5 + (Math.abs(hash) % 40);
}

export function projectExploreDiscoverView(params: {
  trendingPosts: MockPost[];
  suggestedActors: AppBskyActorDefs.ProfileView[];
  visibleDiscoverSections: Set<string> | null;
  sportsPulsePostCount: number;
  recentFeedItemCount: number;
  filteredLinkPostCount: number;
  suggestedFeedCount: number;
}): ExploreDiscoverProjection {
  const trendingTopics = params.trendingPosts
    .flatMap((post) => (getPrimaryPostText(post).match(/#\w+/g) ?? []).slice(0, 2))
    .filter((topic, index, allTopics) => allTopics.indexOf(topic) === index)
    .slice(0, 8);

  const liveClusters = params.suggestedActors.slice(0, 3).map((actor) => ({
    title: actor.displayName ?? actor.handle,
    summary: actor.description ?? 'Active discussion happening now',
    count: deriveStableCount(actor.did),
    id: actor.did,
  }));

  const domains = params.trendingPosts
    .map((post) => {
      const embed = post.embed;
      if (!embed || (embed.type !== 'external' && embed.type !== 'video')) {
        return null;
      }

      try {
        const domain = new URL(embed.url).hostname.replace(/^www\./, '');
        return {
          domain,
          description: ('title' in embed && embed.title) ? embed.title : 'Source',
        };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is ExploreDomainCard => Boolean(entry?.domain))
    .filter((entry, index, allEntries) => allEntries.findIndex((candidate) => candidate.domain === entry.domain) === index)
    .slice(0, 6);

  const hasVisibleDiscoverContent = params.visibleDiscoverSections == null
    || params.visibleDiscoverSections.has('live-sports')
    || (params.visibleDiscoverSections.has('sports-pulse') && params.sportsPulsePostCount > 0)
    || (params.visibleDiscoverSections.has('feed-items') && params.recentFeedItemCount > 0)
    || (params.visibleDiscoverSections.has('top-stories') && params.filteredLinkPostCount > 0)
    || (params.visibleDiscoverSections.has('trending-topics') && trendingTopics.length > 0)
    || (params.visibleDiscoverSections.has('live-clusters') && liveClusters.length > 0)
    || (params.visibleDiscoverSections.has('feeds-to-follow') && params.suggestedFeedCount > 0)
    || (params.visibleDiscoverSections.has('sources') && domains.length > 0);

  return {
    trendingTopics,
    liveClusters,
    domains,
    hasVisibleDiscoverContent,
  };
}
