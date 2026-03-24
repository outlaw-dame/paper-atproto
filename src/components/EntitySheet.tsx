import React from 'react';
import { motion } from 'framer-motion';
import type { EntityEntry, StoryEntry } from '../App.js';
import { MOCK_POSTS } from '../data/mockData.js';

interface Props {
  entity: EntityEntry;
  onClose: () => void;
  onOpenStory: (e: StoryEntry) => void;
}

const TYPE_COLOR: Record<string, string> = {
  person: 'var(--blue)',
  topic:  'var(--purple)',
  feed:   'var(--teal)',
};

const ACTIONS = [
  { label: 'Follow', emoji: '＋' },
  { label: 'Save',   emoji: '🔖' },
  { label: 'Mute',   emoji: '🔇' },
  { label: 'List',   emoji: '📋' },
];

export default function EntitySheet({ entity, onClose, onOpenStory }: Props) {
  const color = TYPE_COLOR[entity.type] || 'var(--blue)';
  const related = MOCK_POSTS.slice(0, 3);

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', zIndex: 250 }}
      />

      {/* Sheet */}
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          background: 'var(--surface)', borderRadius: '24px 24px 0 0',
          zIndex: 251, paddingBottom: 'var(--safe-bottom)',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.16)',
          maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--fill-3)' }} />
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {/* Header */}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', padding: '8px 16px 16px', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color }}>{entity.name[0]}</span>
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.4, marginBottom: 5 }}>{entity.name}</p>
              <span style={{ fontSize: 12, fontWeight: 600, color, background: color + '15', padding: '3px 10px', borderRadius: 100, textTransform: 'capitalize' }}>
                {entity.type}
              </span>
            </div>
            <button onClick={onClose} style={{ padding: 6, color: 'var(--label-3)', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Why you're seeing this */}
          <div style={{ margin: '0 16px 16px', background: 'var(--bg)', borderRadius: 14, padding: '10px 14px', display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>ℹ️</span>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--label-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Why you're seeing this</p>
              <p style={{ fontSize: 14, color: 'var(--label-2)', lineHeight: 1.4 }}>{entity.reason}</p>
            </div>
          </div>

          {/* Quick actions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, padding: '0 16px 16px' }}>
            {ACTIONS.map(a => (
              <button key={a.label} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '12px 8px', borderRadius: 14, background: 'var(--bg)',
                fontSize: 11, fontWeight: 600, color: 'var(--label-2)',
                border: 'none', cursor: 'pointer',
              }}>
                <span style={{ fontSize: 20 }}>{a.emoji}</span>
                {a.label}
              </button>
            ))}
          </div>

          {/* Open Story */}
          <div style={{ padding: '0 16px 16px' }}>
            <button
              onClick={() => { onOpenStory({ type: 'topic', id: entity.id, title: entity.name }); onClose(); }}
              style={{
                width: '100%', padding: '14px 0', borderRadius: 14,
                background: 'var(--blue)', color: '#fff',
                fontSize: 15, fontWeight: 600, letterSpacing: -0.2,
                border: 'none', cursor: 'pointer',
              }}
            >
              ✦ Open Story for {entity.name}
            </button>
          </div>

          {/* Related posts */}
          <div style={{ padding: '0 16px 24px' }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-3)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>Related Posts</p>
            {related.map((post, i) => (
              <div key={post.id} style={{
                display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 12, background: 'var(--bg)', marginBottom: 6,
              }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: ['var(--blue)', 'var(--indigo)', 'var(--green)'][i], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                  {post.author.displayName[0]}
                </div>
                <p style={{ flex: 1, fontSize: 13, color: 'var(--label-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {post.content.slice(0, 60)}…
                </p>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--label-4)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </>
  );
}
