// ─── Hosted Thread — Discussion Mode ─────────────────────────────────────
// Glympse Core Wireframe Spec v1 — Screen 3
//
// Structure (scrollable, not paginated):
//   HostBar (top bar with back + share)
//   PromptHeroCard (dark hero surface — the "cover line")
//   InterpolatorCard (intel surface — collapsed/expanded/emerging)
//   ThreadControls (filter chips)
//   ContributionStack (scored reply cards)
//   RelatedFooter
//
// Pipeline A: deterministic ATProto resolver (thread, facets, embeds)
// Pipeline B: heuristic scorer → rolling summary (Zustand threadStore)

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { StoryEntry } from '../App.js';
import { useSessionStore } from '../store/sessionStore.js';
import { atpCall } from '../lib/atproto/client.js';
import { mapFeedViewPost } from '../atproto/mappers.js';
import type { MockPost } from '../data/mockData.js';
import { formatTime } from '../data/mockData.js';
import {
  resolveThread, extractClusterSignals,
  type ThreadNode, type ResolvedFacet,
} from '../lib/resolver/atproto.js';
import {
  useThreadStore,
  type ContributionRole,
} from '../store/threadStore.js';
import {
  runInterpolatorPipeline,
  type ContributionScore,
} from '../intelligence/index.js';
import {
  promptHero as phTokens,
  interpolator as intTokens,
  contribution as contTokens,
  rolePill as rpTokens,
  signalChip as scTokens,
  nestedContribution as ncTokens,
  discussion as disc,
  accent,
  type as typeScale,
  radius,
  space,
  transitions,
  slideUpVariants,
} from '../design/index.js';

interface Props {
  entry: StoryEntry;
  onClose: () => void;
}

type ThreadFilter = 'Top' | 'Latest' | 'Clarifying' | 'New angles' | 'Open Story';

// ─── Helpers ──────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={2} strokeLinecap="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
        </path>
      </svg>
    </div>
  );
}

function RichText({ text, facets, baseColor }: { text: string; facets?: ResolvedFacet[]; baseColor: string }) {
  if (!facets?.length) {
    const parts = text.split(/(@[\w.]+|#\w+|https?:\/\/\S+)/g);
    return (
      <span>
        {parts.map((p, i) => {
          if (p.startsWith('@')) return <span key={i} style={{ color: '#BF8FFF', fontWeight: 500 }}>{p}</span>;
          if (p.startsWith('#')) return <span key={i} style={{ color: accent.blue500, fontWeight: 500 }}>{p}</span>;
          if (p.startsWith('http')) {
            try { return <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ color: accent.blue500 }} onClick={e => e.stopPropagation()}>{new URL(p).hostname.replace(/^www\./, '')}</a>; }
            catch { return <span key={i}>{p}</span>; }
          }
          return <span key={i} style={{ color: baseColor }}>{p}</span>;
        })}
      </span>
    );
  }
  // Byte-accurate facet rendering
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  const dec = new TextDecoder();
  const sorted = [...facets].sort((a, b) => a.byteStart - b.byteStart);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const f of sorted) {
    if (f.byteStart > cursor) nodes.push(<span key={`t${cursor}`} style={{ color: baseColor }}>{dec.decode(bytes.slice(cursor, f.byteStart))}</span>);
    const seg = dec.decode(bytes.slice(f.byteStart, f.byteEnd));
    if (f.kind === 'mention') nodes.push(<span key={`m${f.byteStart}`} style={{ color: '#BF8FFF', fontWeight: 500 }}>{seg}</span>);
    else if (f.kind === 'hashtag') nodes.push(<span key={`h${f.byteStart}`} style={{ color: accent.blue500, fontWeight: 500 }}>{seg}</span>);
    else if (f.kind === 'link') nodes.push(<a key={`l${f.byteStart}`} href={f.uri} target="_blank" rel="noopener noreferrer" style={{ color: accent.blue500 }} onClick={e => e.stopPropagation()}>{f.uri ? (() => { try { return new URL(f.uri!).hostname.replace(/^www\./, ''); } catch { return seg; } })() : seg}</a>);
    cursor = f.byteEnd;
  }
  if (cursor < bytes.length) nodes.push(<span key={`t${cursor}`} style={{ color: baseColor }}>{dec.decode(bytes.slice(cursor))}</span>);
  return <span>{nodes}</span>;
}

// ─── HostBar ──────────────────────────────────────────────────────────────
function HostBar({ onClose }: { onClose: () => void }) {
  return (
    <div style={{
      flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: 'calc(var(--safe-top) + 12px) 16px 12px',
      background: disc.bgBase,
      borderBottom: `0.5px solid ${disc.lineStrong}`,
    }}>
      <button
        onClick={onClose}
        style={{
          width: 36, height: 36, borderRadius: '50%',
          background: disc.surfaceCard2, border: `0.5px solid ${disc.lineSubtle}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={disc.textSecondary} strokeWidth={2.5} strokeLinecap="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <span style={{
        fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.04em',
        textTransform: 'uppercase', color: disc.textTertiary,
      }}>Thread</span>
      <button style={{
        width: 36, height: 36, borderRadius: '50%',
        background: disc.surfaceCard2, border: `0.5px solid ${disc.lineSubtle}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={disc.textSecondary} strokeWidth={2} strokeLinecap="round">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
      </button>
    </div>
  );
}

// ─── PromptHeroCard ───────────────────────────────────────────────────────
function PromptHeroCard({ post, participantCount }: { post: MockPost; participantCount: number }) {
  const img = post.media?.[0]?.url ?? post.embed?.thumb;
  return (
    <div style={{
      borderRadius: phTokens.radius,
      background: phTokens.bg,
      padding: `${phTokens.padding}px`,
      boxShadow: phTokens.shadow,
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Background image if available */}
      {img && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.18 }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(7,7,7,0.4) 0%, rgba(7,7,7,0.9) 100%)' }} />
        </div>
      )}

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Participant row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <div style={{ display: 'flex' }}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                width: 24, height: 24, borderRadius: '50%',
                background: `hsl(${i * 80 + 200}, 60%, 40%)`,
                border: '1.5px solid rgba(255,255,255,0.15)',
                marginLeft: i > 0 ? -8 : 0,
              }} />
            ))}
          </div>
          <span style={{
            fontSize: typeScale.metaLg[0], fontWeight: 500,
            color: phTokens.meta,
          }}>
            {participantCount} {participantCount === 1 ? 'person' : 'people'} discussing
          </span>
        </div>

        {/* Author */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }}>
            {post.author.avatar
              ? <img src={post.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>{post.author.displayName[0]}</div>
            }
          </div>
          <span style={{ fontSize: typeScale.metaLg[0], fontWeight: 600, color: phTokens.meta }}>
            @{post.author.handle}
          </span>
          <span style={{ fontSize: typeScale.metaSm[0], color: phTokens.meta }}>·</span>
          <span style={{ fontSize: typeScale.metaSm[0], color: phTokens.meta }}>{post.timestamp}</span>
        </div>

        {/* Title — the "cover line" */}
        <p style={{
          fontSize: typeScale.titleXl[0], lineHeight: `${typeScale.titleXl[1]}px`,
          fontWeight: typeScale.titleXl[2], letterSpacing: typeScale.titleXl[3],
          color: phTokens.text, marginBottom: 12,
        }}>
          {post.content}
        </p>

        {/* Embed source */}
        {post.embed && (post.embed.type === 'external' || post.embed.type === 'video') && (
          <div style={{
            padding: `${space[4]}px ${space[6]}px`,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: radius[12],
            border: `0.5px solid ${phTokens.line}`,
            marginBottom: 16,
          }}>
            <span style={{ fontSize: typeScale.metaSm[0], color: phTokens.meta }}>
              {(() => { try { return new URL(post.embed.url).hostname.replace(/^www\./, ''); } catch { return post.embed.url; } })()}
            </span>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── InterpolatorCard ─────────────────────────────────────────────────────
type InterpolatorState = 'collapsed' | 'expanded' | 'emerging' | 'updating' | 'stale';

function InterpolatorCard({
  rootUri, summaryText, clarifications, newAngles,
  heatLevel, repetitionLevel, sourceSupportPresent,
  replyCount, updatedAt,
}: {
  rootUri: string;
  summaryText: string;
  clarifications: string[];
  newAngles: string[];
  heatLevel: number;
  repetitionLevel: number;
  sourceSupportPresent: boolean;
  replyCount: number;
  updatedAt: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const state: InterpolatorState = summaryText === '' ? 'emerging'
    : replyCount < 3 ? 'emerging'
    : 'collapsed';

  const updatedAgo = (() => {
    try {
      const diff = Date.now() - new Date(updatedAt).getTime();
      const m = Math.floor(diff / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return `${m}m ago`;
      return `${Math.floor(m / 60)}h ago`;
    } catch { return ''; }
  })();

  const bg = intTokens.discussion.bg;
  const bg2 = intTokens.discussion.bg2;

  return (
    <motion.div
      layout
      style={{
        borderRadius: intTokens.radius,
        background: `linear-gradient(135deg, ${bg} 0%, ${bg2} 100%)`,
        padding: `${intTokens.padding}px`,
        boxShadow: intTokens.shadow,
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
        {/* Glyph */}
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: 'rgba(255,255,255,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={intTokens.glyph} strokeWidth={1.75} strokeLinecap="round">
            <circle cx="12" cy="12" r="3" fill={intTokens.glyph}/>
            <circle cx="4" cy="6" r="1.5" fill={intTokens.glyph}/>
            <circle cx="20" cy="6" r="1.5" fill={intTokens.glyph}/>
            <circle cx="4" cy="18" r="1.5" fill={intTokens.glyph}/>
            <circle cx="20" cy="18" r="1.5" fill={intTokens.glyph}/>
            <line x1="6" y1="7" x2="10" y2="11" stroke={intTokens.glyph} strokeWidth={1}/>
            <line x1="18" y1="7" x2="14" y2="11" stroke={intTokens.glyph} strokeWidth={1}/>
            <line x1="6" y1="17" x2="10" y2="13" stroke={intTokens.glyph} strokeWidth={1}/>
            <line x1="18" y1="17" x2="14" y2="13" stroke={intTokens.glyph} strokeWidth={1}/>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <p style={{
            fontSize: typeScale.chip[0], fontWeight: 700,
            color: intTokens.text.primary, marginBottom: 2,
          }}>Glympse Interpolator</p>
          <p style={{
            fontSize: typeScale.metaSm[0], fontWeight: 500,
            color: intTokens.timestamp,
          }}>Updated {updatedAgo}</p>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            background: 'rgba(255,255,255,0.08)', border: 'none', cursor: 'pointer',
            width: 28, height: 28, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <motion.svg
            animate={{ rotate: expanded ? 180 : 0 }}
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={intTokens.text.secondary} strokeWidth={2.5} strokeLinecap="round"
          >
            <polyline points="6 9 12 15 18 9"/>
          </motion.svg>
        </button>
      </div>

      {/* Summary */}
      <p style={{
        fontSize: typeScale.bodyMd[0], lineHeight: `${typeScale.bodyMd[1]}px`,
        fontWeight: typeScale.bodyMd[2],
        color: intTokens.text.secondary, marginBottom: 14,
      }}>
        {state === 'emerging'
          ? replyCount === 0
            ? 'This discussion is just beginning. Be the first to contribute.'
            : `This discussion is forming around ${replyCount} early response${replyCount > 1 ? 's' : ''}. Early voices are shaping the conversation.`
          : summaryText || 'Analyzing conversation…'
        }
      </p>

      {/* Evidence row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: expanded ? 16 : 0 }}>
        {replyCount > 0 && (
          <span style={{
            padding: '4px 10px', borderRadius: radius.full,
            background: intTokens.evidenceChip.bg,
            border: `0.5px solid ${intTokens.evidenceChip.border}`,
            color: intTokens.evidenceChip.text,
            fontSize: typeScale.metaLg[0], fontWeight: 600,
          }}>{replyCount} {replyCount === 1 ? 'voice' : 'voices'}</span>
        )}
        {clarifications.length > 0 && (
          <span style={{
            padding: '4px 10px', borderRadius: radius.full,
            background: intTokens.evidenceChip.bg,
            border: `0.5px solid ${intTokens.evidenceChip.border}`,
            color: intTokens.evidenceChip.text,
            fontSize: typeScale.metaLg[0], fontWeight: 600,
          }}>{clarifications.length} clarification{clarifications.length > 1 ? 's' : ''}</span>
        )}
        {sourceSupportPresent && (
          <span style={{
            padding: '4px 10px', borderRadius: radius.full,
            background: intTokens.evidenceChip.bg,
            border: `0.5px solid ${intTokens.evidenceChip.border}`,
            color: intTokens.evidenceChip.text,
            fontSize: typeScale.metaLg[0], fontWeight: 600,
          }}>source cited</span>
        )}
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={transitions.interpolatorToggle}
            style={{ overflow: 'hidden' }}
          >
            {/* What changed */}
            {(clarifications.length > 0 || newAngles.length > 0) && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontSize: typeScale.metaLg[0], fontWeight: 700, color: intTokens.text.meta, marginBottom: 8, letterSpacing: '0.04em', textTransform: 'uppercase' }}>What changed</p>
                {clarifications.slice(0, 2).map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <span style={{ color: intTokens.accent.cyan, fontSize: 13, flexShrink: 0 }}>•</span>
                    <span style={{ fontSize: typeScale.bodySm[0], color: intTokens.text.secondary }}>{c}</span>
                  </div>
                ))}
                {newAngles.slice(0, 2).map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <span style={{ color: intTokens.accent.lime, fontSize: 13, flexShrink: 0 }}>↗</span>
                    <span style={{ fontSize: typeScale.bodySm[0], color: intTokens.text.secondary }}>{a}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Heat / repetition meters */}
            {(heatLevel > 0 || repetitionLevel > 0) && (
              <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
                {heatLevel > 0 && (
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: typeScale.metaSm[0], color: intTokens.text.meta, marginBottom: 4 }}>Heat</p>
                    <div style={{ height: 4, borderRadius: radius.full, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${heatLevel * 100}%` }}
                        style={{ height: '100%', background: intTokens.accent.coral, borderRadius: radius.full }}
                      />
                    </div>
                  </div>
                )}
                {repetitionLevel > 0 && (
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: typeScale.metaSm[0], color: intTokens.text.meta, marginBottom: 4 }}>Repetition</p>
                    <div style={{ height: 4, borderRadius: radius.full, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${repetitionLevel * 100}%` }}
                        style={{ height: '100%', background: 'rgba(255,255,255,0.35)', borderRadius: radius.full }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Footer actions */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{
                padding: '6px 14px', borderRadius: radius.full,
                background: 'rgba(255,255,255,0.10)', border: 'none', cursor: 'pointer',
                color: intTokens.text.secondary, fontSize: typeScale.metaLg[0], fontWeight: 600,
              }}>Key voices</button>
              <button style={{
                padding: '6px 14px', borderRadius: radius.full,
                background: intTokens.link.color, border: 'none', cursor: 'pointer',
                color: '#0A1A2A', fontSize: typeScale.metaLg[0], fontWeight: 600,
              }}>Open Story</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── ThreadControls ───────────────────────────────────────────────────────
const THREAD_FILTERS: ThreadFilter[] = ['Top', 'Latest', 'Clarifying', 'New angles', 'Open Story'];

function ThreadControls({ active, onChange }: { active: ThreadFilter; onChange: (f: ThreadFilter) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2 }}>
      {THREAD_FILTERS.map(f => (
        <button
          key={f}
          onClick={() => onChange(f)}
          style={{
            flexShrink: 0,
            height: 36, padding: '0 14px',
            borderRadius: radius.full,
            background: active === f ? accent.primary : disc.surfaceCard,
            border: `0.5px solid ${active === f ? accent.primary : disc.lineStrong}`,
            color: active === f ? '#fff' : disc.textSecondary,
            fontSize: typeScale.chip[0], fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.14s',
          }}
        >{f}</button>
      ))}
    </div>
  );
}

// ─── SignalChip ───────────────────────────────────────────────────────────
function SignalChip({ type, count }: { type: keyof typeof scTokens; count: number }) {
  if (type === 'height' || type === 'paddingX' || type === 'radius') return null;
  const cfg = scTokens[type] as { bg: string; text: string };
  const labels: Record<string, string> = {
    clarifying: 'Clarifying', new: 'New to me', provocative: 'Provocative',
    source: 'Source-backed', counterpoint: 'Counterpoint',
  };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      height: scTokens.height, padding: `0 ${scTokens.paddingX}px`,
      borderRadius: scTokens.radius,
      background: cfg.bg, color: cfg.text,
      fontSize: typeScale.chip[0], fontWeight: 600,
    }}>
      {count > 0 && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
      {labels[type as string] ?? type}
    </span>
  );
}

// ─── RolePill ─────────────────────────────────────────────────────────────────
// Narwhal-style: bold saturated fills, white text, clearly communicates role.
const ROLE_LABELS: Record<ContributionRole, string> = {
  clarifying:           'Clarifying',
  new_information:      'New info',
  direct_response:      'Direct',
  repetitive:           'Repetitive',
  provocative:          'Provocative',
  useful_counterpoint:  'Counterpoint',
  story_worthy:         'Opinion',
  unknown:              'Reply',
};

function RolePill({ role }: { role: ContributionRole }) {
  const cfg = rpTokens[role as keyof typeof rpTokens] as { bg: string; text: string } | undefined;
  if (!cfg || typeof cfg !== 'object' || !('bg' in cfg)) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      height: rpTokens.height, padding: `0 ${rpTokens.paddingX}px`,
      borderRadius: rpTokens.radius,
      background: cfg.bg, color: cfg.text,
      fontSize: typeScale.metaLg[0], fontWeight: 700,
      letterSpacing: '0.01em',
      whiteSpace: 'nowrap',
    }}>{ROLE_LABELS[role]}</span>
  );
}
// ─── ContributionCard ─────────────────────────────────────────────────────
function ContributionCard({
  node, score, rootUri, featured, nested,
  onFeedback, isFollowed,
}: {
  node: ThreadNode;
  score?: ContributionScore;
  rootUri: string;
  featured?: boolean;
  nested?: boolean;
  isFollowed?: boolean;   // only distinction: slightly bolder display name
  onFeedback: (uri: string, fb: ContributionScore['userFeedback']) => void;
}) {
  const [feedbackGiven, setFeedbackGiven] = useState<ContributionScore['userFeedback']>(score?.userFeedback);
  // Never dim any reply — every contribution is equally important
  const isRepetitive = false;

  const handleFeedback = (fb: ContributionScore['userFeedback']) => {
    setFeedbackGiven(fb);
    onFeedback(node.uri, fb);
  };

  const cardStyle: React.CSSProperties = {
    borderRadius: nested ? ncTokens.radius : contTokens.radius,
    // Use native app CSS variables — consistent with rest of app in light + dark
    background: nested
      ? disc.surfaceNested    // var(--surface-3): slightly recessed, same family
      : disc.surfaceCard,     // var(--surface): white light / #1C1C1E dark
    padding: `${nested ? ncTokens.padding : contTokens.padding}px`,
    boxShadow: nested ? 'none' : contTokens.shadow,
    border: `0.5px solid ${disc.lineSubtle}`,
    // No opacity dimming — every reply reads at full weight
  };

  const signalType = score?.role === 'clarifying' ? 'clarifying'
    : score?.role === 'new_information' ? 'new'
    : score?.role === 'provocative' ? 'provocative'
    : score?.role === 'useful_counterpoint' ? 'counterpoint'
    : null;

  return (
    <div style={cardStyle}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: contTokens.gap }}>
        <div style={{ width: contTokens.avatar.size, height: contTokens.avatar.size, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceNested, flexShrink: 0 }}>
          {node.authorAvatar
            ? <img src={node.authorAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `hsl(${((node.authorHandle ?? 'x').charCodeAt(0) * 37) % 360}, 55%, 42%)`, color: '#fff', fontSize: 15, fontWeight: 700 }}>{(node.authorName ?? node.authorHandle ?? '?')[0].toUpperCase()}</div>
          }
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Only distinction between replies: followed accounts get fontWeight 800 */}
          <p style={{
            fontSize: typeScale.chip[0],
            fontWeight: isFollowed ? 800 : 600,
            color: disc.textPrimary,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {node.authorName ?? node.authorHandle}
          </p>
          <p style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>@{node.authorHandle}</p>
        </div>
        {score && score.role !== 'unknown' && <RolePill role={score.role} />}
        {score && score.usefulnessScore > 0.7 && (
          <div style={{
            minWidth: 40, height: 26, borderRadius: radius.full,
            background: '#FEF9C3', color: '#78610A',
            border: '0.5px solid #F5E07A',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: typeScale.metaSm[0], fontWeight: 700,
            padding: '0 8px', gap: 3,
          }}>
            <span style={{ fontSize: 11 }}>AHA!</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(score.usefulnessScore * 10)}</span>
          </div>
        )}
      </div>

      {/* Body */}
      <p style={{
        fontSize: nested ? typeScale.bodySm[0] : typeScale.bodyMd[0],
        lineHeight: `${nested ? typeScale.bodySm[1] : typeScale.bodyMd[1]}px`,
        fontWeight: typeScale.bodyMd[2],
        color: disc.textPrimary,
        marginBottom: contTokens.gap,
      }}>
        <RichText text={node.text} facets={node.facets} baseColor={disc.textPrimary} />
      </p>

      {/* Embed */}
      {node.embed?.kind === 'external' && node.embed.uri && (
        <a
          href={node.embed.uri}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{
            display: 'block', marginBottom: contTokens.gap,
            background: disc.surfaceCard2, borderRadius: radius[16],
            padding: `${space[6]}px ${space[8]}px`,
            textDecoration: 'none',
            border: `0.5px solid ${disc.lineSubtle}`,
          }}
        >
          {node.embed.thumb && <img src={node.embed.thumb} alt="" style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: radius[12], marginBottom: 6 }} />}
          {(node.embed as any).authorName && (
            <p style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary, marginBottom: 4 }}>
              <span style={{ fontWeight: 700, color: 'var(--teal)' }}>Featured author:</span> {(node.embed as any).authorName}
              {(node.embed as any).publisher && <span style={{ marginLeft: 8, color: 'var(--label-4)' }}>· {(node.embed as any).publisher}</span>}
            </p>
          )}
          <p style={{ fontSize: typeScale.chip[0], fontWeight: 600, color: disc.textPrimary, marginBottom: 2 }}>{node.embed.title}</p>
          <p style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>
            {(() => { try { return new URL(node.embed.uri).hostname.replace(/^www\./, ''); } catch { return node.embed.uri; } })()}
          </p>
        </a>
      )}

      {/* Signal chips */}
      {signalType && !isRepetitive && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: contTokens.gap }}>
          <SignalChip type={signalType} count={0} />
        </div>
      )}

      {/* Nested replies */}
      {node.replies && node.replies.length > 0 && !nested && (
        <div style={{
          marginLeft: ncTokens.inset, marginBottom: contTokens.gap,
          display: 'flex', flexDirection: 'column', gap: ncTokens.gap,
        }}>
          {node.replies.slice(0, 2).map(child => (
            <ContributionCard
              key={child.uri}
              node={child}
              rootUri={rootUri}
              nested
              onFeedback={onFeedback}
            />
          ))}
        </div>
      )}

      {/* Footer: timestamp */}
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 4, marginBottom: nested ? 0 : 8 }}>
        <span style={{
          fontSize: typeScale.metaSm[0], color: disc.textTertiary,
          textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500,
        }}>
          {node.createdAt ? formatTime(node.createdAt) : ''}
        </span>
      </div>

      {/* Narwhal-style feedback row: count + label pills */}
      {!nested && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([
            { fb: 'provocative' as const, label: 'Provocative' },
            { fb: 'clarifying' as const, label: 'Clarifying' },
            { fb: 'new_to_me' as const, label: 'New to me' },
          ]).map(({ fb, label }) => {
            const isActive = feedbackGiven === fb;
            return (
              <button
                key={fb}
                onClick={() => handleFeedback(fb)}
                style={{
                  height: 28, padding: '0 12px',
                  borderRadius: 14,
                  background: isActive ? 'rgba(218,165,32,0.15)' : 'transparent',
                  border: `0.5px solid ${isActive ? '#C49A00' : disc.lineStrong}`,
                  color: isActive ? '#9A7200' : disc.textSecondary,
                  fontSize: typeScale.metaLg[0], fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5,
                  letterSpacing: '0.01em',
                }}
              >
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>0</span>
                <span style={{ opacity: 0.5 }}>—</span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── ReplyBar ─────────────────────────────────────────────────────────────
function ReplyBar({ userAvatar }: { userAvatar?: string }) {
  return (
    <div style={{
      flexShrink: 0,
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 16px',
      paddingBottom: 'calc(var(--safe-bottom, 0px) + 10px)',
      background: disc.bgBase,
      borderTop: `0.5px solid ${disc.lineSubtle}`,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        overflow: 'hidden', flexShrink: 0,
        background: disc.surfaceCard2,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {userAvatar && <img src={userAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
      <div style={{
        flex: 1, height: 36, borderRadius: 18,
        background: disc.surfaceCard2,
        border: `0.5px solid ${disc.lineStrong}`,
        display: 'flex', alignItems: 'center',
        padding: '0 14px',
        cursor: 'text',
      }}>
        <span style={{ fontSize: typeScale.bodyMd[0], color: disc.textTertiary }}>Write your reply…</span>
      </div>
    </div>
  );
}

// ─── RelatedFooter ────────────────────────────────────────────────────────
function RelatedFooter({ onClose }: { onClose: () => void }) {
  return (
    <div style={{
      borderRadius: radius[24],
      background: disc.surfaceCard2,
      padding: `${space[10]}px`,
      border: `0.5px solid ${disc.lineSubtle}`,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <p style={{ fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: disc.textTertiary }}>Explore more</p>
      {[
        { label: 'Open Story', icon: '📖' },
        { label: 'Related topic', icon: '🔗' },
        { label: 'Related source', icon: '📰' },
        { label: 'Related discussion', icon: '💬' },
      ].map(item => (
        <button
          key={item.label}
          onClick={item.label === 'Open Story' ? onClose : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: `${space[6]}px ${space[8]}px`,
            borderRadius: radius[16],
            background: disc.surfaceCard,
            border: `0.5px solid ${disc.lineSubtle}`,
            cursor: 'pointer', textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 18 }}>{item.icon}</span>
          <span style={{ fontSize: typeScale.chip[0], fontWeight: 600, color: disc.textPrimary }}>{item.label}</span>
          <div style={{ flex: 1 }} />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={2.5} strokeLinecap="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      ))}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function StoryMode({ entry, onClose }: Props) {
  const { agent, session, profile } = useSessionStore();
  const { initThread, setInterpolatorState, setUserFeedback, getThread } = useThreadStore();
  const [rootPost, setRootPost] = useState<MockPost | null>(null);
  const [replies, setReplies] = useState<ThreadNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ThreadFilter>('Top');
  // Set of DIDs the current user follows — used only for bold username treatment
  const [followedDids, setFollowedDids] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!session?.did || !agent) return;
    // Fetch the viewer's follows once, quietly — used only for name bolding
    atpCall(() => agent.getFollows({ actor: session.did, limit: 100 }))
      .then(res => {
        const dids = new Set<string>((res?.data?.follows ?? []).map((f: { did: string }) => f.did));
        setFollowedDids(dids);
      })
      .catch(() => {}); // non-critical, fail silently
  }, [session?.did]);

  const threadState = getThread(entry.id);

  // ── Fetch thread ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    initThread(entry.id);

    atpCall(() => agent.getPostThread({ uri: entry.id, depth: 6 }))
      .then(res => {
        const thread = res?.data?.thread;
        if (!thread || thread.$type !== 'app.bsky.feed.defs#threadViewPost') {
          setError('Thread not found'); return;
        }
        // Map root post
        const rootNode = resolveThread(thread as any);
        if (rootNode) {
          const mapped = mapFeedViewPost({ post: (thread as any).post, reply: undefined, reason: undefined });
          setRootPost(mapped);
          setReplies(rootNode.replies ?? []);

          // Run the Interpolator pipeline (entity-aware, evidence-aware)
          const newState = runInterpolatorPipeline({
            rootUri: entry.id,
            rootText: rootNode.text,
            replies: rootNode.replies ?? [],
            existingState: getThread(entry.id),
          });
          setInterpolatorState(entry.id, newState);
        }
      })
      .catch(e => setError(e.message ?? 'Failed to load thread'))
      .finally(() => setLoading(false));
  }, [entry.id, session]);

  const handleFeedback = useCallback((replyUri: string, fb: ContributionScore['userFeedback']) => {
    setUserFeedback(entry.id, replyUri, fb);
  }, [entry.id]);

  // ── Filter replies ────────────────────────────────────────────────────────
  const filteredReplies = useMemo(() => {
    const state = getThread(entry.id);
    const scores = state?.replyScores ?? {};
    let sorted = [...replies];
    if (activeFilter === 'Top') {
      sorted.sort((a, b) => (scores[b.uri]?.usefulnessScore ?? 0) - (scores[a.uri]?.usefulnessScore ?? 0));
    } else if (activeFilter === 'Latest') {
      sorted.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    } else if (activeFilter === 'Clarifying') {
      sorted = sorted.filter(r => scores[r.uri]?.role === 'clarifying');
    } else if (activeFilter === 'New angles') {
      sorted = sorted.filter(r => ['new_information', 'useful_counterpoint'].includes(scores[r.uri]?.role ?? ''));
    }
    return sorted;
  }, [replies, activeFilter, entry.id, threadState?.version]);

  const featuredReply = filteredReplies.find(r => {
    const s = getThread(entry.id)?.replyScores[r.uri];
    return (s?.usefulnessScore ?? 0) > 0.75;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 32 }}
      transition={transitions.storyEntry}
      style={{
        position: 'fixed', inset: 0,
        // Native app background — consistent with rest of app in light + dark mode
        background: disc.bgBase,   // var(--bg): #F2F2F7 light / #000000 dark
        display: 'flex', flexDirection: 'column',
        zIndex: 200,
      }}
    >
      {/* HostBar */}
      <HostBar onClose={onClose} />

      {/* Scrollable body */}
      <div className="scroll-y" style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <Spinner />
        ) : error ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: typeScale.bodySm[0], color: disc.textTertiary }}>{error}</p>
          </div>
        ) : (
          <div style={{ padding: '20px 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* PromptHeroCard */}
            {rootPost && (
              <PromptHeroCard post={rootPost} participantCount={replies.length} />
            )}

            {/* InterpolatorCard */}
            <InterpolatorCard
              rootUri={entry.id}
              summaryText={threadState?.summaryText ?? ''}
              clarifications={threadState?.clarificationsAdded ?? []}
              newAngles={threadState?.newAnglesAdded ?? []}
              heatLevel={threadState?.heatLevel ?? 0}
              repetitionLevel={threadState?.repetitionLevel ?? 0}
              sourceSupportPresent={threadState?.sourceSupportPresent ?? false}
              replyCount={replies.length}
              updatedAt={threadState?.updatedAt ?? new Date().toISOString()}
            />

            {/* ThreadControls */}
            {replies.length > 0 && (
              <ThreadControls active={activeFilter} onChange={setActiveFilter} />
            )}

            {/* Featured contribution */}
            {featuredReply && activeFilter === 'Top' && (
              <ContributionCard
                key={`featured-${featuredReply.uri}`}
                node={featuredReply}
                score={getThread(entry.id)?.replyScores[featuredReply.uri]}
                rootUri={entry.id}
                featured
                isFollowed={followedDids.has(featuredReply.authorDid ?? '')}
                onFeedback={handleFeedback}
              />
            )}

            {/* Contribution stack */}
            {filteredReplies
              .filter(r => r.uri !== featuredReply?.uri || activeFilter !== 'Top')
              .map(node => (
                <ContributionCard
                  key={node.uri}
                  node={node}
                  score={getThread(entry.id)?.replyScores[node.uri]}
                  rootUri={entry.id}
                  isFollowed={followedDids.has(node.authorDid ?? '')}
                  onFeedback={handleFeedback}
                />
              ))
            }

            {replies.length === 0 && !loading && (
              <div style={{ padding: '24px 0', textAlign: 'center' }}>
                <p style={{ fontSize: typeScale.bodySm[0], color: disc.textTertiary }}>No replies yet. Be the first to contribute.</p>
              </div>
            )}

            {/* Related footer */}
            <RelatedFooter onClose={onClose} />
            <div style={{ height: 16 }} />
          </div>
        )}
      </div>

      {/* Static reply bar — always visible, Bluesky-style */}
      <ReplyBar {...(profile?.avatar !== undefined ? { userAvatar: profile.avatar } : {})} />
    </motion.div>
  );
}
