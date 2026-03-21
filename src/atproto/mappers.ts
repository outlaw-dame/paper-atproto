import type {
  AppBskyFeedDefs,
  AppBskyFeedPost,
  AppBskyEmbedImages,
  AppBskyEmbedExternal,
  AppBskyEmbedRecord,
  AppBskyActorDefs,
  AppBskyNotificationListNotifications,
} from '@atproto/api';
import type { MockPost, ChipType } from '../data/mockData';

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function deriveChips(view: AppBskyFeedDefs.FeedViewPost): ChipType[] {
  const chips: ChipType[] = [];
  const record = view.post.record as AppBskyFeedPost.Record;

  if (view.reply) chips.push('thread');
  if (record.embed) {
    const $type = (record.embed as any).$type as string;
    if ($type?.includes('external')) chips.push('related');
  }
  if ((view.post.replyCount ?? 0) > 3) chips.push('story');
  if (chips.length === 0) chips.push('topic');
  return chips;
}

// ─── Feed view → MockPost ──────────────────────────────────────────────────

export function mapFeedViewPost(item: AppBskyFeedDefs.FeedViewPost): MockPost {
  const post = item.post;
  const record = post.record as AppBskyFeedPost.Record;
  const author = post.author as AppBskyActorDefs.ProfileViewBasic;

  // Media images
  let media: MockPost['media'];
  let embed: MockPost['embed'];

  const embedView = post.embed;
  if (embedView) {
    const t = (embedView as any).$type as string;

    if (t === 'app.bsky.embed.images#view') {
      const imgs = (embedView as AppBskyEmbedImages.View).images;
      media = imgs.map(img => ({
        type: 'image' as const,
        url: img.fullsize,
        alt: img.alt,
        aspectRatio: img.aspectRatio ? img.aspectRatio.width / img.aspectRatio.height : 1.5,
      }));
    } else if (t === 'app.bsky.embed.external#view') {
      const ext = (embedView as AppBskyEmbedExternal.View).external;
      embed = {
        type: 'external',
        url: ext.uri,
        title: ext.title,
        description: ext.description,
        ...(ext.thumb ? { thumb: ext.thumb } : {}),
        domain: extractDomain(ext.uri),
      };
    } else if (
      t === 'app.bsky.embed.record#view' ||
      t === 'app.bsky.embed.recordWithMedia#view'
    ) {
      const rec = (embedView as AppBskyEmbedRecord.View).record as any;
      if (rec && rec.$type === 'app.bsky.embed.record#viewRecord') {
        const qAuthor = rec.author as AppBskyActorDefs.ProfileViewBasic;
        const qPostRecord = rec.value as AppBskyFeedPost.Record;
        const qAuthorObj: MockPost['author'] = {
          did: qAuthor.did,
          handle: qAuthor.handle,
          displayName: qAuthor.displayName ?? qAuthor.handle,
          ...(qAuthor.avatar ? { avatar: qAuthor.avatar } : {}),
        };
        embed = {
          type: 'quote',
          post: {
            id: rec.uri,
            author: qAuthorObj,
            content: qPostRecord?.text ?? '',
            createdAt: qPostRecord?.createdAt ?? new Date().toISOString(),
            likeCount: rec.likeCount ?? 0,
            replyCount: rec.replyCount ?? 0,
            repostCount: rec.repostCount ?? 0,
            chips: ['topic'],
          },
        };
      }
    }
  }

  const authorObj: MockPost['author'] = {
    did: author.did,
    handle: author.handle,
    displayName: author.displayName ?? author.handle,
    ...(author.avatar ? { avatar: author.avatar } : {}),
  };

  // Reply context — who is this post replying to?
  let replyTo: MockPost['replyTo'];
  if (item.reply) {
    const parentPost = (item.reply.parent as any)?.post ?? item.reply.parent;
    const parentAuthor = parentPost?.author as AppBskyActorDefs.ProfileViewBasic | undefined;
    if (parentAuthor) {
      replyTo = {
        handle: parentAuthor.handle,
        displayName: parentAuthor.displayName ?? parentAuthor.handle,
      };
    }
  }

  return {
    id: post.uri,
    author: authorObj,
    content: record.text,
    createdAt: record.createdAt,
    likeCount: post.likeCount ?? 0,
    replyCount: post.replyCount ?? 0,
    repostCount: post.repostCount ?? 0,
    ...(media ? { media } : {}),
    ...(embed ? { embed } : {}),
    chips: deriveChips(item),
    threadCount: post.replyCount ?? 0,
    ...(replyTo ? { replyTo } : {}),
  };
}

// ─── Notification mapper ───────────────────────────────────────────────────

export interface LiveNotification {
  id: string;
  type: 'like' | 'repost' | 'reply' | 'follow' | 'mention' | 'quote';
  actor: string;
  displayName: string;
  content: string;
  time: string;
  read: boolean;
  avatar?: string | undefined;
}

export function mapNotification(
  n: AppBskyNotificationListNotifications.Notification
): LiveNotification {
  const author = n.author as unknown as AppBskyActorDefs.ProfileViewBasic;
  const record = n.record as any;
  let content = '';

  switch (n.reason) {
    case 'like':    content = 'liked your post'; break;
    case 'repost':  content = 'reposted your post'; break;
    case 'follow':  content = 'followed you'; break;
    case 'reply':   content = record?.text ? `replied: "${record.text.slice(0, 80)}"` : 'replied to your post'; break;
    case 'mention': content = record?.text ? `mentioned you: "${record.text.slice(0, 80)}"` : 'mentioned you'; break;
    case 'quote':   content = record?.text ? `quoted you: "${record.text.slice(0, 80)}"` : 'quoted your post'; break;
    default:        content = n.reason;
  }

  const result: LiveNotification = {
    id: n.uri,
    type: n.reason as LiveNotification['type'],
    actor: author.handle,
    displayName: author.displayName ?? author.handle,
    content,
    time: n.indexedAt,
    read: n.isRead,
  };
  if (author.avatar) result.avatar = author.avatar;
  return result;
}

// ─── Profile → MockPost author ─────────────────────────────────────────────

export function mapProfile(p: AppBskyActorDefs.ProfileViewDetailed): MockPost['author'] {
  const obj: MockPost['author'] = {
    did: p.did,
    handle: p.handle,
    displayName: p.displayName ?? p.handle,
  };
  if (p.avatar) obj.avatar = p.avatar;
  return obj;
}
