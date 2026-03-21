import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, TrendingUp, Rss, Package, Users, Globe, X } from 'lucide-react';
import { MOCK_TRENDING, MOCK_FEEDS, MOCK_PACKS, MOCK_POSTS, formatCount } from '../data/mockData';
import type { StoryEntry, EntityEntry } from '../App';

interface ExploreTabProps {
  onOpenStory: (entry: StoryEntry) => void;
  onOpenEntity: (entry: EntityEntry) => void;
}

const SECTIONS = [
  { id: 'trending', label: 'Trending', icon: TrendingUp },
  { id: 'feeds',    label: 'Feeds',    icon: Rss },
  { id: 'packs',    label: 'Packs',    icon: Package },
  { id: 'people',   label: 'People',   icon: Users },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

export default function ExploreTab({ onOpenStory, onOpenEntity }: ExploreTabProps) {
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<SectionId>('trending');
  const [focused, setFocused] = useState(false);

  const isSearching = query.trim().length > 0;

  return (
    <div className="min-h-full">
      {/* Search bar */}
      <div className="px-4 pt-3 pb-2 sticky top-0 z-10" style={{ background: 'var(--surface-secondary)' }}>
        <div
          className="flex items-center gap-2 rounded-xl px-3"
          style={{
            background: 'var(--fill-tertiary)',
            height: 44,
            border: focused ? '1.5px solid var(--glimpse-blue)' : '1.5px solid transparent',
            transition: 'border-color 0.15s',
          }}
        >
          <Search size={16} strokeWidth={2} style={{ color: 'var(--label-tertiary)', flexShrink: 0 }} />
          <input
            type="search"
            placeholder="Search people, topics, feeds..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: 'var(--label-primary)', letterSpacing: '-0.2px' }}
            aria-label="Search"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" style={{ color: 'var(--label-tertiary)' }}>
              <X size={16} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {isSearching ? (
        <SearchResults query={query} onOpenStory={onOpenStory} onOpenEntity={onOpenEntity} />
      ) : (
        <>
          {/* Section tabs */}
          <div
            className="flex gap-1 px-4 pb-3 overflow-x-auto"
            style={{ scrollbarWidth: 'none' }}
          >
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-chip text-sm font-medium whitespace-nowrap flex-shrink-0"
                style={{
                  background: activeSection === id ? 'var(--glimpse-blue)' : 'var(--fill-secondary)',
                  color: activeSection === id ? 'white' : 'var(--label-secondary)',
                  transition: 'background 0.15s, color 0.15s',
                }}
                aria-pressed={activeSection === id}
              >
                <Icon size={14} strokeWidth={2} />
                {label}
              </button>
            ))}
          </div>

          {/* Section content */}
          {activeSection === 'trending' && (
            <TrendingSection onOpenStory={onOpenStory} onOpenEntity={onOpenEntity} />
          )}
          {activeSection === 'feeds' && (
            <FeedsSection onOpenEntity={onOpenEntity} />
          )}
          {activeSection === 'packs' && (
            <PacksSection onOpenEntity={onOpenEntity} />
          )}
          {activeSection === 'people' && (
            <PeopleSection onOpenEntity={onOpenEntity} />
          )}
        </>
      )}
    </div>
  );
}

function SearchResults({ query, onOpenStory, onOpenEntity }: { query: string; onOpenStory: (e: StoryEntry) => void; onOpenEntity: (e: EntityEntry) => void }) {
  const matchedPosts = MOCK_POSTS.filter(p =>
    p.content.toLowerCase().includes(query.toLowerCase()) ||
    p.author.displayName.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="px-4 pb-4">
      {/* Entity overview card */}
      <div
        className="rounded-story p-4 mb-4"
        style={{ background: 'linear-gradient(135deg, rgba(10,132,255,0.08), rgba(94,92,230,0.08))', border: '1px solid rgba(10,132,255,0.15)' }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span style={{ color: 'var(--glimpse-blue)', fontSize: '14px' }}>✦</span>
          <span className="text-xs font-semibold uppercase" style={{ color: 'var(--glimpse-blue)', letterSpacing: '0.5px' }}>Best Match</span>
        </div>
        <p className="font-semibold text-base" style={{ color: 'var(--label-primary)', letterSpacing: '-0.3px' }}>
          "{query}"
        </p>
        <p className="text-sm mt-1" style={{ color: 'var(--label-secondary)' }}>
          Found {matchedPosts.length} posts · 3 related topics · 2 feeds
        </p>
      </div>

      {/* People row */}
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase mb-2" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>People</p>
        <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {MOCK_POSTS.slice(0, 4).map(p => (
            <button
              key={p.id}
              className="flex flex-col items-center gap-1.5 flex-shrink-0"
              onClick={() => onOpenEntity({ type: 'person', id: p.author.did, name: p.author.displayName, reason: `Mentioned "${query}"` })}
            >
              <div className="w-14 h-14 rounded-full overflow-hidden" style={{ background: 'var(--glimpse-indigo)' }}>
                {p.author.avatar && <img src={p.author.avatar} alt={p.author.displayName} className="w-full h-full object-cover" />}
              </div>
              <span className="text-xs text-center" style={{ color: 'var(--label-primary)', maxWidth: 64 }}>{p.author.displayName.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Posts */}
      {matchedPosts.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase mb-2" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>Posts</p>
          <div className="flex flex-col gap-2">
            {matchedPosts.map(post => (
              <button
                key={post.id}
                className="glimpse-card p-3 text-left w-full"
                onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName })}
              >
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--label-secondary)' }}>{post.author.displayName}</p>
                <p className="text-sm line-clamp-2" style={{ color: 'var(--label-primary)' }}>{post.content}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrendingSection({ onOpenStory, onOpenEntity }: { onOpenStory: (e: StoryEntry) => void; onOpenEntity: (e: EntityEntry) => void }) {
  return (
    <div className="px-4 pb-4">
      <p className="text-xs font-semibold uppercase mb-3" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
        Trending Topics
      </p>
      <div className="flex flex-col gap-2 mb-6">
        {MOCK_TRENDING.map((t, i) => (
          <motion.button
            key={t.id}
            className="flex items-center gap-3 p-3 rounded-xl text-left w-full"
            style={{ background: 'var(--surface-card)' }}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => onOpenEntity({ type: 'topic', id: t.id, name: t.label, reason: `${formatCount(t.count)} posts in the last 24h` })}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm"
              style={{ background: `var(--glimpse-${t.color})18`, color: `var(--glimpse-${t.color})` }}
            >
              #{i + 1}
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm" style={{ color: 'var(--label-primary)' }}>#{t.label}</p>
              <p className="text-xs" style={{ color: 'var(--label-secondary)' }}>{formatCount(t.count)} posts</p>
            </div>
            <button
              className="px-3 py-1.5 rounded-chip text-xs font-medium"
              style={{ background: `var(--glimpse-${t.color})18`, color: `var(--glimpse-${t.color})` }}
              onClick={(e) => { e.stopPropagation(); onOpenStory({ type: 'topic', id: t.id, title: `#${t.label}` }); }}
            >
              Story
            </button>
          </motion.button>
        ))}
      </div>

      {/* Live clusters */}
      <p className="text-xs font-semibold uppercase mb-3" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
        Live Clusters
      </p>
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
        {['ATProto Summit', 'Web Standards', 'Open Source Week'].map((name, i) => (
          <button
            key={name}
            className="flex-shrink-0 rounded-story p-4 text-left"
            style={{
              background: ['linear-gradient(135deg,#0A84FF22,#5E5CE622)', 'linear-gradient(135deg,#30D15822,#32ADE622)', 'linear-gradient(135deg,#FF9F0A22,#BF5AF222)'][i],
              border: `1px solid ${['rgba(10,132,255,0.2)', 'rgba(48,209,88,0.2)', 'rgba(255,159,10,0.2)'][i]}`,
              width: 200,
            }}
            onClick={() => onOpenStory({ type: 'topic', id: `live-${i}`, title: name })}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: ['#0A84FF', '#30D158', '#FF9F0A'][i] }} />
              <span className="text-xs font-semibold" style={{ color: ['#0A84FF', '#30D158', '#FF9F0A'][i] }}>LIVE</span>
            </div>
            <p className="font-semibold text-sm" style={{ color: 'var(--label-primary)' }}>{name}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--label-secondary)' }}>{[234, 89, 156][i]} active posts</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function FeedsSection({ onOpenEntity }: { onOpenEntity: (e: EntityEntry) => void }) {
  return (
    <div className="px-4 pb-4">
      <p className="text-xs font-semibold uppercase mb-3" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
        Popular Feeds
      </p>
      <div className="flex flex-col gap-2">
        {MOCK_FEEDS.map((feed, i) => (
          <motion.button
            key={feed.id}
            className="glimpse-card p-4 flex items-center gap-3 text-left w-full"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            onClick={() => onOpenEntity({ type: 'feed', id: feed.id, name: feed.name, reason: `${formatCount(feed.count)} followers` })}
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
              <p className="text-xs mt-0.5" style={{ color: 'var(--label-tertiary)' }}>{formatCount(feed.count)} followers</p>
            </div>
            <button
              className="px-3 py-1.5 rounded-chip text-xs font-semibold flex-shrink-0"
              style={{ background: 'var(--glimpse-blue)', color: 'white' }}
              onClick={(e) => e.stopPropagation()}
            >
              Follow
            </button>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function PacksSection({ onOpenEntity }: { onOpenEntity: (e: EntityEntry) => void }) {
  return (
    <div className="px-4 pb-4">
      <p className="text-xs font-semibold uppercase mb-3" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
        Starter Packs
      </p>
      <div className="flex flex-col gap-2">
        {MOCK_PACKS.map((pack, i) => (
          <motion.button
            key={pack.id}
            className="glimpse-card p-4 flex items-center gap-3 text-left w-full"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            onClick={() => onOpenEntity({ type: 'pack', id: pack.id, name: pack.name, reason: `${pack.memberCount} curated members` })}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: 'var(--surface-secondary)' }}
            >
              {pack.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm" style={{ color: 'var(--label-primary)' }}>{pack.name}</p>
              <p className="text-xs" style={{ color: 'var(--label-secondary)' }}>by @{pack.creator}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--label-tertiary)' }}>{pack.memberCount} members</p>
            </div>
            <button
              className="px-3 py-1.5 rounded-chip text-xs font-semibold flex-shrink-0"
              style={{ background: 'var(--fill-secondary)', color: 'var(--label-secondary)' }}
              onClick={(e) => e.stopPropagation()}
            >
              View
            </button>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function PeopleSection({ onOpenEntity }: { onOpenEntity: (e: EntityEntry) => void }) {
  return (
    <div className="px-4 pb-4">
      <p className="text-xs font-semibold uppercase mb-3" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
        Suggested People
      </p>
      <div className="flex flex-col gap-2">
        {MOCK_POSTS.map((post, i) => (
          <motion.button
            key={post.author.did}
            className="glimpse-card p-4 flex items-center gap-3 text-left w-full"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => onOpenEntity({ type: 'person', id: post.author.did, name: post.author.displayName, reason: 'Suggested based on your interests' })}
          >
            <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0" style={{ background: 'var(--glimpse-indigo)' }}>
              {post.author.avatar && <img src={post.author.avatar} alt={post.author.displayName} className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm" style={{ color: 'var(--label-primary)' }}>{post.author.displayName}</p>
              <p className="text-xs" style={{ color: 'var(--label-secondary)' }}>@{post.author.handle}</p>
              <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--label-tertiary)' }}>{post.content.slice(0, 60)}...</p>
            </div>
            <button
              className="px-3 py-1.5 rounded-chip text-xs font-semibold flex-shrink-0"
              style={{ background: 'var(--glimpse-blue)', color: 'white' }}
              onClick={(e) => e.stopPropagation()}
            >
              Follow
            </button>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
