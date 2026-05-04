import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Agent } from '@atproto/api';
import { useQueryClient } from '@tanstack/react-query';
import PostCard from '../components/PostCard';
import ContextPost from '../components/ContextPost';
import LazyModuleBoundary from '../components/LazyModuleBoundary';
import TranslationSettingsSheetFallback from '../components/TranslationSettingsSheetFallback';
import { hasFollowingFeedScope } from '../atproto/oauthClient';
import { useSessionStore } from '../store/sessionStore';
import { useBookmarksStore } from '../store/bookmarksStore';
import { useUiStore, type HomeFeedMode } from '../store/uiStore';
import { useTranslationStore } from '../store/translationStore';
import { useFeedCacheStore } from '../store/feedCacheStore';
import { useAccountFeedsStore } from '../store/accountFeedsStore';
import { mapFeedViewPost, hasDisplayableRecordContent } from '../atproto/mappers';
import { atpCall, atpMutate } from '../lib/atproto/client';
import { qk } from '../lib/atproto/queries';
import { usePostFilterResults } from '../lib/contentFilters/usePostFilterResults';
import { warnMatchReasons } from '../lib/contentFilters/presentation';
import { usePlatform, getIconBtnTokens } from '../hooks/usePlatform';
import { useConversationBatchHydration } from '../conversation/sessionHydration';
import { readViewScrollPosition, writeViewScrollPosition } from '../lib/viewResume';
import { countNewPostsAboveAnchor } from '../lib/feedResume';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import type { MockPost } from '../data/mockData';
import type { StoryEntry } from '../App';
import type { AccountFeedSource } from '../lib/atproto/accountFeeds';

interface Props {
  onOpenStory: (e: StoryEntry) => void;
}

type Mode = HomeFeedMode;

const DISCOVER_FEED_URI = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';
const PUBLIC_APPVIEW_SERVICE = 'https://public.api.bsky.app';
const LIMITED_SCOPE_BANNER_COPY = 'This session does not include Following feed access yet. Saved feeds and public author feeds still work here, but Following needs the Bluesky timeline permission from the HTTPS sign-in.';
const TranslationSettingsSheet = lazyWithRetry(
  () => import('../components/TranslationSettingsSheet'),
  'TranslationSettingsSheet',
);

function dedupePostsById(items: MockPost[]): MockPost[] {
  const seen = new Set<string>();
  const deduped: MockPost[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

function scoreAdaptiveFeedPost(post: MockPost): number {
  const now = Date.now();
  const createdAtMs = Number.isFinite(Date.parse(post.createdAt)) ? Date.parse(post.createdAt) : now;
  const hoursOld = Math.max(1, (now - createdAtMs) / (1000 * 60 * 60));
  const engagement = (post.likeCount * 1.0) + (post.repostCount * 1.6) + (post.replyCount * 1.2);
  const recencyWeight = 1 / Math.sqrt(hoursOld);
  return (Math.log10(engagement + 1) * 3.5) + recencyWeight;
}

function applyAdaptiveFeedRanking(posts: MockPost[]): MockPost[] {
  return posts
    .map((post, index) => ({ post, index, score: scoreAdaptiveFeedPost(post) }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((entry) => entry.post);
}

function Spinner({ small }: { small?: boolean }) {
  const s = small ? 18 : 28;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2.5} strokeLinecap="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
      </path>
    </svg>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px', gap: 12 }}>
      <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--label-3)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/>
          <path d="M9 21V12h6v9"/>
        </svg>
      </div>
      <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', fontWeight: 'var(--type-body-sm-weight)', letterSpacing: 'var(--type-body-sm-track)', color: 'var(--label-3)', textAlign: 'center' }}>{label}</p>
    </div>
  );
}

export default function HomeTab({ onOpenStory }: Props) {
  const { agent, session, profile } = useSessionStore();
  const {
    openProfile,
    openComposeReply,
    homeFeedMode,
    setHomeFeedMode,
    feedsAdaptiveRanking,
  } = useUiStore();
  const translationPolicy = useTranslationStore((state) => state.policy);
  const platform = usePlatform();
  const iconTokens = getIconBtnTokens(platform);
  const navIconButtonSize = Math.max(28, iconTokens.size - 2);
  const navIconGlyphSize = platform.prefersCoarsePointer ? 16 : 15;
  const qc = useQueryClient();
  const mode = homeFeedMode as Mode;
  const [posts, setPosts] = useState<MockPost[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTranslationSettings, setShowTranslationSettings] = useState(false);
  const [revealedFilteredPosts, setRevealedFilteredPosts] = useState<Record<string, boolean>>({});
  const [feedUnreadByFeedId, setFeedUnreadByFeedId] = useState<Record<string, number>>({});
  const publicReadAgent = useMemo(() => new Agent({ service: PUBLIC_APPVIEW_SERVICE }), []);
  const hasLimitedScopeSession = !hasFollowingFeedScope(session?.scope);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollCleanupRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingRestoreRef = useRef<{ mode: Mode; scrollPosition: number; topVisiblePostId?: string } | null>(null);
  const filterResults = usePostFilterResults(posts, 'home');
  const hydrationAgent = hasLimitedScopeSession ? publicReadAgent : agent;
  const conversationHydrationRoots = useMemo(
    () => posts.map((post) => post.threadRoot?.id ?? post.id),
    [posts],
  );

  useConversationBatchHydration({
    enabled: Boolean(hydrationAgent && session && posts.length > 0),
    rootUris: conversationHydrationRoots,
    mode: 'thread',
    agent: hydrationAgent ?? publicReadAgent,
    translationPolicy,
    maxTargets: 8,
  });

  // Feed cache integration
  const getFeedCache = useFeedCacheStore((state) => state.getCache);
  const saveFeedCache = useFeedCacheStore((state) => state.saveCache);
  const setFeedUnreadCount = useFeedCacheStore((state) => state.setUnreadCount);
  const updateFeedScrollPosition = useFeedCacheStore((state) => state.updateScrollPosition);
  const accountFeedSources = useAccountFeedsStore((state) => state.getSources(session?.did));
  const accountFeedsStale = useAccountFeedsStore((state) => state.isStale(session?.did));
  const selectedAccountFeedId = useAccountFeedsStore((state) => state.getSelectedFeedId(session?.did));
  const setSelectedAccountFeedId = useAccountFeedsStore((state) => state.setSelectedFeedId);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  const tabFeedSources = useMemo(
    () => accountFeedSources.filter((feedSource) => {
      if (feedSource.kind !== 'timeline') return true;
      return feedSource.value !== 'following' && feedSource.value !== 'discover';
    }),
    [accountFeedSources],
  );

  const activeAccountFeed = useMemo<AccountFeedSource | null>(() => {
    if (tabFeedSources.length === 0) return null;
    const explicit = selectedAccountFeedId
      ? tabFeedSources.find((feedSource) => feedSource.id === selectedAccountFeedId)
      : null;
    if (explicit) return explicit;
    return tabFeedSources.find((feedSource) => feedSource.pinned) ?? tabFeedSources[0] ?? null;
  }, [selectedAccountFeedId, tabFeedSources]);

  useEffect(() => {
    if (!session || mode !== 'Feeds' || tabFeedSources.length === 0) return;
    if (activeAccountFeed) {
      if (!selectedAccountFeedId || selectedAccountFeedId !== activeAccountFeed.id) {
        setSelectedAccountFeedId(session.did, activeAccountFeed.id);
      }
      return;
    }

    setSelectedAccountFeedId(session.did, tabFeedSources[0]!.id);
  }, [activeAccountFeed, mode, selectedAccountFeedId, session, setSelectedAccountFeedId, tabFeedSources]);

  /**
   * Calculate top visible post index based on scroll position
   */
  const getTopVisibleIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return 0;
    
    const cards = el.querySelectorAll('[data-post-index]');
    let topIndex = 0;
    
    for (const card of cards) {
      const index = parseInt((card as HTMLElement).dataset.postIndex ?? '0', 10);
      const rect = card.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      
      // Check if card is at least partially visible
      if (rect.top < elRect.bottom && rect.bottom > elRect.top) {
        topIndex = index;
        break;
      }
    }
    
    return topIndex;
  }, []);

  const viewResumeKey = useMemo(() => {
    if (!session) return null;
    return `home:${session.did}:${mode}`;
  }, [session, mode]);

  const buildViewResumeKey = useCallback((feedMode: Mode) => {
    if (!session) return null;
    return `home:${session.did}:${feedMode}`;
  }, [session]);

  /**
   * Persist scroll position and visible index periodically
   */
  useEffect(() => {
    const persistScrollPosition = () => {
      if (!session || !scrollRef.current) return;
      
      const topIndex = getTopVisibleIndex();
      updateFeedScrollPosition(
        session.did,
        mode,
        scrollRef.current.scrollTop,
        topIndex,
        posts[topIndex]?.id,
      );
      if (viewResumeKey) {
        writeViewScrollPosition(viewResumeKey, scrollRef.current.scrollTop);
      }
    };

    // Clean up previous interval
    if (scrollCleanupRef.current) {
      clearInterval(scrollCleanupRef.current);
    }

    // Update scroll position every 2 seconds while scrolling
    scrollCleanupRef.current = setInterval(persistScrollPosition, 2000);

    return () => {
      if (scrollCleanupRef.current) {
        clearInterval(scrollCleanupRef.current);
      }
    };
  }, [session, mode, updateFeedScrollPosition, getTopVisibleIndex, posts, viewResumeKey]);

  useEffect(() => {
    const pending = pendingRestoreRef.current;
    if (!pending || pending.mode !== mode || posts.length === 0) return;

    const timer = window.setTimeout(() => {
      const current = pendingRestoreRef.current;
      const container = scrollRef.current;
      if (!current || current.mode !== mode || !container) return;

      let restored = false;
      if (current.topVisiblePostId) {
        const candidates = Array.from(container.querySelectorAll<HTMLElement>('[data-post-id]'));
        const target = candidates.find((node) => node.dataset.postId === current.topVisiblePostId);
        if (target) {
          container.scrollTop = Math.max(0, target.offsetTop);
          restored = true;
        }
      }

      if (!restored && current.scrollPosition > 0) {
        container.scrollTop = current.scrollPosition;
      }

      pendingRestoreRef.current = null;
    }, 50);

    return () => {
      window.clearTimeout(timer);
    };
  }, [mode, posts]);

  /**
   * Restore feed from cache when mode changes
   */
  useEffect(() => {
    if (!session) return;
    if (hasLimitedScopeSession && mode === 'Following') {
      setPosts([]);
      setCursor(undefined);
      setUnreadCounts((prev) => ({ ...prev, Following: 0 }));
      return;
    }
    
    const cached = getFeedCache(session.did, mode);
    if (cached && cached.posts.length > 0) {
      // Restore from cache
      setPosts(cached.posts);
      setCursor(cached.cursor);

      const fallbackTop = viewResumeKey ? readViewScrollPosition(viewResumeKey) : 0;
      pendingRestoreRef.current = {
        mode,
        scrollPosition: cached.scrollPosition > 0 ? cached.scrollPosition : fallbackTop,
        ...(cached.topVisiblePostId ? { topVisiblePostId: cached.topVisiblePostId } : {}),
      };

      // Load the unread count for this mode
      setUnreadCounts((prev) => ({
        ...prev,
        [mode]: cached.unreadCount,
      }));

      void fetchFeed(mode, undefined, {
        backgroundRefresh: true,
        cached,
      });

      return;
    }

    // No cache, fetch fresh
    setPosts([]);
    setCursor(undefined);
    setUnreadCounts((prev) => ({ ...prev, [mode]: 0 }));
    fetchFeed(mode);
  }, [mode, session, getFeedCache, hasLimitedScopeSession, viewResumeKey]);

  /**
   * Save cache after posts change
   */
  useEffect(() => {
    if (!session) return;
    const topVisibleIndex = getTopVisibleIndex();
    const topVisiblePostId = posts[topVisibleIndex]?.id;

    saveFeedCache(session.did, mode, {
      posts,
      ...(cursor !== undefined ? { cursor } : {}),
      scrollPosition: scrollRef.current?.scrollTop ?? 0,
      topVisibleIndex,
      ...(topVisiblePostId ? { topVisiblePostId } : {}),
      unreadCount: unreadCounts[mode] ?? 0,
      savedAt: Date.now(),
      isInvalidated: false,
    });
  }, [posts, cursor, session, mode, saveFeedCache, unreadCounts, getTopVisibleIndex]);

  const fetchFeed = useCallback(async (
    m: Mode,
    cur?: string,
    options?: {
      backgroundRefresh?: boolean;
      cached?: ReturnType<typeof getFeedCache>;
      selectedFeedOverride?: AccountFeedSource | null;
    },
  ) => {
    if (!session) return;
    const isInitial = !cur;
    const backgroundRefresh = options?.backgroundRefresh === true && isInitial;
    if (isInitial) {
      if (!backgroundRefresh) {
        setLoading(true);
        setError(null);
      }
    } else {
      setLoadingMore(true);
      setError(null);
    }
    try {
      if (m === 'Following' && hasLimitedScopeSession) {
        setPosts([]);
        setCursor(undefined);
        if (!backgroundRefresh) {
          setError(LIMITED_SCOPE_BANNER_COPY);
        }
        return;
      }

      let feed: any[] = [];
      let nextCursor: string | undefined;
      const readAgent = m === 'Following' ? agent : publicReadAgent;

      if (m === 'Following') {
        const params: any = { limit: 30, ...(cur ? { cursor: cur } : {}) };
        const res = await atpCall(s => agent.getTimeline(params));
        feed = res.data.feed;
        nextCursor = res.data.cursor;
      } else {
        const selectedFeed = options?.selectedFeedOverride ?? activeAccountFeed;
        if (!selectedFeed) {
          const params: any = { actor: session.did, limit: 30, ...(cur ? { cursor: cur } : {}) };
          const res = await atpCall(s => readAgent.getAuthorFeed(params));
          feed = res.data.feed;
          nextCursor = res.data.cursor;
        } else if (selectedFeed.kind === 'timeline') {
          if (selectedFeed.value === 'following') {
            if (hasLimitedScopeSession) {
              throw new Error(LIMITED_SCOPE_BANNER_COPY);
            }
            const params: any = { limit: 30, ...(cur ? { cursor: cur } : {}) };
            const res = await atpCall(s => agent.getTimeline(params));
            feed = res.data.feed;
            nextCursor = res.data.cursor;
          } else if (selectedFeed.value === 'discover') {
            const params: any = { feed: DISCOVER_FEED_URI, limit: 30, ...(cur ? { cursor: cur } : {}) };
            const res = await atpCall(s => readAgent.app.bsky.feed.getFeed(params));
            feed = res.data.feed;
            nextCursor = res.data.cursor;
          } else {
            throw new Error('This timeline feed is not yet supported.');
          }
        } else if (selectedFeed.kind === 'feed') {
          const params: any = { feed: selectedFeed.value, limit: 30, ...(cur ? { cursor: cur } : {}) };
          const res = await atpCall(s => readAgent.app.bsky.feed.getFeed(params));
          feed = res.data.feed;
          nextCursor = res.data.cursor;
        } else {
          const params: any = { list: selectedFeed.value, limit: 30, ...(cur ? { cursor: cur } : {}) };
          const res = await atpCall(s => readAgent.app.bsky.feed.getListFeed(params));
          feed = res.data.feed;
          nextCursor = res.data.cursor;
        }
      }

      const mapped = feed
        .filter((item: any) => hasDisplayableRecordContent(item.post?.record))
        .map(mapFeedViewPost);
      const freshPosts = dedupePostsById(mapped);

      if (isInitial) {
        const cached = options?.cached ?? getFeedCache(session.did, m);
        const restoreKey = buildViewResumeKey(m);
        const fallbackTop = restoreKey ? readViewScrollPosition(restoreKey) : 0;
        const unreadCount = cached
          ? countNewPostsAboveAnchor(freshPosts, cached.posts, cached.topVisiblePostId)
          : 0;

        setPosts((currentPosts) => {
          if (backgroundRefresh && currentPosts.length > 0 && freshPosts.length === 0) {
            return currentPosts;
          }
          if (m === 'Feeds' && feedsAdaptiveRanking) {
            return applyAdaptiveFeedRanking(freshPosts);
          }
          return freshPosts;
        });

        if (cached && (cached.topVisiblePostId || cached.scrollPosition || fallbackTop > 0)) {
          pendingRestoreRef.current = {
            mode: m,
            scrollPosition: cached.scrollPosition > 0 ? cached.scrollPosition : fallbackTop,
            ...(cached.topVisiblePostId ? { topVisiblePostId: cached.topVisiblePostId } : {}),
          };
        } else {
          scrollRef.current?.scrollTo({ top: 0 });
        }

        setUnreadCounts((prev) => ({ ...prev, [m]: unreadCount }));
        if (cached) {
          setFeedUnreadCount(session.did, m, unreadCount);
        }
      } else {
        setPosts((prev) => {
          const merged = dedupePostsById([...prev, ...freshPosts]);
          if (m === 'Feeds' && feedsAdaptiveRanking) {
            return applyAdaptiveFeedRanking(merged);
          }
          return merged;
        });
      }
      setCursor(nextCursor);
    } catch (err: any) {
      if (!backgroundRefresh) {
        setError(err?.message ?? 'Failed to load feed');
      }
    } finally {
      if (!backgroundRefresh) {
        setLoading(false);
      }
      if (!isInitial) {
        setLoadingMore(false);
      }
    }
  }, [activeAccountFeed, agent, session, getFeedCache, hasLimitedScopeSession, publicReadAgent, buildViewResumeKey, feedsAdaptiveRanking, setFeedUnreadCount]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loadingMore || !cursor) return;
    
    // Load more when near bottom
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      fetchFeed(mode, cursor);
    }

    // Clear unread count when user scrolls to top
    if (el.scrollTop < 100 && unreadCounts[mode]) {
      setUnreadCounts((prev) => ({ ...prev, [mode]: 0 }));
      if (session) {
        setFeedUnreadCount(session.did, mode, 0);
      }
    }

    if (viewResumeKey) {
      writeViewScrollPosition(viewResumeKey, el.scrollTop);
    }
  }, [fetchFeed, mode, cursor, loadingMore, unreadCounts, session, setFeedUnreadCount]);

  const avatarInitial = profile?.displayName?.[0] ?? profile?.handle?.[0] ?? 'Y';

  // ─── Actions ─────────────────────────────────────────────────────────────
  
  const handleToggleRepost = useCallback(async (p: MockPost) => {
    if (!session || !p.cid) return;
    
    const isReposted = !!p.viewer?.repost;
    
    // Optimistic update
    setPosts(prev => prev.map(item => {
      if (item.id !== p.id) return item;
      const viewer = item.viewer ?? {};
      if (isReposted) {
        const { repost: _repost, ...restViewer } = viewer;
        return {
          ...item,
          repostCount: item.repostCount - 1,
          viewer: restViewer,
        };
      }
      return {
        ...item,
        repostCount: item.repostCount + 1,
        viewer: { ...viewer, repost: 'pending' },
      };
    }));

    try {
      if (isReposted) {
        await atpMutate(() => agent.deleteRepost(p.viewer!.repost!));
      } else {
        const res = await atpMutate(() => agent.repost(p.id, p.cid!));
        // Update with real URI on success
        if (res) {
          setPosts(prev => prev.map(item => item.id === p.id ? {
            ...item, viewer: { ...item.viewer, repost: res.uri }
          } : item));
        }
      }
    } catch {
      // Revert on failure
      setPosts(prev => prev.map(item => item.id === p.id ? p : item));
    }
  }, [agent, session]);

  const handleToggleLike = useCallback(async (p: MockPost) => {
    if (!session || !p.cid) return;
    
    const isLiked = !!p.viewer?.like;
    
    setPosts(prev => prev.map(item => {
      if (item.id !== p.id) return item;
      const viewer = item.viewer ?? {};
      if (isLiked) {
        const { like: _like, ...restViewer } = viewer;
        return {
          ...item,
          likeCount: item.likeCount - 1,
          viewer: restViewer,
        };
      }
      return {
        ...item,
        likeCount: item.likeCount + 1,
        viewer: { ...viewer, like: 'pending' },
      };
    }));

    try {
      if (isLiked) {
        await atpMutate(() => agent.deleteLike(p.viewer!.like!));
      } else {
        const res = await atpMutate(() => agent.like(p.id, p.cid!));
        if (res) {
          setPosts(prev => prev.map(item => item.id === p.id ? {
            ...item, viewer: { ...item.viewer, like: res.uri }
          } : item));
        }
      }
    } catch {
      setPosts(prev => prev.map(item => item.id === p.id ? p : item));
    }
  }, [agent, session]);

  const sessionDid = session?.did ?? '';
  // Create a memoized default empty array to prevent new references on every render
  const emptyArray = useMemo(() => [], []);
  // Select bookmarked URIs - use memoized fallback to prevent infinite loops
  const bookmarkedUris = useBookmarksStore((state) =>
    sessionDid && state.bookmarksByDid[sessionDid]
      ? state.bookmarksByDid[sessionDid]
      : emptyArray
  );

  // Sync bookmark state from store to posts when bookmarks change.
  // Only depends on bookmarkedUris — using setPosts functional form avoids
  // adding `posts` as a dep, which would create a setState→posts→effect cycle.
  useEffect(() => {
    const uriSet = new Set(bookmarkedUris);

    setPosts((prev) => {
      if (prev.length === 0) return prev;

      const hasChanges = prev.some((post) => {
        const isBookmarked = uriSet.has(post.id);
        const hasBookmarkState = !!post.viewer?.bookmark;
        return isBookmarked !== hasBookmarkState;
      });

      if (!hasChanges) return prev;

      return prev.map((post) => {
        const isBookmarked = uriSet.has(post.id);
        const hasBookmarkState = !!post.viewer?.bookmark;

        if (isBookmarked === hasBookmarkState) {
          return post;
        }

        const viewer = post.viewer ?? {};
        if (isBookmarked) {
          return {
            ...post,
            viewer: { ...viewer, bookmark: 'bookmarked' },
          };
        }

        const { bookmark: _bookmark, ...restViewer } = viewer;
        return {
          ...post,
          viewer: restViewer,
        };
      });
    });
  }, [bookmarkedUris]);

  const { addBookmark, removeBookmark } = useBookmarksStore();

  const handleBookmark = useCallback(async (p: MockPost) => {
    if (!sessionDid) return;
    const postUri = p.id;
    const wasBookmarked = useBookmarksStore.getState().isBookmarked(sessionDid, postUri);

    // Update local state
    setPosts((prev) => prev.map((item) => {
      if (item.id !== p.id) return item;
      const viewer = item.viewer ?? {};
      if (wasBookmarked) {
        const { bookmark: _bookmark, ...restViewer } = viewer;
        return {
          ...item,
          bookmarkCount: Math.max(0, item.bookmarkCount - 1),
          viewer: restViewer,
        };
      }
      return {
        ...item,
        bookmarkCount: item.bookmarkCount + 1,
        viewer: { ...viewer, bookmark: 'bookmarked' },
      };
    }));

    // Persist to account-scoped store
    if (wasBookmarked) {
      removeBookmark(sessionDid, postUri);
    } else {
      addBookmark(sessionDid, postUri);
    }
  }, [sessionDid, addBookmark, removeBookmark]);

  const handleMore = useCallback((p: MockPost) => {
    // Placeholder for more menu
    console.log('More menu for post:', p.id);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', color: 'var(--label-1)' }}>
      {/* Nav bar */}
      <div style={{
        flexShrink: 0,
        paddingTop: 'calc(var(--safe-top) + 12px)',
        background: 'transparent',
      }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '0 16px 10px', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', overflow: 'hidden',
            background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontFamily: 'var(--font-ui)', fontSize: 'var(--type-meta-sm-size)', fontWeight: 700, flexShrink: 0,
          }}>
            {profile?.avatar
              ? <img src={profile.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : avatarInitial
            }
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-ui-title-md-size)', lineHeight: 'var(--type-ui-title-md-line)', fontWeight: 700, color: 'var(--label-1)', letterSpacing: 'var(--type-ui-title-md-track)' }}>Glimpse</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              aria-label="Refresh"
              onClick={() => fetchFeed(mode)}
              style={{
                width: navIconButtonSize,
                height: navIconButtonSize,
                borderRadius: '50%',
                background: 'var(--fill-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--label-1)', border: 'none', cursor: 'pointer',
              }}
            >
              <svg width={navIconGlyphSize} height={navIconGlyphSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
          </div>
        </div>

        {hasLimitedScopeSession && (
          <div style={{ padding: '0 16px 10px' }}>
            <div
              role="status"
              style={{
                borderRadius: 16,
                border: '1px solid color-mix(in srgb, var(--orange) 28%, var(--sep))',
                background: 'color-mix(in srgb, var(--surface) 88%, var(--orange) 12%)',
                padding: '10px 12px',
              }}
            >
              <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', fontWeight: 600, letterSpacing: 'var(--type-body-sm-track)', color: 'var(--label-2)' }}>
                {LIMITED_SCOPE_BANNER_COPY}
              </p>
            </div>
          </div>
        )}

        {/* Feed tab row — single flat row: Following + all saved feeds */}
        {(!hasLimitedScopeSession || tabFeedSources.length > 0) && (
          <div style={{
            display: 'flex',
            overflowX: 'auto',
            gap: 6,
            padding: '0 16px 10px',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          } as React.CSSProperties}>
            {!hasLimitedScopeSession && (
              <button
                onClick={() => {
                  setHomeFeedMode('Following');
                  setPosts([]);
                  setCursor(undefined);
                }}
                style={{
                  flexShrink: 0,
                  minHeight: 30,
                  padding: '0 14px',
                  borderRadius: 100,
                  fontFamily: 'var(--font-ui)', fontSize: '14px', lineHeight: '18px',
                  fontWeight: mode === 'Following' ? 700 : 500,
                  color: mode === 'Following' ? '#fff' : 'var(--label-1)',
                  background: mode === 'Following' ? 'var(--blue)' : 'var(--fill-2)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  position: 'relative',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                Following
                {(unreadCounts['Following'] ?? 0) > 0 && (
                  <span style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 16, height: 16, borderRadius: '50%',
                    background: mode === 'Following' ? 'rgba(255,255,255,0.3)' : 'var(--red)',
                    color: '#fff',
                    fontFamily: 'var(--font-ui)', fontSize: '10px', fontWeight: 700,
                    padding: '0 4px',
                  }}>
                    {(unreadCounts['Following'] ?? 0) > 99 ? '99+' : unreadCounts['Following']}
                  </span>
                )}
              </button>
            )}
            {tabFeedSources.map((feedSource) => {
              const isSelected = mode === 'Feeds' && activeAccountFeed?.id === feedSource.id;
              const feedUnread = feedUnreadByFeedId[feedSource.id] ?? 0;
              return (
                <button
                  key={feedSource.id}
                  onClick={() => {
                    if (!session) return;
                    // Transfer current Feeds unread to the feed we're leaving
                    if (mode === 'Feeds' && activeAccountFeed && activeAccountFeed.id !== feedSource.id) {
                      const currentUnread = unreadCounts['Feeds'] ?? 0;
                      if (currentUnread > 0) {
                        setFeedUnreadByFeedId((prev) => ({
                          ...prev,
                          [activeAccountFeed.id]: (prev[activeAccountFeed.id] ?? 0) + currentUnread,
                        }));
                        setUnreadCounts((prev) => ({ ...prev, Feeds: 0 }));
                      }
                    }
                    // Clear unread for the feed we're switching to
                    setFeedUnreadByFeedId((prev) => {
                      if (!prev[feedSource.id]) return prev;
                      const next = { ...prev };
                      delete next[feedSource.id];
                      return next;
                    });
                    setSelectedAccountFeedId(session.did, feedSource.id);
                    setHomeFeedMode('Feeds');
                    setPosts([]);
                    setCursor(undefined);
                    void fetchFeed('Feeds', undefined, { selectedFeedOverride: feedSource });
                  }}
                  style={{
                    flexShrink: 0,
                    minHeight: 30,
                    padding: '0 10px',
                    borderRadius: 999,
                    border: 'none',
                    cursor: 'pointer',
                    background: isSelected ? 'var(--blue)' : 'var(--fill-2)',
                    color: isSelected ? '#fff' : 'var(--label-1)',
                    fontFamily: 'var(--font-ui)',
                    fontSize: 12,
                    fontWeight: isSelected ? 700 : 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'all 0.15s',
                    position: 'relative',
                  }}
                >
                  <span>{feedSource.title}</span>
                  {feedUnread > 0 && (
                    <span style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: 'var(--red)',
                      color: '#fff',
                      fontFamily: 'var(--font-ui)',
                      fontSize: 9,
                      fontWeight: 700,
                      padding: '0 3px',
                      marginLeft: 2,
                    }}>
                      {feedUnread > 99 ? '99+' : feedUnread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

      </div>

      {/* Feed scroll */}
      <div
        ref={scrollRef}
        className="scroll-y"
        style={{ flex: 1, padding: '12px 12px 0' }}
        onScroll={handleScroll}
      >
        {/* Feed header strip — shown when a specific feed is selected in Feeds mode */}
        {activeAccountFeed && mode === 'Feeds' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 4px 12px',
          }}>
            {/* Feed avatar */}
            <div style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              flexShrink: 0,
              overflow: 'hidden',
              background: activeAccountFeed.avatar ? 'transparent' : 'var(--fill-3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {activeAccountFeed.avatar ? (
                <img src={activeAccountFeed.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--label-3)' }}>
                  {(activeAccountFeed.title[0] ?? '?').toUpperCase()}
                </span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-ui-title-sm-size)', fontWeight: 700, color: 'var(--label-1)' }}>
                  {activeAccountFeed.title}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  padding: '2px 6px', borderRadius: 4,
                  background: 'var(--fill-3)',
                  color: 'var(--label-2)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}>
                  {activeAccountFeed.kind}
                </span>
                {activeAccountFeed.pinned && (
                  <span aria-label="Pinned" style={{ color: 'var(--yellow)', fontSize: 13 }}>★</span>
                )}
              </div>
              {activeAccountFeed.description && (
                <p style={{
                  fontFamily: 'var(--font-ui)', fontSize: 12,
                  color: 'var(--label-1)', margin: '2px 0 0',
                  overflow: 'hidden', display: '-webkit-box',
                  WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  {activeAccountFeed.description}
                </p>
              )}
            </div>
          </div>
        )}
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
              <Spinner />
            </motion.div>
          ) : error ? (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ padding: '32px 16px', textAlign: 'center' }}>
              <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', fontWeight: 'var(--type-body-sm-weight)', letterSpacing: 'var(--type-body-sm-track)', color: 'var(--red)', marginBottom: 12 }}>{error}</p>
              <button onClick={() => fetchFeed(mode)} style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-label-md-size)', lineHeight: 'var(--type-label-md-line)', fontWeight: 600, letterSpacing: 'var(--type-label-md-track)', color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer' }}>
                Try again
              </button>
            </motion.div>
          ) : posts.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <EmptyState label={mode === 'Following' ? "Nothing new from people you follow." : "No posts found."} />
            </motion.div>
          ) : (
            <motion.div key={mode} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} style={{ paddingBottom: 'var(--safe-bottom)' }}>
              {posts.map((post, i) => {
                const matches = filterResults[post.id] ?? [];
                const isHidden = matches.some((m) => m.action === 'hide');
                const isWarned = matches.some((m) => m.action === 'warn');
                const isRevealed = !!revealedFilteredPosts[post.id];

                if (isHidden) return null;

                if (isWarned && !isRevealed) {
                  const reasons = warnMatchReasons(matches);
                  return (
                    <div key={post.id} style={{
                      border: '1px solid var(--stroke-dim)',
                      borderRadius: 16,
                      padding: '12px 14px',
                      marginBottom: 10,
                      background: 'color-mix(in srgb, var(--surface-card) 90%, var(--orange) 10%)',
                    }}>
                      <div style={{ fontSize: 'var(--type-meta-md-size)', lineHeight: 'var(--type-meta-md-line)', letterSpacing: 'var(--type-meta-md-track)', fontWeight: 700, color: 'var(--label-1)', marginBottom: 4 }}>
                        Content warning
                      </div>
                      <div style={{ fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', letterSpacing: 'var(--type-meta-sm-track)', color: 'var(--label-3)', marginBottom: 10 }}>
                        This post may include words or topics you asked to warn about.
                      </div>
                      <div style={{ fontSize: 'var(--type-meta-md-size)', lineHeight: 'var(--type-meta-md-line)', letterSpacing: 'var(--type-meta-md-track)', fontWeight: 700, color: 'var(--label-2)', marginBottom: 8 }}>
                        Matches filter:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                        {reasons.map((entry) => (
                          <span key={`${entry.phrase}:${entry.reason}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, border: '1px solid var(--stroke-dim)', padding: '4px 10px', background: 'var(--surface-2)' }}>
                            <span style={{ fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', color: 'var(--label-1)', fontWeight: 700 }}>{entry.phrase}</span>
                            <span style={{ fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', color: 'var(--label-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              {entry.reason === 'exact+semantic' ? 'exact + semantic' : entry.reason}
                            </span>
                          </span>
                        ))}
                      </div>
                      <button
                        onClick={() => setRevealedFilteredPosts((prev) => ({ ...prev, [post.id]: true }))}
                        style={{ border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 'var(--type-meta-md-size)', lineHeight: 'var(--type-meta-md-line)', fontWeight: 700, padding: 0, cursor: 'pointer' }}
                      >
                        Show post
                      </button>
                    </div>
                  );
                }

                const storyTitle = post.content.slice(0, 80);
                const openThreadStory = () => {
                  onOpenStory({ id: post.id, type: 'post', title: storyTitle });
                };
                const openContextTarget = (target?: MockPost) => {
                  if (!target?.id) {
                    // If parent context is missing (blocked, deleted, or filtered),
                    // still open the visible thread anchored on the current post.
                    openThreadStory();
                    return;
                  }
                  onOpenStory({
                    id: target.id,
                    type: 'post',
                    title: target.content?.slice(0, 80) || storyTitle,
                  });
                };

                const hasDistinctThreadRoot = !!post.threadRoot && post.threadRoot.id !== post.id;
                const hasDistinctReplyParent = !!post.replyTo
                  && post.replyTo.id !== post.id
                  && post.replyTo.id !== post.threadRoot?.id;

                // A reply-in-thread gets a subtle tinted background so it reads as
                // a distinct unit from adjacent standalone posts.
                const isReply = hasDistinctThreadRoot || hasDistinctReplyParent;
                const replyingToHandle = isReply
                  ? (post.replyTo?.author.handle ?? post.threadRoot?.author.handle)
                  : undefined;
                return (
                <div key={post.id} data-post-index={i} data-post-id={post.id}>
                  {hasDistinctThreadRoot && <ContextPost post={post.threadRoot!} type="thread" onClick={() => openContextTarget(post.threadRoot)} />}
                  {/* Only show direct parent if it's not the same as the thread root */}
                  {hasDistinctReplyParent && <ContextPost post={post.replyTo!} type="reply" onClick={() => openContextTarget(post.replyTo)} />}
                  <PostCard
                    post={post}
                    onOpenStory={onOpenStory}
                    onViewProfile={openProfile}
                    onToggleRepost={handleToggleRepost}
                    onToggleLike={handleToggleLike}
                    onBookmark={handleBookmark}
                    onMore={handleMore}
                    onReply={openComposeReply}
                    index={i}
                    hasContextAbove={isReply}
                    {...(replyingToHandle ? { replyingTo: replyingToHandle } : {})}
                  />
                </div>
                );
              })}
              {loadingMore && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
                  <Spinner small />
                </div>
              )}
              {!cursor && posts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0 32px', gap: 8 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 14 }}>✦</span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--label-3)' }}>You're all caught up</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {showTranslationSettings ? (
        <LazyModuleBoundary
          resetKey={`home-settings:${showTranslationSettings ? 'open' : 'closed'}`}
          fallback={
            <TranslationSettingsSheetFallback
              open={showTranslationSettings}
              onClose={() => setShowTranslationSettings(false)}
              title="Settings unavailable"
              message="The settings module could not finish loading. Close this sheet and try again."
            />
          }
        >
          <React.Suspense
            fallback={
              <TranslationSettingsSheetFallback
                open={showTranslationSettings}
                onClose={() => setShowTranslationSettings(false)}
              />
            }
          >
            <TranslationSettingsSheet
              open={showTranslationSettings}
              onClose={() => setShowTranslationSettings(false)}
            />
          </React.Suspense>
        </LazyModuleBoundary>
      ) : null}
    </div>
  );
}
