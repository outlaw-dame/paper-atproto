// ─── Explore Landing — Discovery Mode ────────────────────────────────────
// Glympse Core Wireframe Spec v1 — Screen 1
// Dark, cinematic, Gist-derived discovery foyer.
//
// Structure (top to bottom):
//   TopBar → HeroTitleBlock → SearchHeroField → QuickFilterRow
//   → FeaturedSearchStoryCard → TrendingTopicsRow → LiveClustersSection
//   → FeedsAndPacksRow → SourcesAndDomainsRow

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSessionStore } from '../store/sessionStore';
import { atpCall, atpMutate } from '../lib/atproto/client';
import { mapFeedViewPost } from '../atproto/mappers';
import type { MockPost } from '../data/mockData';
import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';
import type { StoryEntry } from '../App';
import { useUiStore } from '../store/uiStore';
import {
  searchHeroField as shfTokens,
  quickFilterChip as qfcTokens,
  featuredStoryCard as fscTokens,
  trendingTopicCard as ttcTokens,
  liveClusterCard as lccTokens,
  overviewCard,
  discovery as disc,
  accent,
  type as typeScale,
  radius,
  space,
  shadowDark,
  transitions,
  fadeVariants,
  slideUpVariants,
} from '../design';

interface Props {
  onOpenStory: (e: StoryEntry) => void;
}

// ─── Discovery phrases ────────────────────────────────────────────────────
const DISCOVERY_PHRASES = [
  "What's happening",
  "Explore the conversation",
  "Find what matters",
];

const QUICK_FILTERS = ['Live', 'Topics', 'Threads', 'Feeds', 'Packs', 'Sources'] as const;
type QuickFilter = typeof QUICK_FILTERS[number];

// ─── Shared sub-components ────────────────────────────────────────────────

function DiscoverySpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={2} strokeLinecap="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
        </path>
      </svg>
    </div>
  );
}

function SynopsisChip({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: radius.full,
      background: overviewCard.synopsisChip.bg,
      border: `0.5px solid ${overviewCard.synopsisChip.border}`,
      color: overviewCard.synopsisChip.text,
      fontSize: typeScale.metaLg[0], lineHeight: `${typeScale.metaLg[1]}px`,
      fontWeight: typeScale.metaLg[2], letterSpacing: typeScale.metaLg[3],
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#7CE9FF', flexShrink: 0 }} />
      {label}
    </span>
  );
}

// ─── FeaturedSearchStoryCard ──────────────────────────────────────────────
function FeaturedSearchStoryCard({ post, onTap }: { post: MockPost; onTap: () => void }) {
  const img = post.images?.[0] ?? post.embed?.thumbnail;
  const domain = post.embed?.url ? (() => { try { return new URL(post.embed!.url!).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '';

  return (
    <motion.div
      whileTap={{ scale: 0.985 }}
      onClick={onTap}
      style={{
        borderRadius: fscTokens.radius,
        overflow: 'hidden',
        background: fscTokens.bg,
        boxShadow: fscTokens.shadow,
        cursor: 'pointer',
        border: `0.5px solid ${disc.lineSubtle}`,
      }}
    >
      {/* Hero media */}
      <div style={{ height: fscTokens.mediaHeight, background: disc.surfaceFocus, overflow: 'hidden', position: 'relative' }}>
        {img
          ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{
              width: '100%', height: '100%',
              background: `radial-gradient(circle at 30% 50%, rgba(91,124,255,0.3), transparent 60%), ${disc.surfaceCard2}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} strokeLinecap="round">
                <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/>
                <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
              </svg>
            </div>
        }
        {/* Gradient scrim */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 40%, rgba(18,24,36,0.7) 100%)' }} />
      </div>

      {/* Content */}
      <div style={{ padding: `${space[8]}px ${space[10]}px ${space[10]}px` }}>
        <div style={{ marginBottom: 8 }}>
          <SynopsisChip label="Glympse Synopsis" />
        </div>
        <p style={{
          fontSize: typeScale.titleMd[0], lineHeight: `${typeScale.titleMd[1]}px`,
          fontWeight: typeScale.titleMd[2], letterSpacing: typeScale.titleMd[3],
          color: disc.textPrimary, marginBottom: 8,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {post.content}
        </p>
        <p style={{
          fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
          fontWeight: typeScale.bodySm[2],
          color: disc.textSecondary, marginBottom: 12,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {post.embed?.description ?? post.content}
        </p>

        {/* Source strip */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: `${space[4]}px ${space[6]}px`,
          background: overviewCard.sourceStrip.bg,
          borderRadius: radius[12],
        }}>
          <div style={{ width: 20, height: 20, borderRadius: 6, background: disc.surfaceFocus, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={overviewCard.sourceStrip.iconTint} strokeWidth={2} strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
            </svg>
          </div>
          <span style={{
            fontSize: typeScale.metaSm[0], lineHeight: `${typeScale.metaSm[1]}px`,
            fontWeight: typeScale.metaSm[2], letterSpacing: typeScale.metaSm[3],
            color: overviewCard.sourceStrip.text,
          }}>
            {domain || `@${post.author.handle}`}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: disc.textTertiary }}>→</span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── TrendingTopicCard ────────────────────────────────────────────────────
function TrendingTopicCard({ topic, signal, onTap }: { topic: string; signal: string; onTap: () => void }) {
  return (
    <motion.div
      whileTap={{ scale: 0.96 }}
      onClick={onTap}
      style={{
        flexShrink: 0,
        width: ttcTokens.width, height: ttcTokens.height,
        borderRadius: ttcTokens.radius,
        background: ttcTokens.bg,
        padding: `${ttcTokens.padding}px`,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        cursor: 'pointer',
        border: `0.5px solid ${disc.lineSubtle}`,
      }}
    >
      <p style={{
        fontSize: typeScale.chip[0], lineHeight: `${typeScale.chip[1]}px`,
        fontWeight: typeScale.chip[2],
        color: disc.textPrimary,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{topic}</p>
      <span style={{
        fontSize: typeScale.metaSm[0], lineHeight: `${typeScale.metaSm[1]}px`,
        fontWeight: typeScale.metaSm[2], letterSpacing: typeScale.metaSm[3],
        color: accent.cyan400,
      }}>{signal}</span>
    </motion.div>
  );
}

// ─── LiveClusterCard ──────────────────────────────────────────────────────
function LiveClusterCard({ title, summary, count, onTap }: { title: string; summary: string; count: number; onTap: () => void }) {
  return (
    <motion.div
      whileTap={{ scale: 0.985 }}
      onClick={onTap}
      style={{
        borderRadius: lccTokens.radius,
        background: lccTokens.bg,
        padding: `${lccTokens.padding}px`,
        boxShadow: lccTokens.shadow,
        border: `0.5px solid ${disc.lineSubtle}`,
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}
    >
      <p style={{
        fontSize: typeScale.titleSm[0], lineHeight: `${typeScale.titleSm[1]}px`,
        fontWeight: typeScale.titleSm[2], letterSpacing: typeScale.titleSm[3],
        color: disc.textPrimary,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{title}</p>
      <p style={{
        fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
        fontWeight: typeScale.bodySm[2],
        color: disc.textSecondary,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{summary}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary, fontWeight: 500 }}>
          {count} active threads
        </span>
        <div style={{ flex: 1 }} />
        <span style={{
          padding: '3px 10px', borderRadius: radius.full,
          background: 'rgba(91,124,255,0.15)', color: accent.primary,
          fontSize: typeScale.metaSm[0], fontWeight: 600,
        }}>Open Story →</span>
      </div>
    </motion.div>
  );
}

// ─── FeedCard ─────────────────────────────────────────────────────────────
function FeedCard({ gen, onFollow }: { gen: AppBskyFeedDefs.GeneratorView; onFollow: (uri: string) => void }) {
  const [following, setFollowing] = useState(gen.viewer?.like !== undefined);
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      style={{
        flexShrink: 0, width: 180,
        background: disc.surfaceCard2, borderRadius: radius[24],
        padding: `${space[8]}px ${space[8]}px ${space[6]}px`,
        display: 'flex', flexDirection: 'column', gap: 8,
        border: `0.5px solid ${disc.lineSubtle}`,
        cursor: 'pointer',
      }}
    >
      <div style={{ width: 40, height: 40, borderRadius: 12, overflow: 'hidden', background: disc.surfaceFocus, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {gen.avatar
          ? <img src={gen.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 20 }}>⚡</span>
        }
      </div>
      <div>
        <p style={{ fontSize: typeScale.chip[0], fontWeight: 700, color: disc.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
          {gen.displayName}
        </p>
        <p style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>
          by @{gen.creator.handle.replace('.bsky.social', '')}
        </p>
      </div>
      <button
        onClick={e => { e.stopPropagation(); setFollowing(v => !v); onFollow(gen.uri); }}
        style={{
          padding: '5px 0', borderRadius: radius[8], marginTop: 'auto',
          background: following ? disc.surfaceFocus : accent.primary,
          color: following ? disc.textSecondary : '#fff',
          fontSize: typeScale.metaLg[0], fontWeight: 600,
          border: 'none', cursor: 'pointer',
        }}
      >
        {following ? 'Following' : 'Follow'}
      </button>
    </motion.div>
  );
}

// ─── DomainCapsule ────────────────────────────────────────────────────────
function DomainCapsule({ domain, description }: { domain: string; description: string }) {
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      style={{
        flexShrink: 0, width: 160, height: 72,
        background: disc.surfaceCard2, borderRadius: radius[20],
        padding: `${space[6]}px ${space[8]}px`,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        border: `0.5px solid ${disc.lineSubtle}`,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 18, height: 18, borderRadius: 5, background: disc.surfaceFocus, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={2} strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
          </svg>
        </div>
        <span style={{ fontSize: typeScale.chip[0], fontWeight: 600, color: disc.textPrimary }}>{domain}</span>
      </div>
      <p style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{description}</p>
    </motion.div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────
function SectionHeader({ title }: { title: string }) {
  return (
    <p style={{
      fontSize: typeScale.metaLg[0], lineHeight: `${typeScale.metaLg[1]}px`,
      fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const,
      color: disc.textTertiary,
      marginBottom: space[4],
    }}>{title}</p>
  );
}

// ─── ActorRow (search results) ────────────────────────────────────────────
function ActorRow({ actor, onFollow }: { actor: AppBskyActorDefs.ProfileView; onFollow: (did: string) => void }) {
  const [following, setFollowing] = useState(actor.viewer?.following !== undefined);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: `${space[6]}px 0`,
      borderBottom: `0.5px solid ${disc.lineSubtle}`,
    }}>
      <div style={{ width: 42, height: 42, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceFocus, flexShrink: 0 }}>
        {actor.avatar
          ? <img src={actor.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: accent.indigo600, color: '#fff', fontSize: 16, fontWeight: 700 }}>
              {(actor.displayName ?? actor.handle)[0]}
            </div>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: typeScale.chip[0], fontWeight: 700, color: disc.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {actor.displayName ?? actor.handle}
        </p>
        <p style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>@{actor.handle}</p>
      </div>
      <button
        onClick={() => { setFollowing(v => !v); onFollow(actor.did); }}
        style={{
          padding: '6px 14px', borderRadius: radius.full, flexShrink: 0,
          background: following ? disc.surfaceFocus : accent.primary,
          color: following ? disc.textSecondary : '#fff',
          fontSize: typeScale.metaLg[0], fontWeight: 600,
          border: 'none', cursor: 'pointer',
        }}
      >
        {following ? 'Following' : 'Follow'}
      </button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function ExploreTab({ onOpenStory }: Props) {
  const { agent, session } = useSessionStore();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<QuickFilter | null>(null);
  const [searchPosts, setSearchPosts] = useState<MockPost[]>([]);
  const [searchActors, setSearchActors] = useState<AppBskyActorDefs.ProfileView[]>([]);
  const [suggestedFeeds, setSuggestedFeeds] = useState<AppBskyFeedDefs.GeneratorView[]>([]);
  const [suggestedActors, setSuggestedActors] = useState<AppBskyActorDefs.ProfileView[]>([]);
  const [featuredPost, setFeaturedPost] = useState<MockPost | null>(null);
  const [trendingPosts, setTrendingPosts] = useState<MockPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const phraseIdx = useRef(Math.floor(Math.random() * DISCOVERY_PHRASES.length));

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 400);
    return () => clearTimeout(t);
  }, [query]);

  // Live search
  useEffect(() => {
    if (!debouncedQuery.trim()) { setSearchPosts([]); setSearchActors([]); return; }
    if (!session) return;
    setLoading(true);
    Promise.all([
      atpCall(() => agent.app.bsky.feed.searchPosts({ q: debouncedQuery, limit: 20 })).catch(() => null),
      atpCall(() => agent.searchActors({ term: debouncedQuery, limit: 8 })).catch(() => null),
    ]).then(([postsRes, actorsRes]) => {
      if (postsRes?.data?.posts) {
        setSearchPosts(
          postsRes.data.posts
            .filter((p: any) => p?.record?.text)
            .map((p: any) => mapFeedViewPost({ post: p, reply: undefined, reason: undefined }))
        );
      }
      if (actorsRes?.data?.actors) setSearchActors(actorsRes.data.actors);
    }).finally(() => setLoading(false));
  }, [debouncedQuery, agent, session]);

  // Discover content
  useEffect(() => {
    if (!session) return;
    setDiscoverLoading(true);
    Promise.all([
      atpCall(() => agent.app.bsky.feed.getSuggestedFeeds({ limit: 10 })).catch(() => null),
      atpCall(() => agent.getSuggestions({ limit: 10 })).catch(() => null),
      atpCall(() => agent.app.bsky.feed.searchPosts({ q: 'technology OR science OR culture', limit: 12 })).catch(() => null),
    ]).then(([feedsRes, actorsRes, postsRes]) => {
      if (feedsRes?.data?.feeds) setSuggestedFeeds(feedsRes.data.feeds);
      if (actorsRes?.data?.actors) setSuggestedActors(actorsRes.data.actors);
      if (postsRes?.data?.posts?.length) {
        const mapped = postsRes.data.posts
          .filter((p: any) => p?.record?.text)
          .map((p: any) => mapFeedViewPost({ post: p, reply: undefined, reason: undefined }));
        setFeaturedPost(mapped[0] ?? null);
        setTrendingPosts(mapped.slice(1, 6));
      }
    }).finally(() => setDiscoverLoading(false));
  }, [agent, session]);

  const handleFollow = useCallback(async (did: string) => {
    if (!session) return;
    await atpMutate(() => agent.follow(did));
  }, [agent, session]);

  const handleFollowFeed = useCallback(async (uri: string) => {
    // Feed like/follow via ATProto
  }, []);

  const isSearching = debouncedQuery.trim().length > 0;

  // ─── Trending topics derived from posts ─────────────────────────────────
  const trendingTopics = trendingPosts.flatMap(p =>
    (p.content.match(/#\w+/g) ?? []).slice(0, 2)
  ).filter((v, i, a) => a.indexOf(v) === i).slice(0, 8);

  // ─── Live clusters from suggestedActors (placeholder) ───────────────────
  const liveClusters = suggestedActors.slice(0, 3).map(a => ({
    title: a.displayName ?? a.handle,
    summary: a.description ?? 'Active discussion happening now',
    count: Math.floor(Math.random() * 40) + 5,
    id: a.did,
  }));

  // ─── Domains from trending posts ────────────────────────────────────────
  const domains = trendingPosts
    .filter(p => p.embed?.url)
    .map(p => {
      try {
        const h = new URL(p.embed!.url!).hostname.replace(/^www\./, '');
        return { domain: h, description: p.embed?.title ?? 'Source' };
      } catch { return null; }
    })
    .filter(Boolean)
    .filter((v, i, a) => a.findIndex(x => x?.domain === v?.domain) === i)
    .slice(0, 6) as { domain: string; description: string }[];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: disc.bgBase,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Atmospheric background */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: disc.bgAtmosphere,
      }} />

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative', zIndex: 2,
        flexShrink: 0,
        paddingTop: 'calc(var(--safe-top) + 8px)',
        padding: 'calc(var(--safe-top) + 8px) 20px 0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 'calc(var(--safe-top) + 49px)',
      }}>
        {/* Avatar / account switcher */}
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: disc.surfaceCard2, border: `0.5px solid ${disc.lineSubtle}`, overflow: 'hidden', cursor: 'pointer' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={1.5} strokeLinecap="round">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        {/* Wordmark */}
        <span style={{
          fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em',
          color: disc.textSecondary,
        }}>Glympse</span>
        {/* Overflow */}
        <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={2} strokeLinecap="round">
            <circle cx="12" cy="5" r="1" fill={disc.textTertiary}/>
            <circle cx="12" cy="12" r="1" fill={disc.textTertiary}/>
            <circle cx="12" cy="19" r="1" fill={disc.textTertiary}/>
          </svg>
        </div>
      </div>

      {/* ── Scrollable content ───────────────────────────────────────────── */}
      <div className="scroll-y" style={{ flex: 1, position: 'relative', zIndex: 1 }}>
        <div style={{ padding: '20px 20px 0' }}>

          {/* ── Hero title block ──────────────────────────────────────── */}
          <AnimatePresence mode="wait">
            {!isSearching && (
              <motion.div
                key="hero"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={transitions.fadeIn}
                style={{ marginBottom: 20 }}
              >
                <h1 style={{
                  fontSize: typeScale.displayLg[0], lineHeight: `${typeScale.displayLg[1]}px`,
                  fontWeight: typeScale.displayLg[2], letterSpacing: typeScale.displayLg[3],
                  color: disc.textPrimary, margin: 0,
                }}>
                  {DISCOVERY_PHRASES[phraseIdx.current]}
                </h1>
                <p style={{
                  fontSize: typeScale.bodyMd[0], lineHeight: `${typeScale.bodyMd[1]}px`,
                  fontWeight: typeScale.bodyMd[2],
                  color: disc.textSecondary, marginTop: 6,
                }}>
                  Stories, threads, and ideas worth your attention
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Search hero field ─────────────────────────────────────── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            marginBottom: 12,
          }}>
            <motion.div
              animate={{ boxShadow: focused ? shfTokens.focus.glow : shfTokens.shadow }}
              style={{
                flex: 1,
                height: shfTokens.height,
                borderRadius: shfTokens.radius,
                background: shfTokens.discovery.bg,
                border: `1px solid ${focused ? shfTokens.focus.border : shfTokens.discovery.border}`,
                display: 'flex', alignItems: 'center', gap: shfTokens.iconGap,
                padding: `0 ${shfTokens.paddingX}px`,
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={shfTokens.discovery.icon} strokeWidth={2} strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && query.trim().length > 1) {
                    e.currentTarget.blur();
                    useUiStore.getState().openSearchStory(query.trim());
                  }
                }}
                placeholder="Search stories, topics, feeds"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  flex: 1,
                  fontSize: typeScale.bodyLg[0], lineHeight: `${typeScale.bodyLg[1]}px`,
                  fontWeight: typeScale.bodyLg[2],
                  color: shfTokens.discovery.text,
                  background: 'none', border: 'none', outline: 'none',
                }}
              />
              {query && (
                <button onClick={() => setQuery('')} style={{ color: disc.textTertiary, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              )}
            </motion.div>
            <AnimatePresence>
              {(isSearching || focused) && (
                <motion.button
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  onClick={() => { setQuery(''); inputRef.current?.blur(); setFocused(false); }}
                  style={{
                    fontSize: typeScale.chip[0], fontWeight: 600,
                    color: accent.primary,
                    background: 'none', border: 'none', cursor: 'pointer',
                    whiteSpace: 'nowrap', overflow: 'hidden',
                  }}
                >
                  Cancel
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* ── Search Story CTA (shows when query is non-empty) ─────── */}
          <AnimatePresence>
            {query.trim().length > 1 && (
              <motion.button
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                onClick={() => useUiStore.getState().openSearchStory(query.trim())}
                style={{
                  width: '100%', height: 44,
                  borderRadius: radius.full,
                  background: accent.primary,
                  color: '#fff',
                  border: 'none', cursor: 'pointer',
                  fontSize: typeScale.chip[0], fontWeight: 700,
                  marginBottom: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                Search Story: "{query}"
              </motion.button>
            )}
          </AnimatePresence>

          {/* ── Quick filter chips ────────────────────────────────────── */}
          <AnimatePresence>
            {!isSearching && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ display: 'flex', gap: qfcTokens.gap, overflowX: 'auto', paddingBottom: 4, marginBottom: 20, scrollbarWidth: 'none' }}
              >
                {QUICK_FILTERS.map(f => (
                  <button
                    key={f}
                    onClick={() => setActiveFilter(activeFilter === f ? null : f)}
                    style={{
                      flexShrink: 0,
                      height: qfcTokens.height,
                      padding: `0 ${qfcTokens.paddingX}px`,
                      borderRadius: qfcTokens.radius,
                      background: activeFilter === f ? qfcTokens.discovery.activeBg : qfcTokens.discovery.bg,
                      border: `0.5px solid ${qfcTokens.discovery.border}`,
                      color: activeFilter === f ? qfcTokens.discovery.activeText : qfcTokens.discovery.text,
                      fontSize: typeScale.chip[0], fontWeight: typeScale.chip[2],
                      cursor: 'pointer',
                      transition: 'all 0.14s',
                    }}
                  >{f}</button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Search results ─────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {isSearching ? (
            <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: '0 20px' }}>
              {loading ? <DiscoverySpinner /> : (
                <>
                  {searchActors.length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <SectionHeader title="People" />
                      <div style={{ background: disc.surfaceCard, borderRadius: radius[24], padding: `0 ${space[8]}px`, border: `0.5px solid ${disc.lineSubtle}` }}>
                        {searchActors.map(a => <ActorRow key={a.did} actor={a} onFollow={handleFollow} />)}
                      </div>
                    </div>
                  )}
                  {searchPosts.length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <SectionHeader title="Posts" />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {searchPosts.slice(0, 8).map(post => (
                          <motion.div
                            key={post.id}
                            whileTap={{ scale: 0.985 }}
                            onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.content.slice(0, 80) })}
                            style={{
                              background: disc.surfaceCard, borderRadius: radius[24],
                              padding: `${space[8]}px ${space[10]}px`,
                              border: `0.5px solid ${disc.lineSubtle}`,
                              cursor: 'pointer',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                              <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceFocus, flexShrink: 0 }}>
                                {post.author.avatar
                                  ? <img src={post.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  : <div style={{ width: '100%', height: '100%', background: accent.indigo600, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>{post.author.displayName[0]}</div>
                                }
                              </div>
                              <span style={{ fontSize: typeScale.metaLg[0], fontWeight: 600, color: disc.textPrimary }}>{post.author.displayName}</span>
                              <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>@{post.author.handle}</span>
                            </div>
                            <p style={{ fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`, color: disc.textSecondary, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {post.content}
                            </p>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}
                  {searchActors.length === 0 && searchPosts.length === 0 && (
                    <div style={{ padding: '40px 0', textAlign: 'center' }}>
                      <p style={{ fontSize: typeScale.bodySm[0], color: disc.textTertiary }}>No results for "{debouncedQuery}"</p>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          ) : (
            <motion.div key="discover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {discoverLoading ? (
                <div style={{ padding: '0 20px' }}><DiscoverySpinner /></div>
              ) : (
                <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 28 }}>

                  {/* Featured Search Story Card */}
                  {featuredPost && (
                    <div>
                      <SectionHeader title="Featured Story" />
                      <FeaturedSearchStoryCard
                        post={featuredPost}
                        onTap={() => onOpenStory({ type: 'post', id: featuredPost.id, title: featuredPost.content.slice(0, 80) })}
                      />
                    </div>
                  )}

                  {/* Trending Topics */}
                  {trendingTopics.length > 0 && (
                    <div>
                      <SectionHeader title="Trending Topics" />
                      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 4 }}>
                        {trendingTopics.map((t, i) => (
                          <TrendingTopicCard
                            key={t}
                            topic={t}
                            signal={i < 2 ? 'active now' : i < 4 ? 'rising' : 'new'}
                            onTap={() => { setQuery(t); }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Live Clusters */}
                  {liveClusters.length > 0 && (
                    <div>
                      <SectionHeader title="Live Clusters" />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {liveClusters.map(c => (
                          <LiveClusterCard
                            key={c.id}
                            title={c.title}
                            summary={c.summary}
                            count={c.count}
                            onTap={() => onOpenStory({ type: 'topic', id: c.id, title: c.title })}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Feeds & Packs */}
                  {suggestedFeeds.length > 0 && (
                    <div>
                      <SectionHeader title="Feeds to Follow" />
                      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 4 }}>
                        {suggestedFeeds.map(gen => <FeedCard key={gen.uri} gen={gen} onFollow={handleFollowFeed} />)}
                      </div>
                    </div>
                  )}

                  {/* Sources & Domains */}
                  {domains.length > 0 && (
                    <div>
                      <SectionHeader title="Sources" />
                      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 4 }}>
                        {domains.map(d => <DomainCapsule key={d.domain} domain={d.domain} description={d.description} />)}
                      </div>
                    </div>
                  )}

                  {/* People to follow */}
                  {suggestedActors.length > 0 && (
                    <div>
                      <SectionHeader title="People to Follow" />
                      <div style={{ background: disc.surfaceCard, borderRadius: radius[24], padding: `0 ${space[8]}px`, border: `0.5px solid ${disc.lineSubtle}` }}>
                        {suggestedActors.slice(0, 5).map(a => <ActorRow key={a.did} actor={a} onFollow={handleFollow} />)}
                      </div>
                    </div>
                  )}

                  <div style={{ height: 24 }} />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
