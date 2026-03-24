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
import { useSessionStore } from '../store/sessionStore.js';
import { atpCall, atpMutate } from '../lib/atproto/client.js';
import { mapFeedViewPost } from '../atproto/mappers.js';
import type { MockPost } from '../data/mockData.js';
import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';
import type { StoryEntry } from '../App.js';
import { useUiStore } from '../store/uiStore.js';
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
} from '../design/index.js';

interface Props {
  onOpenStory: (e: StoryEntry) => void;
}

// ─── Discovery phrases ────────────────────────────────────────────────────
const DISCOVERY_PHRASES = [
  "What's happening",
  "Explore the conversation",
  "Find what matters",
];

const DISCOVER_FEED_URI = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';
const QUIET_FEED_URI    = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/quiet-posters';

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

// ─── RichPostText — inline #hashtag linkification ────────────────────────
function RichPostText({ text, onHashtag, style }: {
  text: string;
  onHashtag?: (tag: string) => void;
  style?: React.CSSProperties;
}) {
  const parts = text.split(/(#\w+)/g);
  return (
    <span style={style}>
      {parts.map((part, i) =>
        part.startsWith('#') ? (
          <span
            key={i}
            onClick={e => { e.stopPropagation(); onHashtag?.(part.slice(1)); }}
            style={{ color: accent.cyan400, fontWeight: 700, cursor: onHashtag ? 'pointer' : 'default' }}
          >{part}</span>
        ) : part
      )}
    </span>
  );
}

// ─── FeaturedSearchStoryCard — Gist-inspired flush link story card ────────
function FeaturedSearchStoryCard({ post, onTap, onHashtag }: {
  post: MockPost;
  onTap: () => void;
  onHashtag?: (tag: string) => void;
}) {
  const embed = post.embed?.type === 'external' ? post.embed : null;
  const img = post.media?.[0]?.url ?? embed?.thumb;
  const domain = embed?.domain ?? '';
  const hashtags: string[] = Array.from(new Set((post.content.match(/#\w+/g) ?? []) as string[])).slice(0, 5);

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
      {/* ── Hero zone: image + gradient scrim that bleeds into card bg ── */}
      <div style={{ position: 'relative', height: 210, background: disc.surfaceFocus, overflow: 'hidden' }}>
        {img ? (
          <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: `radial-gradient(ellipse at 20% 60%, rgba(91,124,255,0.35) 0%, transparent 55%),
                         radial-gradient(ellipse at 78% 20%, rgba(124,233,255,0.15) 0%, transparent 50%),
                         ${disc.surfaceCard}`,
          }} />
        )}
        {/* Gradient scrim: fades to exact card bg so there is NO hard edge */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.05) 45%, ${fscTokens.bg} 100%)`,
        }} />
        {/* Domain pill overlaid in lower-left of hero */}
        {domain && (
          <div style={{
            position: 'absolute', bottom: 14, left: 14,
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'rgba(7,11,18,0.76)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: '0.5px solid rgba(255,255,255,0.09)',
            borderRadius: radius.full,
            padding: '4px 10px 4px 7px',
          }}>
            <div style={{ width: 14, height: 14, borderRadius: 4, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2.5} strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
              </svg>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.75)', letterSpacing: '0.01em' }}>{domain}</span>
          </div>
        )}
        {/* Open-link pill: upper-right corner */}
        <div style={{
          position: 'absolute', top: 12, right: 12,
          background: 'rgba(7,11,18,0.6)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '0.5px solid rgba(255,255,255,0.09)',
          borderRadius: radius.full,
          padding: '4px 9px',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={accent.cyan400} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600, color: accent.cyan400 }}>Open</span>
        </div>
      </div>

      {/* ── Content zone — seamlessly attached below hero ── */}
      <div style={{ padding: `14px ${space[10]}px ${space[10]}px` }}>

        {/* Hashtag chips */}
        {hashtags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {hashtags.map(tag => (
              <button
                key={tag}
                onClick={e => { e.stopPropagation(); onHashtag?.(tag.slice(1)); }}
                style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '3px 9px', borderRadius: radius.full,
                  background: 'rgba(91,124,255,0.13)',
                  border: '0.5px solid rgba(91,124,255,0.3)',
                  color: accent.primary,
                  fontSize: 12, fontWeight: 600, letterSpacing: '0.01em',
                  cursor: 'pointer',
                }}
              >{tag}</button>
            ))}
          </div>
        )}

        {/* Post text with inline hashtag linkification */}
        <p style={{
          fontSize: typeScale.titleSm[0], lineHeight: `${typeScale.titleSm[1]}px`,
          fontWeight: 600, letterSpacing: typeScale.titleSm[3],
          color: disc.textPrimary, marginBottom: 8,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          <RichPostText text={post.content} {...(onHashtag ? { onHashtag } : {})} />
        </p>

        {/* Article title from embed (if different from post text) */}
        {embed?.title && embed.title.trim() !== post.content.trim() && (
          <p style={{
            fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
            color: disc.textSecondary, marginBottom: 8,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{embed.title}</p>
        )}

        {/* Article author / publisher row */}
        {(embed?.authorName || embed?.publisher) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '2px 8px', borderRadius: radius.full,
              background: 'rgba(124,233,255,0.10)',
              border: `0.5px solid rgba(124,233,255,0.22)`,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: accent.cyan400,
              textTransform: 'uppercase',
            }}>Featured</span>
            {embed?.authorName && (
              <span style={{ fontSize: 12, color: disc.textSecondary, fontWeight: 500 }}>
                By <span style={{ color: disc.textPrimary, fontWeight: 600 }}>{embed.authorName}</span>
              </span>
            )}
            {embed?.publisher && (
              <span style={{ fontSize: 12, color: disc.textTertiary }}>
                · {embed.publisher}
              </span>
            )}
          </div>
        )}

        {/* Footer: author avatar + name + engagement */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, borderTop: `0.5px solid ${disc.lineSubtle}`, marginTop: 12 }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceFocus, flexShrink: 0 }}>
            {post.author.avatar
              ? <img src={post.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ width: '100%', height: '100%', background: accent.indigo600, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700 }}>{post.author.displayName[0]}</div>
            }
          </div>
          <span style={{ fontSize: 12, fontWeight: 500, color: disc.textSecondary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {post.author.displayName}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: disc.textTertiary }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
              {post.likeCount.toLocaleString()}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: disc.textTertiary }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              {post.replyCount.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── LinkedPostMiniCard — horizontal strip of popular link posts ──────────
function LinkedPostMiniCard({ post, onTap, onHashtag }: {
  post: MockPost;
  onTap: () => void;
  onHashtag?: (tag: string) => void;
}) {
  const embed = post.embed?.type === 'external' ? post.embed : null;
  const img = post.media?.[0]?.url ?? embed?.thumb;
  const domain = embed?.domain ?? '';

  return (
    <motion.div
      whileTap={{ scale: 0.96 }}
      onClick={onTap}
      style={{
        flexShrink: 0, width: 182,
        borderRadius: radius[20],
        overflow: 'hidden',
        background: disc.surfaceCard2,
        border: `0.5px solid ${disc.lineSubtle}`,
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Thumbnail with gradient scrim */}
      <div style={{ height: 96, background: disc.surfaceFocus, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
        {img ? (
          <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: `radial-gradient(circle at 50% 60%, rgba(91,124,255,0.22), ${disc.surfaceCard2})` }} />
        )}
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(to bottom, rgba(0,0,0,0) 30%, ${disc.surfaceCard2} 100%)`,
        }} />
      </div>
      {/* Text content */}
      <div style={{ padding: '8px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p style={{
          fontSize: 13, fontWeight: 600, lineHeight: '18px', color: disc.textPrimary,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          <RichPostText text={post.content} {...(onHashtag ? { onHashtag } : {})} />
        </p>
        {domain && (
          <span style={{
            fontSize: 11, color: disc.textTertiary, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{domain}</span>
        )}
        {(embed?.authorName || embed?.publisher) && (
          <span style={{
            fontSize: 11, color: disc.textSecondary, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {embed?.authorName ? `By ${embed.authorName}` : embed?.publisher}
            {embed?.authorName && embed?.publisher ? ` · ${embed.publisher}` : ''}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: disc.textTertiary }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
            {post.likeCount.toLocaleString()}
          </span>
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
  const [linkPosts, setLinkPosts] = useState<MockPost[]>([]);
  const [trendingPosts, setTrendingPosts] = useState<MockPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [focused, setFocused] = useState(false);
  const [featuredIdx, setFeaturedIdx] = useState(0);
  const [sidePosts, setSidePosts] = useState<MockPost[]>([]);
  const carouselIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
      atpCall(() => agent.app.bsky.feed.getFeed({ feed: DISCOVER_FEED_URI, limit: 40 })).catch(() => null),
      atpCall(() => agent.app.bsky.feed.getFeed({ feed: QUIET_FEED_URI, limit: 20 })).catch(() => null),
    ]).then(([feedsRes, actorsRes, discoverRes, quietRes]) => {
      if (feedsRes?.data?.feeds) setSuggestedFeeds(feedsRes.data.feeds);
      if (actorsRes?.data?.actors) setSuggestedActors(actorsRes.data.actors);
      if (discoverRes?.data?.feed?.length) {
        const mapped = discoverRes.data.feed
          .filter((item: any) => item.post?.record?.text)
          .map((item: any) => mapFeedViewPost(item));

        // Sort by engagement score
        const byEngagement = [...mapped].sort(
          (a, b) => (b.likeCount + b.repostCount * 2 + b.replyCount) - (a.likeCount + a.repostCount * 2 + a.replyCount)
        );

        // Link posts: only those with an external embed, top 6 by engagement
        const withLinks = byEngagement.filter(p => p.embed?.type === 'external').slice(0, 6);
        setLinkPosts(withLinks);
        setFeaturedPost(withLinks[0] ?? byEngagement[0] ?? null);
        setTrendingPosts(byEngagement.slice(0, 10));

        // Side strip: mid-tier trending + underdogs from quiet posters feed
        const topIds = new Set(withLinks.map(p => p.id));

        // Mid-tier: trending posts not in top stories (with or without links, by engagement rank)
        const midTier = byEngagement.filter(p => !topIds.has(p.id)).slice(0, 4);

        // Underdogs: low-engagement link posts from the hot feed, not already featured
        const underdogs = byEngagement
          .filter(p => p.embed?.type === 'external' && !topIds.has(p.id))
          .sort((a, b) => (a.likeCount + a.repostCount) - (b.likeCount + b.repostCount))
          .slice(0, 3);

        // Quiet posters: map if available, keep only posts with some substance
        const quietMapped = quietRes?.data?.feed?.length
          ? quietRes.data.feed
              .filter((item: any) => item.post?.record?.text?.length > 40)
              .map((item: any) => mapFeedViewPost(item))
              .slice(0, 4)
          : [];

        // Interleave: midTier → quietMapped → underdogs, dedupe by id
        const seen = new Set(topIds);
        const combined: MockPost[] = [];
        for (const p of [...midTier, ...quietMapped, ...underdogs]) {
          if (!seen.has(p.id)) { seen.add(p.id); combined.push(p); }
          if (combined.length >= 10) break;
        }
        setSidePosts(combined);
      }
    }).finally(() => setDiscoverLoading(false));
  }, [agent, session]);

  // Reset carousel index when link posts refresh
  useEffect(() => { setFeaturedIdx(0); }, [linkPosts]);

  // Auto-advance carousel — restarts on manual tap
  const restartCarousel = useCallback(() => {
    if (carouselIntervalRef.current) clearInterval(carouselIntervalRef.current);
    if (linkPosts.length <= 1) return;
    carouselIntervalRef.current = setInterval(() => {
      setFeaturedIdx(i => (i + 1) % linkPosts.length);
    }, 5000);
  }, [linkPosts.length]);

  useEffect(() => {
    restartCarousel();
    return () => { if (carouselIntervalRef.current) clearInterval(carouselIntervalRef.current); };
  }, [restartCarousel]);

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

                  {/* Featured Story Carousel */}
                  {linkPosts.length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <SectionHeader title="Top Stories" />

                      {/* Hero card — crossfades between link posts */}
                      <div style={{ position: 'relative' }}>
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.div
                            key={linkPosts[featuredIdx]?.id ?? featuredIdx}
                            initial={{ opacity: 0, scale: 0.975 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.38, ease: [0.25, 0.1, 0.25, 1] }}
                          >
                            <FeaturedSearchStoryCard
                              post={linkPosts[featuredIdx]}
                              onTap={() => {
                                const p = linkPosts[featuredIdx];
                                onOpenStory({ type: 'post', id: p.id, title: p.content.slice(0, 80) });
                              }}
                              onHashtag={tag => useUiStore.getState().openSearchStory(tag)}
                            />
                          </motion.div>
                        </AnimatePresence>
                      </div>

                      {/* Progress dots — tap to jump, active pill fills over 5s */}
                      {linkPosts.length > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5, marginTop: 10, marginBottom: 2 }}>
                          {linkPosts.map((_, i) => (
                            <button
                              key={i}
                              onClick={() => { setFeaturedIdx(i); restartCarousel(); }}
                              style={{ background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                            >
                              <motion.div
                                animate={{ width: i === featuredIdx ? 20 : 6 }}
                                transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
                                style={{
                                  height: 4, borderRadius: 2,
                                  overflow: 'hidden', position: 'relative',
                                  background: disc.lineSubtle,
                                }}
                              >
                                {i === featuredIdx && (
                                  <motion.div
                                    key={`fill-${featuredIdx}`}
                                    initial={{ scaleX: 0 }}
                                    animate={{ scaleX: 1 }}
                                    transition={{ duration: 5, ease: 'linear' }}
                                    style={{
                                      position: 'absolute', inset: 0,
                                      background: accent.primary,
                                      transformOrigin: 'left center',
                                    }}
                                  />
                                )}
                              </motion.div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Side strip: trending non-top + quiet posters + underdogs */}
                      {sidePosts.length > 0 && (
                        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2, marginTop: 12 }}>
                          {sidePosts.map(p => (
                            <LinkedPostMiniCard
                              key={p.id}
                              post={p}
                              onTap={() => onOpenStory({ type: 'post', id: p.id, title: p.content.slice(0, 80) })}
                              onHashtag={tag => useUiStore.getState().openSearchStory(tag)}
                            />
                          ))}
                        </div>
                      )}
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
