import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { MOCK_POSTS, MOCK_FEEDS, MOCK_PACKS, formatTime } from '../data/mockData';
import type { StoryEntry } from '../App';

interface Props {
  onOpenStory: (e: StoryEntry) => void;
}

const TABS = ['Saved', 'My Feeds', 'My Packs', 'History'] as const;
type Tab = typeof TABS[number];

const CHIP_COLORS: Record<string, { bg: string; color: string }> = {
  thread:  { bg: 'rgba(0,122,255,0.1)',   color: 'var(--blue)'   },
  topic:   { bg: 'rgba(175,82,222,0.1)',  color: 'var(--purple)' },
  feed:    { bg: 'rgba(90,200,250,0.12)', color: 'var(--teal)'   },
  pack:    { bg: 'rgba(52,199,89,0.1)',   color: 'var(--green)'  },
  related: { bg: 'rgba(255,149,0,0.1)',   color: 'var(--orange)' },
  story:   { bg: 'rgba(0,122,255,0.1)',   color: 'var(--blue)'   },
};

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
          <>
            {MOCK_POSTS.slice(0, 5).map((post, i) => {
              const chip = post.chips[0];
              const chipStyle = chip ? CHIP_COLORS[chip] : null;
              return (
                <motion.button
                  key={post.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName })}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: 'var(--surface)', borderRadius: 18,
                    padding: 0, marginBottom: 10, overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                    border: 'none', cursor: 'pointer',
                  }}
                >
                  {/* Media thumbnail if present */}
                  {post.media?.[0] && (
                    <div style={{ width: '100%', height: 140, overflow: 'hidden', background: 'var(--fill-3)' }}>
                      <img src={post.media[0].url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  )}
                  <div style={{ padding: '12px 14px 14px' }}>
                    {/* Author row */}
                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', overflow: 'hidden', background: 'var(--fill-2)', flexShrink: 0 }}>
                        {post.author.avatar
                          ? <img src={post.author.avatar} alt={post.author.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--blue)', color: '#fff', fontSize: 11, fontWeight: 700 }}>{post.author.displayName[0]}</div>
                        }
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-2)' }}>{post.author.displayName}</span>
                      <span style={{ fontSize: 12, color: 'var(--label-4)', marginLeft: 'auto' }}>{formatTime(post.createdAt)}</span>
                    </div>
                    {/* Content */}
                    <p style={{ fontSize: 14, lineHeight: 1.4, color: 'var(--label-1)', letterSpacing: -0.2, marginBottom: chipStyle ? 10 : 0, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {post.content}
                    </p>
                    {/* Chip */}
                    {chipStyle && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 100, background: chipStyle.bg, color: chipStyle.color, fontSize: 11, fontWeight: 600, letterSpacing: -0.1 }}>
                        {chip.charAt(0).toUpperCase() + chip.slice(1)}{chip === 'thread' && post.threadCount ? ` · ${post.threadCount}` : ''}
                      </span>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </>
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
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
                {feed.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--label-1)', letterSpacing: -0.2, marginBottom: 2 }}>{feed.name}</p>
                <p style={{ fontSize: 13, color: 'var(--label-3)' }}>by @{feed.creator.replace('.bsky.social', '')} · {feed.count.toLocaleString()} posts</p>
              </div>
              <button style={{ padding: '6px 14px', borderRadius: 100, background: 'rgba(255,59,48,0.1)', color: 'var(--red)', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', flexShrink: 0 }}>
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
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
                {pack.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--label-1)', letterSpacing: -0.2, marginBottom: 2 }}>{pack.name}</p>
                <p style={{ fontSize: 13, color: 'var(--label-3)' }}>{pack.memberCount} members · by @{pack.creator.replace('.bsky.social', '')}</p>
              </div>
              <button style={{ padding: '6px 14px', borderRadius: 100, background: 'rgba(255,59,48,0.1)', color: 'var(--red)', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                Leave
              </button>
            </motion.div>
          ))
        )}

        {tab === 'History' && (
          MOCK_POSTS.slice(0, 6).map((post, i) => (
            <motion.button
              key={post.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName })}
              style={{
                width: '100%', textAlign: 'left',
                background: 'var(--surface)', borderRadius: 14,
                padding: '12px 14px', marginBottom: 8,
                display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
                border: 'none', cursor: 'pointer',
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', background: 'var(--fill-2)', flexShrink: 0 }}>
                {post.author.avatar
                  ? <img src={post.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--indigo)', color: '#fff', fontSize: 12, fontWeight: 700 }}>{post.author.displayName[0]}</div>
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--label-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: -0.2 }}>
                  {post.content.slice(0, 70)}…
                </p>
                <p style={{ fontSize: 12, color: 'var(--label-3)', marginTop: 2 }}>{post.author.displayName} · {formatTime(post.createdAt)}</p>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--label-4)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </motion.button>
          ))
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
