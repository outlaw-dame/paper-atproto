// ─── SearchStoryScreen — Discovery Mode card-deck reader ──────────────────
// Glympse Core Wireframe Spec v1 — Screen 2
//
// Structure:
//   StoryProgressRail (top)
//   QuietTopBar (back + query)
//   Card deck (swipe/tap to advance):
//     0. OverviewCard       — synopsis, media, source strip
//     1. BestSourceCard     — top source post with facets
//     2. RelatedEntitiesCard — mentioned actors + hashtag clusters
//     3. RelatedConversationCard — top reply threads
//   BottomQueryDock (refine query)

import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { useDrag } from '@use-gesture/react';
import { useSessionStore } from '../store/sessionStore.js';
import { atpCall } from '../lib/atproto/client.js';
import { mapFeedViewPost, mapPostViewToMockPost } from '../atproto/mappers.js';
import type { MockPost } from '../data/mockData.js';
import type { StoryEntry } from '../App.js';
import {
  storyProgress as spTokens,
  overviewCard as ocTokens,
  bottomQueryDock as bqdTokens,
  interpolator as intTokens,
  discovery as disc,
  accent,
  type as typeScale,
  radius,
  space,
  transitions,
  storyCardVariants,
} from '../design/index.js';

interface Props {
  query: string;
  onClose: () => void;
  onOpenStory: (e: StoryEntry) => void;
}

const CARD_NAMES = ['Overview', 'Best Source', 'Related', 'Conversation'] as const;
type CardName = typeof CARD_NAMES[number];

// ─── StoryProgressRail ────────────────────────────────────────────────────
function StoryProgressRail({ total, current }: { total: number; current: number }) {
  return (
    <div style={{
      display: 'flex', gap: spTokens.segmentGap,
      padding: '0 20px',
      height: spTokens.height,
    }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          flex: 1, height: spTokens.height,
          borderRadius: spTokens.radius,
          background: i < current ? spTokens.complete : i === current ? spTokens.active : spTokens.track,
          boxShadow: i === current ? spTokens.currentGlow : 'none',
          transition: 'background 0.3s',
        }} />
      ))}
    </div>
  );
}

// ─── RichText inline renderer ─────────────────────────────────────────────
function RichText({ text, color }: { text: string; color: string }) {
  const parts = text.split(/(@[\w.]+|#\w+|https?:\/\/\S+)/g);
  return (
    <span>
      {parts.map((p, i) => {
        if (p.startsWith('@')) return <span key={i} style={{ color: '#BF8FFF', fontWeight: 500 }}>{p}</span>;
        if (p.startsWith('#')) return <span key={i} style={{ color: accent.cyan400, fontWeight: 500 }}>{p}</span>;
        if (p.startsWith('http')) {
          try {
            return <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ color: accent.cyan400 }} onClick={e => e.stopPropagation()}>{new URL(p).hostname.replace(/^www\./, '')}</a>;
          } catch { return <span key={i}>{p}</span>; }
        }
        return <span key={i} style={{ color }}>{p}</span>;
      })}
    </span>
  );
}

// ─── OverviewCard ─────────────────────────────────────────────────────────
function OverviewCard({ posts, query }: { posts: MockPost[]; query: string }) {
  const top = posts[0];
  if (!top) return null;
  const img = top.images?.[0] ?? top.embed?.thumbnail;
  const domain = top.embed?.url ? (() => { try { return new URL(top.embed!.url!).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '';

  return (
    <div style={{
      borderRadius: ocTokens.radius,
      background: ocTokens.bg,
      boxShadow: ocTokens.shadow,
      overflow: 'hidden',
      border: `0.5px solid ${disc.lineSubtle}`,
    }}>
      {/* Media */}
      {img && (
        <div style={{ height: ocTokens.mediaHeight, overflow: 'hidden', position: 'relative' }}>
          <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 40%, rgba(18,24,36,0.8) 100%)' }} />
        </div>
      )}

      <div style={{ padding: `${ocTokens.padding}px` }}>
        {/* Synopsis chip */}
        <div style={{ marginBottom: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: radius.full,
            background: ocTokens.synopsisChip.bg,
            border: `0.5px solid ${ocTokens.synopsisChip.border}`,
            color: ocTokens.synopsisChip.text,
            fontSize: typeScale.metaLg[0], fontWeight: 600,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#7CE9FF', flexShrink: 0 }} />
            Glympse Synopsis
          </span>
        </div>

        {/* Title */}
        <p style={{
          fontSize: typeScale.titleLg[0], lineHeight: `${typeScale.titleLg[1]}px`,
          fontWeight: typeScale.titleLg[2], letterSpacing: typeScale.titleLg[3],
          color: disc.textPrimary, marginBottom: 10,
        }}>
          <RichText text={top.content.slice(0, 140)} color={disc.textPrimary} />
        </p>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
          {[
            { icon: '💬', val: top.replies, label: 'replies' },
            { icon: '🔁', val: top.reposts, label: 'reposts' },
            { icon: '❤️', val: top.likes, label: 'likes' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 13 }}>{s.icon}</span>
              <span style={{ fontSize: typeScale.metaLg[0], fontWeight: 600, color: disc.textSecondary }}>{s.val}</span>
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>{posts.length} results</span>
        </div>

        {/* Source strip */}
        {(domain || top.author.handle) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: `${space[4]}px ${space[6]}px`,
            background: ocTokens.sourceStrip.bg,
            borderRadius: radius[12],
          }}>
            <div style={{ width: 20, height: 20, borderRadius: 6, background: disc.surfaceFocus, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {top.author.avatar
                ? <img src={top.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />
                : <span style={{ fontSize: 10, color: disc.textTertiary }}>@</span>
              }
            </div>
            <span style={{ fontSize: typeScale.metaSm[0], fontWeight: 500, color: ocTokens.sourceStrip.text }}>
              {domain || `@${top.author.handle}`}
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>
              {top.timestamp}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── BestSourceCard ───────────────────────────────────────────────────────
function BestSourceCard({ posts }: { posts: MockPost[] }) {
  const top = posts[0];
  if (!top) return null;
  return (
    <div style={{
      borderRadius: ocTokens.radius,
      background: disc.surfaceCard2,
      boxShadow: ocTokens.shadow,
      padding: `${space[12]}px`,
      border: `0.5px solid ${disc.lineSubtle}`,
    }}>
      <p style={{
        fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: disc.textTertiary, marginBottom: 16,
      }}>Best Source</p>

      {/* Author */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceFocus, flexShrink: 0 }}>
          {top.author.avatar
            ? <img src={top.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: accent.indigo600, color: '#fff', fontSize: 16, fontWeight: 700 }}>{top.author.displayName[0]}</div>
          }
        </div>
        <div>
          <p style={{ fontSize: typeScale.chip[0], fontWeight: 700, color: disc.textPrimary }}>{top.author.displayName}</p>
          <p style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>@{top.author.handle}</p>
        </div>
      </div>

      {/* Full text */}
      <p style={{
        fontSize: typeScale.bodyMd[0], lineHeight: `${typeScale.bodyMd[1]}px`,
        fontWeight: typeScale.bodyMd[2],
        color: disc.textSecondary, marginBottom: 16,
      }}>
        <RichText text={top.content} color={disc.textSecondary} />
      </p>

      {/* Embed if present */}
      {top.embed && (top.embed.type === 'external' || top.embed.type === 'video') && (
        <a
          href={top.embed.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{
            display: 'block',
            background: disc.surfaceFocus,
            borderRadius: radius[16],
            padding: `${space[6]}px ${space[8]}px`,
            textDecoration: 'none',
            border: `0.5px solid ${disc.lineSubtle}`,
          }}
        >
          {top.embed.thumb && (
            <img src={top.embed.thumb} alt="" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: radius[12], marginBottom: 8 }} />
          )}
          {top.embed.title && <p style={{ fontSize: typeScale.chip[0], fontWeight: 600, color: disc.textPrimary, marginBottom: 4 }}>{top.embed.title}</p>}
          <p style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>
            {(() => { try { return new URL(top.embed.url).hostname.replace(/^www\./, ''); } catch { return top.embed.url; } })()}
          </p>
        </a>
      )}
    </div>
  );
}

// ─── RelatedEntitiesCard ──────────────────────────────────────────────────
function RelatedEntitiesCard({ posts }: { posts: MockPost[] }) {
  // Extract hashtags and mentioned handles
  const hashtags = posts.flatMap(p => p.content.match(/#\w+/g) ?? []).filter((v, i, a) => a.indexOf(v) === i).slice(0, 12);
  const handles = posts.flatMap(p => p.content.match(/@[\w.]+/g) ?? []).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6);

  return (
    <div style={{
      borderRadius: ocTokens.radius,
      background: disc.surfaceCard2,
      padding: `${space[12]}px`,
      border: `0.5px solid ${disc.lineSubtle}`,
    }}>
      <p style={{
        fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: disc.textTertiary, marginBottom: 16,
      }}>Related Entities</p>

      {hashtags.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: typeScale.metaSm[0], fontWeight: 600, color: disc.textTertiary, marginBottom: 8, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Topics</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {hashtags.map(h => (
              <span key={h} style={{
                padding: '5px 12px', borderRadius: radius.full,
                background: 'rgba(91,124,255,0.14)',
                color: accent.primary,
                fontSize: typeScale.chip[0], fontWeight: 600,
              }}>{h}</span>
            ))}
          </div>
        </div>
      )}

      {handles.length > 0 && (
        <div>
          <p style={{ fontSize: typeScale.metaSm[0], fontWeight: 600, color: disc.textTertiary, marginBottom: 8, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Mentioned</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {handles.map(h => (
              <span key={h} style={{
                padding: '5px 12px', borderRadius: radius.full,
                background: 'rgba(191,143,255,0.12)',
                color: '#BF8FFF',
                fontSize: typeScale.chip[0], fontWeight: 600,
              }}>{h}</span>
            ))}
          </div>
        </div>
      )}

      {hashtags.length === 0 && handles.length === 0 && (
        <p style={{ fontSize: typeScale.bodySm[0], color: disc.textTertiary }}>No entities detected in this result set.</p>
      )}
    </div>
  );
}

// ─── RelatedConversationCard ──────────────────────────────────────────────
function RelatedConversationCard({ posts, onOpenStory }: { posts: MockPost[]; onOpenStory: (e: StoryEntry) => void }) {
  return (
    <div style={{
      borderRadius: ocTokens.radius,
      background: disc.surfaceCard2,
      padding: `${space[12]}px`,
      border: `0.5px solid ${disc.lineSubtle}`,
    }}>
      <p style={{
        fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: disc.textTertiary, marginBottom: 16,
      }}>Related Conversations</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {posts.slice(1, 6).map(post => (
          <motion.div
            key={post.id}
            whileTap={{ scale: 0.985 }}
            onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.content.slice(0, 80) })}
            style={{
              background: disc.surfaceCard,
              borderRadius: radius[20],
              padding: `${space[8]}px ${space[8]}px`,
              border: `0.5px solid ${disc.lineSubtle}`,
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceFocus, flexShrink: 0 }}>
                {post.author.avatar
                  ? <img src={post.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', background: accent.indigo600, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>{post.author.displayName[0]}</div>
                }
              </div>
              <span style={{ fontSize: typeScale.metaLg[0], fontWeight: 600, color: disc.textPrimary }}>{post.author.displayName}</span>
              <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>{post.timestamp}</span>
            </div>
            <p style={{
              fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
              color: disc.textSecondary,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {post.content}
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>💬 {post.replyCount}</span>
              <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>❤️ {post.likeCount}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─── BottomQueryDock ──────────────────────────────────────────────────────
function BottomQueryDock({ query, onRefine }: { query: string; onRefine: (q: string) => void }) {
  const [val, setVal] = useState(query);
  return (
    <div style={{
      position: 'absolute', bottom: 'calc(var(--safe-bottom) + 16px)',
      left: 20, right: 20,
      height: bqdTokens.height,
      borderRadius: bqdTokens.radius,
      background: bqdTokens.bg,
      border: `0.5px solid ${bqdTokens.border}`,
      backdropFilter: `blur(${bqdTokens.blur})`,
      WebkitBackdropFilter: `blur(${bqdTokens.blur})`,
      boxShadow: bqdTokens.shadow,
      display: 'flex', alignItems: 'center',
      padding: `0 ${bqdTokens.paddingX}px`,
      gap: 10,
      zIndex: 10,
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={2} strokeLinecap="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onRefine(val); }}
        placeholder="Refine your search…"
        style={{
          flex: 1,
          fontSize: typeScale.bodySm[0], fontWeight: typeScale.bodySm[2],
          color: bqdTokens.text,
          background: 'none', border: 'none', outline: 'none',
        }}
      />
      <button
        onClick={() => onRefine(val)}
        style={{
          width: 32, height: 32, borderRadius: '50%',
          background: bqdTokens.actionBg, color: bqdTokens.actionFg,
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
        </svg>
      </button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function SearchStoryScreen({ query, onClose, onOpenStory }: Props) {
  const { agent, session } = useSessionStore();
  const [posts, setPosts] = useState<MockPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [cardIdx, setCardIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const [refinedQuery, setRefinedQuery] = useState(query);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    atpCall(() => agent.app.bsky.feed.searchPosts({ q: refinedQuery, limit: 25 }))
      .then(res => {
        if (res?.data?.posts) {
          setPosts(
            res.data.posts
              .filter((p: any) => p?.record?.text)
              .map((p: any) => mapPostViewToMockPost(p))
          );
        }
      })
      .finally(() => setLoading(false));
  }, [refinedQuery, agent, session]);

  const advance = useCallback(() => {
    if (cardIdx < CARD_NAMES.length - 1) { setDir(1); setCardIdx(i => i + 1); }
  }, [cardIdx]);

  const retreat = useCallback(() => {
    if (cardIdx > 0) { setDir(-1); setCardIdx(i => i - 1); }
  }, [cardIdx]);

  // Swipe gesture
  const bind = useDrag(({ swipe: [swipeX] }) => {
    if (swipeX === -1) advance();
    if (swipeX === 1) retreat();
  }, { axis: 'x', swipe: { velocity: 0.3 } });

  const cards = [
    <OverviewCard key="overview" posts={posts} query={refinedQuery} />,
    <BestSourceCard key="source" posts={posts} />,
    <RelatedEntitiesCard key="entities" posts={posts} />,
    <RelatedConversationCard key="conversation" posts={posts} onOpenStory={onOpenStory} />,
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0,
        background: disc.bgBase,
        display: 'flex', flexDirection: 'column',
        zIndex: 200,
      }}
    >
      {/* Atmosphere */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: disc.bgAtmosphere }} />

      {/* Top bar */}
      <div style={{
        position: 'relative', zIndex: 2,
        flexShrink: 0,
        paddingTop: 'calc(var(--safe-top) + 12px)',
        padding: 'calc(var(--safe-top) + 12px) 20px 12px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={onClose} style={{
          width: 36, height: 36, borderRadius: '50%',
          background: disc.surfaceCard, border: `0.5px solid ${disc.lineSubtle}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={disc.textSecondary} strokeWidth={2.5} strokeLinecap="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <p style={{
          flex: 1,
          fontSize: typeScale.titleSm[0], fontWeight: typeScale.titleSm[2],
          letterSpacing: typeScale.titleSm[3],
          color: disc.textPrimary,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>"{refinedQuery}"</p>
        <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>
          {cardIdx + 1} / {CARD_NAMES.length}
        </span>
      </div>

      {/* Progress rail */}
      <div style={{ position: 'relative', zIndex: 2, flexShrink: 0, paddingBottom: 12 }}>
        <StoryProgressRail total={CARD_NAMES.length} current={cardIdx} />
      </div>

      {/* Card area */}
      <div
        {...bind()}
        style={{ flex: 1, position: 'relative', zIndex: 1, overflow: 'hidden', touchAction: 'pan-y' }}
        onClick={advance}
      >
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={2} strokeLinecap="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
              </path>
            </svg>
          </div>
        ) : (
          <div className="scroll-y" style={{ height: '100%', paddingBottom: 88 }}>
            <div style={{ padding: '0 20px' }}>
              <AnimatePresence mode="wait" custom={dir}>
                <motion.div
                  key={cardIdx}
                  custom={dir}
                  variants={storyCardVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={transitions.storyCard}
                >
                  {cards[cardIdx]}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* Bottom query dock */}
      <BottomQueryDock query={refinedQuery} onRefine={q => { setRefinedQuery(q); setCardIdx(0); }} />
    </motion.div>
  );
}
