import React, { useState } from 'react';
import { MOCK_TRENDING, MOCK_FEEDS, MOCK_PACKS } from '../data/mockData';
import type { StoryEntry } from '../App';

interface Props {
  onOpenStory: (e: StoryEntry) => void;
}

export default function ExploreTab({ onOpenStory }: Props) {
  const [query, setQuery] = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Nav / Search */}
      <div style={{
        flexShrink: 0,
        paddingTop: 'calc(var(--safe-top) + 12px)',
        padding: 'calc(var(--safe-top) + 12px) 16px 12px',
        background: 'var(--chrome-bg)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '0.5px solid var(--sep)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
            background: 'var(--fill-2)', borderRadius: 12, padding: '9px 12px',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--label-3)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search people, topics, feeds…"
              style={{ flex: 1, fontSize: 15, color: 'var(--label-1)', background: 'none', border: 'none', outline: 'none' }}
            />
          </div>
          {query && (
            <button onClick={() => setQuery('')} style={{ fontSize: 15, color: 'var(--blue)', fontWeight: 500 }}>Cancel</button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="scroll-y" style={{ flex: 1 }}>
        {/* Trending */}
        <SectionHeader title="Trending" />
        <div style={{ background: 'var(--surface)', borderRadius: 16, margin: '0 12px 8px', overflow: 'hidden' }}>
          {MOCK_TRENDING.map((t, i) => (
            <button
              key={t.id}
              onClick={() => onOpenStory({ type: 'post', id: t.id, title: t.label })}
              style={{
                width: '100%', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14,
                padding: '13px 16px',
                borderBottom: i < MOCK_TRENDING.length - 1 ? '0.5px solid var(--sep)' : 'none',
                background: 'none', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 13, color: 'var(--label-3)', width: 18, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--label-1)', letterSpacing: -0.3 }}>#{t.label}</span>
                  {i === 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--red)', background: 'rgba(255,59,48,0.1)', padding: '2px 6px', borderRadius: 100, letterSpacing: 0.4 }}>LIVE</span>
                  )}
                </div>
                <span style={{ fontSize: 13, color: 'var(--label-3)' }}>{t.count.toLocaleString()} posts</span>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--label-4)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          ))}
        </div>

        {/* Feeds */}
        <SectionHeader title="Feeds to Follow" />
        <div className="scroll-x" style={{ display: 'flex', flexDirection: 'row', gap: 10, padding: '0 12px 12px' }}>
          {MOCK_FEEDS.map(f => (
            <div key={f.id} style={{
              flexShrink: 0, width: 148,
              background: 'var(--surface)', borderRadius: 16,
              padding: '14px 14px 12px',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                {f.icon}
              </div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-1)', letterSpacing: -0.2, marginBottom: 2 }}>{f.name}</p>
                <p style={{ fontSize: 12, color: 'var(--label-3)' }}>by {f.creator.replace('.bsky.social', '')}</p>
              </div>
              <p style={{ fontSize: 12, color: 'var(--label-2)' }}>{f.count.toLocaleString()} posts</p>
              <button style={{ padding: '7px 0', borderRadius: 8, background: 'var(--blue)', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                Follow
              </button>
            </div>
          ))}
        </div>

        {/* Starter Packs */}
        <SectionHeader title="Starter Packs" />
        <div style={{ background: 'var(--surface)', borderRadius: 16, margin: '0 12px 8px', overflow: 'hidden' }}>
          {MOCK_PACKS.map((p, i) => (
            <div key={p.id} style={{
              display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
              padding: '13px 16px',
              borderBottom: i < MOCK_PACKS.length - 1 ? '0.5px solid var(--sep)' : 'none',
            }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                {p.icon}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--label-1)', letterSpacing: -0.2, marginBottom: 2 }}>{p.name}</p>
                <p style={{ fontSize: 13, color: 'var(--label-3)' }}>{p.memberCount} members · by {p.creator.replace('.bsky.social', '')}</p>
              </div>
              <button style={{ padding: '6px 14px', borderRadius: 100, background: 'var(--fill-2)', color: 'var(--blue)', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                View
              </button>
            </div>
          ))}
        </div>

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-3)', letterSpacing: 0.3, textTransform: 'uppercase', padding: '16px 16px 8px' }}>
      {title}
    </p>
  );
}
