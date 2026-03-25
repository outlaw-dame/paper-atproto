// ─── ATProto Data Mappers ───────────────────────────────────────────────────
// Converts raw ATProto API responses into the app's internal `MockPost` format.
// This provides a layer of abstraction, allowing the UI to be built against a
// stable data structure, even if the underlying ATProto API changes.

import {
  AppBskyFeedDefs,
  AppBskyEmbedImages,
  AppBskyEmbedExternal,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
} from '@atproto/api';
import type { MockPost, ChipType } from '../data/mockData.js';

/**
 * A simplified, recursive function to map a `PostView` to a `MockPost`.
 * This is used for the main post, quoted posts, and reply/root context posts.
 * @param post The `PostView` object from the ATProto API.
 * @returns A `MockPost` object.
 */
export function mapPostViewToMockPost(post: AppBskyFeedDefs.PostView): MockPost {
  const record = post.record as any; // Cast to access text, etc.
  const embed = post.embed as any;

  let media: MockPost['media'];
  if (AppBskyEmbedImages.isView(embed)) {
    media = embed.images.map((img: any) => ({
      type: 'image' as const,
      url: img.fullsize,
      alt: img.alt,
      aspectRatio: img.aspectRatio ? img.aspectRatio.width / img.aspectRatio.height : undefined,
    }));
  } else if (AppBskyEmbedRecordWithMedia.isView(embed) && AppBskyEmbedImages.isView((embed as any).media)) {
    media = (embed as any).media.images.map((img: any) => ({
      type: 'image' as const,
      url: img.fullsize,
      alt: img.alt,
      aspectRatio: img.aspectRatio ? img.aspectRatio.width / img.aspectRatio.height : undefined,
    }));
  }

  let embedData: MockPost['embed'];
  if (AppBskyEmbedExternal.isView(embed)) {
    embedData = {
      type: 'external' as const,
      url: embed.external.uri,
      title: embed.external.title,
      description: embed.external.description,
      thumb: embed.external.thumb,
      domain: new URL(embed.external.uri).hostname,
      authorName: (embed.external as any).author || (embed.external as any).authorName,
      authorUrl: (embed.external as any).authorUrl,
      publisher: (embed.external as any).siteName || (embed.external as any).publisher,
    };
  } else if (AppBskyEmbedRecord.isView(embed) && AppBskyFeedDefs.isPostView((embed as any).record)) {
    embedData = {
      type: 'quote' as const,
      post: mapPostViewToMockPost((embed as any).record as AppBskyFeedDefs.PostView),
    };
  } else if (
    AppBskyEmbedRecordWithMedia.isView(embed) &&
    AppBskyEmbedRecord.isView((embed as any).record) &&
    AppBskyFeedDefs.isPostView((embed as any).record.record)
  ) {
      embedData = {
          type: 'quote' as const,
          post: mapPostViewToMockPost((embed as any).record.record as AppBskyFeedDefs.PostView),
      };
  }

  return {
    id: post.uri,
    author: {
      did: post.author.did,
      handle: post.author.handle,
      displayName: post.author.displayName || post.author.handle,
      ...(post.author.avatar && { avatar: post.author.avatar }),
      verified: !!post.author.viewer?.followedBy,
    },
    content: record.text,
    createdAt: record.createdAt,
    likeCount: post.likeCount || 0,
    replyCount: post.replyCount || 0,
    repostCount: post.repostCount || 0,
    bookmarkCount: 0,
    chips: [] as ChipType[], // Chips are determined by higher-level logic
    ...(media ? { media } : {}),
    ...(embedData ? { embed: embedData } : {}),
  };
}

/**
 * Maps a `FeedViewPost` (which includes reply context) to a `MockPost`.
 * @param item The `FeedViewPost` from the ATProto API.
 * @returns A `MockPost` object with reply and thread context.
 */
export function mapFeedViewPost(item: AppBskyFeedDefs.FeedViewPost): MockPost {
  const mockPost = mapPostViewToMockPost(item.post);

  if (item.reply) {
    if (AppBskyFeedDefs.isPostView(item.reply.parent)) {
      mockPost.replyTo = mapPostViewToMockPost(item.reply.parent);
    }
    // Show thread root only if it's not the same as the direct parent
    if (AppBskyFeedDefs.isPostView(item.reply.root) && AppBskyFeedDefs.isPostView(item.reply.parent) && item.reply.parent.uri !== item.reply.root.uri) {
      mockPost.threadRoot = mapPostViewToMockPost(item.reply.root);
    }
  }

  return mockPost;
}