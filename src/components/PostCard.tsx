import React, { useState } from 'react';
import { motion } from 'framer-motion';
import type { MockPost, ChipType } from '../data/mockData';
import { formatCount, formatTime } from '../data/mockData';
import type { StoryEntry } from '../App';

interface Props {
  post: MockPost;
  onOpenStory: (e: StoryEntry) => void;
  index?: number;
}

const CHIP: Record<ChipType, { label: string; bg: string; color: string }> = {
  thread:  { label: 'Thread',     bg: 'rgba(0,122,255,0.1)',   color: 'var(--blue)'   },
  topic:   { label: 'Topic',      bg: 'rgba(175,82,222,0.1)',  color: 'var(--purple)' },
  feed:    { label: 'Feed',       bg: 'rgba(90,200,250,0.12)', color: 'var(--teal)'   },
  pack:    { label: 'Pack',       bg: 'rgba(52,199,89,0.1)',   color: 'var(--green)'  },
  related: { label: 'Related',    bg: 'rgba(255,149,0,0.1)',   color: 'var(--orange)' },
  story:   { label: 'Open Story', bg: 'rgba(0,122,255,0.1)',   color: 'var(--blue)'   },
};

// ─── Rich text renderer ────────────────────────────────────────────────────
// Splits post text into segments: plain text, @mentions, #hashtags, URLs
function RichText({ text }: { text: string }) {
  // Token pattern: URLs first (greedy), then @mentions, then #hashtags
  const TOKEN = /(https?:\/\/[^\s]+)|(@[\w.]+)|(#\w+)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = TOKEN.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    const [full] = m;
    if (full.startsWith('http')) {
      // URL — show shortened domain
      let display = full;
      try { display = new URL(full).hostname.replace(/^www\./, '') + '…'; } catch { /* keep full */ }
      nodes.push(
        <a
          key={m.index}
          href={full}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ color: 'var(--blue)', textDecoration: 'none', fontWeight: 500 }}
        >
          {display}
        </a>
      );
    } else if (full.startsWith('@')) {
      nodes.push(
        <span key={m.index} style={{ color: 'var(--purple)', fontWeight: 500 }}>
          {full}
        </span>
      );
    } else if (full.startsWith('#')) {
      nodes.push(
        <span key={m.index} style={{ color: 'var(--blue)', fontWeight: 500 }}>
          {full}
        </span>
      );
    }
    last = m.index + full.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

// ─── PostCard ──────────────────────────────────────────────────────────────
export default function PostCard({ post, onOpenStory, index = 0 }: Props) {
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);

  const openStory = () => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName });

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.26, ease: [0.25, 0.1, 0.25, 1] }}
      style={{ background: 'var(--surface)', borderRadius: 20, overflow: 'hidden', marginBottom: 10 }}
    >
      {/* ── Tappable body ── */}
      <div
        role="button"
        tabIndex={0}
        onClick={openStory}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') openStory(); }}
        style={{ cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
      >
        {/* Media first */}
        {post.media && post.media.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: post.media.length === 1 ? '1fr' : '1fr 1fr',
            gap: 2,
          }}>
            {post.media.map((m, i) => (
              <div key={i} style={{
                position: 'relative',
                paddingTop: post.media!.length === 1 ? `${100 / (m.aspectRatio || 1.5)}%` : '75%',
                background: 'var(--fill-3)', overflow: 'hidden',
              }}>
                <img src={m.url} alt={m.alt || ''} loading="lazy" style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                }} />
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div style={{ padding: '14px 16px 0' }}>

          {/* Reply-to context banner */}
          {post.replyTo && (
            <div style={{
              display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5,
              marginBottom: 8,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--label-3)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/>
              </svg>
              <span style={{ fontSize: 13, color: 'var(--label-3)' }}>
                Replying to{' '}
                <span style={{ color: 'var(--blue)', fontWeight: 500 }}>
                  @{post.replyTo.handle.replace('.bsky.social', '')}
                </span>
              </span>
            </div>
          )}

          {/* Author row */}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--fill-2)' }}>
              {post.author.avatar
                ? <img src={post.author.avatar} alt={post.author.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--blue)', color: '#fff', fontSize: 15, fontWeight: 700 }}>{post.author.displayName[0]}</div>
              }
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--label-1)', letterSpacing: -0.3 }}>{post.author.displayName}</span>
                <span style={{ fontSize: 13, color: 'var(--label-3)' }}>@{post.author.handle.replace('.bsky.social', '')}</span>
                <span style={{ fontSize: 12, color: 'var(--label-3)' }}>· {formatTime(post.createdAt)}</span>
              </div>
            </div>
            <button
              aria-label="More"
              onClick={e => e.stopPropagation()}
              style={{ padding: 4, color: 'var(--label-3)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
            </button>
          </div>

          {/* Rich text body */}
          <p style={{ fontSize: 15, lineHeight: 1.5, letterSpacing: -0.2, color: 'var(--label-1)', marginBottom: 12, wordBreak: 'break-word' }}>
            <RichText text={post.content} />
          </p>

          {/* External link embed */}
          {post.embed?.type === 'external' && (
            <a
              href={post.embed.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ display: 'block', textDecoration: 'none', border: '1px solid var(--sep)', borderRadius: 14, overflow: 'hidden', marginBottom: 12, background: 'var(--bg)' }}
            >
              {post.embed.thumb && (
                <div style={{ height: 130, overflow: 'hidden' }}>
                  <img src={post.embed.thumb} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              <div style={{ padding: '10px 12px 12px' }}>
                <p style={{ fontSize: 11, color: 'var(--label-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{post.embed.domain}</p>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-1)', letterSpacing: -0.2, lineHeight: 1.3, marginBottom: 4 }}>{post.embed.title}</p>
                <p style={{ fontSize: 13, color: 'var(--label-2)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{post.embed.description}</p>
              </div>
            </a>
          )}

          {/* Quote post */}
          {post.embed?.type === 'quote' && (
            <div style={{ border: '1px solid var(--sep)', borderRadius: 14, padding: '12px 14px', marginBottom: 12, background: 'var(--bg)' }}>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                  {post.embed.post.author.displayName[0]}
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-1)' }}>{post.embed.post.author.displayName}</span>
                <span style={{ fontSize: 12, color: 'var(--label-3)' }}>@{post.embed.post.author.handle.replace('.bsky.social', '')}</span>
              </div>
              <p style={{ fontSize: 14, color: 'var(--label-1)', lineHeight: 1.4, letterSpacing: -0.2 }}>
                <RichText text={post.embed.post.content} />
              </p>
            </div>
          )}

          {/* Content-type chips */}
          {post.chips.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {post.chips.map(chip => {
                const c = CHIP[chip];
                return (
                  <span
                    key={chip}
                    style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 100, background: c.bg, color: c.color, fontSize: 12, fontWeight: 500, letterSpacing: -0.1 }}
                  >
                    {c.label}{chip === 'thread' && post.threadCount ? ` · ${post.threadCount}` : ''}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Action bar (not part of tap target) ── */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '8px 8px 14px', borderTop: '0.5px solid var(--sep)' }}>
        <Btn
          icon={<ReplyIcon />}
          count={post.replyCount}
          label="Reply"
          onPress={openStory}
        />
        <Btn icon={<RepostIcon />} count={post.repostCount} label="Repost" />
        <Btn
          icon={<HeartIcon filled={liked} />}
          count={post.likeCount + (liked ? 1 : 0)}
          label="Like"
          color={liked ? 'var(--red)' : undefined}
          onPress={e => { e.stopPropagation(); setLiked(v => !v); }}
        />
        <div style={{ flex: 1 }} />
        <Btn
          icon={<SaveIcon filled={saved} />}
          label="Save"
          color={saved ? 'var(--blue)' : undefined}
          onPress={e => { e.stopPropagation(); setSaved(v => !v); }}
        />
        <Btn icon={<ShareIcon />} label="Share" />
      </div>
    </motion.article>
  );
}

// ─── Action button ─────────────────────────────────────────────────────────
function Btn({ icon, count, label, color, onPress }: {
  icon: React.ReactNode;
  count?: number;
  label: string;
  color?: string;
  onPress?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onPress}
      aria-label={label}
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5,
        padding: '6px 10px', color: color || 'var(--label-2)',
        fontSize: 13, fontWeight: 400,
        background: 'none', border: 'none', cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {icon}
      {count !== undefined && <span>{formatCount(count)}</span>}
    </button>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────
const ReplyIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
  </svg>
);
const RepostIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/>
    <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
  </svg>
);
const HeartIcon = ({ filled }: { filled: boolean }) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
  </svg>
);
const SaveIcon = ({ filled }: { filled: boolean }) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
  </svg>
);
const ShareIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
);
