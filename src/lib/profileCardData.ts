import type { MockPost } from '../data/mockData';
import type { ProfileCardData } from '../types/profileCard';

function inferMediaType(
  post: Pick<MockPost, 'media' | 'embed'>,
): 'image' | 'video' | 'external' | undefined {
  if (post.embed?.type === 'video') return 'video';
  if (post.embed?.type === 'external') return 'external';
  if ((post.media?.length ?? 0) > 0) return 'image';
  return undefined;
}

export function buildStandardProfileCardData(post: MockPost): ProfileCardData | null {
  const did = (post.author.did ?? '').trim();
  const handle = (post.author.handle ?? '').trim();
  if (!did || !handle) return null;

  const recentText = post.content.trim();
  const mediaType = inferMediaType(post);

  return {
    variant: 'standard',
    identity: {
      did,
      handle,
      ...(post.author.displayName ? { displayName: post.author.displayName } : {}),
      ...(post.author.avatar ? { avatar: post.author.avatar } : {}),
    },
    social: {
      followersCount: 0,
      mutualsCount: 0,
      followingCount: 0,
      isFollowing: false,
      canFollow: false,
      canBlock: false,
      isPartial: true,
    },
    starterPacks: [],
    activity: {
      recentPosts: recentText
        ? [{
            uri: post.id,
            text: recentText,
            createdAt: post.createdAt,
            likeCount: post.likeCount,
            replyCount: post.replyCount,
            hasMedia: Boolean(mediaType),
            ...(mediaType ? { mediaType } : {}),
          }]
        : [],
      popularPosts: [],
    },
  };
}
