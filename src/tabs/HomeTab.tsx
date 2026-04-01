import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Agent } from '@atproto/api';
import { useQueryClient } from '@tanstack/react-query';
import PostCard from '../components/PostCard';
import ContextPost from '../components/ContextPost';
import TranslationSettingsSheet from '../components/TranslationSettingsSheet';
import { hasFollowingFeedScope } from '../atproto/oauthClient';
import { useSessionStore } from '../store/sessionStore';
import { useUiStore } from '../store/uiStore';
import { useTranslationStore } from '../store/translationStore';
import { useFeedCacheStore } from '../store/feedCacheStore';
import { mapFeedViewPost, hasDisplayableRecordContent } from '../atproto/mappers';
import { atpCall, atpMutate } from '../lib/atproto/client';
import { qk } from '../lib/atproto/queries';
import { usePostFilterResults } from '../lib/contentFilters/usePostFilterResults';
import { warnMatchReasons } from '../lib/contentFilters/presentation';
import { usePlatform, getIconBtnTokens } from '../hooks/usePlatform';
import { useConversationBatchHydration } from '../conversation/sessionHydration';
import { useTimelineConversationHintsProjection } from '../conversation/sessionSelectors';
import type { MockPost } from '../data/mockData';
import type { StoryEntry } from '../App';

interface Props {
  onOpenStory: (e: StoryEntry) => void;
}

const MODES = ['Following', 'Discover', 'Feeds'] as const;
type Mode = typeof MODES[number];

const DISCOVER_FEED_URI = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';
const PUBLIC_APPVIEW_SERVICE = 'https://public.api.bsky.app';
const LIMITED_SCOPE_BANNER_COPY = 'This session does not include Following feed access yet. Discover and public author feeds still work here, but Following needs the Bluesky timeline permission from the HTTPS sign-in.';

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
  const { openProfile, openComposeReply } = useUiStore();
  const translationPolicy = useTranslationStore((state) => state.policy);
  const platform = usePlatform();
  const iconTokens = getIconBtnTokens(platform);
  const topModePillHeight = platform.prefersCoarsePointer ? 34 : 30;
  const topModePillPaddingX = platform.prefersCoarsePointer ? 14 : 12;
  const topModePillBadgeSize = platform.prefersCoarsePointer ? 18 : 16;
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('Following');
  const [posts, setPosts] = useState<MockPost[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTranslationSettings, setShowTranslationSettings] = useState(false);
  const [revealedFilteredPosts, setRevealedFilteredPosts] = useState<Record<string, boolean>>({});
  const publicReadAgent = useMemo(() => new Agent({ service: PUBLIC_APPVIEW_SERVICE }), []);
  const hasLimitedScopeSession = !hasFollowingFeedScope(session?.scope);
  const visibleModes = useMemo(
    () => MODES.filter((item) => !hasLimitedScopeSession || item !== 'Following') as Mode[],
    [hasLimitedScopeSession],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollCleanupRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRedirectedLimitedScopeRef = useRef(false);
  const filterResults = usePostFilterResults(posts, 'home');
  const hydrationAgent = hasLimitedScopeSession ? publicReadAgent : agent;
  const conversationHydrationRoots = useMemo(
    () => posts.map((post) => post.threadRoot?.id ?? post.id),
    [posts],
  );

  const timelineHintByPostId = useTimelineConversationHintsProjection(posts);

  useConversationBatchHydration({
    enabled: Boolean(hydrationAgent && session && posts.length > 0),
    rootUris: conversationHydrationRoots,
    mode: 'thread',
    agent: hydrationAgent ?? publicReadAgent,
    translationPolicy,
    maxTargets: 8,
  });

  useEffect(() => {
    if (!hasLimitedScopeSession) {
      autoRedirectedLimitedScopeRef.current = false;
      return;
    }

    if (autoRedirectedLimitedScopeRef.current || mode !== 'Following') {
      return;
    }

    autoRedirectedLimitedScopeRef.current = true;
    setMode('Discover');
  }, [hasLimitedScopeSession, mode]);
  
  // Feed cache integration
  const getFeedCache = useFeedCacheStore((state) => state.getCache);
  const saveFeedCache = useFeedCacheStore((state) => state.saveCache);
  const incrementFeedUnreadCount = useFeedCacheStore((state) => state.incrementUnreadCount);
  const resetFeedUnreadCount = useFeedCacheStore((state) => state.resetUnreadCount);
  const updateFeedScrollPosition = useFeedCacheStore((state) => state.updateScrollPosition);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

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

  /**
   * Persist scroll position and visible index periodically
   */
  useEffect(() => {
    const persistScrollPosition = () => {
      if (!session || !scrollRef.current) return;
      
      const topIndex = getTopVisibleIndex();
      updateFeedScrollPosition(session.did, mode, scrollRef.current.scrollTop, topIndex);
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
  }, [session, mode, updateFeedScrollPosition, getTopVisibleIndex]);

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
      
      // Schedule scroll restoration (needs DOM to be ready)
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = cached.scrollPosition;
        }
      }, 50);

      // Load the unread count for this mode
      setUnreadCounts((prev) => ({
        ...prev,
        [mode]: cached.unreadCount,
      }));

      return; // Don't fetch, use cache
    }

    // No cache, fetch fresh
    setPosts([]);
    setCursor(undefined);
    setUnreadCounts((prev) => ({ ...prev, [mode]: 0 }));
    fetchFeed(mode);
  }, [mode, session, getFeedCache, hasLimitedScopeSession]);

  /**
   * Save cache after posts change
   */
  useEffect(() => {
    if (!session) return;
    
    saveFeedCache(session.did, mode, {
      posts,
      ...(cursor !== undefined ? { cursor } : {}),
      scrollPosition: scrollRef.current?.scrollTop ?? 0,
      topVisibleIndex: getTopVisibleIndex(),
      unreadCount: unreadCounts[mode] ?? 0,
      savedAt: Date.now(),
      isInvalidated: false,
    });
  }, [posts, cursor, session, mode, saveFeedCache, unreadCounts, getTopVisibleIndex]);

  const fetchFeed = useCallback(async (m: Mode, cur?: string) => {
    if (!session) return;
    const isInitial = !cur;
    if (isInitial) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      if (m === 'Following' && hasLimitedScopeSession) {
        setPosts([]);
        setCursor(undefined);
        setError(LIMITED_SCOPE_BANNER_COPY);
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
      } else if (m === 'Discover') {
        const params: any = { feed: DISCOVER_FEED_URI, limit: 30, ...(cur ? { cursor: cur } : {}) };
        const res = await atpCall(s => readAgent.app.bsky.feed.getFeed(params));
        feed = res.data.feed;
        nextCursor = res.data.cursor;
      } else {
        const params: any = { actor: session.did, limit: 30, ...(cur ? { cursor: cur } : {}) };
        const res = await atpCall(s => readAgent.getAuthorFeed(params));
        feed = res.data.feed;
        nextCursor = res.data.cursor;
      }

      const mapped = feed
        .filter((item: any) => hasDisplayableRecordContent(item.post?.record))
        .map(mapFeedViewPost);

      if (isInitial) {
        const cached = getFeedCache(session.did, m);
        const newCount = cached ? mapped.length : 0;
        
        setPosts(dedupePostsById(mapped));
        scrollRef.current?.scrollTo({ top: 0 });
        
        // If there was cached data and new posts arrived, track as unread
        if (newCount > 0) {
          setUnreadCounts((prev) => ({ ...prev, [m]: newCount }));
          incrementFeedUnreadCount(session.did, m, newCount);
        }
      } else {
        setPosts(prev => dedupePostsById([...prev, ...mapped]));
      }
      setCursor(nextCursor);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load feed');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [agent, session, getFeedCache, incrementFeedUnreadCount, hasLimitedScopeSession, publicReadAgent]);

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
        resetFeedUnreadCount(session.did, mode);
      }
    }
  }, [fetchFeed, mode, cursor, loadingMore, unreadCounts, session, resetFeedUnreadCount]);

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

  const handleBookmark = useCallback(async (p: MockPost) => {
    // Placeholder for bookmark functionality
    // For now, just toggle the state locally
    setPosts(prev => prev.map(item => {
      if (item.id !== p.id) return item;
      const viewer = item.viewer ?? {};
      const isBookmarked = !!viewer.bookmark;
      if (isBookmarked) {
        const { bookmark: _bookmark, ...restViewer } = viewer;
        return {
          ...item,
          bookmarkCount: item.bookmarkCount - 1,
          viewer: restViewer,
        };
      }
      return {
        ...item,
        bookmarkCount: item.bookmarkCount + 1,
        viewer: { ...viewer, bookmark: 'bookmarked' },
      };
    }));
  }, []);

  const handleMore = useCallback((p: MockPost) => {
    // Placeholder for more menu
    console.log('More menu for post:', p.id);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Nav bar */}
      <div style={{
        flexShrink: 0,
        paddingTop: 'calc(var(--safe-top) + 12px)',
        background: 'transparent',
      }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '0 16px 10px', gap: 12 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              aria-label="Settings"
              onClick={() => setShowTranslationSettings(true)}
              style={{
                width: iconTokens.size,
                height: iconTokens.size,
                borderRadius: '50%',
                background: 'var(--fill-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--label-2)', border: 'none', cursor: 'pointer',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 8l6 6" />
                <path d="M4 14l6-6 2-3" />
                <path d="M2 5h12" />
                <path d="M7 2h1" />
                <path d="M22 22l-5-10-5 10" />
                <path d="M14 18h6" />
              </svg>
            </button>
            <button
              aria-label="Refresh"
              onClick={() => fetchFeed(mode)}
              style={{
                width: iconTokens.size,
                height: iconTokens.size,
                borderRadius: '50%',
                background: 'var(--fill-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--label-2)', border: 'none', cursor: 'pointer',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
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

        {/* Mode pills */}
        <div style={{ display: 'flex', flexDirection: 'row', padding: '0 16px 10px', gap: 6 }}>
          {visibleModes.map(m => {
            const unreadCount = unreadCounts[m] ?? 0;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  minHeight: topModePillHeight,
                  padding: `0 ${topModePillPaddingX}px`,
                  borderRadius: 100,
                  fontFamily: 'var(--font-ui)', fontSize: '14px', lineHeight: '18px', fontWeight: mode === m ? 600 : 500, letterSpacing: '0',
                  color: mode === m ? '#fff' : 'var(--label-2)',
                  background: mode === m ? 'var(--blue)' : 'var(--fill-2)',
                  border: 'none', cursor: 'pointer',
                  transition: 'all 0.15s',
                  position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                {m}
                {unreadCount > 0 && (
                  <span style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: topModePillBadgeSize, height: topModePillBadgeSize, borderRadius: '50%',
                    background: mode === m ? 'rgba(255,255,255,0.3)' : 'var(--red)',
                    color: mode === m ? '#fff' : '#fff',
                    fontFamily: 'var(--font-ui)', fontSize: '10px', fontWeight: 700,
                    padding: '0 4px',
                  }}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Feed scroll */}
      <div
        ref={scrollRef}
        className="scroll-y"
        style={{ flex: 1, padding: '12px 12px 0' }}
        onScroll={handleScroll}
      >
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

                // A reply-in-thread gets a subtle tinted background so it reads as
                // a distinct unit from adjacent standalone posts
                const isReply = !!(post.threadRoot ?? post.replyTo);
                const timelineHint = timelineHintByPostId[post.id];
                const replyingToHandle = !isReply
                  ? (post.replyTo?.author.handle ?? post.threadRoot?.author.handle)
                  : undefined;
                return (
                <div key={post.id} data-post-index={i}>
                  {post.threadRoot && <ContextPost post={post.threadRoot} type="thread" onClick={() => openContextTarget(post.threadRoot)} />}
                  {/* Only show direct parent if it's not the same as the thread root */}
                  {post.replyTo && post.replyTo.id !== post.threadRoot?.id && <ContextPost post={post.replyTo} type="reply" onClick={() => openContextTarget(post.replyTo)} />}
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
                    {...(timelineHint ? { timelineHint } : {})}
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

      <TranslationSettingsSheet open={showTranslationSettings} onClose={() => setShowTranslationSettings(false)} />
    </div>
  );
}
