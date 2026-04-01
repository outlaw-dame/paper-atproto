import type { ResolvedFacet } from '../lib/resolver/atproto';

export interface MockPost {
  id: string;
  cid?: string;
  author: {
    did: string;
    handle: string;
    displayName: string;
    avatar?: string;
    verified?: boolean;
  };
  content: string;
  /** ATProto facets resolved from the post record — drives byte-accurate link/mention/hashtag rendering. */
  facets?: ResolvedFacet[];
  createdAt: string;
  timestamp?: string;
  likeCount: number;
  replyCount: number;
  repostCount: number;
  bookmarkCount: number;
  media?: { type: 'image'; url: string; alt?: string; aspectRatio?: number }[];
  images?: string[];
  embed?: {
    type: 'external';
    url: string;
    title: string;
    description: string;
    thumb?: string;
    domain: string;
    authorName?: string;
    authorUrl?: string;
    publisher?: string;
  } | {
    type: 'video';
    url: string;
    thumb?: string;
    title?: string;
    description?: string;
    domain: string;
    aspectRatio?: number;
    captions?: Array<{
      lang: string;
      url: string;
      label?: string;
    }>;
  } | {
    type: 'audio';
    url: string;
    title: string;
    description?: string; // "Artist\nAlbum" format
    thumb?: string;       // cover art URL
    mimeType?: string;    // e.g. "audio/mpeg"
    duration?: number;    // seconds
    domain: string;
  } | {
    type: 'quote';
    post: Omit<MockPost, 'replyTo' | 'threadRoot'>;
    externalLink?: { url: string; title?: string; description?: string; thumb?: string; domain: string };
  };
  chips: ChipType[];
  contentLabels?: string[];
  labelDetails?: Array<{
    val: string;
    src?: string;
    neg: boolean;
  }>;
  sensitiveMedia?: {
    isSensitive: boolean;
    reasons: string[];
  };
  threadCount?: number;
  replyTo?: MockPost;
  threadRoot?: MockPost;
  viewer?: {
    like?: string;
    repost?: string;
    bookmark?: string;
  };
  /** Optional conversation-session context used to seed composer guidance. */
  glympseComposerContext?: unknown;
  article?: {
    title?: string;
    body: string;
    banner?: string;
  };
}

export type ChipType = 'thread' | 'topic' | 'feed' | 'pack' | 'related' | 'story';

export const MOCK_POSTS: MockPost[] = [
  {
    id: 'post-1',
    author: {
      did: 'did:plc:alice123',
      handle: 'alice.bsky.social',
      displayName: 'Alice Chen',
      avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=alice&backgroundColor=b6e3f4',
    },
    content: 'The open social web is finally here. ATProto gives us something we\'ve never had before: portable identity, user-owned data, and algorithmic choice. This is what the internet was supposed to be.',
    createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    likeCount: 847,
    replyCount: 124,
    repostCount: 312,
    bookmarkCount: 45,
    chips: ['thread', 'topic', 'story'],
    threadCount: 12,
  },
  {
    id: 'post-2',
    author: {
      did: 'did:plc:bob456',
      handle: 'bob.bsky.social',
      displayName: 'Bob Nakamura',
      avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=bob&backgroundColor=c0aede',
    },
    content: 'Just shipped a new custom feed algorithm that surfaces posts based on semantic similarity rather than engagement. The difference in content quality is remarkable.',
    createdAt: new Date(Date.now() - 1000 * 60 * 23).toISOString(),
    likeCount: 2341,
    replyCount: 89,
    repostCount: 567,
    bookmarkCount: 123,
    media: [
      {
        type: 'image',
        url: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&q=80',
        alt: 'Code on a dark screen showing a feed algorithm',
        aspectRatio: 16/9,
      }
    ],
    chips: ['feed', 'topic', 'story'],
  },
  {
    id: 'post-3',
    author: {
      did: 'did:plc:carol789',
      handle: 'carol.bsky.social',
      displayName: 'Carol Williams',
      avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=carol&backgroundColor=d1d4f9',
    },
    content: 'Reading this piece on the history of RSS and how it almost became the backbone of the social web. We had the technology. We just needed the will.',
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    likeCount: 1203,
    replyCount: 67,
    repostCount: 445,
    bookmarkCount: 78,
    embed: {
      type: 'external',
      url: 'https://example.com/rss-history',
      title: 'The Rise and Fall of RSS: A Story About Open Standards',
      description: 'How RSS almost became the foundation of social media, and why it didn\'t — and what we can learn from that failure today.',
      thumb: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=600&q=80',
      domain: 'example.com',
      authorName: 'Alex Rivera',
      authorUrl: 'https://example.com/authors/alex-rivera',
      publisher: 'Example Insights',
    },
    chips: ['topic', 'related', 'story'],
  },
  {
    id: 'post-4',
    author: {
      did: 'did:plc:dave012',
      handle: 'dave.bsky.social',
      displayName: 'Dave Okonkwo',
      avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=dave&backgroundColor=ffd5dc',
    },
    content: 'Hot take: the best social apps of the next decade will be the ones that make the graph *legible*. Not hidden behind algorithms. Not flattened into a feed. Actually visible and navigable.',
    createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    likeCount: 3891,
    replyCount: 234,
    repostCount: 1102,
    bookmarkCount: 256,
    chips: ['topic', 'story'],
  },
  {
    id: 'post-5',
    author: {
      did: 'did:plc:eve345',
      handle: 'eve.bsky.social',
      displayName: 'Eve Larsson',
      avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=eve&backgroundColor=c0aede',
    },
    content: 'Starter packs are genuinely one of the best onboarding mechanisms I\'ve seen on any social platform. The ability to curate a set of accounts and share them as a unit is so underrated.',
    createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    likeCount: 567,
    replyCount: 43,
    repostCount: 189,
    bookmarkCount: 34,
    embed: {
      type: 'quote',
      post: {
        id: 'post-5-quote',
        author: {
          did: 'did:plc:frank678',
          handle: 'frank.bsky.social',
          displayName: 'Frank Müller',
        },
        content: 'Starter packs on Bluesky are like curated playlists for your social graph. Someone who gets it can hand you a whole community in one tap.',
        createdAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
        likeCount: 1245,
        replyCount: 88,
        repostCount: 334,
        bookmarkCount: 67,
        chips: ['pack'],
      }
    },
    chips: ['pack', 'related'],
  },
  {
    id: 'post-6',
    author: {
      did: 'did:plc:grace901',
      handle: 'grace.bsky.social',
      displayName: 'Grace Kim',
      avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=grace&backgroundColor=b6e3f4',
    },
    content: 'The photography community on here is incredible. Three months in and I\'ve found more genuine feedback and connection than years on other platforms.',
    createdAt: new Date(Date.now() - 1000 * 60 * 200).toISOString(),
    likeCount: 892,
    replyCount: 56,
    repostCount: 201,
    bookmarkCount: 45,
    media: [
      {
        type: 'image',
        url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80',
        alt: 'Mountain landscape at golden hour',
        aspectRatio: 4/3,
      },
      {
        type: 'image',
        url: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&q=80',
        alt: 'Forest path in morning mist',
        aspectRatio: 4/3,
      },
    ],
    chips: ['feed', 'topic'],
  },
  {
    id: 'post-7',
    author: {
      did: 'did:plc:grace901',
      handle: 'grace.bsky.social',
      displayName: 'Grace Kim',
      avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=grace&backgroundColor=b6e3f4',
    },
    content: 'Replying to Bob here. This is a great point, the signal-to-noise ratio is so much better.',
    createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    likeCount: 15,
    replyCount: 2,
    repostCount: 1,
    bookmarkCount: 0,
    chips: ['thread'],
    replyTo: {
      id: 'post-2',
      author: {
        did: 'did:plc:bob456',
        handle: 'bob.bsky.social',
        displayName: 'Bob Nakamura',
        avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=bob&backgroundColor=c0aede',
      },
      content: 'Just shipped a new custom feed algorithm that surfaces posts based on semantic similarity rather than engagement. The difference in content quality is remarkable.',
      createdAt: new Date(Date.now() - 1000 * 60 * 23).toISOString(),
      likeCount: 2341,
      replyCount: 89,
      repostCount: 567,
      bookmarkCount: 123,
      chips: ['feed', 'topic', 'story'],
    },
  },
  {
    id: 'post-8',
    author: {
      did: 'did:plc:hannah101',
      handle: 'hannah.bsky.social',
      displayName: 'Hannah Davis',
      avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=hannah&backgroundColor=ffd5dc',
    },
    content: 'This breakdown of the AT Protocol architecture is absolutely essential viewing for anyone building in this space. The explanation of MSTs specifically is top tier.',
    createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    likeCount: 432,
    replyCount: 21,
    repostCount: 89,
    bookmarkCount: 12,
    chips: ['topic', 'story'],
    embed: {
      type: 'video',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', // Using a known ID for stability, usually would be ATProto tech talk
      title: 'Understanding Merkle Search Trees',
      description: 'A deep dive into the data structures powering Bluesky.',
      domain: 'youtube.com',
    }
  },
];

export const MOCK_TRENDING: { id: string; label: string; count: number; color: string }[] = [
  { id: 't1', label: 'ATProto',       count: 12400, color: 'blue' },
  { id: 't2', label: 'OpenWeb',       count: 8900,  color: 'green' },
  { id: 't3', label: 'FederatedSocial', count: 6700, color: 'purple' },
  { id: 't4', label: 'Bluesky',       count: 5200,  color: 'teal' },
  { id: 't5', label: 'IndieWeb',      count: 3800,  color: 'orange' },
];

export const MOCK_FEEDS = [
  { id: 'f1', name: 'Tech & Open Web', creator: 'alice.bsky.social', count: 24100, icon: '⚡' },
  { id: 'f2', name: 'Photography',     creator: 'grace.bsky.social',  count: 18700, icon: '📷' },
  { id: 'f3', name: 'Design Systems',  creator: 'bob.bsky.social',    count: 9300,  icon: '🎨' },
  { id: 'f4', name: 'Science Daily',   creator: 'carol.bsky.social',  count: 31200, icon: '🔬' },
];

export const MOCK_PACKS = [
  { id: 'p1', name: 'ATProto Builders', creator: 'dave.bsky.social', memberCount: 48, icon: '🛠️' },
  { id: 'p2', name: 'Open Web Advocates', creator: 'eve.bsky.social', memberCount: 127, icon: '🌐' },
  { id: 'p3', name: 'Design Thinkers', creator: 'frank.bsky.social', memberCount: 63, icon: '✏️' },
];

export const MOCK_NOTIFICATIONS = [
  { id: 'n1', type: 'like',   actor: 'bob.bsky.social',   displayName: 'Bob Nakamura', content: 'liked your post about ATProto', time: '2m', read: false },
  { id: 'n2', type: 'reply',  actor: 'carol.bsky.social', displayName: 'Carol Williams', content: 'replied: "Couldn\'t agree more about portable identity"', time: '8m', read: false },
  { id: 'n3', type: 'repost', actor: 'dave.bsky.social',  displayName: 'Dave Okonkwo', content: 'reposted your thread', time: '15m', read: false },
  { id: 'n4', type: 'follow', actor: 'eve.bsky.social',   displayName: 'Eve Larsson',  content: 'followed you', time: '1h', read: true },
  { id: 'n5', type: 'like',   actor: 'grace.bsky.social', displayName: 'Grace Kim',    content: 'liked your post about starter packs', time: '2h', read: true },
  { id: 'n6', type: 'mention',actor: 'alice.bsky.social', displayName: 'Alice Chen',   content: 'mentioned you in a thread about open standards', time: '3h', read: true },
];

export function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
