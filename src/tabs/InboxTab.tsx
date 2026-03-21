import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Heart, Repeat2, MessageCircle, UserPlus, AtSign } from 'lucide-react';
import { MOCK_NOTIFICATIONS } from '../data/mockData';

const NOTIF_CONFIG = {
  like:    { icon: Heart,          color: 'var(--glimpse-red)',    bg: 'rgba(255,69,58,0.12)' },
  repost:  { icon: Repeat2,        color: 'var(--glimpse-green)',  bg: 'rgba(48,209,88,0.12)' },
  reply:   { icon: MessageCircle,  color: 'var(--glimpse-blue)',   bg: 'rgba(10,132,255,0.12)' },
  follow:  { icon: UserPlus,       color: 'var(--glimpse-purple)', bg: 'rgba(191,90,242,0.12)' },
  mention: { icon: AtSign,         color: 'var(--glimpse-orange)', bg: 'rgba(255,159,10,0.12)' },
} as const;

const FILTER_TABS = ['All', 'Mentions', 'Likes', 'Follows'] as const;
type FilterTab = typeof FILTER_TABS[number];

export default function InboxTab() {
  const [filter, setFilter] = useState<FilterTab>('All');
  const unreadCount = MOCK_NOTIFICATIONS.filter(n => !n.read).length;

  const filtered = MOCK_NOTIFICATIONS.filter(n => {
    if (filter === 'All') return true;
    if (filter === 'Mentions') return n.type === 'mention' || n.type === 'reply';
    if (filter === 'Likes') return n.type === 'like';
    if (filter === 'Follows') return n.type === 'follow';
    return true;
  });

  return (
    <div className="min-h-full">
      {/* Filter tabs */}
      <div
        className="sticky top-0 z-10 px-4 pt-3 pb-2"
        style={{ background: 'var(--surface-secondary)' }}
      >
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {FILTER_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-chip text-sm font-medium whitespace-nowrap flex-shrink-0"
              style={{
                background: filter === tab ? 'var(--glimpse-blue)' : 'var(--fill-secondary)',
                color: filter === tab ? 'white' : 'var(--label-secondary)',
                transition: 'background 0.15s, color 0.15s',
              }}
              aria-pressed={filter === tab}
            >
              {tab}
              {tab === 'All' && unreadCount > 0 && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-xs font-bold"
                  style={{ background: filter === tab ? 'rgba(255,255,255,0.25)' : 'var(--glimpse-blue)', color: filter === tab ? 'white' : 'white', fontSize: '10px' }}
                >
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Notifications list */}
      <div className="px-4 pb-4">
        {/* Unread section */}
        {filtered.some(n => !n.read) && (
          <>
            <p className="text-xs font-semibold uppercase mb-2 mt-1" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
              New
            </p>
            {filtered.filter(n => !n.read).map((notif, i) => (
              <NotifRow key={notif.id} notif={notif} index={i} />
            ))}
          </>
        )}

        {/* Read section */}
        {filtered.some(n => n.read) && (
          <>
            <p className="text-xs font-semibold uppercase mb-2 mt-4" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
              Earlier
            </p>
            {filtered.filter(n => n.read).map((notif, i) => (
              <NotifRow key={notif.id} notif={notif} index={i} />
            ))}
          </>
        )}

        {filtered.length === 0 && (
          <div className="flex flex-col items-center py-16 gap-3">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'var(--fill-secondary)' }}>
              <Bell size={24} style={{ color: 'var(--label-tertiary)' }} />
            </div>
            <p className="text-sm" style={{ color: 'var(--label-tertiary)' }}>No notifications yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

function NotifRow({ notif, index }: { notif: typeof MOCK_NOTIFICATIONS[0]; index: number }) {
  const cfg = NOTIF_CONFIG[notif.type as keyof typeof NOTIF_CONFIG] || NOTIF_CONFIG.like;
  const Icon = cfg.icon;

  return (
    <motion.button
      className="flex items-start gap-3 p-3 rounded-xl w-full text-left mb-1"
      style={{
        background: notif.read ? 'transparent' : 'var(--surface-card)',
        boxShadow: notif.read ? 'none' : '0 1px 6px rgba(0,0,0,0.06)',
      }}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
    >
      {/* Icon */}
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: cfg.bg }}
      >
        <Icon size={18} strokeWidth={1.75} style={{ color: cfg.color }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug" style={{ color: 'var(--label-primary)', letterSpacing: '-0.1px' }}>
          <span className="font-semibold">{notif.displayName}</span>
          {' '}{notif.content}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--label-secondary)' }}>{notif.time} ago</p>
      </div>

      {/* Unread dot */}
      {!notif.read && (
        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: 'var(--glimpse-blue)' }} />
      )}
    </motion.button>
  );
}

// Bell icon for empty state
function Bell({ size, style }: { size: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
