import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { useDrag } from '@use-gesture/react';
import type { StoryEntry } from '../App';
import type { AppBskyFeedDefs, AppBskyFeedPost, AppBskyActorDefs } from '@atproto/api';
import { useAtp } from '../atproto/AtpContext';
import { mapFeedViewPost } from '../atproto/mappers';
import type { MockPost } from '../data/mockData';
import { formatTime, formatCount } from '../data/mockData';

interface Props {
  entry: StoryEntry;
  onClose: () => void;
}

const CARDS = ['Overview', 'Source', 'Conversation', 'Entity Graph'];

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2.5} strokeLinecap="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
        </path>
      </svg>
    </div>
  );
}

export default function StoryMode({ entry, onClose }: Props) {
  const { agent } = useAtp();
  const [cardIndex, setCardIndex] = useState(0);
  const [dir, setDir] = useState(0);
  const [post, setPost] = useState<MockPost | null>(null);
  const [replies, setReplies] = useState<MockPost[]>([]);
  const [loading, setLoading] = useState(true);

  const y = useMotionValue(0);
  const opacity = useTransform(y, [0, 200], [1, 0]);
  const scale = useTransform(y, [0, 200], [1, 0.95]);

  const bind = useDrag(({ down, movement: [, my], velocity: [, vy], direction: [, dy] }) => {
    if (!down) {
      if (my > 120 || (vy > 0.5 && dy > 0)) onClose();
      else y.set(0);
    } else {
      if (my > 0) y.set(my);
    }
  }, { axis: 'y', filterTaps: true });

  // Fetch the post thread from ATProto
  useEffect(() => {
    if (!agent.session || !entry.id) { setLoading(false); return; }
    setLoading(true);
    agent.getPostThread({ uri: entry.id, depth: 6 }).then(res => {
      const thread = res.data.thread as AppBskyFeedDefs.ThreadViewPost;
      if (thread?.post) {
        const postView = thread.post as AppBskyFeedDefs.PostView;
        const mapped = mapFeedViewPost({ post: postView, reply: undefined, reason: undefined });
        setPost(mapped);
        // Extract replies
        const replyItems = (thread.replies ?? []) as AppBskyFeedDefs.ThreadViewPost[];
        const mappedReplies = replyItems
          .filter(r => r?.post && (r.post.record as any)?.text)
          .slice(0, 8)
          .map(r => mapFeedViewPost({ post: r.post as AppBskyFeedDefs.PostView, reply: undefined, reason: undefined }));
        setReplies(mappedReplies);
      }
    }).catch(() => {
      // If the URI is not a valid AT URI (e.g., a mock ID), silently fail
    }).finally(() => setLoading(false));
  }, [agent, entry.id]);

  const goNext = useCallback(() => {
    if (cardIndex < CARDS.length - 1) { setDir(1); setCardIndex(i => i + 1); }
  }, [cardIndex]);

  const goPrev = useCallback(() => {
    if (cardIndex > 0) { setDir(-1); setCardIndex(i => i - 1); }
  }, [cardIndex]);

  return (
    <motion.div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg)',
        y, opacity, scale,
      }}
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', stiffness: 380, damping: 40 }}
    >
      {/* Handle */}
      <div
        {...bind()}
        style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 4, touchAction: 'none', cursor: 'grab' }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--fill-3)' }} />
      </div>

      {/* Header */}
      <div style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center',
        padding: 'calc(var(--safe-top) + 4px) 16px 8px',
      }}>
        <button onClick={onClose} aria-label="Close" style={{ padding: 6, color: 'var(--label-2)', background: 'none', border: 'none', cursor: 'pointer' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        {/* Progress bars */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', gap: 4, margin: '0 12px' }}>
          {CARDS.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 2, borderRadius: 1, background: 'var(--fill-3)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 1,
                background: 'var(--blue)',
                width: i < cardIndex ? '100%' : i === cardIndex ? '50%' : '0%',
                transition: 'width 0.3s',
              }} />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
          <button aria-label="Save" style={{ padding: 6, color: 'var(--label-2)', background: 'none', border: 'none', cursor: 'pointer' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
            </svg>
          </button>
          <button aria-label="Share" style={{ padding: 6, color: 'var(--label-2)', background: 'none', border: 'none', cursor: 'pointer' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Card type label */}
      <div style={{ padding: '0 16px 8px' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          {CARDS[cardIndex]}
        </span>
      </div>

      {/* Card content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {loading ? (
          <Spinner />
        ) : (
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={cardIndex}
              custom={dir}
              style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}
              initial={{ x: dir * 60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: dir * -60, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            >
              <div style={{ padding: '0 16px 32px' }}>
                {cardIndex === 0 && <OverviewCard post={post} entry={entry} />}
                {cardIndex === 1 && <SourceCard post={post} />}
                {cardIndex === 2 && <ConversationCard replies={replies} />}
                {cardIndex === 3 && <GraphCard post={post} />}
              </div>
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Navigation */}
      <div style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', paddingBottom: 'calc(var(--safe-bottom) + 12px)',
        borderTop: '0.5px solid var(--sep)',
      }}>
        <button
          onClick={goPrev}
          disabled={cardIndex === 0}
          style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 500, color: cardIndex === 0 ? 'var(--label-4)' : 'var(--blue)', background: 'none', border: 'none', cursor: cardIndex === 0 ? 'default' : 'pointer' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          {cardIndex > 0 ? CARDS[cardIndex - 1] : 'Back'}
        </button>

        <span style={{ fontSize: 13, color: 'var(--label-3)' }}>{cardIndex + 1} / {CARDS.length}</span>

        <button
          onClick={goNext}
          disabled={cardIndex === CARDS.length - 1}
          style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 500, color: cardIndex === CARDS.length - 1 ? 'var(--label-4)' : 'var(--blue)', background: 'none', border: 'none', cursor: cardIndex === CARDS.length - 1 ? 'default' : 'pointer' }}
        >
          {cardIndex < CARDS.length - 1 ? CARDS[cardIndex + 1] : 'Done'}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>
    </motion.div>
  );
}

// ─── Overview card ─────────────────────────────────────────────────────────
function OverviewCard({ post, entry }: { post: MockPost | null; entry: StoryEntry }) {
  if (!post) return (
    <div style={{ padding: '24px 0', textAlign: 'center' }}>
      <p style={{ fontSize: 14, color: 'var(--label-3)' }}>Could not load post details.</p>
    </div>
  );
  return (
    <div>
      {/* Gist card */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(10,132,255,0.08), rgba(94,92,230,0.08))',
        border: '1px solid rgba(10,132,255,0.15)',
        borderRadius: 20, padding: '18px 16px', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12 }}>✦</div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', letterSpacing: 0.5, textTransform: 'uppercase' }}>The Gist</span>
        </div>
        <p style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.5, color: 'var(--label-1)', letterSpacing: -0.3 }}>
          {post.author.displayName} shared this post {formatTime(post.createdAt)} ago.
          {post.replyCount > 0 ? ` It has sparked ${post.replyCount} replies` : ''}
          {post.likeCount > 0 ? ` and received ${formatCount(post.likeCount)} likes` : ''}.
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {[
          { label: 'Likes', value: formatCount(post.likeCount), color: 'var(--red)' },
          { label: 'Replies', value: formatCount(post.replyCount), color: 'var(--blue)' },
          { label: 'Reposts', value: formatCount(post.repostCount), color: 'var(--green)' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--surface)', borderRadius: 14, padding: '12px 8px', textAlign: 'center' }}>
            <p style={{ fontSize: 20, fontWeight: 700, color: s.color, letterSpacing: -0.5, marginBottom: 2 }}>{s.value}</p>
            <p style={{ fontSize: 12, color: 'var(--label-3)' }}>{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Source card ───────────────────────────────────────────────────────────
function SourceCard({ post }: { post: MockPost | null }) {
  if (!post) return (
    <div style={{ padding: '24px 0', textAlign: 'center' }}>
      <p style={{ fontSize: 14, color: 'var(--label-3)' }}>Could not load source.</p>
    </div>
  );
  return (
    <div>
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', overflow: 'hidden', background: 'var(--indigo)', flexShrink: 0 }}>
            {post.author.avatar && <img src={post.author.avatar} alt={post.author.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-1)' }}>{post.author.displayName}</p>
            <p style={{ fontSize: 12, color: 'var(--label-3)' }}>@{post.author.handle}</p>
          </div>
          <p style={{ fontSize: 12, color: 'var(--label-4)', marginLeft: 'auto' }}>{formatTime(post.createdAt)}</p>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.45, color: 'var(--label-1)', letterSpacing: -0.2 }}>{post.content}</p>
      </div>

      {post.media?.[0] && (
        <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 14, maxHeight: 240 }}>
          <img src={post.media[0].url} alt={post.media[0].alt || ''} style={{ width: '100%', objectFit: 'cover', maxHeight: 240 }} />
        </div>
      )}

      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: '10px 14px' }}>
        <p style={{ fontSize: 11, color: 'var(--label-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>AT URI</p>
        <p style={{ fontSize: 12, color: 'var(--blue)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
          {post.id}
        </p>
      </div>
    </div>
  );
}

// ─── Conversation card ─────────────────────────────────────────────────────
function ConversationCard({ replies }: { replies: MockPost[] }) {
  if (replies.length === 0) return (
    <div style={{ padding: '24px 0', textAlign: 'center' }}>
      <p style={{ fontSize: 14, color: 'var(--label-3)' }}>No replies yet.</p>
    </div>
  );
  return (
    <div>
      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-3)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>
        Top Replies
      </p>
      {replies.map(r => (
        <div key={r.id} style={{ background: 'var(--surface)', borderRadius: 14, padding: '12px 14px', marginBottom: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
              {r.author.avatar
                ? <img src={r.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : r.author.displayName[0]
              }
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-1)' }}>{r.author.displayName}</span>
            <span style={{ fontSize: 12, color: 'var(--label-3)', marginLeft: 'auto' }}>♥ {formatCount(r.likeCount)}</span>
          </div>
          <p style={{ fontSize: 14, color: 'var(--label-1)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {r.content}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Entity graph card ─────────────────────────────────────────────────────
function GraphCard({ post }: { post: MockPost | null }) {
  if (!post) return (
    <div style={{ padding: '24px 0', textAlign: 'center' }}>
      <p style={{ fontSize: 14, color: 'var(--label-3)' }}>No entities detected.</p>
    </div>
  );

  // Extract hashtags and mentions from post text as "entities"
  const hashtags = (post.content.match(/#\w+/g) ?? []).slice(0, 4);
  const mentions = (post.content.match(/@[\w.]+/g) ?? []).slice(0, 3);

  const entities = [
    ...hashtags.map(tag => ({ label: tag, type: 'Hashtag', color: 'var(--blue)' })),
    ...mentions.map(m => ({ label: m, type: 'Mention', color: 'var(--purple)' })),
    { label: post.author.displayName, type: 'Author', color: 'var(--teal)' },
  ];

  if (entities.length === 0) {
    entities.push({ label: 'ATProto', type: 'Protocol', color: 'var(--blue)' });
  }

  return (
    <div>
      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-3)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>Detected Entities</p>
      {entities.map((e, i) => (
        <div key={i} style={{ background: 'var(--surface)', borderRadius: 14, padding: '12px 14px', marginBottom: 8, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: e.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: e.color }}>{e.label[0]}</span>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-1)', marginBottom: 2 }}>{e.label}</p>
            <p style={{ fontSize: 12, color: 'var(--label-3)' }}>{e.type}</p>
          </div>
          <button style={{ padding: '5px 12px', borderRadius: 100, background: e.color + '15', color: e.color, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
            Explore
          </button>
        </div>
      ))}
    </div>
  );
}
