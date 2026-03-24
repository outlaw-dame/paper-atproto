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
import { type PostView } from '@atproto/api/dist/client/types/app/bsky/feed/defs';
import type { MockPost, ChipType } from '../data/mockData';

/**
 * A simplified, recursive function to map a `PostView` to a `MockPost`.
 * This is used for the main post, quoted posts, and reply/root context posts.
 * @param post The `PostView` object from the ATProto API.
 * @returns A `MockPost` object.
 */
export function mapPostViewToMockPost(post: PostView): MockPost {
  const record = post.record as any; // Cast to access text, etc.
  const embed = post.embed;

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
      type: 'external' as const,
      url: embed.external.uri,
      title: embed.external.title,
      description: embed.external.description,
      thumb: embed.external.thumb,
      domain: new URL(embed.external.uri).hostname,
    };
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
    embed: embedData,
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
    if (AppBskyFeedDefs.isPostView(item.reply.root) && item.reply.parent?.uri !== item.reply.root.uri) {
      mockPost.threadRoot = mapPostViewToMockPost(item.reply.root);
    }
  }

  return mockPost;
}