import {
  AppBskyFeedDefs,
  AppBskyFeedPost,
  AppBskyEmbedImages,
  AppBskyEmbedExternal,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  AppBskyEmbedVideo,
  AppBskyActorDefs,
  AppBskyNotificationListNotifications,
} from '@atproto/api';
import type { MockPost, ChipType } from '../data/mockData';
import { resolveFacets } from '../lib/resolver/atproto';
import { detectSensitiveMedia, mapRawLabelValues } from '../lib/moderation/sensitiveMedia';
import {
  asTrimmedString,
  contentUnionToText,
  extractRecordDisplayText,
  hasDisplayableRecordContent,
} from '../lib/atproto/recordContent';

export { hasDisplayableRecordContent } from '../lib/atproto/recordContent';

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function deriveChips(
  view: AppBskyFeedDefs.FeedViewPost | AppBskyFeedDefs.PostView,
  isReplyContext: boolean = false
): ChipType[] {
  const chips: ChipType[] = [];
  
  // Handle FeedViewPost (has .post, .reply) vs PostView (just the post)
  const post = (view as AppBskyFeedDefs.FeedViewPost).post ?? view;
  const replyContext = (view as AppBskyFeedDefs.FeedViewPost).reply;
  const record = post.record as AppBskyFeedPost.Record;

  if (replyContext || isReplyContext) chips.push('thread');
  
  if (record.embed) {
    const $type = (record.embed as any).$type as string;
    if ($type?.includes('external')) chips.push('related');
  }
  
  if ((post.replyCount ?? 0) > 3) chips.push('story');
  if (chips.length === 0) chips.push('topic');
  return chips;
}

function isVideoUrl(url: string): boolean {
  const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv)\/.+$/;
  return pattern.test(url);
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

function summarizeText(text: string, maxChars = 320): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 1).trimEnd()}…`;
}

function mapImageViewToMedia(embed: AppBskyEmbedImages.View): NonNullable<MockPost['media']> {
  return embed.images.map((img: any) => ({
    type: 'image' as const,
    url: img.fullsize,
    alt: img.alt,
    ...(img.aspectRatio ? { aspectRatio: img.aspectRatio.width / img.aspectRatio.height } : {}),
  }));
}

function mapVideoViewToEmbed(embed: AppBskyEmbedVideo.View): Extract<NonNullable<MockPost['embed']>, { type: 'video' }> {
  const aspectRatio = embed.aspectRatio ? embed.aspectRatio.width / embed.aspectRatio.height : undefined;
  const domain = extractDomain(embed.playlist);
  return {
    type: 'video',
    url: embed.playlist,
    ...(embed.thumbnail ? { thumb: embed.thumbnail } : {}),
    ...(embed.alt ? { description: embed.alt } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    domain: domain === 'video.bsky.app' ? 'bsky.app' : domain,
  };
}

function buildExternalEmbedData(embed: AppBskyEmbedExternal.View): Extract<NonNullable<MockPost['embed']>, { type: 'external' }> {
  return {
    type: 'external',
    url: embed.external.uri,
    title: embed.external.title,
    description: embed.external.description,
    domain: extractDomain(embed.external.uri),
    ...(embed.external.thumb ? { thumb: embed.external.thumb } : {}),
    ...(((embed.external as any).author || (embed.external as any).authorName)
      ? { authorName: (embed.external as any).author || (embed.external as any).authorName }
      : {}),
    ...((embed.external as any).authorUrl ? { authorUrl: (embed.external as any).authorUrl } : {}),
    ...(((embed.external as any).siteName || (embed.external as any).publisher)
      ? { publisher: (embed.external as any).siteName || (embed.external as any).publisher }
      : {}),
  };
}

function mapQuotedRecordToMockPost(record: AppBskyEmbedRecord.ViewRecord): Omit<MockPost, 'replyTo' | 'threadRoot'> {
  let media: MockPost['media'];
  let embed: MockPost['embed'];

  for (const quotedEmbed of record.embeds ?? []) {
    if (!media && AppBskyEmbedImages.isView(quotedEmbed)) {
      media = mapImageViewToMedia(quotedEmbed);
      continue;
    }

    if (!media && AppBskyEmbedRecordWithMedia.isView(quotedEmbed) && AppBskyEmbedImages.isView((quotedEmbed as any).media)) {
      media = mapImageViewToMedia((quotedEmbed as any).media);
    }

    if (!embed && AppBskyEmbedExternal.isView(quotedEmbed)) {
      embed = buildExternalEmbedData(quotedEmbed);
      continue;
    }

    if (!embed && AppBskyEmbedVideo.isView(quotedEmbed)) {
      embed = mapVideoViewToEmbed(quotedEmbed);
      continue;
    }

    if (!embed && AppBskyEmbedRecord.isView(quotedEmbed) && AppBskyEmbedRecord.isViewRecord((quotedEmbed as any).record)) {
      embed = {
        type: 'quote',
        post: mapQuotedRecordToMockPost((quotedEmbed as any).record as AppBskyEmbedRecord.ViewRecord),
      };
      continue;
    }

    if (
      !embed &&
      AppBskyEmbedRecordWithMedia.isView(quotedEmbed) &&
      AppBskyEmbedRecord.isViewRecord((quotedEmbed as any).record.record)
    ) {
      const quotedPost = mapQuotedRecordToMockPost((quotedEmbed as any).record.record as AppBskyEmbedRecord.ViewRecord);
      let externalLink: { url: string; title?: string; description?: string; thumb?: string; domain: string } | undefined;
      if (AppBskyEmbedExternal.isView((quotedEmbed as any).media)) {
        const ext = (quotedEmbed as any).media.external;
        externalLink = {
          url: ext.uri,
          title: ext.title,
          description: ext.description,
          thumb: ext.thumb,
          domain: extractDomain(ext.uri),
        };
      }
      embed = {
        type: 'quote',
        post: quotedPost,
        ...(externalLink ? { externalLink } : {}),
      };
    }
  }

  const quotedLabelValues = mapRawLabelValues((record as any).labels);

  const mapped: Omit<MockPost, 'replyTo' | 'threadRoot'> = {
    id: record.uri,
    cid: record.cid,
    author: {
      did: record.author.did,
      handle: record.author.handle,
      displayName: record.author.displayName || record.author.handle,
      ...(record.author.avatar ? { avatar: record.author.avatar } : {}),
      verified: !!(record.author as any).viewer?.followedBy,
    },
    content: extractRecordDisplayText(record.value),
    createdAt: record.indexedAt,
    likeCount: record.likeCount || 0,
    replyCount: record.replyCount || 0,
    repostCount: record.repostCount || 0,
    bookmarkCount: 0,
    chips: [],
    ...(quotedLabelValues.length > 0 ? { contentLabels: quotedLabelValues } : {}),
    ...(media ? { media } : {}),
    ...(embed ? { embed } : {}),
  };

  const sensitiveResult = detectSensitiveMedia(mapped as MockPost);
  if (sensitiveResult.isSensitive) {
    mapped.sensitiveMedia = { isSensitive: true, reasons: sensitiveResult.reasons };
  }

  return mapped;
}

// ─── Post View Mapper ──────────────────────────────────────────────────────

export function mapPostViewToMockPost(post: AppBskyFeedDefs.PostView): MockPost {
  const record = post.record as any; // Cast to access text, etc.
  const embed = post.embed as any;
  const postLabelValues = mapRawLabelValues((post as any).labels);
  const recordLabelValues = mapRawLabelValues(record?.labels?.values);
  const contentLabels = [...new Set([...postLabelValues, ...recordLabelValues])].slice(0, 20);
  const $type = record?.$type;

  let content = record.text || '';
  let article: MockPost['article'] | undefined;

  // Detect long-form records from common ATProto article/blog lexicons.
  if ($type === 'app.bsky.feed.article') {
    const body = asTrimmedString(record.body) || asTrimmedString(record.textContent) || contentUnionToText(record.content);
    const title = asTrimmedString(record.title);
    const description = asTrimmedString(record.description);
    const banner = buildBlobCdnUrl(post.author.did, record.thumbnail);
    article = {
      ...(title ? { title } : {}),
      body,
      ...(banner ? { banner } : {}),
    };
    if (!content) content = description || summarizeText(body);
  } else if ($type === 'site.standard.document') {
    const body = asTrimmedString(record.textContent) || contentUnionToText(record.content);
    const title = asTrimmedString(record.title);
    const description = asTrimmedString(record.description);
    const banner = buildBlobCdnUrl(post.author.did, record.coverImage);
    article = {
      ...(title ? { title } : {}),
      body,
      ...(banner ? { banner } : {}),
    };
    if (!content) content = description || summarizeText(body);
  } else if ($type === 'com.whtwnd.blog.entry') {
    const body = asTrimmedString(record.content);
    const title = asTrimmedString(record.title);
    const subtitle = asTrimmedString(record.subtitle);
    const ogpImage = typeof record.ogp?.image === 'string' ? record.ogp.image : undefined;
    article = {
      ...(title ? { title } : {}),
      body,
      ...(ogpImage ? { banner: ogpImage } : {}),
    };
    if (!content) content = subtitle || summarizeText(body);
  } else if ($type === 'sh.standard.post' || $type === 'sh.standard.article') {
    const body = asTrimmedString(record.content) || asTrimmedString(record.body) || asTrimmedString(record.textContent);
    const title = asTrimmedString(record.title);
    const description = asTrimmedString(record.description);
    const banner = buildBlobCdnUrl(post.author.did, record.image);
    article = {
      ...(title ? { title } : {}),
      body,
      ...(banner ? { banner } : {}),
    };
    if (!content) content = description || summarizeText(body);
  }

  let media: MockPost['media'];
  if (AppBskyEmbedImages.isView(embed)) {
    media = mapImageViewToMedia(embed);
  } else if (AppBskyEmbedRecordWithMedia.isView(embed) && AppBskyEmbedImages.isView((embed as any).media)) {
    media = mapImageViewToMedia((embed as any).media);
  }

  let embedData: MockPost['embed'];
  if (AppBskyEmbedExternal.isView(embed)) {
    if (isVideoUrl(embed.external.uri)) {
      embedData = {
        type: 'video',
        url: embed.external.uri,
        title: embed.external.title,
        description: embed.external.description,
        thumb: embed.external.thumb,
        domain: extractDomain(embed.external.uri),
      };
    } else {
      embedData = buildExternalEmbedData(embed);
    }
  } else if (AppBskyEmbedVideo.isView(embed)) {
    embedData = mapVideoViewToEmbed(embed);
  } else if (AppBskyEmbedRecord.isView(embed) && AppBskyFeedDefs.isPostView((embed as any).record)) {
    embedData = {
      type: 'quote' as const,
      post: mapPostViewToMockPost((embed as any).record as AppBskyFeedDefs.PostView),
    };
  } else if (AppBskyEmbedRecord.isView(embed) && AppBskyEmbedRecord.isViewRecord((embed as any).record)) {
    embedData = {
      type: 'quote' as const,
      post: mapQuotedRecordToMockPost((embed as any).record as AppBskyEmbedRecord.ViewRecord),
    };
  } else if (
    AppBskyEmbedRecordWithMedia.isView(embed) &&
    AppBskyEmbedRecord.isView((embed as any).record) &&
    AppBskyFeedDefs.isPostView((embed as any).record.record)
  ) {
    const quotedPost = mapPostViewToMockPost((embed as any).record.record as AppBskyFeedDefs.PostView);
    let externalLink: { url: string; title?: string; description?: string; thumb?: string; domain: string } | undefined;
    if (AppBskyEmbedExternal.isView((embed as any).media)) {
      const ext = (embed as any).media.external;
      externalLink = { url: ext.uri, title: ext.title, description: ext.description, thumb: ext.thumb, domain: extractDomain(ext.uri) };
    }
    embedData = { type: 'quote' as const, post: quotedPost, ...(externalLink ? { externalLink } : {}) };
  } else if (
    AppBskyEmbedRecordWithMedia.isView(embed) &&
    AppBskyEmbedRecord.isView((embed as any).record) &&
    AppBskyEmbedRecord.isViewRecord((embed as any).record.record)
  ) {
    const quotedPost = mapQuotedRecordToMockPost((embed as any).record.record as AppBskyEmbedRecord.ViewRecord);
    let externalLink: { url: string; title?: string; description?: string; thumb?: string; domain: string } | undefined;
    if (AppBskyEmbedExternal.isView((embed as any).media)) {
      const ext = (embed as any).media.external;
      externalLink = {
        url: ext.uri,
        title: ext.title,
        description: ext.description,
        thumb: ext.thumb,
        domain: extractDomain(ext.uri),
      };
    }
    embedData = { type: 'quote' as const, post: quotedPost, ...(externalLink ? { externalLink } : {}) };
  }

  const author: MockPost['author'] = {
    did: post.author.did,
    handle: post.author.handle,
    displayName: post.author.displayName || post.author.handle,
    ...(post.author.avatar ? { avatar: post.author.avatar } : {}),
    verified: !!post.author.viewer?.followedBy,
  };

  const viewer: MockPost['viewer'] = {
    ...(post.viewer?.like ? { like: post.viewer.like } : {}),
    ...(post.viewer?.repost ? { repost: post.viewer.repost } : {}),
  };

  const facets = resolveFacets(record.facets);

  const mapped: MockPost = {
    id: post.uri,
    cid: post.cid,
    author,
    content,
    createdAt: record.createdAt || record.publishedAt || (post as any).indexedAt || new Date().toISOString(),
    likeCount: post.likeCount || 0,
    replyCount: post.replyCount || 0,
    repostCount: post.repostCount || 0,
    bookmarkCount: 0,
    chips: [] as ChipType[],
    ...(facets.length > 0 ? { facets } : {}), // Chips are determined by higher-level logic
    ...(media ? { media } : {}),
    ...(article ? { article } : {}),
    viewer,
    ...(contentLabels.length > 0 ? { contentLabels } : {}),
    ...(embedData ? { embed: embedData } : {}),
  };

  const sensitiveMedia = detectSensitiveMedia(mapped);
  if (sensitiveMedia.isSensitive) {
    mapped.sensitiveMedia = {
      isSensitive: true,
      reasons: sensitiveMedia.reasons,
    };
  }

  return mapped;
}

// ─── Feed Item Mapper ──────────────────────────────────────────────────────

export function mapFeedViewPost(item: AppBskyFeedDefs.FeedViewPost): MockPost {
  const mockPost = mapPostViewToMockPost(item.post);
  
  // Set context-specific chips
  mockPost.chips = deriveChips(item);

  // Map Reply Context
  if (item.reply) {
    // Map Parent (Immediate Reply)
    const parent = item.reply.parent;
    if (AppBskyFeedDefs.isPostView(parent)) {
      mockPost.replyTo = mapPostViewToMockPost(parent);
      // Parent is technically part of a thread context
      mockPost.replyTo.chips = deriveChips(parent, true);
    }

    // Map Root (Thread Start)
    // We only attach threadRoot if it is DIFFERENT from the immediate parent
    // to avoid showing the same post twice in the UI stack.
    const root = item.reply.root;
    if (AppBskyFeedDefs.isPostView(root)) {
      // Only set root if it differs from parent to avoid visual duplication
      if (root.uri !== (parent as any)?.uri) {
        mockPost.threadRoot = mapPostViewToMockPost(root);
        mockPost.threadRoot.chips = deriveChips(root, true);
      }
    }
  }

  return mockPost;
}

// ─── Notification mapper ───────────────────────────────────────────────────

export interface LiveNotification {
  uri: string;
  cid: string;
  reason: string;
  isRead: boolean;
  indexedAt: string;
  author: {
    did: string;
    handle: string;
    displayName: string;
    avatar?: string;
  };
  subjectUri?: string;
}

export function mapNotification(n: AppBskyNotificationListNotifications.Notification): LiveNotification {
  const subjectUri = n.reasonSubject as string | undefined;
  return {
    uri: n.uri,
    cid: n.cid,
    reason: n.reason,
    isRead: n.isRead,
    indexedAt: n.indexedAt,
    author: {
      did: n.author.did,
      handle: n.author.handle,
      displayName: n.author.displayName ?? n.author.handle,
      ...(n.author.avatar && { avatar: n.author.avatar }),
    },
    ...(subjectUri ? { subjectUri } : {}),
  };
}
