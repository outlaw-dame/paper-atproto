import React from 'react';
import { motion } from 'framer-motion';
import { X, UserPlus, Bookmark, VolumeX, ListPlus, HelpCircle, ExternalLink } from 'lucide-react';
import type { EntityEntry, StoryEntry } from '../App';

interface EntitySheetProps {
  entry: EntityEntry;
  onClose: () => void;
  onOpenStory: (entry: StoryEntry) => void;
}

const TYPE_CONFIG: Record<EntityEntry['type'], { label: string; color: string; icon: string }> = {
  person: { label: 'Person',       color: 'var(--glimpse-blue)',   icon: '👤' },
  topic:  { label: 'Topic',        color: 'var(--glimpse-purple)', icon: '✦' },
  feed:   { label: 'Feed',         color: 'var(--glimpse-teal)',   icon: '📡' },
  pack:   { label: 'Starter Pack', color: 'var(--glimpse-orange)', icon: '🛠️' },
  domain: { label: 'Domain',       color: 'var(--glimpse-green)',  icon: '🌐' },
};

export default function EntitySheet({ entry, onClose, onOpenStory }: EntitySheetProps) {
  const cfg = TYPE_CONFIG[entry.type];

  const relatedPosts = [
    'The open social web is finally here...',
    'Just shipped a new custom feed algorithm...',
    'Hot take: the best social apps of the next decade...',
  ];

  const actions = [
    { icon: <UserPlus size={18} strokeWidth={1.75} />, label: 'Follow', color: 'var(--glimpse-blue)' },
    { icon: <Bookmark size={18} strokeWidth={1.75} />, label: 'Save', color: 'var(--glimpse-green)' },
    { icon: <VolumeX size={18} strokeWidth={1.75} />, label: 'Mute', color: 'var(--glimpse-orange)' },
    { icon: <ListPlus size={18} strokeWidth={1.75} />, label: 'Add to List', color: 'var(--glimpse-purple)' },
  ];

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Sheet */}
      <motion.div
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-sheet overflow-hidden"
        style={{
          background: 'var(--surface-primary)',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.16)',
          paddingBottom: 'var(--safe-bottom)',
          maxHeight: '80vh',
        }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 40 }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--fill-primary)' }} />
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: 'calc(80vh - 20px)' }}>
          {/* Header */}
          <div className="flex items-start justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-xl"
                style={{ background: `${cfg.color}18` }}
              >
                {cfg.icon}
              </div>
              <div>
                <p className="font-semibold text-base" style={{ color: 'var(--label-primary)', letterSpacing: '-0.3px' }}>
                  {entry.name}
                </p>
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-chip"
                  style={{ background: `${cfg.color}18`, color: cfg.color }}
                >
                  {cfg.label}
                </span>
              </div>
            </div>
            <button
              className="touch-target rounded-full"
              onClick={onClose}
              aria-label="Close"
              style={{ color: 'var(--label-secondary)' }}
            >
              <X size={20} strokeWidth={2} />
            </button>
          </div>

          {/* Why shown */}
          {entry.reason && (
            <div
              className="mx-4 mb-4 rounded-xl p-3 flex items-start gap-2"
              style={{ background: 'var(--surface-secondary)' }}
            >
              <HelpCircle size={16} strokeWidth={1.75} style={{ color: 'var(--label-secondary)', flexShrink: 0, marginTop: 1 }} />
              <div>
                <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--label-secondary)' }}>Why you're seeing this</p>
                <p className="text-sm" style={{ color: 'var(--label-primary)' }}>{entry.reason}</p>
              </div>
            </div>
          )}

          {/* Quick actions */}
          <div className="px-4 mb-4">
            <div className="grid grid-cols-4 gap-2">
              {actions.map(action => (
                <button
                  key={action.label}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl"
                  style={{ background: 'var(--surface-secondary)' }}
                  aria-label={action.label}
                >
                  <span style={{ color: action.color }}>{action.icon}</span>
                  <span className="text-xs" style={{ color: 'var(--label-secondary)' }}>{action.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Open Story button */}
          <div className="px-4 mb-4">
            <button
              className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
              style={{ background: 'var(--glimpse-blue)', color: 'white' }}
              onClick={() => {
                onClose();
                onOpenStory({ type: entry.type === 'person' ? 'person' : entry.type === 'feed' ? 'feed' : 'topic', id: entry.id, title: entry.name });
              }}
            >
              <span>✦</span>
              Open Story
            </button>
          </div>

          {/* Related posts */}
          <div className="px-4 mb-6">
            <p className="text-xs font-semibold uppercase mb-2" style={{ color: 'var(--label-secondary)', letterSpacing: '0.5px' }}>
              Related Posts
            </p>
            <div className="flex flex-col gap-2">
              {relatedPosts.map((text, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ background: 'var(--surface-secondary)' }}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                    style={{ background: ['#0A84FF', '#5E5CE6', '#30D158'][i] }}
                  >
                    {['A', 'B', 'D'][i]}
                  </div>
                  <p className="text-sm line-clamp-1 flex-1" style={{ color: 'var(--label-primary)' }}>
                    {text}
                  </p>
                  <ExternalLink size={14} strokeWidth={1.75} style={{ color: 'var(--label-tertiary)', flexShrink: 0 }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}
