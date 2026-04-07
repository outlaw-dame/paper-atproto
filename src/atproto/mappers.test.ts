import { describe, expect, it } from 'vitest';
import { mapFeedViewPost, mapPostViewToMockPost } from './mappers';

describe('mapPostViewToMockPost', () => {
  it('preserves recordWithMedia video previews inside quote cards', () => {
    const mapped = mapPostViewToMockPost({
      $type: 'app.bsky.feed.defs#postView',
      uri: 'at://did:plc:author/app.bsky.feed.post/root',
      cid: 'cid-root',
      author: {
        did: 'did:plc:author',
        handle: 'author.bsky.social',
        displayName: 'Author',
      },
      record: {
        text: 'Top-level post',
        createdAt: '2026-04-01T12:00:00.000Z',
        embed: {
          $type: 'app.bsky.embed.recordWithMedia',
          record: { uri: 'at://did:plc:quoted/app.bsky.feed.post/quoted' },
          media: {
            $type: 'app.bsky.embed.video',
            video: { ref: { $link: 'bafkreivideocid' } },
          },
        },
      },
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        record: {
          $type: 'app.bsky.embed.record#view',
          record: {
            $type: 'app.bsky.feed.defs#postView',
            uri: 'at://did:plc:quoted/app.bsky.feed.post/quoted',
            cid: 'cid-quoted',
            author: {
              did: 'did:plc:quoted',
              handle: 'quoted.bsky.social',
              displayName: 'Quoted Person',
            },
            record: {
              text: 'Quoted preview text',
              createdAt: '2026-04-01T11:00:00.000Z',
            },
            likeCount: 0,
            replyCount: 0,
            repostCount: 0,
          },
        },
        media: {
          $type: 'app.bsky.embed.video#view',
          playlist: 'https://video.bsky.app/watch/playlist.m3u8',
          thumbnail: 'https://video.bsky.app/thumb.jpg',
          alt: 'Launch clip',
          aspectRatio: { width: 9, height: 16 },
        },
      },
      likeCount: 0,
      replyCount: 0,
      repostCount: 0,
    } as any);

    expect(mapped.embed?.type).toBe('quote');
    if (mapped.embed?.type === 'quote') {
      expect(mapped.embed.post.embed?.type).toBe('video');
      if (mapped.embed.post.embed?.type === 'video') {
        expect(mapped.embed.post.embed.url).toBe('https://video.bsky.app/watch/playlist.m3u8');
        expect(mapped.embed.post.embed.thumb).toBe('https://video.bsky.app/thumb.jpg');
        expect(mapped.embed.post.embed.aspectRatio).toBe(9 / 16);
      }
    }
  });

  it('does not attach reply context when parent/root records are non-renderable', () => {
    const mapped = mapFeedViewPost({
      $type: 'app.bsky.feed.defs#feedViewPost',
      post: {
        $type: 'app.bsky.feed.defs#postView',
        uri: 'at://did:plc:author/app.bsky.feed.post/current',
        cid: 'cid-current',
        author: {
          did: 'did:plc:author',
          handle: 'author.bsky.social',
          displayName: 'Author',
        },
        record: {
          text: 'Current post text',
          createdAt: '2026-04-01T12:00:00.000Z',
        },
        likeCount: 0,
        replyCount: 0,
        repostCount: 0,
      },
      reply: {
        root: {
          $type: 'app.bsky.feed.defs#postView',
          uri: 'at://did:plc:root/app.bsky.feed.post/root',
          cid: 'cid-root',
          author: {
            did: 'did:plc:root',
            handle: 'root.bsky.social',
            displayName: 'Root',
          },
          record: {
            createdAt: '2026-04-01T10:00:00.000Z',
          },
          likeCount: 0,
          replyCount: 0,
          repostCount: 0,
        },
        parent: {
          $type: 'app.bsky.feed.defs#postView',
          uri: 'at://did:plc:parent/app.bsky.feed.post/parent',
          cid: 'cid-parent',
          author: {
            did: 'did:plc:parent',
            handle: 'parent.bsky.social',
            displayName: 'Parent',
          },
          record: {
            createdAt: '2026-04-01T11:00:00.000Z',
          },
          likeCount: 0,
          replyCount: 0,
          repostCount: 0,
        },
      },
    } as any);

    expect(mapped.replyTo).toBeUndefined();
    expect(mapped.threadRoot).toBeUndefined();
  });
});
