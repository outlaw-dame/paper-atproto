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
  evidenceCount: number;
  reason: string;
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

  const domainCounts = new Map<string, number>();
  const domainDescriptions = new Map<string, string>();
  for (const post of params.trendingPosts) {
    const embed = post.embed;
    if (!embed || (embed.type !== 'external' && embed.type !== 'video')) {
      continue;
    }
    try {
      const domain = new URL(embed.url).hostname.replace(/^www\./, '');
      if (!domain) continue;
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
      if (!domainDescriptions.has(domain)) {
        domainDescriptions.set(domain, ('title' in embed && embed.title) ? embed.title : 'Source');
      }
    } catch {
      // Ignore malformed URLs in discovery projection only.
    }
  }

  const domains = [...domainCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([domain, evidenceCount]) => ({
      domain,
      description: domainDescriptions.get(domain) ?? 'Source',
      evidenceCount,
      reason: evidenceCount > 1
        ? `Referenced by ${evidenceCount} trending stories`
        : 'Referenced by a trending story',
    }));

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
