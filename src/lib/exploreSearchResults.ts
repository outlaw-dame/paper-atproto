import type { AppBskyActorDefs } from '@atproto/api';
import type { MockPost } from '../data/mockData';
import { isAtUri, parseAtUri } from './resolver/atproto';
import { sanitizeExternalUrl } from './safety/externalUrl';

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

type RankedExplorePostSource = 'remote' | 'tag' | 'local';

interface LocalQuotePreview {
  uri: string;
  authorDid?: string;
  authorHandle?: string;
  authorDisplayName?: string;
  text?: string;
  external?: {
    url: string;
    title?: string;
    description?: string;
    thumb?: string;
    domain: string;
  };
}

interface RankedExplorePostCandidate {
  post: MockPost;
  source: RankedExplorePostSource;
  sourceIndex: number;
  score: number;
  richness: number;
}

const SOURCE_PRIORITY: Record<RankedExplorePostSource, number> = {
  remote: 0,
  tag: 1,
  local: 2,
};

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function sanitizePreviewUrl(rawUrl: unknown): string | undefined {
  if (typeof rawUrl !== 'string') return undefined;
  return sanitizeExternalUrl(rawUrl, {
    rejectLocalHosts: true,
  }) ?? undefined;
}

function isVideoUrl(url: string): boolean {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv)\/.+$/i.test(url);
}

function isAudioUrl(url: string): boolean {
  return /\.(mp3|ogg|wav|flac|aac|m4a|opus)(\?.*)?$/i.test(url);
}

function readBlobRef(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const ref = (value as any).ref;
  if (!ref || typeof ref !== 'object') return null;
  if (typeof ref.$link === 'string' && ref.$link.length > 0) return ref.$link;
  if (typeof ref.toString === 'function') {
    const str = ref.toString();
    if (typeof str === 'string' && str.length > 0 && str !== '[object Object]') return str;
  }
  return null;
}

function buildBlobCdnUrl(did: string, blobLike: unknown): string | undefined {
  const cid = readBlobRef(blobLike);
  if (!cid) return undefined;
  return `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@jpeg`;
}

function buildBlobSyncUrl(did: string, blobLike: unknown): string | undefined {
  const cid = readBlobRef(blobLike);
  if (!cid) return undefined;
  return `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
}

function normalizeAspectRatio(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const width = Number((value as any).width);
  const height = Number((value as any).height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return width / height;
}

function parseEmbedJson(raw: unknown): any | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function resolveBlobUrl(authorDid: string, blobLike: unknown): string | undefined {
  if (typeof blobLike === 'string' && blobLike.trim().length > 0) return blobLike.trim();
  return buildBlobCdnUrl(authorDid, blobLike) || buildBlobSyncUrl(authorDid, blobLike);
}

function defaultHandleForDid(did: string): string {
  return did.startsWith('did:') ? `${did.slice(-8)}.local` : 'local-user';
}

export function getLocalHybridPostUri(row: any): string | null {
  const uriCandidate = typeof row?.uri === 'string' ? row.uri.trim() : '';
  if (isAtUri(uriCandidate)) return uriCandidate;
  const idCandidate = typeof row?.id === 'string' ? row.id.trim() : '';
  return isAtUri(idCandidate) ? idCandidate : null;
}

function resolveLocalHybridPostId(row: any): string {
  return getLocalHybridPostUri(row)
    ?? String(row?.id || row?.uri || `local-search:${String(row?.author_did || row?.authorDid || 'anonymous')}`);
}

function mapLocalExternalEmbed(authorDid: string, external: any): MockPost['embed'] | undefined {
  const url = sanitizePreviewUrl(typeof external?.uri === 'string' ? external.uri.trim() : '');
  if (!url) return undefined;
  const title = typeof external?.title === 'string' ? external.title : url;
  const description = typeof external?.description === 'string' ? external.description : '';
  const thumb = sanitizePreviewUrl(resolveBlobUrl(authorDid, external?.thumb));

  if (isAudioUrl(url)) {
    return {
      type: 'audio',
      url,
      title,
      ...(description ? { description } : {}),
      ...(thumb ? { thumb } : {}),
      domain: extractDomain(url),
    };
  }

  if (isVideoUrl(url)) {
    return {
      type: 'video',
      url,
      title,
      ...(description ? { description } : {}),
      ...(thumb ? { thumb } : {}),
      domain: extractDomain(url),
    };
  }

  return {
    type: 'external',
    url,
    title,
    description,
    ...(thumb ? { thumb } : {}),
    domain: extractDomain(url),
  };
}

function mapLocalEmbed(authorDid: string, embed: any): {
  media?: MockPost['media'];
  embed?: MockPost['embed'];
  quoteUri?: string;
  quotePreview?: LocalQuotePreview;
} {
  if (!embed || typeof embed !== 'object') return {};

  const preview = embed._preview && typeof embed._preview === 'object' ? embed._preview : null;
  const mediaSource = embed.$type === 'app.bsky.embed.recordWithMedia'
    ? embed.media
    : embed;
  const imageEntries = Array.isArray(mediaSource?.images) ? mediaSource.images : [];
  const previewImages = preview?.kind === 'images'
    ? (Array.isArray(preview.images) ? preview.images : [])
    : preview?.kind === 'recordWithMedia'
      ? (Array.isArray(preview.mediaImages) ? preview.mediaImages : [])
      : [];

  const mediaCandidates = imageEntries.length > 0 ? imageEntries : previewImages;
  const media = mediaCandidates
    .map((entry: any) => {
      const aspectRatio = normalizeAspectRatio(entry?.aspectRatio);
      const url = sanitizePreviewUrl(
        resolveBlobUrl(authorDid, entry?.image) ?? (typeof entry?.url === 'string' ? entry.url.trim() : ''),
      );
      if (!url) return null;
      return {
        type: 'image' as const,
        url,
        ...(typeof entry?.alt === 'string' && entry.alt.trim().length > 0 ? { alt: entry.alt.trim() } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
      };
    })
    .filter((entry: unknown): entry is NonNullable<MockPost['media']>[number] => Boolean(entry));

  const externalEmbed = mapLocalExternalEmbed(
    authorDid,
    mediaSource?.external
    ?? embed?.external
    ?? (preview?.kind === 'external' ? preview.external : null)
    ?? (preview?.kind === 'recordWithMedia' ? preview.mediaExternal : null),
  );

  let videoEmbed: MockPost['embed'] | undefined;
  const videoBlob = mediaSource?.video?.video ?? mediaSource?.video;
  const previewVideo = preview?.kind === 'video'
    ? preview.video
    : preview?.kind === 'recordWithMedia'
      ? preview.mediaVideo
      : null;
  const previewVideoUrl = sanitizePreviewUrl(previewVideo?.uri);
  const videoUrl = previewVideoUrl || sanitizePreviewUrl(resolveBlobUrl(authorDid, videoBlob)) || '';
  const videoAspectRatio = normalizeAspectRatio(mediaSource?.aspectRatio);
  if (videoUrl) {
    const previewAspectRatio = normalizeAspectRatio(previewVideo?.aspectRatio);
    const resolvedAspectRatio = videoAspectRatio ?? previewAspectRatio;
    const resolvedThumb = typeof previewVideo?.thumb === 'string' && previewVideo.thumb.trim().length > 0
      ? previewVideo.thumb
      : undefined;
    const resolvedDescription = typeof mediaSource?.alt === 'string' && mediaSource.alt.trim().length > 0
      ? mediaSource.alt.trim()
      : typeof previewVideo?.alt === 'string' && previewVideo.alt.trim().length > 0
        ? previewVideo.alt.trim()
        : undefined;

    videoEmbed = {
      type: 'video',
      url: videoUrl,
      ...(resolvedDescription ? { description: resolvedDescription } : {}),
      ...(resolvedThumb ? { thumb: resolvedThumb } : {}),
      ...(typeof resolvedAspectRatio === 'number' ? { aspectRatio: resolvedAspectRatio } : {}),
      domain: extractDomain(videoUrl) || previewVideo?.domain || 'bsky.app',
    };
  }

  const quoteUri = typeof embed?.record?.uri === 'string'
    ? embed.record.uri.trim()
    : typeof embed?.record?.record?.uri === 'string'
      ? embed.record.record.uri.trim()
      : typeof preview?.quotedUri === 'string'
        ? preview.quotedUri.trim()
      : '';
  const quotePreview = quoteUri
    ? {
        uri: quoteUri,
        ...(typeof preview?.quotedAuthorDid === 'string' && preview.quotedAuthorDid.trim().length > 0
          ? { authorDid: preview.quotedAuthorDid.trim() }
          : {}),
        ...(typeof preview?.quotedAuthorHandle === 'string' && preview.quotedAuthorHandle.trim().length > 0
          ? { authorHandle: preview.quotedAuthorHandle.trim() }
          : {}),
        ...(typeof preview?.quotedAuthorDisplayName === 'string' && preview.quotedAuthorDisplayName.trim().length > 0
          ? { authorDisplayName: preview.quotedAuthorDisplayName.trim() }
          : {}),
        ...(typeof preview?.quotedText === 'string' && preview.quotedText.trim().length > 0
          ? { text: preview.quotedText.trim() }
          : {}),
        ...(preview?.quotedExternal?.uri
          ? {
              ...(sanitizePreviewUrl(preview.quotedExternal.uri)
                ? {
                    external: {
                      url: sanitizePreviewUrl(preview.quotedExternal.uri)!,
                      ...(preview.quotedExternal.title ? { title: preview.quotedExternal.title } : {}),
                      ...(preview.quotedExternal.description ? { description: preview.quotedExternal.description } : {}),
                      ...(sanitizePreviewUrl(preview.quotedExternal.thumb)
                        ? { thumb: sanitizePreviewUrl(preview.quotedExternal.thumb)! }
                        : {}),
                      domain: extractDomain(sanitizePreviewUrl(preview.quotedExternal.uri)!),
                    },
                  }
                : {}),
            }
          : {}),
      }
    : undefined;

  return {
    ...(media.length > 0 ? { media } : {}),
    ...(videoEmbed ? { embed: videoEmbed } : externalEmbed ? { embed: externalEmbed } : {}),
    ...(quoteUri ? { quoteUri } : {}),
    ...(quotePreview ? { quotePreview } : {}),
  };
}

function buildLocalQuotedPost(createdAt: string, quotePreview: LocalQuotePreview): Omit<MockPost, 'replyTo' | 'threadRoot'> {
  const authorDid = quotePreview.authorDid || parseAtUri(quotePreview.uri)?.repo || 'did:plc:quoted';
  const authorHandle = quotePreview.authorHandle || defaultHandleForDid(authorDid);
  return {
    id: quotePreview.uri,
    author: {
      did: authorDid,
      handle: authorHandle,
      displayName: quotePreview.authorDisplayName || authorHandle,
    },
    content: quotePreview.text || 'Quoted post preview unavailable offline.',
    createdAt,
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
    bookmarkCount: 0,
    chips: [],
    ...(quotePreview.external
      ? {
          embed: {
            type: 'external' as const,
            url: quotePreview.external.url,
            title: quotePreview.external.title || quotePreview.external.url,
            description: quotePreview.external.description || '',
            ...(quotePreview.external.thumb ? { thumb: quotePreview.external.thumb } : {}),
            domain: quotePreview.external.domain,
          },
        }
      : {}),
  };
}

function measurePostRichness(post: MockPost): number {
  let richness = 0;
  if (post.media?.length) richness += 3;
  if (post.embed) richness += 3;
  if (post.author.avatar) richness += 1;
  if (post.content.trim().length > 0) richness += 1;
  if (post.cid) richness += 1;
  return richness;
}

function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function buildRankedExplorePostCandidates(
  remotePosts: MockPost[],
  tagPosts: MockPost[],
  localHybridPosts: MockPost[],
  localHybridRows: unknown,
): RankedExplorePostCandidate[] {
  const localRows = Array.isArray(localHybridRows) ? localHybridRows : [];
  const candidates: RankedExplorePostCandidate[] = [];

  const pushRanked = (
    posts: MockPost[],
    source: RankedExplorePostSource,
    sourceWeight: number,
    supplementalScore?: (index: number) => number,
  ) => {
    posts.forEach((post, index) => {
      const rankScore = sourceWeight / (index + 1);
      candidates.push({
        post,
        source,
        sourceIndex: index,
        score: rankScore + (supplementalScore ? supplementalScore(index) : 0),
        richness: measurePostRichness(post),
      });
    });
  };

  // Keep remote search as the anchor ordering, while still allowing strong local
  // evidence to outrank weaker lower-ranked remote results.
  pushRanked(remotePosts, 'remote', 1.45);
  pushRanked(tagPosts, 'tag', 0.72);
  pushRanked(localHybridPosts, 'local', 0.62, (index) => {
    const row = localRows[index];
    const fused = clampUnitInterval(Number(row?.fused_score ?? 0));
    const confidence = clampUnitInterval(Number(row?.confidence_score ?? 0));
    return fused * 0.1 + confidence * 0.08;
  });

  return candidates;
}

function mergeRankedExplorePosts(candidates: RankedExplorePostCandidate[]): MockPost[] {
  const bestById = new Map<string, RankedExplorePostCandidate>();

  for (const candidate of candidates) {
    const key = candidate.post.id.trim().toLowerCase();
    if (!key) continue;
    const existing = bestById.get(key);
    if (!existing) {
      bestById.set(key, candidate);
      continue;
    }

    if (candidate.score > existing.score + 0.001) {
      bestById.set(key, candidate);
      continue;
    }
    if (Math.abs(candidate.score - existing.score) <= 0.001 && candidate.richness > existing.richness) {
      bestById.set(key, candidate);
    }
  }

  return Array.from(bestById.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.richness !== a.richness) return b.richness - a.richness;
      if (SOURCE_PRIORITY[a.source] !== SOURCE_PRIORITY[b.source]) {
        return SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
      }
      return a.sourceIndex - b.sourceIndex;
    })
    .map((candidate) => candidate.post);
}

export function mapFeedRowToExploreFeedResult(row: any): ExploreFeedResult {
  const score = Number.isFinite(Number(row?.fused_score))
    ? Number(row.fused_score)
    : Number.isFinite(Number(row?.rrf_score))
      ? Number(row.rrf_score)
      : undefined;

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
    ...(typeof score === 'number' ? { score } : {}),
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
  const handle = defaultHandleForDid(authorDid);
  const postId = resolveLocalHybridPostId(row);
  const parsedEmbed = parseEmbedJson(row?.embed);
  const mappedEmbed = mapLocalEmbed(authorDid, parsedEmbed);
  const uri = getLocalHybridPostUri(row);
  const cid = typeof row?.cid === 'string'
    ? row.cid
    : uri && String(row?.id || '') !== uri
      ? String(row.id)
      : undefined;
  const parsedQuotedUri = mappedEmbed.quoteUri ? parseAtUri(mappedEmbed.quoteUri) : null;
  const fallbackQuotedDid = parsedQuotedUri?.repo && parsedQuotedUri.repo.startsWith('did:')
    ? parsedQuotedUri.repo
    : undefined;
  const quotedPost = mappedEmbed.quotePreview
    ? buildLocalQuotedPost(createdAt, mappedEmbed.quotePreview)
    : fallbackQuotedDid
      ? {
          id: mappedEmbed.quoteUri ?? `quoted:${fallbackQuotedDid}`,
          author: {
            did: fallbackQuotedDid,
            handle: defaultHandleForDid(fallbackQuotedDid),
            displayName: 'Quoted post',
          },
          content: 'Quoted post preview unavailable offline.',
          createdAt,
          likeCount: 0,
          replyCount: 0,
          repostCount: 0,
          bookmarkCount: 0,
          chips: [],
        }
      : null;
  const quotedPostWithMedia = quotedPost && mappedEmbed.embed?.type === 'video'
    ? {
        ...quotedPost,
        ...(quotedPost.embed ? {} : { embed: mappedEmbed.embed }),
      }
    : quotedPost;

  return {
    id: postId,
    ...(cid ? { cid: String(cid) } : {}),
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
    ...(mappedEmbed.media ? { media: mappedEmbed.media } : {}),
    ...(mappedEmbed.media ? { images: mappedEmbed.media.map((entry) => entry.url) } : {}),
    ...(quotedPost
      ? {
        embed: {
          type: 'quote' as const,
          post: quotedPostWithMedia ?? quotedPost,
          ...(mappedEmbed.embed?.type === 'external'
            ? {
                externalLink: {
                  url: mappedEmbed.embed.url,
                  title: mappedEmbed.embed.title,
                  description: mappedEmbed.embed.description,
                  ...(mappedEmbed.embed.thumb ? { thumb: mappedEmbed.embed.thumb } : {}),
                  domain: mappedEmbed.embed.domain,
                },
              }
            : {}),
        },
      }
      : mappedEmbed.embed
        ? { embed: mappedEmbed.embed }
      : {}),
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

  const mappedPosts = dedupeExploreSearchPosts(
    mergeRankedExplorePosts(
      buildRankedExplorePostCandidates(
        mappedRemotePosts,
        mappedTagPosts,
        mappedLocalHybridPosts,
        input.localHybridPostRows,
      ),
    ),
  );

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
