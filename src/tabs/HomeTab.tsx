import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import PostCard from '../components/PostCard';
import ContextPost from '../components/ContextPost';
import { useSessionStore } from '../store/sessionStore';
import { mapFeedViewPost } from '../atproto/mappers';
import { atpCall } from '../lib/atproto/client';
import { qk } from '../lib/atproto/queries';
import type { MockPost } from '../data/mockData';
import type { StoryEntry } from '../App';

interface Props {
  onOpenStory: (e: StoryEntry) => void;
}

const MODES = ['Following', 'Discover', 'Feeds'] as const;
type Mode = typeof MODES[number];

const DISCOVER_FEED_URI = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';

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
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('Following');
  const [posts, setPosts] = useState<MockPost[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchFeed = useCallback(async (m: Mode, cur?: string) => {
    if (!session) return;
    const isInitial = !cur;
    if (isInitial) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      let feed: any[] = [];
      let nextCursor: string | undefined;

      if (m === 'Following') {
        const res = await atpCall(s => agent.getTimeline({ limit: 30, cursor: cur }));
        feed = res.data.feed;
        nextCursor = res.data.cursor;
      } else if (m === 'Discover') {
        const res = await atpCall(s => agent.app.bsky.feed.getFeed({ feed: DISCOVER_FEED_URI, limit: 30, cursor: cur }));
        feed = res.data.feed;
        nextCursor = res.data.cursor;
      } else {
        const res = await atpCall(s => agent.getAuthorFeed({ actor: session.did, limit: 30, cursor: cur }));
        feed = res.data.feed;
        nextCursor = res.data.cursor;
      }

      const mapped = feed
        .filter((item: any) => item.post?.record?.text !== undefined)
        .map(mapFeedViewPost);

      if (isInitial) {
        setPosts(mapped);
        scrollRef.current?.scrollTo({ top: 0 });
      } else {
        setPosts(prev => [...prev, ...mapped]);
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
          <button
            aria-label="Refresh"
            onClick={() => fetchFeed(mode)}
            style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--label-2)', border: 'none', cursor: 'pointer' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
          </button>
        </div>

        {/* Mode pills */}
        <div style={{ display: 'flex', flexDirection: 'row', padding: '0 16px 12px', gap: 8 }}>
          {MODES.map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '6px 14px', borderRadius: 100,
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
              {posts.map((post, i) => (
                <div key={post.id} style={{ borderBottom: '1px solid var(--stroke-light)', paddingBottom: 12, marginBottom: 12 }}>
                  {post.threadRoot && <ContextPost post={post.threadRoot} type="thread" />}
                  {/* Only show direct parent if it's not the same as the thread root */}
                  {post.replyTo && post.replyTo.id !== post.threadRoot?.id && <ContextPost post={post.replyTo} type="reply" />}
                  <PostCard post={post} onOpenStory={onOpenStory} index={i} />
                </div>
              ))}
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
    </div>
  );
}
