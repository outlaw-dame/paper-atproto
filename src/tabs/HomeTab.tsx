import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import PostCard from '../components/PostCard.js';
import ContextPost from '../components/ContextPost.js';
import TranslationSettingsSheet from '../components/TranslationSettingsSheet.js';
import { useSessionStore } from '../store/sessionStore.js';
import { useUiStore } from '../store/uiStore.js';
import { mapFeedViewPost, hasDisplayableRecordContent } from '../atproto/mappers.js';
import { atpCall, atpMutate } from '../lib/atproto/client.js';
import { qk } from '../lib/atproto/queries.js';
import { usePostFilterResults } from '../lib/contentFilters/usePostFilterResults.js';
import { warnMatchReasons } from '../lib/contentFilters/presentation.js';
import { usePlatform, getButtonTokens, getIconBtnTokens } from '../hooks/usePlatform.js';
import type { MockPost } from '../data/mockData.js';
import type { StoryEntry } from '../App.js';

interface Props {
  onOpenStory: (e: StoryEntry) => void;
}

const MODES = ['Following', 'Discover', 'Feeds'] as const;
type Mode = typeof MODES[number];

const DISCOVER_FEED_URI = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';

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
  const platform = usePlatform();
  const buttonTokens = getButtonTokens(platform);
  const iconTokens = getIconBtnTokens(platform);
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('Following');
  const [posts, setPosts] = useState<MockPost[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTranslationSettings, setShowTranslationSettings] = useState(false);
  const [revealedFilteredPosts, setRevealedFilteredPosts] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const filterResults = usePostFilterResults(posts, 'home');

  const fetchFeed = useCallback(async (m: Mode, cur?: string) => {
    if (!session) return;
    const isInitial = !cur;
    if (isInitial) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      let feed: any[] = [];
      let nextCursor: string | undefined;

      if (m === 'Following') {
        const params: any = { limit: 30, ...(cur ? { cursor: cur } : {}) };
        const res = await atpCall(s => agent.getTimeline(params));
        feed = res.data.feed;
        nextCursor = res.data.cursor;
      } else if (m === 'Discover') {
        const params: any = { feed: DISCOVER_FEED_URI, limit: 30, ...(cur ? { cursor: cur } : {}) };
        const res = await atpCall(s => agent.app.bsky.feed.getFeed(params));
        feed = res.data.feed;
        nextCursor = res.data.cursor;
      } else {
        const params: any = { actor: session.did, limit: 30, ...(cur ? { cursor: cur } : {}) };
        const res = await atpCall(s => agent.getAuthorFeed(params));
        feed = res.data.feed;
        nextCursor = res.data.cursor;
      }

      const mapped = feed
        .filter((item: any) => hasDisplayableRecordContent(item.post?.record))
        .map(mapFeedViewPost);

      if (isInitial) {
        setPosts(dedupePostsById(mapped));
        scrollRef.current?.scrollTo({ top: 0 });
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
  }, [agent, session]);

  useEffect(() => {
    setPosts([]);
    setCursor(undefined);
    fetchFeed(mode);
  }, [mode, fetchFeed]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loadingMore || !cursor) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      fetchFeed(mode, cursor);
    }
  }, [fetchFeed, mode, cursor, loadingMore]);

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
        background: 'var(--chrome-bg)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '0.5px solid var(--sep)',
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

        {/* Mode pills */}
        <div style={{ display: 'flex', flexDirection: 'row', padding: '0 16px 12px', gap: 8 }}>
          {MODES.map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                minHeight: platform.prefersCoarsePointer ? 40 : 34,
                padding: `0 ${buttonTokens.paddingH - 2}px`,
                borderRadius: 100,
                fontFamily: 'var(--font-ui)', fontSize: 'var(--type-label-md-size)', lineHeight: 'var(--type-label-md-line)', fontWeight: mode === m ? 600 : 400, letterSpacing: 'var(--type-label-md-track)',
                color: mode === m ? '#fff' : 'var(--label-2)',
                background: mode === m ? 'var(--blue)' : 'var(--fill-2)',
                border: 'none', cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >{m}</button>
          ))}
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

                const storyRootId = post.threadRoot?.id ?? post.id;
                const storyTitle = (post.threadRoot?.content ?? post.content).slice(0, 80);
                const openThreadStory = () => {
                  onOpenStory({ id: storyRootId, type: 'post', title: storyTitle });
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
                return (
                <div key={post.id}>
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
                    hasContextAbove={isReply}
                    replyingTo={isReply ? undefined : (post.replyTo?.author.handle ?? post.threadRoot?.author.handle)}
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
