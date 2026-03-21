import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { MOCK_NOTIFICATIONS } from '../data/mockData';

const NOTIF_CONFIG = {
  like:    { label: '♥', color: 'var(--red)',    bg: 'rgba(255,69,58,0.12)' },
  repost:  { label: '↺', color: 'var(--green)',  bg: 'rgba(48,209,88,0.12)' },
  reply:   { label: '↩', color: 'var(--blue)',   bg: 'rgba(10,132,255,0.12)' },
  follow:  { label: '+', color: 'var(--purple)', bg: 'rgba(191,90,242,0.12)' },
  mention: { label: '@', color: 'var(--orange)', bg: 'rgba(255,159,10,0.12)' },
} as const;

const FILTERS = ['All', 'Mentions', 'Likes', 'Follows'] as const;
type Filter = typeof FILTERS[number];

export default function InboxTab() {
  const [filter, setFilter] = useState<Filter>('All');

  const filtered = MOCK_NOTIFICATIONS.filter(n => {
    if (filter === 'All') return true;
    if (filter === 'Mentions') return n.type === 'mention' || n.type === 'reply';
    if (filter === 'Likes') return n.type === 'like';
    if (filter === 'Follows') return n.type === 'follow';
    return true;
  });

  const newItems = filtered.filter(n => !n.read);
  const oldItems = filtered.filter(n => n.read);

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
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '0 16px 10px', gap: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.5, flex: 1 }}>Inbox</span>
          <button style={{ fontSize: 14, color: 'var(--blue)', fontWeight: 500 }}>Mark all read</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', padding: '0 16px 12px', gap: 8 }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '6px 14px', borderRadius: 100,
              fontSize: 14, fontWeight: filter === f ? 600 : 400,
              color: filter === f ? '#fff' : 'var(--label-2)',
              background: filter === f ? 'var(--blue)' : 'var(--fill-2)',
              border: 'none', cursor: 'pointer',
            }}>{f}</button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="scroll-y" style={{ flex: 1 }}>
        {newItems.length > 0 && (
          <>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-3)', letterSpacing: 0.3, textTransform: 'uppercase', padding: '16px 16px 8px' }}>New</p>
            <div style={{ background: 'var(--surface)', borderRadius: 16, margin: '0 12px 8px', overflow: 'hidden' }}>
              {newItems.map((n, i) => <NotifRow key={n.id} n={n} index={i} last={i === newItems.length - 1} />)}
            </div>
          </>
        )}

        {oldItems.length > 0 && (
          <>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-3)', letterSpacing: 0.3, textTransform: 'uppercase', padding: '16px 16px 8px' }}>Earlier</p>
            <div style={{ background: 'var(--surface)', borderRadius: 16, margin: '0 12px 8px', overflow: 'hidden' }}>
              {oldItems.map((n, i) => <NotifRow key={n.id} n={n} index={i} last={i === oldItems.length - 1} />)}
            </div>
          </>
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function NotifRow({ n, index, last }: { n: typeof MOCK_NOTIFICATIONS[0]; index: number; last: boolean }) {
  const cfg = NOTIF_CONFIG[n.type as keyof typeof NOTIF_CONFIG] || NOTIF_CONFIG.like;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'flex-start',
        padding: '12px 16px',
        borderBottom: last ? 'none' : '0.5px solid var(--sep)',
        background: n.read ? 'none' : 'rgba(0,122,255,0.04)',
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
        background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: cfg.color, fontSize: 16, fontWeight: 700, marginRight: 12,
      }}>{cfg.label}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, color: 'var(--label-1)', lineHeight: 1.35, marginBottom: 2 }}>
          <strong>{n.displayName}</strong> {n.content}
        </p>
        <p style={{ fontSize: 12, color: 'var(--label-3)' }}>{n.time} ago</p>
      </div>

      {!n.read && (
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', flexShrink: 0, marginTop: 5, marginLeft: 8 }} />
      )}
    </motion.div>
  );
}
