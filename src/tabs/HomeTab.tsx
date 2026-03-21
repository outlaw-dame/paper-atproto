import React, { useState } from 'react';
import PostCard from '../components/PostCard';
import { MOCK_POSTS } from '../data/mockData';
import type { StoryEntry } from '../App';

interface Props {
  onOpenStory: (e: StoryEntry) => void;
}

const MODES = ['Following', 'Discover', 'Feeds'];

export default function HomeTab({ onOpenStory }: Props) {
  const [mode, setMode] = useState(0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Nav bar */}
      <div style={{
        flexShrink: 0,
        paddingTop: 'calc(var(--safe-top) + 12px)',
        background: 'var(--chrome-bg)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '0.5px solid var(--sep)',
      }}>
        {/* Top row */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '0 16px 10px', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--blue)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0,
          }}>Y</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.5 }}>Glimpse</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--label-2)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
          <button aria-label="Search" style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--label-2)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
        </div>

        {/* Mode pills */}
        <div style={{ display: 'flex', flexDirection: 'row', padding: '0 16px 12px', gap: 8 }}>
          {MODES.map((m, i) => (
            <button
              key={m}
              onClick={() => setMode(i)}
              style={{
                padding: '6px 14px', borderRadius: 100,
                fontSize: 14, fontWeight: mode === i ? 600 : 400,
                color: mode === i ? '#fff' : 'var(--label-2)',
                background: mode === i ? 'var(--blue)' : 'var(--fill-2)',
                border: 'none', cursor: 'pointer',
              }}
            >{m}</button>
          ))}
        </div>
      </div>

      {/* Feed scroll */}
      <div
        className="scroll-y"
        style={{ flex: 1, padding: '12px 12px 0' }}
      >
        {MOCK_POSTS.map((post, i) => (
          <PostCard key={post.id} post={post} onOpenStory={onOpenStory} index={i} />
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0 32px', gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 14 }}>✦</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--label-3)' }}>You're all caught up</p>
        </div>
      </div>
    </div>
  );
}
