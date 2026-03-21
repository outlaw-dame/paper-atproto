import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { MOCK_POSTS, MOCK_FEEDS, MOCK_PACKS, formatTime } from '../data/mockData';
import type { StoryEntry } from '../App';

interface Props {
  onOpenStory: (e: StoryEntry) => void;
}

const TABS = ['Saved', 'My Feeds', 'My Packs', 'History'] as const;
type Tab = typeof TABS[number];

export default function LibraryTab({ onOpenStory }: Props) {
  const [tab, setTab] = useState<Tab>('Saved');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Nav */}
      <div style={{
        flexShrink: 0,
        paddingTop: 'calc(var(--safe-top) + 12px)',
        background: 'var(--chrome-bg)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '0.5px solid var(--sep)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '0 16px 10px' }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.5 }}>Library</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', padding: '0 16px 12px', gap: 8, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '6px 14px', borderRadius: 100, flexShrink: 0,
              fontSize: 14, fontWeight: tab === t ? 600 : 400,
              color: tab === t ? '#fff' : 'var(--label-2)',
              background: tab === t ? 'var(--blue)' : 'var(--fill-2)',
              border: 'none', cursor: 'pointer',
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="scroll-y" style={{ flex: 1, padding: '12px 12px 0' }}>
        {tab === 'Saved' && (
          MOCK_POSTS.slice(0, 3).map((post, i) => (
            <motion.button
              key={post.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName })}
              style={{
                width: '100%', textAlign: 'left',
                background: 'var(--surface)', borderRadius: 16,
                padding: '14px 16px', marginBottom: 10,
                display: 'flex', flexDirection: 'row', gap: 12, alignItems: 'flex-start',
                border: 'none', cursor: 'pointer',
              }}
            >
              {post.media?.[0] && (
                <div style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'var(--fill-3)' }}>
                  <img src={post.media[0].url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-2)', marginBottom: 3 }}>{post.author.displayName}</p>
                <p style={{ fontSize: 14, color: 'var(--label-1)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {post.content}
                </p>
              </div>
            </motion.button>
          ))
        )}

        {tab === 'My Feeds' && (
          MOCK_FEEDS.map((feed, i) => (
            <motion.div
              key={feed.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              style={{
                background: 'var(--surface)', borderRadius: 16, padding: '14px 16px', marginBottom: 10,
                display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                {feed.icon}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--label-1)', letterSpacing: -0.2, marginBottom: 2 }}>{feed.name}</p>
                <p style={{ fontSize: 13, color: 'var(--label-3)' }}>by @{feed.creator.replace('.bsky.social', '')}</p>
              </div>
              <button style={{ padding: '6px 14px', borderRadius: 100, background: 'rgba(255,59,48,0.1)', color: 'var(--red)', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                Unfollow
              </button>
            </motion.div>
          ))
        )}

        {tab === 'My Packs' && (
          MOCK_PACKS.map((pack, i) => (
            <motion.div
              key={pack.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              style={{
                background: 'var(--surface)', borderRadius: 16, padding: '14px 16px', marginBottom: 10,
                display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                {pack.icon}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--label-1)', letterSpacing: -0.2, marginBottom: 2 }}>{pack.name}</p>
                <p style={{ fontSize: 13, color: 'var(--label-3)' }}>{pack.memberCount} members</p>
              </div>
              <button style={{ padding: '6px 14px', borderRadius: 100, background: 'rgba(255,59,48,0.1)', color: 'var(--red)', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                Leave
              </button>
            </motion.div>
          ))
        )}

        {tab === 'History' && (
          MOCK_POSTS.slice(0, 4).map((post, i) => (
            <motion.button
              key={post.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName })}
              style={{
                width: '100%', textAlign: 'left',
                background: 'var(--surface)', borderRadius: 16,
                padding: '12px 16px', marginBottom: 8,
                display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
                border: 'none', cursor: 'pointer',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--label-3)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--label-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {post.content.slice(0, 60)}…
                </p>
                <p style={{ fontSize: 12, color: 'var(--label-3)' }}>{post.author.displayName} · {formatTime(post.createdAt)}</p>
              </div>
            </motion.button>
          ))
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
