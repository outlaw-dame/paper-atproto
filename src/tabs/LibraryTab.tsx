import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Bookmark, Rss, Package, Clock, Sparkles } from 'lucide-react';
import { MOCK_POSTS, MOCK_FEEDS, MOCK_PACKS, formatTime } from '../data/mockData';
import type { StoryEntry } from '../App';

interface LibraryTabProps {
  onOpenStory: (entry: StoryEntry) => void;
}

const SECTIONS = [
  { id: 'saved',   label: 'Saved',   icon: Bookmark },
  { id: 'feeds',   label: 'My Feeds', icon: Rss },
  { id: 'packs',   label: 'My Packs', icon: Package },
  { id: 'history', label: 'History',  icon: Clock },
] as const;
type SectionId = typeof SECTIONS[number]['id'];

export default function LibraryTab({ onOpenStory }: LibraryTabProps) {
  const [section, setSection] = useState<SectionId>('saved');

  // Simulate saved posts (first 3)
  const savedPosts = MOCK_POSTS.slice(0, 3);

  return (
    <div className="min-h-full">
      {/* Section tabs */}
      <div
        className="sticky top-0 z-10 px-4 pt-3 pb-2"
        style={{ background: 'var(--surface-secondary)' }}
      >
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-chip text-sm font-medium whitespace-nowrap flex-shrink-0"
              style={{
                background: section === id ? 'var(--glimpse-blue)' : 'var(--fill-secondary)',
                color: section === id ? 'white' : 'var(--label-secondary)',
                transition: 'background 0.15s, color 0.15s',
              }}
              aria-pressed={section === id}
            >
              <Icon size={13} strokeWidth={2} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-4">
        {section === 'saved' && (
          <SavedSection posts={savedPosts} onOpenStory={onOpenStory} />
        )}
        {section === 'feeds' && (
          <MyFeedsSection />
        )}
        {section === 'packs' && (
          <MyPacksSection />
        )}
        {section === 'history' && (
          <HistorySection posts={MOCK_POSTS.slice(0, 4)} onOpenStory={onOpenStory} />
        )}
      </div>
    </div>
  );
}

function SavedSection({ posts, onOpenStory }: { posts: typeof MOCK_POSTS; onOpenStory: (e: StoryEntry) => void }) {
  if (posts.length === 0) {
    return (
      <EmptyState icon="🔖" title="Nothing saved yet" subtitle="Tap the bookmark icon on any post to save it here." />
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase mb-3 mt-1" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
        {posts.length} Saved Posts
      </p>
      <div className="flex flex-col gap-2">
        {posts.map((post, i) => (
          <motion.button
            key={post.id}
            className="glimpse-card p-4 text-left w-full"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName })}
          >
            {/* Media thumbnail */}
            {post.media && post.media[0] && (
              <div className="w-full rounded-xl overflow-hidden mb-3" style={{ height: 120 }}>
                <img src={post.media[0].url} alt="" className="w-full h-full object-cover" loading="lazy" />
              </div>
            )}
            <div className="flex items-center gap-2 mb-1.5">
              <div
                className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0"
                style={{ background: 'var(--glimpse-indigo)' }}
              >
                {post.author.avatar && <img src={post.author.avatar} alt="" className="w-full h-full object-cover" />}
              </div>
              <span className="text-xs font-medium" style={{ color: 'var(--label-secondary)' }}>
                {post.author.displayName}
              </span>
              <span className="text-xs" style={{ color: 'var(--label-tertiary)' }}>·</span>
              <span className="text-xs" style={{ color: 'var(--label-tertiary)' }}>{formatTime(post.createdAt)}</span>
            </div>
            <p className="text-sm leading-relaxed line-clamp-3" style={{ color: 'var(--label-primary)', letterSpacing: '-0.1px' }}>
              {post.content}
            </p>
            <div className="flex items-center gap-1.5 mt-2">
              {post.chips.slice(0, 2).map(chip => (
                <span key={chip} className={`glimpse-chip ${chip === 'story' ? 'blue' : chip === 'topic' ? 'purple' : 'teal'}`}>
                  {chip}
                </span>
              ))}
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function MyFeedsSection() {
  return (
    <div>
      <p className="text-xs font-semibold uppercase mb-3 mt-1" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
        Following {MOCK_FEEDS.length} Feeds
      </p>
      <div className="flex flex-col gap-2">
        {MOCK_FEEDS.map((feed, i) => (
          <motion.div
            key={feed.id}
            className="glimpse-card p-4 flex items-center gap-3"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: 'var(--surface-secondary)' }}
            >
              {feed.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm" style={{ color: 'var(--label-primary)' }}>{feed.name}</p>
              <p className="text-xs" style={{ color: 'var(--label-secondary)' }}>by @{feed.creator}</p>
            </div>
            <button
              className="px-3 py-1.5 rounded-chip text-xs font-semibold"
              style={{ background: 'var(--fill-secondary)', color: 'var(--label-secondary)' }}
            >
              Unfollow
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function MyPacksSection() {
  return (
    <div>
      <p className="text-xs font-semibold uppercase mb-3 mt-1" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
        {MOCK_PACKS.length} Starter Packs
      </p>
      <div className="flex flex-col gap-2">
        {MOCK_PACKS.map((pack, i) => (
          <motion.div
            key={pack.id}
            className="glimpse-card p-4 flex items-center gap-3"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: 'var(--surface-secondary)' }}
            >
              {pack.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm" style={{ color: 'var(--label-primary)' }}>{pack.name}</p>
              <p className="text-xs" style={{ color: 'var(--label-secondary)' }}>{pack.memberCount} members · @{pack.creator}</p>
            </div>
            <button
              className="px-3 py-1.5 rounded-chip text-xs font-semibold"
              style={{ background: 'var(--fill-secondary)', color: 'var(--label-secondary)' }}
            >
              Leave
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function HistorySection({ posts, onOpenStory }: { posts: typeof MOCK_POSTS; onOpenStory: (e: StoryEntry) => void }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase mb-3 mt-1" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
        Recently Viewed
      </p>
      <div className="flex flex-col gap-1">
        {posts.map((post, i) => (
          <motion.button
            key={post.id}
            className="flex items-center gap-3 p-3 rounded-xl text-left w-full"
            style={{ background: 'var(--surface-card)' }}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName })}
          >
            <Clock size={16} strokeWidth={1.75} style={{ color: 'var(--label-tertiary)', flexShrink: 0 }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium line-clamp-1" style={{ color: 'var(--label-primary)' }}>
                {post.content.slice(0, 60)}...
              </p>
              <p className="text-xs" style={{ color: 'var(--label-secondary)' }}>
                {post.author.displayName} · {formatTime(post.createdAt)}
              </p>
            </div>
            <Sparkles size={14} strokeWidth={1.75} style={{ color: 'var(--glimpse-blue)', flexShrink: 0 }} />
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center py-16 gap-3 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
        style={{ background: 'var(--fill-secondary)' }}
      >
        {icon}
      </div>
      <p className="font-semibold" style={{ color: 'var(--label-primary)' }}>{title}</p>
      <p className="text-sm max-w-xs" style={{ color: 'var(--label-secondary)' }}>{subtitle}</p>
    </div>
  );
}
