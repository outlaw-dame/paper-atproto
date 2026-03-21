import React, { useState } from 'react';
import { motion } from 'framer-motion';
import PostCard from '../components/PostCard';
import { MOCK_POSTS } from '../data/mockData';
import type { StoryEntry, EntityEntry } from '../App';

const FEED_MODES = ['Following', 'Discover', 'Quiet'] as const;
type FeedMode = typeof FEED_MODES[number];

interface HomeTabProps {
  onOpenStory: (entry: StoryEntry) => void;
  onOpenEntity: (entry: EntityEntry) => void;
}

export default function HomeTab({ onOpenStory, onOpenEntity }: HomeTabProps) {
  const [feedMode, setFeedMode] = useState<FeedMode>('Following');

  return (
    <div className="min-h-full">
      {/* Feed mode segmented control */}
      <div
        className="sticky top-0 z-10 px-4 py-2"
        style={{ background: 'var(--surface-secondary)' }}
      >
        <div
          className="flex rounded-xl p-1 gap-1"
          style={{ background: 'var(--fill-tertiary)' }}
          role="tablist"
          aria-label="Feed mode"
        >
          {FEED_MODES.map(mode => (
            <button
              key={mode}
              role="tab"
              aria-selected={feedMode === mode}
              onClick={() => setFeedMode(mode)}
              className="flex-1 rounded-lg py-1.5 text-sm font-medium transition-all relative"
              style={{
                color: feedMode === mode ? 'var(--label-primary)' : 'var(--label-secondary)',
                letterSpacing: '-0.2px',
              }}
            >
              {feedMode === mode && (
                <motion.div
                  layoutId="feed-mode-indicator"
                  className="absolute inset-0 rounded-lg"
                  style={{ background: 'var(--surface-card)', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
              <span className="relative z-10">{mode}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Post cards */}
      <div className="pt-1 pb-4">
        {MOCK_POSTS.map((post, i) => (
          <PostCard
            key={post.id}
            post={post}
            onOpenStory={onOpenStory}
            onOpenEntity={onOpenEntity}
            style={{ animationDelay: `${i * 40}ms` }}
          />
        ))}

        {/* End of feed indicator */}
        <div className="flex flex-col items-center py-8 gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'var(--fill-secondary)' }}
          >
            <span style={{ fontSize: '16px' }}>✦</span>
          </div>
          <p className="text-sm" style={{ color: 'var(--label-tertiary)' }}>You're all caught up</p>
        </div>
      </div>
    </div>
  );
}
