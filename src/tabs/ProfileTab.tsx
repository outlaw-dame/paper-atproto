// ─── Profile Tab ────────────────────────────────────────────────────────────
// Apple Connect-inspired profile page with 6 sub-tabs.
// Own profile by default (session.did); accepts an optional actorDid prop
// for viewing other users' profiles in the future.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AppBskyFeedDefs, AppBskyActorDefs, AppBskyGraphDefs } from '@atproto/api';
import { useSessionStore } from '../store/sessionStore.js';
import { useUiStore } from '../store/uiStore.js';
import { atpCall } from '../lib/atproto/client.js';
import { mapFeedViewPost } from '../atproto/mappers.js';
import PostCard from '../components/PostCard.js';
import TranslationSettingsSheet from '../components/TranslationSettingsSheet.js';
import type { MockPost } from '../data/mockData.js';
import { formatCount, formatTime } from '../data/mockData.js';
import type { StoryEntry } from '../App.js';
import { usePostFilterResults } from '../lib/contentFilters/usePostFilterResults.js';
import { usePlatform, getButtonTokens } from '../hooks/usePlatform.js';
import {
  useMuteActor,
  useUnmuteActor,
  useBlockActor,
  useUnblockActor,
} from '../lib/atproto/queries.js';

// ─── Sub-tabs ──────────────────────────────────────────────────────────────
const PROFILE_TABS = ['Posts', 'Library', 'Media', 'Feeds', 'Starter Packs', 'Lists'] as const;
type ProfileTab = typeof PROFILE_TABS[number];

interface Props {
  onOpenStory: (e: StoryEntry) => void;
  actorDid?: string; // if omitted, shows the signed-in user
}

// ─── URL shortener ─────────────────────────────────────────────────────────
function shortenUrl(raw: string): string {
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const path = u.pathname.replace(/\/$/, '');
    const short = path.length > 20 ? path.slice(0, 18) + '…' : path || '';
    return u.hostname.replace(/^www\./, '') + short;
  } catch {
    return raw.length > 30 ? raw.slice(0, 28) + '…' : raw;
  }
}

// ─── Bio text (linkified hashtags + URLs) ──────────────────────────────────
const BIO_SEGMENT_RE = /(https?:\/\/[^\s]+|#[\w]+)/g;

function BioText({ text, onHashtagClick }: { text: string; onHashtagClick?: (tag: string) => void }) {
  const segments = useMemo(() => {
    const parts: { key: number; type: 'text' | 'url' | 'tag'; value: string }[] = [];
    let last = 0, match: RegExpExecArray | null, i = 0;
    BIO_SEGMENT_RE.lastIndex = 0;
    while ((match = BIO_SEGMENT_RE.exec(text)) !== null) {
      if (match.index > last) parts.push({ key: i++, type: 'text', value: text.slice(last, match.index) });
      const v = match[0];
      parts.push({ key: i++, type: v.startsWith('#') ? 'tag' : 'url', value: v });
      last = match.index + v.length;
    }
    if (last < text.length) parts.push({ key: i++, type: 'text', value: text.slice(last) });
    return parts;
  }, [text]);

  return (
    <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--label-2)', textAlign: 'center', padding: '10px 24px 0', maxWidth: 340 }}>
      {segments.map(({ key, type, value }) => {
        if (type === 'tag') return (
          <span key={key} onClick={() => onHashtagClick?.(value.slice(1))} style={{ color: 'var(--blue)', fontWeight: 600, cursor: onHashtagClick ? 'pointer' : 'default' }}>{value}</span>
        );
        if (type === 'url') return (
          <a key={key} href={value} target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--blue)', textDecoration: 'none', borderBottom: '1px solid rgba(0,122,255,0.3)' }}>
            {shortenUrl(value)}
          </a>
        );
        return <React.Fragment key={key}>{value}</React.Fragment>;
      })}
    </p>
  );
}

// ─── Spinner ───────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2.5} strokeLinecap="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
        </path>
      </svg>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '56px 24px', gap: 10 }}>
      <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--label-3)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <p style={{ fontSize: 14, color: 'var(--label-3)', textAlign: 'center', lineHeight: 1.4 }}>{message}</p>
    </div>
  );
}

// ─── Stats pill ────────────────────────────────────────────────────────────
function StatItem({ count, label }: { count: number; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums' }}>
        {formatCount(count)}
      </span>
      <span style={{ fontSize: 12, color: 'var(--label-3)', fontWeight: 500, letterSpacing: 0.1 }}>{label}</span>
    </div>
  );
}

// ─── Feed row (used in Library) ────────────────────────────────────────────
function FeedRow({ feed, index }: { feed: AppBskyFeedDefs.GeneratorView; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
        padding: '12px 16px', background: 'var(--surface)', borderRadius: 16,
        marginBottom: 8, boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: 14, overflow: 'hidden', flexShrink: 0,
        background: 'linear-gradient(135deg, rgba(0,122,255,0.15) 0%, rgba(90,200,250,0.15) 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {feed.avatar
          ? <img src={feed.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 22 }}>⚡</span>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.3, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {feed.displayName}
        </p>
        <p style={{ fontSize: 12, color: 'var(--label-3)' }}>
          {formatCount(feed.likeCount ?? 0)} likes
          {feed.description ? ` · ${feed.description.slice(0, 48)}` : ''}
        </p>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--label-4)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </motion.div>
  );
}

// ─── List row ──────────────────────────────────────────────────────────────
function ListRow({ list, index }: { list: AppBskyGraphDefs.ListView; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
        padding: '12px 16px', background: 'var(--surface)', borderRadius: 16,
        marginBottom: 8, boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: 14, overflow: 'hidden', flexShrink: 0,
        background: 'linear-gradient(135deg, rgba(175,82,222,0.15) 0%, rgba(90,200,250,0.12) 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {list.avatar
          ? <img src={list.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.3, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {list.name}
        </p>
        <p style={{ fontSize: 12, color: 'var(--label-3)' }}>
          {list.listItemCount != null ? `${formatCount(list.listItemCount)} members` : 'List'}
          {list.description ? ` · ${list.description.slice(0, 48)}` : ''}
        </p>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--label-4)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </motion.div>
  );
}

// ─── Media grid ────────────────────────────────────────────────────────────
function MediaGrid({ posts }: { posts: MockPost[] }) {
  const mediaPosts = posts.filter(p => p.media && p.media.length > 0);
  if (mediaPosts.length === 0) return <EmptyState message="No photos or videos yet." />;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, margin: '0 -12px' }}>
      {mediaPosts.map((post, i) => (
        <motion.div
          key={post.id}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.03 }}
          style={{
            position: 'relative', paddingTop: '100%',
            background: 'var(--fill-3)', overflow: 'hidden', cursor: 'pointer',
          }}
        >
          <img
            src={post.media![0].url}
            alt={post.media![0].alt ?? ''}
            loading="lazy"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {post.media!.length > 1 && (
            <div style={{
              position: 'absolute', top: 6, right: 6,
              background: 'rgba(0,0,0,0.5)', borderRadius: 6,
              padding: '2px 6px', color: '#fff', fontSize: 10, fontWeight: 700,
            }}>
              +{post.media!.length - 1}
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

// ─── Liked post row (Library tab) ─────────────────────────────────────────
function LikedPostRow({ post, index, onOpenStory }: { post: MockPost; index: number; onOpenStory: (e: StoryEntry) => void }) {
  const thumbUrl = post.media?.[0]?.url ?? (post.embed?.type === 'external' ? (post.embed as any).thumb : null);
  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName })}
      style={{
        width: '100%', textAlign: 'left', background: 'var(--surface)', borderRadius: 16,
        padding: 0, marginBottom: 8, overflow: 'hidden', display: 'flex', flexDirection: 'row',
        border: 'none', cursor: 'pointer', boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
        alignItems: 'stretch',
      }}
    >
      <div style={{ flex: 1, padding: '12px 14px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', background: 'var(--fill-2)', flexShrink: 0 }}>
            {post.author.avatar
              ? <img src={post.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--blue)', color: '#fff', fontSize: 9, fontWeight: 700 }}>{post.author.displayName[0]}</div>
            }
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {post.author.displayName}
          </span>
          <span style={{ fontSize: 11, color: 'var(--label-4)', flexShrink: 0 }}>{formatTime(post.createdAt)}</span>
        </div>
        <p style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, letterSpacing: -0.2, color: 'var(--label-1)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {post.content}
        </p>
        <p style={{ fontSize: 11, color: 'var(--label-3)', marginTop: 7 }}>{formatCount(post.likeCount)} likes · {formatCount(post.replyCount)} replies</p>
      </div>
      {thumbUrl && (
        <div style={{ width: 80, flexShrink: 0, overflow: 'hidden' }}>
          <img src={thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      )}
    </motion.button>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function ProfileTab({ onOpenStory, actorDid }: Props) {
  const { agent, session, profile: sessionProfile } = useSessionStore();
  const { openSearchStory, setTab: setAppTab } = useUiStore();
  const platform = usePlatform();
  const btnTokens = getButtonTokens(platform);
  const touchLike = platform.isMobile || platform.prefersCoarsePointer || platform.hasAnyCoarsePointer;
  const did = actorDid ?? session?.did ?? '';
  const isOwnProfile = !actorDid || actorDid === session?.did;

  const [tab, setTab] = useState<ProfileTab>('Posts');
  const [profile, setProfile] = useState<AppBskyActorDefs.ProfileViewDetailed | null>(
    isOwnProfile ? sessionProfile : null
  );

  // Tab data
  const [posts, setPosts]       = useState<MockPost[]>([]);
  const [likedPosts, setLiked]  = useState<MockPost[]>([]);
  const [feeds, setFeeds]       = useState<AppBskyFeedDefs.GeneratorView[]>([]);
  const [lists, setLists]       = useState<AppBskyGraphDefs.ListView[]>([]);
  const [loading, setLoading]   = useState(false);
  const [profileLoading, setProfileLoading] = useState(!isOwnProfile || !sessionProfile);
  const [showTranslationSettings, setShowTranslationSettings] = useState(false);
  const [revealedFilteredPosts, setRevealedFilteredPosts] = useState<Record<string, boolean>>({});
  const [viewerMutedOverride, setViewerMutedOverride] = useState<boolean | null>(null);
  const [viewerBlockedOverride, setViewerBlockedOverride] = useState<boolean | null>(null);

  const muteActor = useMuteActor();
  const unmuteActor = useUnmuteActor();
  const blockActor = useBlockActor();
  const unblockActor = useUnblockActor();

  const tabBarRef = useRef<HTMLDivElement>(null);

  // Reset content when switching to a different user
  useEffect(() => {
    setPosts([]);
    setLiked([]);
    setFeeds([]);
    setLists([]);
    setProfile(isOwnProfile ? sessionProfile : null);
    setTab('Posts');
    setViewerMutedOverride(null);
    setViewerBlockedOverride(null);
  }, [did]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load profile ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!did) return;
    if (isOwnProfile && sessionProfile) { setProfile(sessionProfile); return; }
    setProfileLoading(true);
    atpCall(s => agent.getProfile({ actor: did }))
      .then(res => setProfile(res.data))
      .catch(() => {})
      .finally(() => setProfileLoading(false));
  }, [did, isOwnProfile, sessionProfile, agent]);

  // ── Load posts ─────────────────────────────────────────────────────────────
  const loadPosts = useCallback(async () => {
    if (!did) return;
    setLoading(true);
    try {
      const res = await atpCall(s => agent.getAuthorFeed({ actor: did, limit: 30 }));
      setPosts(res.data.feed.filter(i => (i.post.record as any)?.text).map(mapFeedViewPost));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agent, did]);

  // ── Load liked posts (Library) ─────────────────────────────────────────────
  const loadLiked = useCallback(async () => {
    if (!did) return;
    setLoading(true);
    try {
      const res = await atpCall(s => agent.getActorLikes({ actor: did, limit: 40 }));
      setLiked(res.data.feed.filter(i => (i.post.record as any)?.text).map(mapFeedViewPost));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agent, did]);

  // ── Load feeds ────────────────────────────────────────────────────────────
  const loadFeeds = useCallback(async () => {
    if (!did) return;
    setLoading(true);
    try {
      const res = await atpCall(s => agent.app.bsky.feed.getActorFeeds({ actor: did, limit: 50 }));
      setFeeds(res.data.feeds);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agent, did]);

  // ── Load lists ────────────────────────────────────────────────────────────
  const loadLists = useCallback(async () => {
    if (!did) return;
    setLoading(true);
    try {
      const res = await atpCall(s => agent.app.bsky.graph.getLists({ actor: did, limit: 50 }));
      setLists(res.data.lists);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agent, did]);

  useEffect(() => {
    if (tab === 'Posts' || tab === 'Media') loadPosts();
    else if (tab === 'Library') loadLiked();
    else if (tab === 'Feeds') loadFeeds();
    else if (tab === 'Lists') loadLists();
    // Starter Packs: load when API is available
  }, [tab, loadPosts, loadLiked, loadFeeds, loadLists]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleToggleRepost = useCallback(async (p: MockPost) => {
    // Similar to HomeTab
  }, [agent, session]);

  const handleToggleLike = useCallback(async (p: MockPost) => {
    // Similar to HomeTab
  }, [agent, session]);

  const handleBookmark = useCallback(async (p: MockPost) => {
    // Placeholder
  }, []);

  const handleMore = useCallback((p: MockPost) => {
    // Placeholder
  }, []);

  // Scroll active sub-tab into view
  const scrollTabIntoView = (idx: number) => {
    const bar = tabBarRef.current;
    if (!bar) return;
    const btn = bar.children[idx] as HTMLElement | undefined;
    btn?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  // ── Render sub-tab content ─────────────────────────────────────────────────
  const profileVisiblePool = useMemo(() => {
    const merged = [...posts, ...likedPosts];
    const byId = new Map<string, MockPost>();
    for (const p of merged) byId.set(p.id, p);
    return [...byId.values()];
  }, [posts, likedPosts]);
  const filterResults = usePostFilterResults(profileVisiblePool, 'profile');

  function renderContent() {
    if (loading) return <Spinner />;

    switch (tab) {
      case 'Posts':
        return posts.filter((p) => !((filterResults[p.id] ?? []).some((m) => m.action === 'hide'))).length === 0
          ? <EmptyState message="No posts yet." />
          : posts.map((p, i) => {
              const matches = filterResults[p.id] ?? [];
              const isHidden = matches.some((m) => m.action === 'hide');
              const isWarned = matches.some((m) => m.action === 'warn');
              const isRevealed = !!revealedFilteredPosts[p.id];
              if (isHidden) return null;
              if (isWarned && !isRevealed) {
                const titles = [...new Set(matches.filter((m) => m.action === 'warn').map((m) => m.phrase))];
                return (
                  <div key={p.id} style={{ border: '1px solid var(--sep)', borderRadius: 12, padding: '10px 12px', marginBottom: 8, background: 'color-mix(in srgb, var(--surface) 90%, var(--orange) 10%)' }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-2)', marginBottom: 6 }}>
                      Matches filter: {titles.join(', ')}
                    </p>
                    <button onClick={() => setRevealedFilteredPosts((prev) => ({ ...prev, [p.id]: true }))} style={{ border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 12, fontWeight: 700, padding: 0, cursor: 'pointer' }}>
                      Show post
                    </button>
                  </div>
                );
              }
              return <PostCard key={p.id} post={p} onOpenStory={onOpenStory} onToggleRepost={handleToggleRepost} onToggleLike={handleToggleLike} onBookmark={handleBookmark} onMore={handleMore} index={i} />;
            });

      case 'Library':
        return likedPosts.filter((p) => !((filterResults[p.id] ?? []).some((m) => m.action === 'hide'))).length === 0
          ? <EmptyState message="Liked posts will appear here." />
          : likedPosts.map((p, i) => {
              const matches = filterResults[p.id] ?? [];
              const isHidden = matches.some((m) => m.action === 'hide');
              const isWarned = matches.some((m) => m.action === 'warn');
              const isRevealed = !!revealedFilteredPosts[p.id];
              if (isHidden) return null;
              if (isWarned && !isRevealed) {
                const titles = [...new Set(matches.filter((m) => m.action === 'warn').map((m) => m.phrase))];
                return (
                  <div key={p.id} style={{ border: '1px solid var(--sep)', borderRadius: 12, padding: '10px 12px', marginBottom: 8, background: 'color-mix(in srgb, var(--surface) 90%, var(--orange) 10%)' }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-2)', marginBottom: 6 }}>
                      Matches filter: {titles.join(', ')}
                    </p>
                    <button onClick={() => setRevealedFilteredPosts((prev) => ({ ...prev, [p.id]: true }))} style={{ border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 12, fontWeight: 700, padding: 0, cursor: 'pointer' }}>
                      Show post
                    </button>
                  </div>
                );
              }
              return <LikedPostRow key={p.id} post={p} index={i} onOpenStory={onOpenStory} />;
            });

      case 'Media':
        return <MediaGrid posts={posts.filter((p) => !((filterResults[p.id] ?? []).some((m) => m.action === 'hide')))} />;

      case 'Feeds':
        return feeds.length === 0
          ? <EmptyState message="No feeds created yet." />
          : feeds.map((f, i) => <FeedRow key={f.uri} feed={f} index={i} />);

      case 'Starter Packs':
        return <EmptyState message="Starter Packs coming soon." />;

      case 'Lists':
        return lists.length === 0
          ? <EmptyState message="No lists yet." />
          : lists.map((l, i) => <ListRow key={l.uri} list={l} index={i} />);

      default:
        return null;
    }
  }

  const displayName = profile?.displayName ?? profile?.handle ?? session?.handle ?? '';
  const handle = profile?.handle ?? session?.handle ?? '';
  const bio = profile?.description ?? '';
  const followersCount = profile?.followersCount ?? 0;
  const followsCount   = profile?.followsCount ?? 0;
  const postsCount     = profile?.postsCount ?? 0;
  const isMuted = viewerMutedOverride ?? !!profile?.viewer?.muted;
  const isBlocked = viewerBlockedOverride ?? !!profile?.viewer?.blocking;

  function handleToggleMute() {
    if (!did || isOwnProfile) return;
    if (isMuted) {
      unmuteActor.mutate(
        { did },
        {
          onSuccess: () => setViewerMutedOverride(false),
        },
      );
      return;
    }
    muteActor.mutate(
      { did, durationMs: null },
      {
        onSuccess: () => setViewerMutedOverride(true),
      },
    );
  }

  function handleToggleBlock() {
    if (!did || isOwnProfile) return;
    if (isBlocked) {
      unblockActor.mutate(
        { did },
        {
          onSuccess: () => setViewerBlockedOverride(false),
        },
      );
      return;
    }
    blockActor.mutate(
      { did },
      {
        onSuccess: () => setViewerBlockedOverride(true),
      },
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>

      {/* ── Nav bar ───────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        paddingTop: 'var(--safe-top)',
        background: 'var(--chrome-bg)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '0.5px solid var(--sep)',
        zIndex: 10,
      }}>
        <div style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center',
          padding: '12px 16px 10px', minHeight: 44,
        }}>
          {/* Left — empty or back button */}
          <div style={{ width: 36, flexShrink: 0 }}>
            {!isOwnProfile && (
              <button onClick={() => setAppTab('home')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--blue)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
            )}
          </div>

          {/* Center — handle */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.3 }}>
              {handle ? `@${handle.replace('.bsky.social', '')}` : 'Profile'}
            </span>
          </div>

          {/* Right — settings */}
          <div style={{ width: 36, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              aria-label="Settings"
              onClick={() => setShowTranslationSettings(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--label-2)' }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div className="scroll-y" style={{ flex: 1 }}>

        {/* ── Profile header ──────────────────────────────────────────────── */}
        {profileLoading ? (
          <Spinner />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
            style={{ background: 'var(--surface)', paddingBottom: 0 }}
          >
            {/* ── Banner ── */}
            <div style={{ position: 'relative', width: '100%', height: 130, background: 'var(--fill-3)', overflow: 'hidden' }}>
              {profile?.banner
                ? <img src={profile.banner} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, var(--blue) 0%, var(--indigo) 60%, rgba(90,200,250,0.6) 100%)' }} />
              }
            </div>

            {/* Banner / avatar area */}
            <div style={{ position: 'relative', paddingTop: 0, paddingBottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

              {/* Avatar — overlaps banner */}
              <div style={{
                width: 80, height: 80, borderRadius: '50%',
                overflow: 'hidden', background: 'var(--fill-2)',
                border: '3.5px solid var(--surface)',
                boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
                flexShrink: 0,
                marginTop: -40, marginBottom: 10,
                position: 'relative', zIndex: 2,
              }}>
                {profile?.avatar
                  ? <img src={profile.avatar} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (
                    <div style={{
                      width: '100%', height: '100%', display: 'flex', alignItems: 'center',
                      justifyContent: 'center',
                      background: 'linear-gradient(135deg, var(--blue) 0%, var(--indigo) 100%)',
                      color: '#fff', fontSize: 30, fontWeight: 700,
                    }}>
                      {displayName[0]?.toUpperCase() ?? '?'}
                    </div>
                  )
                }
                
                {/* Live badge */}
                {(profile as any)?.status?.["com.atproto.server#userStatus"]?.status === 'LIVE' && (
                  <div style={{
                    position: 'absolute', bottom: 0, right: 0,
                    width: 28, height: 28,
                    background: '#FF0000', borderRadius: '50%',
                    border: '2.5px solid white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: 'white',
                  }}>
                    ●
                  </div>
                )}
              </div>

              {/* Name */}
              <h1 style={{
                fontSize: 22, fontWeight: 800, color: 'var(--label-1)',
                letterSpacing: -0.6, margin: 0, lineHeight: 1.15,
              }}>
                {displayName}
              </h1>

              {/* Handle */}
              <p style={{ fontSize: 14, color: 'var(--label-3)', marginTop: 3, fontWeight: 500 }}>
                @{handle.replace('.bsky.social', '')}
              </p>

              {/* Bio — linkified */}
              {bio && <BioText text={bio} onHashtagClick={tag => openSearchStory(tag)} />}

              {/* Stats row */}
              <div style={{
                display: 'flex', flexDirection: 'row', alignItems: 'center',
                gap: 0, marginTop: 18, width: '100%',
                borderTop: '0.5px solid var(--sep)', borderBottom: '0.5px solid var(--sep)',
              }}>
                {[
                  { count: postsCount, label: 'Posts' },
                  { count: followsCount, label: 'Following' },
                  { count: followersCount, label: 'Followers' },
                ].map((stat, i, arr) => (
                  <React.Fragment key={stat.label}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 0' }}>
                      <StatItem count={stat.count} label={stat.label} />
                    </div>
                    {i < arr.length - 1 && (
                      <div style={{ width: 0.5, height: 32, background: 'var(--sep)' }} />
                    )}
                  </React.Fragment>
                ))}
              </div>

              {/* Action buttons */}
              <div style={{
                display: 'flex', flexDirection: 'row', gap: 10,
                flexWrap: !isOwnProfile && touchLike ? 'wrap' : 'nowrap',
                padding: `${platform.isMobile ? 16 : 14}px 16px`,
                width: '100%', boxSizing: 'border-box',
              }}>
                {isOwnProfile ? (
                  <>
                    <button style={{
                      flex: 1,
                      height: btnTokens.height,
                      borderRadius: btnTokens.borderRadius,
                      background: 'var(--fill-2)',
                      border: 'none', cursor: 'pointer',
                      fontSize: btnTokens.fontSize,
                      fontWeight: btnTokens.fontWeight,
                      color: 'var(--label-1)',
                      letterSpacing: -0.2,
                      WebkitTapHighlightColor: 'transparent',
                      transition: 'opacity 0.12s',
                    }}>
                      Edit Profile
                    </button>
                    <button style={{
                      flex: 1,
                      height: btnTokens.height,
                      borderRadius: btnTokens.borderRadius,
                      background: 'var(--fill-2)',
                      border: 'none', cursor: 'pointer',
                      fontSize: btnTokens.fontSize,
                      fontWeight: btnTokens.fontWeight,
                      color: 'var(--label-1)',
                      letterSpacing: -0.2,
                      WebkitTapHighlightColor: 'transparent',
                      transition: 'opacity 0.12s',
                    }}>
                      Share Profile
                    </button>
                  </>
                ) : (
                  <>
                    <button style={{
                      flex: 1,
                      minWidth: !isOwnProfile && touchLike ? 'calc(50% - 5px)' : undefined,
                      height: btnTokens.height,
                      borderRadius: btnTokens.borderRadius,
                      background: 'var(--blue)',
                      border: 'none', cursor: 'pointer',
                      fontSize: btnTokens.fontSize,
                      fontWeight: btnTokens.fontWeight,
                      color: '#fff',
                      letterSpacing: -0.2,
                      WebkitTapHighlightColor: 'transparent',
                      transition: 'opacity 0.12s',
                    }}>
                      Follow
                    </button>
                    <button style={{
                      flex: 1,
                      minWidth: !isOwnProfile && touchLike ? 'calc(50% - 5px)' : undefined,
                      height: btnTokens.height,
                      borderRadius: btnTokens.borderRadius,
                      background: 'var(--fill-2)',
                      border: 'none', cursor: 'pointer',
                      fontSize: btnTokens.fontSize,
                      fontWeight: btnTokens.fontWeight,
                      color: 'var(--label-1)',
                      letterSpacing: -0.2,
                      WebkitTapHighlightColor: 'transparent',
                      transition: 'opacity 0.12s',
                      opacity: muteActor.isPending || unmuteActor.isPending ? 0.65 : 1,
                    }}>
                      Message
                    </button>
                    <button
                      onClick={handleToggleMute}
                      disabled={muteActor.isPending || unmuteActor.isPending}
                      style={{
                        flex: 1,
                        minWidth: !isOwnProfile && touchLike ? 'calc(50% - 5px)' : undefined,
                        height: btnTokens.height,
                        borderRadius: btnTokens.borderRadius,
                        background: isMuted ? 'color-mix(in srgb, var(--orange) 18%, var(--fill-2))' : 'var(--fill-2)',
                        border: 'none', cursor: 'pointer',
                        fontSize: btnTokens.fontSize,
                        fontWeight: btnTokens.fontWeight,
                        color: isMuted ? 'var(--orange)' : 'var(--label-1)',
                        letterSpacing: -0.2,
                        WebkitTapHighlightColor: 'transparent',
                        transition: 'opacity 0.12s',
                        opacity: muteActor.isPending || unmuteActor.isPending ? 0.65 : 1,
                      }}
                    >
                      {isMuted ? 'Unmute' : 'Mute'}
                    </button>
                    <button
                      onClick={handleToggleBlock}
                      disabled={blockActor.isPending || unblockActor.isPending}
                      style={{
                        flex: 1,
                        minWidth: !isOwnProfile && touchLike ? 'calc(50% - 5px)' : undefined,
                        height: btnTokens.height,
                        borderRadius: btnTokens.borderRadius,
                        background: isBlocked ? 'color-mix(in srgb, var(--red) 18%, var(--fill-2))' : 'var(--fill-2)',
                        border: 'none', cursor: 'pointer',
                        fontSize: btnTokens.fontSize,
                        fontWeight: btnTokens.fontWeight,
                        color: isBlocked ? 'var(--red)' : 'var(--label-1)',
                        letterSpacing: -0.2,
                        WebkitTapHighlightColor: 'transparent',
                        transition: 'opacity 0.12s',
                        opacity: blockActor.isPending || unblockActor.isPending ? 0.65 : 1,
                      }}
                    >
                      {isBlocked ? 'Unblock' : 'Block'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Sub-tab bar ─────────────────────────────────────────────────── */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 8,
          background: 'var(--chrome-bg)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderBottom: '0.5px solid var(--sep)',
        }}>
          <div
            ref={tabBarRef}
            style={{
              display: 'flex', flexDirection: 'row',
              overflowX: 'auto', scrollbarWidth: 'none',
              padding: '0 4px',
              WebkitOverflowScrolling: 'touch' as any,
            }}
          >
            {PROFILE_TABS.map((t, i) => {
              const active = tab === t;
              return (
                <button
                  key={t}
                  onClick={() => { setTab(t); scrollTabIntoView(i); }}
                  style={{
                    flexShrink: 0,
                    minHeight: touchLike ? 44 : 40,
                    padding: touchLike ? '14px 16px 12px' : '13px 14px 11px',
                    border: 'none', background: 'none', cursor: 'pointer',
                    fontSize: touchLike ? 15 : 14,
                    fontWeight: active ? 700 : 500,
                    color: active ? 'var(--blue)' : 'var(--label-3)',
                    letterSpacing: -0.2,
                    position: 'relative',
                    transition: 'color 0.15s',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {t}
                  {active && (
                    <motion.div
                      layoutId="profile-tab-indicator"
                      style={{
                        position: 'absolute', bottom: 0, left: 10, right: 10,
                        height: 2, borderRadius: 2, background: 'var(--blue)',
                      }}
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Tab content ─────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
            style={{
              padding: tab === 'Media' ? '2px 12px 0' : '12px 12px 0',
            }}
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>

        {/* Safe area bottom padding */}
        <div style={{ height: 32 }} />
      </div>

      <TranslationSettingsSheet open={showTranslationSettings} onClose={() => setShowTranslationSettings(false)} />
    </div>
  );
}
