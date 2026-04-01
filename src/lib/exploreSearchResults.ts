import type { AppBskyActorDefs } from '@atproto/api';
import type { MockPost } from '../data/mockData';

export interface ExploreFeedResult {
  id: string;
  title: string;
  content?: string;
  link: string;
  pubDate?: string;
  author?: string;
  enclosureType?: string;
  feedTitle?: string;
  feedCategory?: string;
  score?: number;
  source?: 'local' | 'podcast-index';
}

interface ResolveExploreSearchResultsInput {
  postsRes: any;
  tagPostsRes?: any;
  localHybridPostRows?: any;
  actorsRes: any;
  feedRes: any;
  podcastIndexFeeds: any;
  hasDisplayableRecordContent: (record: unknown) => boolean;
  mapPost: (postView: any) => MockPost;
  mapLocalHybridPost?: (row: any) => MockPost;
  mapFeedRow: (row: any) => ExploreFeedResult;
  mapPodcastFeed: (feed: any) => ExploreFeedResult;
}

export interface ResolvedExploreSearchResults {
  posts: MockPost[];
  actors: AppBskyActorDefs.ProfileView[];
  feedItems: ExploreFeedResult[];
}

export function mapFeedRowToExploreFeedResult(row: any): ExploreFeedResult {
  return {
    id: String(row.id),
    title: String(row.title || 'Untitled feed item'),
    ...(row.content ? { content: String(row.content) } : {}),
    link: String(row.link || ''),
    ...(row.pub_date ? { pubDate: String(row.pub_date) } : {}),
    ...(row.author ? { author: String(row.author) } : {}),
    ...(row.enclosure_type ? { enclosureType: String(row.enclosure_type) } : {}),
    ...(row.feed_title ? { feedTitle: String(row.feed_title) } : {}),
    ...(row.feed_category ? { feedCategory: String(row.feed_category) } : {}),
    ...(typeof row.rrf_score === 'number' ? { score: row.rrf_score } : {}),
    source: 'local',
  };
}

export function mapPodcastFeedToExploreFeedResult(feed: any): ExploreFeedResult {
  const categories = feed?.categories && typeof feed.categories === 'object'
    ? Object.values(feed.categories).filter((value) => typeof value === 'string')
    : [];

  return {
    id: `podcast-index:${String(feed?.id ?? feed?.url ?? Math.random())}`,
    title: String(feed?.title || 'Untitled podcast'),
    ...(feed?.description ? { content: String(feed.description) } : {}),
    link: String(feed?.url || ''),
    ...(feed?.author ? { author: String(feed.author) } : {}),
    enclosureType: 'audio/mpeg',
    feedTitle: String(feed?.title || 'Podcast'),
    ...(categories.length > 0 ? { feedCategory: String(categories[0]) } : { feedCategory: 'Podcast' }),
    source: 'podcast-index',
  };
}

export function mapHybridPostRowToMockPost(row: any): MockPost {
  const authorDid = String(row?.author_did || row?.authorDid || 'did:plc:local');
  const createdAt = (() => {
    const raw = row?.created_at || row?.createdAt;
    if (!raw) return new Date().toISOString();
    return new Date(raw).toISOString();
  })();
  const handle = authorDid.startsWith('did:')
    ? `${authorDid.slice(-8)}.local`
    : 'local-user';

  return {
    id: String(row?.id || crypto.randomUUID()),
    ...(row?.cid ? { cid: String(row.cid) } : {}),
    author: {
      did: authorDid,
      handle,
      displayName: handle,
    },
    content: String(row?.content || ''),
    createdAt,
    timestamp: createdAt,
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
    bookmarkCount: 0,
    chips: [],
  };
}

export function dedupeExploreSearchPosts(posts: MockPost[]): MockPost[] {
  const seen = new Set<string>();
  return posts.filter((post) => {
    const key = post.id.trim().toLowerCase();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveExploreSearchResults(
  input: ResolveExploreSearchResultsInput,
): ResolvedExploreSearchResults {
  const mappedRemotePosts = input.postsRes?.data?.posts
    ? input.postsRes.data.posts
      .filter((p: any) => input.hasDisplayableRecordContent(p?.record))
      .map((p: any) => input.mapPost(p))
    : [];

  const mappedTagPosts = input.tagPostsRes?.data?.posts
    ? input.tagPostsRes.data.posts
      .filter((p: any) => input.hasDisplayableRecordContent(p?.record))
      .map((p: any) => input.mapPost(p))
    : [];

  const mappedLocalHybridPosts = Array.isArray(input.localHybridPostRows) && input.mapLocalHybridPost
    ? input.localHybridPostRows.map((row) => input.mapLocalHybridPost!(row))
    : [];

  const mappedPosts = dedupeExploreSearchPosts([
    ...mappedRemotePosts,
    ...mappedTagPosts,
    ...mappedLocalHybridPosts,
  ]);

  const actors = input.actorsRes?.data?.actors ?? [];

  const localResults = input.feedRes?.rows
    ? input.feedRes.rows.map(input.mapFeedRow)
    : [];

  const podcastResults = Array.isArray(input.podcastIndexFeeds)
    ? input.podcastIndexFeeds.map(input.mapPodcastFeed)
    : [];

  const seenLinks = new Set<string>();
  const merged = [...localResults, ...podcastResults].filter((item) => {
    const key = item.link.trim().toLowerCase();
    if (!key) return false;
    if (seenLinks.has(key)) return false;
    seenLinks.add(key);
    return true;
  });

  return {
    posts: mappedPosts,
    actors,
    feedItems: merged,
  };
}
