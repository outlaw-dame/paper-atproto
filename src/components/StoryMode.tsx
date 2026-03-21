import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { useDrag } from '@use-gesture/react';
import { X, ChevronLeft, ChevronRight, Bookmark, Share2, User, MessageCircle, Layers } from 'lucide-react';
import type { StoryEntry, EntityEntry } from '../App';
import { MOCK_POSTS } from '../data/mockData';

interface StoryModeProps {
  entry: StoryEntry;
  onClose: () => void;
  onOpenEntity: (entry: EntityEntry) => void;
}

interface StoryCard {
  id: string;
  type: 'overview' | 'source' | 'conversation' | 'graph' | 'dive';
  title: string;
  content: React.ReactNode;
}

export default function StoryMode({ entry, onClose, onOpenEntity }: StoryModeProps) {
  const [cardIndex, setCardIndex] = useState(0);
  const [direction, setDirection] = useState(0);

  const y = useMotionValue(0);
  const opacity = useTransform(y, [0, 200], [1, 0]);
  const scale = useTransform(y, [0, 200], [1, 0.95]);

  const bind = useDrag(
    ({ down, movement: [, my], velocity: [, vy], direction: [, dy] }) => {
      if (!down) {
        if (my > 120 || (vy > 0.5 && dy > 0)) {
          onClose();
        } else {
          y.set(0);
        }
      } else {
        if (my > 0) y.set(my);
      }
    },
    { axis: 'y', filterTaps: true }
  );

  // Build story cards based on entry type
  const post = MOCK_POSTS.find(p => p.id === entry.id) || MOCK_POSTS[0];

  const cards: StoryCard[] = [
    {
      id: 'overview',
      type: 'overview',
      title: 'Overview',
      content: <OverviewCard post={post} entry={entry} />,
    },
    {
      id: 'source',
      type: 'source',
      title: 'Source',
      content: <SourceCard post={post} />,
    },
    {
      id: 'conversation',
      type: 'conversation',
      title: 'Conversation',
      content: <ConversationCard post={post} />,
    },
    {
      id: 'graph',
      type: 'graph',
      title: 'Entity Graph',
      content: <GraphCard post={post} onOpenEntity={onOpenEntity} />,
    },
  ];

  const goNext = useCallback(() => {
    if (cardIndex < cards.length - 1) {
      setDirection(1);
      setCardIndex(i => i + 1);
    }
  }, [cardIndex, cards.length]);

  const goPrev = useCallback(() => {
    if (cardIndex > 0) {
      setDirection(-1);
      setCardIndex(i => i - 1);
    }
  }, [cardIndex]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'var(--surface-primary)', y, opacity, scale }}
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', stiffness: 400, damping: 40 }}
    >
      {/* Drag handle */}
      <div
        {...bind()}
        className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        aria-label="Drag down to close"
      >
        <div className="w-10 h-1 rounded-full" style={{ background: 'var(--fill-primary)' }} />
      </div>

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}
      >
        <button
          className="touch-target rounded-full"
          onClick={onClose}
          aria-label="Close story"
          style={{ color: 'var(--label-secondary)' }}
        >
          <X size={22} strokeWidth={2} />
        </button>

        {/* Progress indicators */}
        <div className="flex items-center gap-1.5 flex-1 mx-4">
          {cards.map((_, i) => (
            <div
              key={i}
              className="flex-1 story-progress"
              style={{ height: 2 }}
            >
              <div
                className="story-progress-fill"
                style={{
                  width: i < cardIndex ? '100%' : i === cardIndex ? '50%' : '0%',
                  background: 'var(--glimpse-blue)',
                }}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button className="touch-target" aria-label="Save" style={{ color: 'var(--label-secondary)' }}>
            <Bookmark size={20} strokeWidth={1.75} />
          </button>
          <button className="touch-target" aria-label="Share" style={{ color: 'var(--label-secondary)' }}>
            <Share2 size={20} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Card type label */}
      <div className="px-4 pb-2">
        <span
          className="text-xs font-semibold uppercase"
          style={{ color: 'var(--glimpse-blue)', letterSpacing: '0.5px' }}
        >
          {cards[cardIndex].title}
        </span>
      </div>

      {/* Card content */}
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={cardIndex}
            custom={direction}
            className="absolute inset-0 overflow-y-auto"
            initial={{ x: direction * 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: direction * -60, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="px-4 pb-8">
              {cards[cardIndex].content}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{
          paddingBottom: 'calc(var(--safe-bottom) + 12px)',
          borderTop: '1px solid var(--separator)',
        }}
      >
        <button
          className="flex items-center gap-1.5 touch-target"
          onClick={goPrev}
          disabled={cardIndex === 0}
          aria-label="Previous card"
          style={{ color: cardIndex === 0 ? 'var(--label-quaternary)' : 'var(--glimpse-blue)' }}
        >
          <ChevronLeft size={20} strokeWidth={2} />
          <span className="text-sm font-medium">
            {cardIndex > 0 ? cards[cardIndex - 1].title : 'Back'}
          </span>
        </button>

        <span className="text-sm" style={{ color: 'var(--label-tertiary)' }}>
          {cardIndex + 1} / {cards.length}
        </span>

        <button
          className="flex items-center gap-1.5 touch-target"
          onClick={goNext}
          disabled={cardIndex === cards.length - 1}
          aria-label="Next card"
          style={{ color: cardIndex === cards.length - 1 ? 'var(--label-quaternary)' : 'var(--glimpse-blue)' }}
        >
          <span className="text-sm font-medium">
            {cardIndex < cards.length - 1 ? cards[cardIndex + 1].title : 'Done'}
          </span>
          <ChevronRight size={20} strokeWidth={2} />
        </button>
      </div>
    </motion.div>
  );
}

// ── Card content components ──

function OverviewCard({ post, entry }: { post: typeof MOCK_POSTS[0]; entry: StoryEntry }) {
  return (
    <div>
      {/* Gist summary */}
      <div
        className="rounded-story p-5 mb-4"
        style={{
          background: 'linear-gradient(135deg, rgba(10,132,255,0.08) 0%, rgba(94,92,230,0.08) 100%)',
          border: '1px solid rgba(10,132,255,0.15)',
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center"
            style={{ background: 'var(--glimpse-blue)' }}
          >
            <span style={{ fontSize: '12px' }}>✦</span>
          </div>
          <span className="text-xs font-semibold uppercase" style={{ color: 'var(--glimpse-blue)', letterSpacing: '0.5px' }}>
            The Gist
          </span>
        </div>
        <p className="text-base font-medium leading-relaxed" style={{ color: 'var(--label-primary)', letterSpacing: '-0.3px' }}>
          {post.author.displayName} is discussing the significance of ATProto's open social graph and portable identity — a thread gaining significant traction in the decentralized web community.
        </p>
      </div>

      {/* Why it matters */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold uppercase mb-2" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
          Why it matters
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--label-primary)', letterSpacing: '-0.1px' }}>
          This post is part of a growing conversation about the future of social media infrastructure. The author has {post.likeCount.toLocaleString()} likes and {post.replyCount} replies, indicating strong community engagement.
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Likes', value: post.likeCount.toLocaleString(), color: 'var(--glimpse-red)' },
          { label: 'Replies', value: post.replyCount.toString(), color: 'var(--glimpse-blue)' },
          { label: 'Reposts', value: post.repostCount.toString(), color: 'var(--glimpse-green)' },
        ].map(stat => (
          <div
            key={stat.label}
            className="rounded-xl p-3 text-center"
            style={{ background: 'var(--surface-secondary)' }}
          >
            <p className="text-lg font-bold" style={{ color: stat.color, letterSpacing: '-0.5px' }}>{stat.value}</p>
            <p className="text-xs" style={{ color: 'var(--label-secondary)' }}>{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceCard({ post }: { post: typeof MOCK_POSTS[0] }) {
  return (
    <div>
      <div className="glimpse-card p-4 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0"
            style={{ background: 'var(--glimpse-indigo)' }}
          >
            {post.author.avatar && (
              <img src={post.author.avatar} alt={post.author.displayName} className="w-full h-full object-cover" />
            )}
          </div>
          <div>
            <p className="font-semibold text-sm" style={{ color: 'var(--label-primary)' }}>{post.author.displayName}</p>
            <p className="text-xs" style={{ color: 'var(--label-secondary)' }}>@{post.author.handle}</p>
          </div>
        </div>
        <p className="text-base leading-relaxed" style={{ color: 'var(--label-primary)', letterSpacing: '-0.3px' }}>
          {post.content}
        </p>
      </div>

      {post.media && post.media.length > 0 && (
        <div className="rounded-xl overflow-hidden mb-4">
          <img src={post.media[0].url} alt={post.media[0].alt || ''} className="w-full object-cover" style={{ maxHeight: 240 }} />
        </div>
      )}

      <div className="rounded-xl p-3" style={{ background: 'var(--surface-secondary)' }}>
        <p className="text-xs font-medium mb-1" style={{ color: 'var(--label-secondary)' }}>AT URI</p>
        <p className="text-xs font-mono" style={{ color: 'var(--label-tertiary)' }}>
          at://{post.author.did}/app.bsky.feed.post/{post.id}
        </p>
      </div>
    </div>
  );
}

function ConversationCard({ post }: { post: typeof MOCK_POSTS[0] }) {
  const replies = [
    { handle: 'bob.bsky.social', name: 'Bob Nakamura', content: 'This is exactly right. The portable identity piece is what changes everything.', likes: 234 },
    { handle: 'carol.bsky.social', name: 'Carol Williams', content: 'Agreed — and the custom feeds make it so much more than just another Twitter clone.', likes: 189 },
    { handle: 'dave.bsky.social', name: 'Dave Okonkwo', content: 'The key insight here is that the graph itself becomes a first-class object.', likes: 445 },
  ];

  return (
    <div>
      <p className="text-xs font-semibold uppercase mb-3" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
        Top Replies · {post.replyCount}
      </p>
      <div className="flex flex-col gap-3">
        {replies.map((reply, i) => (
          <div
            key={i}
            className="glimpse-card p-3"
          >
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                style={{ background: ['#0A84FF', '#5E5CE6', '#30D158'][i] }}
              >
                {reply.name[0]}
              </div>
              <div>
                <span className="text-xs font-semibold" style={{ color: 'var(--label-primary)' }}>{reply.name}</span>
                <span className="text-xs ml-1.5" style={{ color: 'var(--label-secondary)' }}>@{reply.handle}</span>
              </div>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--label-primary)' }}>{reply.content}</p>
            <div className="flex items-center gap-1 mt-2">
              <span style={{ fontSize: '12px', color: 'var(--label-secondary)' }}>♥ {reply.likes}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GraphCard({ post, onOpenEntity }: { post: typeof MOCK_POSTS[0]; onOpenEntity: (e: EntityEntry) => void }) {
  const entities: { type: EntityEntry['type']; name: string; reason: string; color: string; icon: string }[] = [
    { type: 'person', name: post.author.displayName, reason: 'Post author', color: 'var(--glimpse-blue)', icon: '👤' },
    { type: 'topic', name: 'ATProto', reason: 'Mentioned 3 times', color: 'var(--glimpse-purple)', icon: '✦' },
    { type: 'topic', name: 'Open Web', reason: 'Related topic cluster', color: 'var(--glimpse-indigo)', icon: '🌐' },
    { type: 'feed', name: 'Tech & Open Web', reason: 'Post appears in this feed', color: 'var(--glimpse-teal)', icon: '📡' },
    { type: 'pack', name: 'ATProto Builders', reason: 'Author is a member', color: 'var(--glimpse-orange)', icon: '🛠️' },
  ];

  return (
    <div>
      <p className="text-xs font-semibold uppercase mb-3" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
        Connected Entities
      </p>
      <div className="flex flex-col gap-2">
        {entities.map((e, i) => (
          <button
            key={i}
            className="flex items-center gap-3 p-3 rounded-xl text-left w-full"
            style={{ background: 'var(--surface-secondary)' }}
            onClick={() => onOpenEntity({ type: e.type, id: `entity-${i}`, name: e.name, reason: e.reason })}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base"
              style={{ background: `${e.color}18` }}
            >
              {e.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: 'var(--label-primary)' }}>{e.name}</p>
              <p className="text-xs" style={{ color: 'var(--label-secondary)' }}>{e.reason}</p>
            </div>
            <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--label-tertiary)', flexShrink: 0 }} />
          </button>
        ))}
      </div>
    </div>
  );
}


