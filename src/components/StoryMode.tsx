// ─── StoryMode ────────────────────────────────────────────────────────────
// Gist × Paper × Narwhal — the immersive story reader.
//
// Pipeline A cards (Neeva Gist-style):
//   0. Overview    — stats, gist summary, author, media
//   1. Source      — full post text, AT URI, facets, labels
//   2. Conversation — scored replies with Narwhal-style contribution roles
//   3. Signals     — deterministic cluster signals (hashtags, domains, mentions, quotes)
//
// Pipeline B card (Narwhal-style):
//   4. Interpolator — rolling thread state: summary, heat, clarifications, new angles
//
// The thread is fetched via ATProto, resolved deterministically, and then
// scored heuristically (Phase 1) or via SetFit (Phase 2).

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { useDrag } from '@use-gesture/react';
import type { StoryEntry } from '../App';
import type { AppBskyFeedDefs } from '@atproto/api';
import { useSessionStore } from '../store/sessionStore';
import { atpCall } from '../lib/atproto/client';
import { mapFeedViewPost } from '../atproto/mappers';
import type { MockPost } from '../data/mockData';
import { formatTime, formatCount } from '../data/mockData';
import {
  resolveThread, extractClusterSignals,
  type ThreadNode, type ResolvedFacet, type ClusterSignals,
} from '../lib/resolver/atproto';
import {
  useThreadStore,
  heuristicScoreReply, buildRollingSummary,
  type ContributionRole, type ReplyScore,
} from '../store/threadStore';

interface Props {
  entry: StoryEntry;
  onClose: () => void;
}

const CARDS = ['Overview', 'Source', 'Conversation', 'Signals', 'Interpolator'] as const;
type CardName = typeof CARDS[number];

const ROLE_CONFIG: Record<ContributionRole, { label: string; color: string; bg: string }> = {
  clarifying:        { label: 'Clarifying',       color: 'var(--blue)',   bg: 'rgba(10,132,255,0.1)' },
  new_information:   { label: 'New info',          color: 'var(--teal)',   bg: 'rgba(90,200,250,0.1)' },
  direct_response:   { label: 'Direct response',   color: 'var(--green)',  bg: 'rgba(48,209,88,0.1)' },
  repetitive:        { label: 'Repetitive',        color: 'var(--label-3)', bg: 'var(--fill-2)' },
  provocative:       { label: 'Provocative',       color: 'var(--orange)', bg: 'rgba(255,159,10,0.1)' },
  useful_counterpoint: { label: 'Counterpoint',    color: 'var(--purple)', bg: 'rgba(191,90,242,0.1)' },
  story_worthy:      { label: 'Story-worthy',      color: 'var(--red)',    bg: 'rgba(255,69,58,0.1)' },
  unknown:           { label: 'Reply',             color: 'var(--label-3)', bg: 'var(--fill-2)' },
};

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

// ─── Rich text renderer (inline) ──────────────────────────────────────────
function RichText({ text, facets }: { text: string; facets?: ResolvedFacet[] }) {
  if (!facets?.length) {
    // Fallback: regex-based linkification
    const parts = text.split(/(@[\w.]+|#\w+|https?:\/\/\S+)/g);
    return (
      <span>
        {parts.map((p, i) => {
          if (p.startsWith('@')) return <span key={i} style={{ color: 'var(--purple)', fontWeight: 500 }}>{p}</span>;
          if (p.startsWith('#')) return <span key={i} style={{ color: 'var(--blue)', fontWeight: 500 }}>{p}</span>;
          if (p.startsWith('http')) return <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }} onClick={e => e.stopPropagation()}>{new URL(p).hostname.replace(/^www\./, '')}</a>;
          return <span key={i}>{p}</span>;
        })}
      </span>
    );
  }

  // Byte-accurate rendering using resolved facets
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(text);
  const segments: React.ReactNode[] = [];
  let pos = 0;

  const sorted = [...facets].sort((a, b) => a.byteStart - b.byteStart);
  for (const f of sorted) {
    if (f.byteStart > pos) {
      segments.push(<span key={`t${pos}`}>{decoder.decode(bytes.slice(pos, f.byteStart))}</span>);
    }
    const span = decoder.decode(bytes.slice(f.byteStart, f.byteEnd));
    if (f.kind === 'mention') {
      segments.push(<span key={`f${f.byteStart}`} style={{ color: 'var(--purple)', fontWeight: 500 }}>{span}</span>);
    } else if (f.kind === 'hashtag') {
      segments.push(<span key={`f${f.byteStart}`} style={{ color: 'var(--blue)', fontWeight: 500 }}>{span}</span>);
    } else if (f.kind === 'link') {
      segments.push(
        <a key={`f${f.byteStart}`} href={f.uri} target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--blue)' }} onClick={e => e.stopPropagation()}>
          {f.domain ?? span}
        </a>
      );
    }
    pos = f.byteEnd;
  }
  if (pos < bytes.length) {
    segments.push(<span key={`t${pos}`}>{decoder.decode(bytes.slice(pos))}</span>);
  }
  return <span>{segments}</span>;
}

// ─── Main component ────────────────────────────────────────────────────────
export default function StoryMode({ entry, onClose }: Props) {
  const { agent, session } = useSessionStore();
  const { initThread, updateSummary, setReplyScore, setUserFeedback, getThread } = useThreadStore();

  const [cardIndex, setCardIndex] = useState(0);
  const [dir, setDir] = useState(0);
  const [post, setPost] = useState<MockPost | null>(null);
  const [rootNode, setRootNode] = useState<ThreadNode | null>(null);
  const [replies, setReplies] = useState<ThreadNode[]>([]);
  const [signals, setSignals] = useState<ClusterSignals | null>(null);
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

  // Fetch and resolve the thread
  useEffect(() => {
    if (!session || !entry.id) { setLoading(false); return; }
    setLoading(true);

    atpCall(s => agent.getPostThread({ uri: entry.id, depth: 6 }))
      .then(res => {
        const thread = res.data.thread as AppBskyFeedDefs.ThreadViewPost;
        if (!thread?.post) return;

        // Pipeline A: deterministic resolution
        const resolved = resolveThread(thread);
        setRootNode(resolved);

        // Map to MockPost for OverviewCard / SourceCard compatibility
        const postView = thread.post as AppBskyFeedDefs.PostView;
        setPost(mapFeedViewPost({ post: postView, reply: undefined, reason: undefined }));

        // Extract cluster signals
        const sig = extractClusterSignals(
          resolved.text,
          resolved.facets,
          resolved.embed,
          resolved.labels
        );
        setSignals(sig);

        // Flatten replies (depth-first, max 12)
        const flatReplies: ThreadNode[] = [];
        const flatten = (nodes: ThreadNode[]) => {
          for (const n of nodes) {
            if (flatReplies.length >= 12) break;
            flatReplies.push(n);
            if (n.replies.length) flatten(n.replies);
          }
        };
        flatten(resolved.replies);
        setReplies(flatReplies);

        // Pipeline B: initialize thread state and score replies heuristically
        initThread(resolved.uri);
        const threadTexts = flatReplies.map(r => r.text);
        const scores: Record<string, ReplyScore> = {};
        for (const reply of flatReplies) {
          const score = heuristicScoreReply(reply.text, threadTexts, reply.likeCount);
          score.uri = reply.uri;
          scores[reply.uri] = score;
          setReplyScore(resolved.uri, score);
        }

        // Build initial rolling summary
        const summary = buildRollingSummary(resolved.text, flatReplies, scores);
        updateSummary(resolved.uri, summary);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session, entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const threadState = rootNode ? getThread(rootNode.uri) : null;

  const goNext = useCallback(() => {
    if (cardIndex < CARDS.length - 1) { setDir(1); setCardIndex(i => i + 1); }
  }, [cardIndex]);

  const goPrev = useCallback(() => {
    if (cardIndex > 0) { setDir(-1); setCardIndex(i => i - 1); }
  }, [cardIndex]);

  const handleFeedback = useCallback((replyUri: string, fb: ReplyScore['userFeedback']) => {
    if (!rootNode) return;
    setUserFeedback(rootNode.uri, replyUri, fb);
  }, [rootNode, setUserFeedback]);

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
      {/* Drag handle */}
      <div {...bind()} style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 4, touchAction: 'none', cursor: 'grab' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--fill-3)' }} />
      </div>

      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', padding: 'calc(var(--safe-top) + 4px) 16px 8px' }}>
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
                height: '100%', borderRadius: 1, background: i === CARDS.length - 1 ? 'var(--purple)' : 'var(--blue)',
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

      {/* Card label */}
      <div style={{ padding: '0 16px 8px', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
          color: cardIndex === CARDS.length - 1 ? 'var(--purple)' : 'var(--blue)',
        }}>
          {CARDS[cardIndex]}
        </span>
        {cardIndex === CARDS.length - 1 && threadState && (
          <span style={{ fontSize: 11, color: 'var(--label-3)' }}>
            Updated {formatTime(threadState.updatedAt)}
          </span>
        )}
      </div>

      {/* Card content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {loading ? <Spinner /> : (
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
                {cardIndex === 1 && <SourceCard post={post} rootNode={rootNode} />}
                {cardIndex === 2 && <ConversationCard replies={replies} rootUri={rootNode?.uri ?? ''} onFeedback={handleFeedback} />}
                {cardIndex === 3 && <SignalsCard signals={signals} />}
                {cardIndex === 4 && <InterpolatorCard threadState={threadState} replies={replies} />}
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
  if (!post) return <div style={{ padding: '24px 0', textAlign: 'center' }}><p style={{ fontSize: 14, color: 'var(--label-3)' }}>Could not load post.</p></div>;

  return (
    <div>
      {/* Gist card */}
      <div style={{ background: 'linear-gradient(135deg, rgba(10,132,255,0.08), rgba(94,92,230,0.08))', border: '1px solid rgba(10,132,255,0.15)', borderRadius: 20, padding: '18px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12 }}>✦</div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', letterSpacing: 0.5, textTransform: 'uppercase' }}>The Gist</span>
        </div>
        <p style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.5, color: 'var(--label-1)', letterSpacing: -0.3 }}>
          {post.author.displayName} posted {formatTime(post.createdAt)} ago.
          {post.replyCount > 0 ? ` It has sparked ${post.replyCount} replies` : ''}
          {post.likeCount > 0 ? ` and received ${formatCount(post.likeCount)} likes` : ''}.
        </p>
      </div>

      {/* Author */}
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '12px 14px', marginBottom: 12, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', background: 'var(--indigo)', flexShrink: 0 }}>
          {post.author.avatar && <img src={post.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        </div>
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-1)' }}>{post.author.displayName}</p>
          <p style={{ fontSize: 12, color: 'var(--label-3)' }}>@{post.author.handle}</p>
        </div>
        <p style={{ fontSize: 12, color: 'var(--label-4)', marginLeft: 'auto' }}>{formatTime(post.createdAt)}</p>
      </div>

      {/* Media */}
      {post.media?.[0] && (
        <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
          <img src={post.media[0].url} alt={post.media[0].alt || ''} style={{ width: '100%', objectFit: 'cover', maxHeight: 220 }} />
        </div>
      )}

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
function SourceCard({ post, rootNode }: { post: MockPost | null; rootNode: ThreadNode | null }) {
  if (!post || !rootNode) return <div style={{ padding: '24px 0', textAlign: 'center' }}><p style={{ fontSize: 14, color: 'var(--label-3)' }}>Could not load source.</p></div>;

  return (
    <div>
      {/* Full post text with byte-accurate facets */}
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', overflow: 'hidden', background: 'var(--indigo)', flexShrink: 0 }}>
            {post.author.avatar && <img src={post.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-1)' }}>{post.author.displayName}</p>
            <p style={{ fontSize: 12, color: 'var(--label-3)' }}>@{post.author.handle}</p>
          </div>
          <p style={{ fontSize: 12, color: 'var(--label-4)', marginLeft: 'auto' }}>{formatTime(post.createdAt)}</p>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--label-1)', letterSpacing: -0.2 }}>
          <RichText text={rootNode.text} facets={rootNode.facets} />
        </p>
      </div>

      {/* Labels */}
      {rootNode.labels.length > 0 && (
        <div style={{ background: 'rgba(255,159,10,0.08)', border: '1px solid rgba(255,159,10,0.2)', borderRadius: 12, padding: '10px 14px', marginBottom: 12 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--orange)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Content Labels</p>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {rootNode.labels.map((l, i) => (
              <span key={i} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 100, background: 'rgba(255,159,10,0.12)', color: 'var(--orange)', fontWeight: 500 }}>
                {l.neg ? '−' : ''}{l.val}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* AT URI */}
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: '10px 14px' }}>
        <p style={{ fontSize: 11, color: 'var(--label-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>AT URI</p>
        <p style={{ fontSize: 12, color: 'var(--blue)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{rootNode.uri}</p>
      </div>
    </div>
  );
}

// ─── Conversation card ─────────────────────────────────────────────────────
function ConversationCard({
  replies, rootUri, onFeedback,
}: {
  replies: ThreadNode[];
  rootUri: string;
  onFeedback: (replyUri: string, fb: ReplyScore['userFeedback']) => void;
}) {
  const { getThread } = useThreadStore();
  const threadState = getThread(rootUri);
  const scores = threadState?.replyScores ?? {};

  // Sort by usefulness, filter out repetitive unless nothing else
  const sorted = useMemo(() => {
    const useful = replies.filter(r => (scores[r.uri]?.role ?? 'unknown') !== 'repetitive');
    const rest = replies.filter(r => (scores[r.uri]?.role ?? 'unknown') === 'repetitive');
    return [...useful.sort((a, b) => (scores[b.uri]?.usefulnessScore ?? 0) - (scores[a.uri]?.usefulnessScore ?? 0)), ...rest];
  }, [replies, scores]);

  if (sorted.length === 0) return <div style={{ padding: '24px 0', textAlign: 'center' }}><p style={{ fontSize: 14, color: 'var(--label-3)' }}>No replies yet.</p></div>;

  return (
    <div>
      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-3)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>
        {sorted.length} Replies — sorted by quality
      </p>
      {sorted.map(r => {
        const score = scores[r.uri];
        const roleConf = ROLE_CONFIG[score?.role ?? 'unknown'];
        const isRepetitive = score?.role === 'repetitive';

        return (
          <div key={r.uri} style={{
            background: 'var(--surface)', borderRadius: 14, padding: '12px 14px', marginBottom: 8,
            opacity: isRepetitive ? 0.55 : 1,
          }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {r.authorHandle[0]?.toUpperCase()}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-1)' }}>@{r.authorHandle}</span>
              {/* Role chip */}
              <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 100, background: roleConf.bg, color: roleConf.color, fontWeight: 600, marginLeft: 'auto' }}>
                {roleConf.label}
              </span>
            </div>

            <p style={{ fontSize: 14, color: 'var(--label-1)', lineHeight: 1.4, marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              <RichText text={r.text} facets={r.facets} />
            </p>

            {/* User feedback buttons */}
            <div style={{ display: 'flex', flexDirection: 'row', gap: 6 }}>
              {(['clarifying', 'new_to_me', 'provocative', 'aha'] as const).map(fb => {
                const labels: Record<string, string> = { clarifying: 'Clarifying', new_to_me: 'New to me', provocative: 'Provocative', aha: 'AHA!' };
                const active = score?.userFeedback === fb;
                return (
                  <button
                    key={fb}
                    onClick={() => onFeedback(r.uri, fb)}
                    style={{
                      fontSize: 11, padding: '3px 8px', borderRadius: 100,
                      background: active ? 'var(--blue)' : 'var(--fill-2)',
                      color: active ? '#fff' : 'var(--label-2)',
                      border: 'none', cursor: 'pointer', fontWeight: active ? 600 : 400,
                      transition: 'all 0.15s',
                    }}
                  >
                    {labels[fb]}
                  </button>
                );
              })}
              <span style={{ fontSize: 12, color: 'var(--label-3)', marginLeft: 'auto', alignSelf: 'center' }}>
                ♥ {formatCount(r.likeCount)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Signals card (Pipeline A deterministic layer) ─────────────────────────
function SignalsCard({ signals }: { signals: ClusterSignals | null }) {
  if (!signals) return <div style={{ padding: '24px 0', textAlign: 'center' }}><p style={{ fontSize: 14, color: 'var(--label-3)' }}>No signals detected.</p></div>;

  const sections = [
    { label: 'Hashtags', items: signals.hashtags, color: 'var(--blue)', prefix: '#' },
    { label: 'Mentioned Actors', items: signals.mentionedDids, color: 'var(--purple)', prefix: '' },
    { label: 'Domains', items: signals.domains, color: 'var(--teal)', prefix: '' },
    { label: 'Quoted Posts', items: signals.quotedUris, color: 'var(--orange)', prefix: '' },
    { label: 'Content Labels', items: signals.labelValues, color: 'var(--red)', prefix: '' },
  ].filter(s => s.items.length > 0);

  if (sections.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: 'var(--label-3)' }}>No deterministic signals found in this post.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
        <p style={{ fontSize: 12, color: 'var(--label-3)', lineHeight: 1.5 }}>
          These signals are extracted deterministically from the post's ATProto facets, embeds, and labels — no inference required. They power Pipeline A's clustering and grouping.
        </p>
      </div>

      {sections.map(sec => (
        <div key={sec.label} style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-3)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>{sec.label}</p>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {sec.items.map((item, i) => (
              <span key={i} style={{
                fontSize: 13, padding: '5px 10px', borderRadius: 100,
                background: sec.color + '15', color: sec.color, fontWeight: 500,
                maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {sec.prefix}{item.length > 40 ? item.slice(0, 38) + '…' : item}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Interpolator card (Pipeline B Narwhal-style) ─────────────────────────
function InterpolatorCard({ threadState, replies }: {
  threadState: ReturnType<typeof useThreadStore.getState>['threads'][string] | null;
  replies: ThreadNode[];
}) {
  const scores = threadState?.replyScores ?? {};

  const topReplies = useMemo(() =>
    replies
      .filter(r => (scores[r.uri]?.usefulnessScore ?? 0) > 0.6)
      .sort((a, b) => (scores[b.uri]?.usefulnessScore ?? 0) - (scores[a.uri]?.usefulnessScore ?? 0))
      .slice(0, 3),
    [replies, scores]
  );

  const heatPct = Math.round((threadState?.heatLevel ?? 0) * 100);
  const repPct = Math.round((threadState?.repetitionLevel ?? 0) * 100);

  return (
    <div>
      {/* AI Interpolator header */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(191,90,242,0.1), rgba(94,92,230,0.1))',
        border: '1px solid rgba(191,90,242,0.2)',
        borderRadius: 20, padding: '16px', marginBottom: 14,
      }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12 }}>◈</div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)', letterSpacing: 0.5, textTransform: 'uppercase' }}>AI Interpolator</span>
          {threadState && (
            <span style={{ fontSize: 11, color: 'var(--label-3)', marginLeft: 'auto' }}>
              v{threadState.version} · {formatTime(threadState.updatedAt)}
            </span>
          )}
        </div>
        <p style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5, color: 'var(--label-1)', letterSpacing: -0.2 }}>
          {threadState?.summaryText || 'Analyzing discussion…'}
        </p>
      </div>

      {/* Thread health meters */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Heat level', pct: heatPct, color: heatPct > 50 ? 'var(--red)' : 'var(--orange)' },
          { label: 'Repetition', pct: repPct, color: repPct > 50 ? 'var(--label-3)' : 'var(--green)' },
        ].map(m => (
          <div key={m.label} style={{ background: 'var(--surface)', borderRadius: 14, padding: '12px 14px' }}>
            <p style={{ fontSize: 12, color: 'var(--label-3)', marginBottom: 6 }}>{m.label}</p>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--fill-3)', overflow: 'hidden', marginBottom: 4 }}>
              <div style={{ height: '100%', borderRadius: 2, background: m.color, width: `${m.pct}%`, transition: 'width 0.4s' }} />
            </div>
            <p style={{ fontSize: 13, fontWeight: 600, color: m.color }}>{m.pct}%</p>
          </div>
        ))}
      </div>

      {/* New angles */}
      {(threadState?.newAnglesAdded?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-3)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>New Angles Added</p>
          {threadState!.newAnglesAdded.map((a, i) => (
            <div key={i} style={{ background: 'var(--surface)', borderRadius: 12, padding: '10px 12px', marginBottom: 6 }}>
              <p style={{ fontSize: 13, color: 'var(--label-1)', lineHeight: 1.4 }}>"{a}"</p>
            </div>
          ))}
        </div>
      )}

      {/* Top replies by usefulness */}
      {topReplies.length > 0 && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-3)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>Most Useful Replies</p>
          {topReplies.map(r => {
            const score = scores[r.uri];
            const roleConf = ROLE_CONFIG[score?.role ?? 'unknown'];
            return (
              <div key={r.uri} style={{ background: 'var(--surface)', borderRadius: 14, padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-1)' }}>@{r.authorHandle}</span>
                  <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 100, background: roleConf.bg, color: roleConf.color, fontWeight: 600, marginLeft: 'auto' }}>
                    {roleConf.label}
                  </span>
                </div>
                <p style={{ fontSize: 14, color: 'var(--label-1)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {r.text}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Source support indicator */}
      {threadState?.sourceSupportPresent && (
        <div style={{ background: 'rgba(48,209,88,0.08)', border: '1px solid rgba(48,209,88,0.2)', borderRadius: 12, padding: '10px 14px', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <p style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>Sources cited in this discussion</p>
        </div>
      )}
    </div>
  );
}
