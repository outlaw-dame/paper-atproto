import {
  AppBskyFeedDefs,
  AppBskyFeedPost,
  AppBskyEmbedImages,
  AppBskyEmbedExternal,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  AppBskyActorDefs,
  AppBskyNotificationListNotifications,
} from '@atproto/api';
import { type PostView } from '@atproto/api/dist/client/types/app/bsky/feed/defs';
import type { MockPost, ChipType } from '../data/mockData.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function deriveChips(view: AppBskyFeedDefs.FeedViewPost | PostView, isReplyContext: boolean = false): ChipType[] {
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

// ─── Post View Mapper ──────────────────────────────────────────────────────

export function mapPostViewToMockPost(post: PostView): MockPost {
  const record = post.record as any; // Cast to access text, etc.
  const embed: any = post.embed;

  let media;
  if (AppBskyEmbedImages.isView(embed)) {
    media = embed.images.map(img => ({
      type: 'image' as const,
      url: img.fullsize,
      alt: img.alt,
      aspectRatio: img.aspectRatio ? img.aspectRatio.width / img.aspectRatio.height : undefined,
    }));
  } else if (AppBskyEmbedRecordWithMedia.isView(embed) && AppBskyEmbedImages.isView(embed.media)) {
    media = embed.media.images.map(img => ({
      type: 'image' as const,
      url: img.fullsize,
      alt: img.alt,
      aspectRatio: img.aspectRatio ? img.aspectRatio.width / img.aspectRatio.height : undefined,
    }));
  }

  let embedData;
  if (AppBskyEmbedExternal.isView(embed)) {
    embedData = {
      type: isVideoUrl(embed.external.uri) ? 'video' as const : 'external' as const,
      url: embed.external.uri,
      title: embed.external.title,
      description: embed.external.description,
      thumb: embed.external.thumb,
      domain: extractDomain(embed.external.uri),
    };

    // Add extra fields for external links if not a video (or shared fields)
    if (embedData.type === 'external') {
      Object.assign(embedData, {
        authorName: (embed.external as any).author || (embed.external as any).authorName,
        authorUrl: (embed.external as any).authorUrl,
        publisher: (embed.external as any).siteName || (embed.external as any).publisher,
      });
    } else {
      // Video-specific adjustments can go here if needed
      // e.g. forcing youtube.com domain display
    }

  } else if (AppBskyEmbedRecord.isView(embed) && AppBskyFeedDefs.isPostView(embed.record)) {
    embedData = {
      type: 'quote' as const,
      post: mapPostViewToMockPost(embed.record as PostView),
    };
  } else if (AppBskyEmbedRecordWithMedia.isView(embed) && AppBskyEmbedRecord.isView(embed.record) && AppBskyFeedDefs.isPostView(embed.record.record)) {
      embedData = {
          type: 'quote' as const,
          post: mapPostViewToMockPost(embed.record.record as PostView),
      };
  }

  return {
    id: post.uri,
    cid: post.cid,
    author: {
      did: post.author.did,
      handle: post.author.handle,
      displayName: post.author.displayName || post.author.handle,
      avatar: post.author.avatar,
      verified: !!post.author.viewer?.followedBy,
    },
    content: record.text,
    createdAt: record.createdAt,
    likeCount: post.likeCount || 0,
    replyCount: post.replyCount || 0,
    repostCount: post.repostCount || 0,
    chips: [] as ChipType[], // Chips are determined by higher-level logic
    media,
    viewer: {
      like: post.viewer?.like,
      repost: post.viewer?.repost,
    },
    embed: embedData,
  };
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
    subjectUri: (n.reasonSubject as string | undefined),
  };
}