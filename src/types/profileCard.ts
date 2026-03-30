// ─── Profile Card Types ────────────────────────────────────────────────────

export type ProfileCardVariant = 'standard' | 'thread_scoped';

export interface CompactPostPreview {
  uri: string;
  text: string;
  createdAt: string;
  likeCount?: number;
  replyCount?: number;
  hasMedia?: boolean;
  mediaType?: 'image' | 'video' | 'external';
  /** For thread-scoped cards */
  roleBadge?: string;
}

export interface StarterPackRef {
  uri: string;
  title: string;
}

export interface ProfileCardData {
  variant: ProfileCardVariant;

  identity: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
    banner?: string;
    bio?: string;
  };

  social: {
    followersCount: number;
    mutualsCount: number;
    followingCount: number;
    isFollowing: boolean;
    canFollow: boolean;
    canBlock?: boolean;
  };

  starterPacks: StarterPackRef[];

  activity: {
    recentPosts: CompactPostPreview[];
    popularPosts: CompactPostPreview[];
  };

  threadContext?: {
    threadUri: string;
    compactPosts: CompactPostPreview[];
    roleSummary?: string;
    notableAction?: string;
    mostLabelledReply?: CompactPostPreview & {
      labels: Array<{ label: string; count: number }>;
    };
  };
}
