// ─── EntitySheet ──────────────────────────────────────────────────────────
// Two exports:
//  - default EntitySheet: app-level navigation (EntityEntry from App.tsx)
//  - WriterEntitySheet: Narwhal v3 AI entity chips (WriterEntity from llmContracts)
//
// Both render as a spring-animated bottom sheet with a blur backdrop.

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { EntityEntry, StoryEntry } from '../App.js';
import type { WriterEntity } from '../intelligence/llmContracts.js';
import type { MockPost } from '../data/mockData.js';
import { MOCK_POSTS } from '../data/mockData.js';
import {
  discovery as disc,
  accent,
  type as typeScale,
  radius,
  space,
} from '../design/index.js';

// ─── Shared ───────────────────────────────────────────────────────────────

const WRITER_TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  person:       { label: 'Person',        color: '#BF8FFF', bg: 'rgba(191,143,255,0.12)' },
  organization: { label: 'Org',           color: accent.cyan400, bg: 'rgba(124,233,255,0.10)' },
  topic:        { label: 'Topic',         color: accent.primary, bg: 'rgba(91,124,255,0.12)' },
  event:        { label: 'Event',         color: '#F97316', bg: 'rgba(249,115,22,0.12)' },
  team:         { label: 'Team',          color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
  product:      { label: 'Product',       color: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
  rule:         { label: 'Rule / Policy', color: '#63DCB4', bg: 'rgba(99,220,180,0.12)' },
  source:       { label: 'Source',        color: '#94A3B8', bg: 'rgba(148,163,184,0.12)' },
};

const FALLBACK_TYPE_META = WRITER_TYPE_META['topic']!;

function TypeBadge({ type, label }: { type: string; label?: string }) {
  const meta = WRITER_TYPE_META[type] ?? FALLBACK_TYPE_META;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 9px', borderRadius: radius.full,
      background: meta.bg,
      border: `0.5px solid ${meta.color}40`,
      color: meta.color,
      fontSize: typeScale.metaSm[0], fontWeight: 700,
      letterSpacing: '0.03em',
    }}>
      {label ?? meta.label}
    </span>
  );
}

function SheetBackdrop({ onClick }: { onClick: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClick}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 250 }}
    />
  );
}

function SheetDragHandle() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
      <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)' }} />
    </div>
  );
}

// ─── WriterEntitySheet ────────────────────────────────────────────────────
// Narwhal v3 AI entity chip sheet. Accepts WriterEntity from the pipeline.
// Shows entity type, confidence, impact bar, and related posts from the feed.

export interface WriterEntitySheetProps {
  entity: WriterEntity | null;
  /** Posts from the current feed — scanned for entity mentions. */
  relatedPosts?: MockPost[];
  onClose: () => void;
}

function RelatedPostRow({ post, needle }: { post: MockPost; needle: string }) {
  const lower = post.content.toLowerCase();
  const idx = lower.indexOf(needle);
  const snippet = idx >= 0
    ? post.content.slice(Math.max(0, idx - 20), idx + needle.length + 40).trim()
    : post.content.slice(0, 80).trim();
  const hasEllipsisLeft = idx > 20;
  const hasEllipsisRight = (hasEllipsisLeft ? idx - 20 + needle.length + 40 : needle.length + 40) < post.content.length;

  return (
    <div style={{
      padding: `${space[6]}px ${space[8]}px`,
      background: 'rgba(255,255,255,0.04)',
      borderRadius: radius[12],
      border: `0.5px solid ${disc.lineSubtle}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <div style={{
          width: 18, height: 18, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
          background: `hsl(${((post.author.handle ?? 'x').charCodeAt(0) * 37) % 360}, 55%, 40%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 9, fontWeight: 700,
        }}>
          {post.author.avatar
            ? <img src={post.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : ((post.author.displayName ?? post.author.handle ?? '').trim().charAt(0) || '?').toUpperCase()
          }
        </div>
        <span style={{ fontSize: typeScale.metaSm[0], fontWeight: 700, color: disc.textSecondary }}>
          @{post.author.handle}
        </span>
      </div>
      <p style={{
        margin: 0,
        fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
        color: disc.textTertiary,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {hasEllipsisLeft ? '…' : ''}{snippet}{hasEllipsisRight ? '…' : ''}
      </p>
    </div>
  );
}

export function WriterEntitySheet({ entity, relatedPosts = [], onClose }: WriterEntitySheetProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const needle = entity ? entity.label.replace(/^[@#]/, '').toLowerCase() : '';
  const mentioningPosts = relatedPosts
    .filter(p => needle.length > 1 && p.content.toLowerCase().includes(needle))
    .slice(0, 5);

  return (
    <AnimatePresence>
      {entity && (
        <>
          <SheetBackdrop onClick={onClose} />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 32 }}
            style={{
              position: 'fixed', left: 0, right: 0, bottom: 0,
              background: disc.bgBase,
              borderRadius: `${radius[20]}px ${radius[20]}px 0 0`,
              border: `0.5px solid ${disc.lineSubtle}`,
              borderBottom: 'none',
              zIndex: 251,
              maxHeight: '72vh', overflowY: 'auto', overscrollBehavior: 'contain',
            }}
          >
            <SheetDragHandle />

            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: `${space[4]}px ${space[10]}px ${space[4]}px`,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <TypeBadge type={entity.type} />
                  {entity.confidence >= 0.60 && (
                    <span style={{ fontSize: typeScale.metaSm[0], fontWeight: 600, color: disc.textTertiary }}>
                      {Math.round(entity.confidence * 100)}% confident
                    </span>
                  )}
                </div>
                <h2 style={{
                  margin: 0,
                  fontSize: typeScale.titleMd[0], lineHeight: `${typeScale.titleMd[1]}px`,
                  fontWeight: 700, color: disc.textPrimary,
                }}>
                  {entity.label}
                </h2>
              </div>
              <button
                onClick={onClose}
                style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.08)',
                  border: `0.5px solid ${disc.lineSubtle}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', flexShrink: 0,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={disc.textSecondary} strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* Impact bar */}
            {entity.impact > 0 && (
              <div style={{ padding: `0 ${space[10]}px`, marginBottom: space[6] }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${Math.round(entity.impact * 100)}%`,
                      background: `linear-gradient(90deg, ${accent.primary}, ${accent.cyan400})`,
                      borderRadius: 2, transition: 'width 0.4s ease',
                    }} />
                  </div>
                  <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {Math.round(entity.impact * 100)}% impact
                  </span>
                </div>
              </div>
            )}

            <div style={{ height: '0.5px', background: disc.lineSubtle, margin: `0 ${space[10]}px ${space[8]}px` }} />

            {/* Related mentions */}
            <div style={{ padding: `0 ${space[10]}px ${space[10]}px` }}>
              {mentioningPosts.length > 0 ? (
                <>
                  <p style={{
                    fontSize: typeScale.metaLg[0], fontWeight: 700, color: disc.textTertiary,
                    letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: space[6],
                  }}>
                    Mentioned in {mentioningPosts.length} post{mentioningPosts.length > 1 ? 's' : ''}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: space[4] }}>
                    {mentioningPosts.map(p => (
                      <RelatedPostRow key={p.id} post={p} needle={needle} />
                    ))}
                  </div>
                </>
              ) : (
                <p style={{
                  fontSize: typeScale.bodySm[0], color: disc.textTertiary,
                  fontStyle: 'italic', textAlign: 'center', padding: `${space[8]}px 0`,
                }}>
                  No matching posts in the current feed.
                </p>
              )}
            </div>

            <div style={{ height: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── EntityChip ───────────────────────────────────────────────────────────
// Tappable chip for use in Explore story cards and InterpolatorCard.

export function EntityChip({
  entity,
  onTap,
  size = 'md',
}: {
  entity: WriterEntity;
  onTap: (entity: WriterEntity) => void;
  size?: 'sm' | 'md';
}) {
  const meta = WRITER_TYPE_META[entity.type] ?? FALLBACK_TYPE_META;
  const pad = size === 'sm' ? '2px 8px' : '3px 10px';
  const fs = size === 'sm' ? 11 : typeScale.metaLg[0];

  return (
    <button
      onClick={e => { e.stopPropagation(); onTap(entity); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: pad, borderRadius: radius.full,
        background: meta.bg,
        border: `0.5px solid ${meta.color}50`,
        color: meta.color,
        fontSize: fs, fontWeight: 700, letterSpacing: '0.01em',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <span style={{ opacity: 0.7, fontSize: fs - 1 }}>
        {entity.type === 'person' ? '👤' : entity.type === 'organization' || entity.type === 'team' ? '🏢' : '#'}
      </span>
      {entity.label}
    </button>
  );
}

// ─── Legacy EntitySheet (app-level entity navigation) ─────────────────────
// Kept for existing EntityEntry navigation (EntityEntry from App.tsx).

const LEGACY_TYPE_COLOR: Record<string, string> = {
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

interface LegacyProps {
  entity: EntityEntry;
  onClose: () => void;
  onOpenStory: (e: StoryEntry) => void;
}

export default function EntitySheet({ entity, onClose, onOpenStory }: LegacyProps) {
  const color = LEGACY_TYPE_COLOR[entity.type] || 'var(--blue)';
  const related = MOCK_POSTS.slice(0, 3);

  return (
    <>
      <SheetBackdrop onClick={onClose} />
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
        <SheetDragHandle />
        <div style={{ overflowY: 'auto', flex: 1 }}>
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

          <div style={{ margin: '0 16px 16px', background: 'var(--bg)', borderRadius: 14, padding: '10px 14px', display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>ℹ️</span>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--label-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Why you're seeing this</p>
              <p style={{ fontSize: 14, color: 'var(--label-2)', lineHeight: 1.4 }}>{entity.reason}</p>
            </div>
          </div>

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
