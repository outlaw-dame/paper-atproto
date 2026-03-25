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
import { formatTime, formatCount } from '../data/mockData.js';
import {
  resolveThread, extractClusterSignals,
  type ThreadNode, type ResolvedFacet,
} from '../lib/resolver/atproto.js';
import { useThreadStore } from '../store/threadStore.js';
import {
  runVerifiedThreadPipeline,
  nodeToThreadPost,
  type ContributionRole,
  type ContributionScores,
  type ContributorImpact,
  type EntityImpact,
  type VerificationOutcome,
} from '../intelligence/index.js';
import { createVerificationProviders } from '../intelligence/verification/providerFactory.js';
import { InMemoryVerificationCache } from '../intelligence/verification/cache.js';
import { buildThreadStateForWriter } from '../intelligence/writerInput.js';
import { callInterpolatorWriter } from '../intelligence/modelClient.js';
import type { SummaryMode } from '../intelligence/llmContracts.js';
import { translateWriterInput } from '../lib/i18n/threadTranslation.js';
import { useTranslationStore } from '../store/translationStore.js';
import { translationClient } from '../lib/i18n/client.js';
import {
  promptHero as phTokens,
  interpolator as intTokens,
  contribution as contTokens,
  rolePill as rpTokens,
  signalChip as scTokens,
  nestedContribution as ncTokens,
  discussion as disc,
  accent,
  intel,
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

type ThreadFilter = 'Top' | 'Latest' | 'Clarifying' | 'New angles' | 'Source-backed' | 'Open Story';

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
function PromptHeroCard({
  post,
  participantCount,
  rootVerification,
}: {
  post: MockPost;
  participantCount: number;
  rootVerification?: VerificationOutcome | null;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [liked, setLiked] = useState(!!post.viewer?.like);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [reposted, setReposted] = useState(!!post.viewer?.repost);
  const [repostCount, setRepostCount] = useState(post.repostCount);
  const [bookmarked, setBookmarked] = useState(false);
  const [showRepostMenu, setShowRepostMenu] = useState(false);
  const { policy: translationPolicy, byId: translationById, upsertTranslation } = useTranslationStore();
  const translation = translationById[post.id];
  const rootText = translation && !showOriginal ? translation.translatedText : post.content;

  const handleTranslate = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (translation) {
      setShowOriginal((prev) => !prev);
      return;
    }

    if (!post.content.trim()) return;
    setTranslating(true);
    try {
      const result = await translationClient.translateInline({
        id: post.id,
        sourceText: post.content,
        targetLang: translationPolicy.userLanguage,
        mode: translationPolicy.localOnlyMode ? 'local_private' : 'server_default',
      });
      upsertTranslation(result);
      setShowOriginal(false);
    } catch {
      // Keep original text visible.
    } finally {
      setTranslating(false);
    }
  };

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
          {rootText}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <button
            onClick={handleTranslate}
            disabled={translating}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#7CE9FF',
              fontSize: typeScale.metaSm[0],
              fontWeight: 600,
              padding: 0,
              cursor: translating ? 'default' : 'pointer',
              opacity: translating ? 0.7 : 1,
            }}
          >
            {translation ? (showOriginal ? 'Show translation' : 'Show original') : (translating ? 'Translating...' : 'Translate')}
          </button>
          {translation && (
            <span style={{ fontSize: typeScale.metaSm[0], color: phTokens.meta }}>
              from {translation.sourceLang}
            </span>
          )}
        </div>

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

        {/* Quote post embed */}
        {post.embed?.type === 'quote' && post.embed.post && (
          <div style={{
            padding: `${space[6]}px ${space[8]}px`,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: radius[12],
            border: `0.5px solid ${phTokens.line}`,
            marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: typeScale.metaSm[0], fontWeight: 700, color: phTokens.meta }}>
                {post.embed.post.author.displayName || post.embed.post.author.handle}
              </span>
              <span style={{ fontSize: typeScale.metaSm[0], color: phTokens.meta, opacity: 0.6 }}>
                @{post.embed.post.author.handle}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: typeScale.bodySm[0], color: phTokens.meta, opacity: 0.85, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {post.embed.post.content}
            </p>
          </div>
        )}

        {/* External link preview (standalone or from recordWithMedia) */}
        {post.embed?.type === 'quote' && post.embed.externalLink && (
          <a
            href={post.embed.externalLink.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{
              display: 'block', marginBottom: 16,
              background: 'rgba(255,255,255,0.06)',
              borderRadius: radius[12],
              border: `0.5px solid ${phTokens.line}`,
              textDecoration: 'none', overflow: 'hidden',
            }}
          >
            {post.embed.externalLink.thumb && (
              <img src={post.embed.externalLink.thumb} alt="" style={{ width: '100%', height: 120, objectFit: 'cover' }} />
            )}
            <div style={{ padding: `${space[4]}px ${space[6]}px` }}>
              {post.embed.externalLink.title && (
                <p style={{ margin: '0 0 2px', fontSize: typeScale.chip[0], fontWeight: 600, color: phTokens.text }}>{post.embed.externalLink.title}</p>
              )}
              <p style={{ margin: 0, fontSize: typeScale.metaSm[0], color: phTokens.meta }}>{post.embed.externalLink.domain}</p>
            </div>
          </a>
        )}
        {post.embed?.type === 'external' && (
          <a
            href={post.embed.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{
              display: 'block', marginBottom: 16,
              background: 'rgba(255,255,255,0.06)',
              borderRadius: radius[12],
              border: `0.5px solid ${phTokens.line}`,
              textDecoration: 'none', overflow: 'hidden',
            }}
          >
            {post.embed.thumb && (
              <img src={post.embed.thumb} alt="" style={{ width: '100%', height: 120, objectFit: 'cover' }} />
            )}
            <div style={{ padding: `${space[4]}px ${space[6]}px` }}>
              {post.embed.title && (
                <p style={{ margin: '0 0 2px', fontSize: typeScale.chip[0], fontWeight: 600, color: phTokens.text }}>{post.embed.title}</p>
              )}
              <p style={{ margin: 0, fontSize: typeScale.metaSm[0], color: phTokens.meta }}>{post.embed.domain}</p>
            </div>
          </a>
        )}

        {/* Factual chips from root verification */}
        {rootVerification && (() => {
          const chips: Array<{ label: string; color: string }> = [];
          if (rootVerification.factCheck?.matched) chips.push({ label: 'Fact-checked', color: '#22C55E' });
          if (rootVerification.sourcePresence > 0.3 && rootVerification.sourceQuality > 0.4) chips.push({ label: 'Source-backed', color: accent.blue500 });
          if (rootVerification.quoteFidelity >= 0.65) chips.push({ label: 'Direct quote', color: '#BF8FFF' });
          if (rootVerification.contradictionLevel >= 0.45) chips.push({ label: 'Contested', color: '#F97316' });
          if (chips.length === 0) return null;
          return (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {chips.map(chip => (
                <span key={chip.label} style={{
                  padding: '3px 10px', borderRadius: radius.full,
                  background: 'rgba(255,255,255,0.08)',
                  border: `0.5px solid ${chip.color}40`,
                  color: chip.color,
                  fontSize: typeScale.metaSm[0], fontWeight: 600,
                }}>{chip.label}</span>
              ))}
            </div>
          );
        })()}

        {/* Action bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 0,
          borderTop: `0.5px solid rgba(255,255,255,0.1)`,
          paddingTop: 12, marginTop: 8,
        }}>
          {/* Reply */}
          <button style={heroActionBtnStyle} onClick={e => e.stopPropagation()}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
            <span style={heroActionCountStyle}>{formatCount(post.replyCount)}</span>
          </button>

          {/* Repost / Quote */}
          <div style={{ position: 'relative' }}>
            <button
              style={{ ...heroActionBtnStyle, color: reposted ? 'var(--green)' : 'rgba(255,255,255,0.55)' }}
              onClick={e => { e.stopPropagation(); setShowRepostMenu(v => !v); }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={reposted ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/>
                <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
              </svg>
              <span style={{ ...heroActionCountStyle, color: reposted ? 'var(--green)' : 'rgba(255,255,255,0.55)' }}>{formatCount(repostCount)}</span>
            </button>
            <AnimatePresence>
              {showRepostMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.95 }}
                  transition={{ duration: 0.12 }}
                  style={{
                    position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
                    background: disc.surfaceCard,
                    border: `0.5px solid ${disc.lineStrong}`,
                    borderRadius: radius[16], overflow: 'hidden',
                    zIndex: 300, minWidth: 160,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                  }}
                >
                  <button
                    onClick={e => { e.stopPropagation(); setReposted(v => !v); setRepostCount(c => reposted ? c - 1 : c + 1); setShowRepostMenu(false); }}
                    style={dropdownItemStyle}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={disc.textPrimary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/>
                      <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
                    </svg>
                    <span style={{ fontSize: typeScale.bodyMd[0], fontWeight: 600, color: disc.textPrimary }}>{reposted ? 'Undo repost' : 'Repost'}</span>
                  </button>
                  <div style={{ height: 0.5, background: disc.lineSubtle }} />
                  <button onClick={e => { e.stopPropagation(); setShowRepostMenu(false); }} style={dropdownItemStyle}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={disc.textPrimary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
                      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
                    </svg>
                    <span style={{ fontSize: typeScale.bodyMd[0], fontWeight: 600, color: disc.textPrimary }}>Quote post</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Like */}
          <button
            style={{ ...heroActionBtnStyle, color: liked ? 'var(--red)' : 'rgba(255,255,255,0.55)' }}
            onClick={e => { e.stopPropagation(); setLiked(v => !v); setLikeCount(c => liked ? c - 1 : c + 1); }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={liked ? 0 : 2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
            </svg>
            <span style={{ ...heroActionCountStyle, color: liked ? 'var(--red)' : 'rgba(255,255,255,0.55)' }}>{formatCount(likeCount)}</span>
          </button>

          {/* Bookmark */}
          <button
            style={{ ...heroActionBtnStyle, color: bookmarked ? accent.primary : 'rgba(255,255,255,0.55)' }}
            onClick={e => { e.stopPropagation(); setBookmarked(v => !v); }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={bookmarked ? 0 : 2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
            </svg>
          </button>

          {showRepostMenu && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={e => { e.stopPropagation(); setShowRepostMenu(false); }} />
          )}
        </div>

      </div>
    </div>
  );
}

// ─── renderSummaryText ────────────────────────────────────────────────────
// Splits summaryText on @mentions and #hashtags, returning a React node array
// with linkified, slightly-bold handles and linkified tags.
function renderSummaryText(text: string): React.ReactNode[] {
  const parts = text.split(/(@[\w.:-]+|#[\w]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const handle = part.slice(1);
      return (
        <a
          key={i}
          href={`https://bsky.app/profile/${handle}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontWeight: 600, color: 'inherit', textDecoration: 'none' }}
        >
          {part}
        </a>
      );
    }
    if (part.startsWith('#')) {
      const tag = part.slice(1);
      return (
        <a
          key={i}
          href={`https://bsky.app/search?q=%23${tag}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit', textDecoration: 'none' }}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

// ─── InterpolatorCard ─────────────────────────────────────────────────────
type InterpolatorState = 'collapsed' | 'expanded' | 'emerging' | 'updating' | 'stale';

function InterpolatorCard({
  rootUri, summaryText, writerSummary, summaryMode,
  writerWhatChanged, writerContributorBlurbs,
  clarifications, newAngles,
  heatLevel, repetitionLevel, sourceSupportPresent,
  replyCount, updatedAt,
  topContributors, entityLandscape, factualSignalPresent,
}: {
  rootUri: string;
  summaryText: string;
  /** Model-written summary — takes precedence over heuristic summaryText when present. */
  writerSummary?: string | undefined;
  /** Summary mode from confidence routing. */
  summaryMode?: SummaryMode | undefined;
  /** Model-written what-changed signals — takes precedence over heuristic clarifications/newAngles. */
  writerWhatChanged?: string[] | undefined;
  /** Model-written per-contributor blurbs for the expanded Key Voices section. */
  writerContributorBlurbs?: Array<{ handle: string; blurb: string }> | undefined;
  clarifications: string[];
  newAngles: string[];
  heatLevel: number;
  repetitionLevel: number;
  sourceSupportPresent: boolean;
  replyCount: number;
  updatedAt: string;
  topContributors: ContributorImpact[];
  entityLandscape: EntityImpact[];
  factualSignalPresent: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // Use writer summary if available, otherwise fall back to heuristic
  const displaySummary = writerSummary || summaryText;
  // Only show "emerging" when there is genuinely nothing to display —
  // the model can write a summary for even a 1-reply thread.
  const state: InterpolatorState = displaySummary === '' ? 'emerging' : 'collapsed';

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
          : displaySummary ? renderSummaryText(displaySummary) : 'Analyzing conversation…'
        }
      </p>

      {/* Fallback mode badge */}
      {writerSummary && summaryMode && summaryMode !== 'normal' && (
        <p style={{ fontSize: 11, color: intTokens.text.secondary, opacity: 0.5, margin: '-10px 0 10px', fontStyle: 'italic' }}>
          {summaryMode === 'descriptive_fallback' ? 'Descriptive analysis' : 'Summary'}
        </p>
      )}

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
        {factualSignalPresent && (
          <span style={{
            padding: '4px 10px', borderRadius: radius.full,
            background: 'rgba(99,220,180,0.12)',
            border: '0.5px solid rgba(99,220,180,0.30)',
            color: '#63DCB4',
            fontSize: typeScale.metaLg[0], fontWeight: 600,
          }}>evidence verified</span>
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
            {/* What changed — prefer model output, fall back to heuristic */}
            {((writerWhatChanged && writerWhatChanged.length > 0) || clarifications.length > 0 || newAngles.length > 0) && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontSize: typeScale.metaLg[0], fontWeight: 700, color: intTokens.text.meta, marginBottom: 8, letterSpacing: '0.04em', textTransform: 'uppercase' }}>What changed</p>
                {writerWhatChanged && writerWhatChanged.length > 0 ? (
                  writerWhatChanged.map((signal, i) => {
                    const isNewAngle = signal.startsWith('new angle:') || signal.startsWith('new info:') || signal.startsWith('counterpoint:');
                    return (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <span style={{ color: isNewAngle ? intel.accentLime : intel.accentCyan, fontSize: 13, flexShrink: 0 }}>{isNewAngle ? '↗' : '•'}</span>
                        <span style={{ fontSize: typeScale.bodySm[0], color: intTokens.text.secondary }}>{signal}</span>
                      </div>
                    );
                  })
                ) : (
                  <>
                    {clarifications.slice(0, 2).map((c, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <span style={{ color: intel.accentCyan, fontSize: 13, flexShrink: 0 }}>•</span>
                        <span style={{ fontSize: typeScale.bodySm[0], color: intTokens.text.secondary }}>{c}</span>
                      </div>
                    ))}
                    {newAngles.slice(0, 2).map((a, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <span style={{ color: intel.accentLime, fontSize: 13, flexShrink: 0 }}>↗</span>
                        <span style={{ fontSize: typeScale.bodySm[0], color: intTokens.text.secondary }}>{a}</span>
                      </div>
                    ))}
                  </>
                )}
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

            {/* Entities */}
            {entityLandscape.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontSize: typeScale.metaLg[0], fontWeight: 700, color: intTokens.text.meta, marginBottom: 8, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Entities</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[...entityLandscape]
                    .sort((a, b) => b.mentionCount - a.mentionCount)
                    .slice(0, 5)
                    .map((e, i) => (
                      <span key={i} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '3px 9px', borderRadius: radius.full,
                        background: 'rgba(255,255,255,0.07)',
                        border: '0.5px solid rgba(255,255,255,0.14)',
                        fontSize: typeScale.metaLg[0], color: intTokens.text.secondary,
                      }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                          color: intTokens.text.meta, textTransform: 'uppercase',
                        }}>{e.entityKind}</span>
                        <span style={{ fontWeight: 600 }}>{e.canonicalLabel ?? e.entityText}</span>
                        {e.mentionCount > 1 && (
                          <span style={{ color: intTokens.text.meta, fontSize: 11 }}>×{e.mentionCount}</span>
                        )}
                        {e.matchConfidence !== undefined && e.matchConfidence < 0.99 && (
                          <span style={{ color: intTokens.text.meta, fontSize: 11 }}>{Math.round(e.matchConfidence * 100)}%</span>
                        )}
                      </span>
                    ))
                  }
                </div>
              </div>
            )}

            {/* Key voices — show writer blurbs when available, fall back to heuristic role labels */}
            {topContributors.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontSize: typeScale.metaLg[0], fontWeight: 700, color: intTokens.text.meta, marginBottom: 8, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Key voices</p>
                {topContributors.slice(0, 3).map((c, i) => {
                  const label = c.handle ? `@${c.handle}` : `${c.did.slice(8, 18)}…`;
                  const blurb = writerContributorBlurbs?.find(b => b.handle === c.handle)?.blurb;
                  const roleLabel: Record<string, string> = {
                    clarifying: 'Clarifying', new_information: 'New info',
                    direct_response: 'Direct', useful_counterpoint: 'Counterpoint',
                    story_worthy: 'Story-worthy', rule_source: 'Rule source',
                    source_bringer: 'Source', repetitive: 'Repetitive',
                    provocative: 'Provocative', unknown: 'Contributor',
                  };
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: blurb ? 10 : 6 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: 'rgba(255,255,255,0.12)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 700, color: intTokens.text.secondary, flexShrink: 0, marginTop: 1,
                      }}>{label.slice(1, 2).toUpperCase()}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: typeScale.bodySm[0], fontWeight: 600, color: intTokens.text.secondary }}>{label}</span>
                          {!blurb && (
                            <span style={{
                              padding: '2px 8px', borderRadius: radius.full,
                              background: 'rgba(255,255,255,0.08)',
                              fontSize: typeScale.metaSm[0], fontWeight: 600, color: intTokens.text.meta,
                            }}>{roleLabel[c.dominantRole] ?? 'Contributor'}</span>
                          )}
                          {c.factualContributions > 0 && (
                            <span style={{
                              padding: '2px 7px', borderRadius: radius.full,
                              background: 'rgba(99,220,180,0.12)', border: '0.5px solid rgba(99,220,180,0.25)',
                              fontSize: typeScale.metaSm[0], fontWeight: 600, color: '#63DCB4',
                            }}>{c.factualContributions} factual</span>
                          )}
                        </div>
                        {blurb && (
                          <p style={{ fontSize: typeScale.metaLg[0], color: intTokens.text.meta, margin: '2px 0 0', lineHeight: '1.4' }}>{blurb}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Footer actions */}
            <div style={{ display: 'flex', gap: 10 }}>
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
const THREAD_FILTERS: ThreadFilter[] = ['Top', 'Latest', 'Clarifying', 'New angles', 'Source-backed', 'Open Story'];

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
  rule_source:          'Rule source',
  source_bringer:       'Source',
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
  onFeedback, onQuoteComment, isFollowed,
}: {
  node: ThreadNode;
  score?: ContributionScores;
  rootUri: string;
  featured?: boolean;
  nested?: boolean;
  isFollowed?: boolean;
  onFeedback: (uri: string, fb: ContributionScores['userFeedback']) => void;
  onQuoteComment?: (node: ThreadNode) => void;
}) {
  const [feedbackGiven, setFeedbackGiven] = useState<ContributionScores['userFeedback']>(score?.userFeedback);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(node.likeCount);
  const [reposted, setReposted] = useState(false);
  const [repostCount, setRepostCount] = useState(node.repostCount);
  const [bookmarked, setBookmarked] = useState(false);
  const [showRepostMenu, setShowRepostMenu] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [translating, setTranslating] = useState(false);
  const { policy: translationPolicy, byId: translationById, upsertTranslation } = useTranslationStore();
  const translation = translationById[node.uri];

  const handleFeedback = (fb: ContributionScores['userFeedback']) => {
    setFeedbackGiven(fb);
    onFeedback(node.uri, fb);
  };

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLiked(v => !v);
    setLikeCount(c => liked ? c - 1 : c + 1);
  };

  const handleRepost = (e: React.MouseEvent) => {
    e.stopPropagation();
    setReposted(v => !v);
    setRepostCount(c => reposted ? c - 1 : c + 1);
    setShowRepostMenu(false);
  };

  const handleBookmark = (e: React.MouseEvent) => {
    e.stopPropagation();
    setBookmarked(v => !v);
  };

  const handleTranslate = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (translation) {
      setShowOriginal((prev) => !prev);
      return;
    }

    if (!node.text.trim()) return;
    setTranslating(true);
    try {
      const result = await translationClient.translateInline({
        id: node.uri,
        sourceText: node.text,
        targetLang: translationPolicy.userLanguage,
        mode: translationPolicy.localOnlyMode ? 'local_private' : 'server_default',
      });
      upsertTranslation(result);
      setShowOriginal(false);
    } catch {
      // Keep rendering original on translation failure.
    } finally {
      setTranslating(false);
    }
  };

  // Never dim any reply — every contribution is equally important
  const isRepetitive = false;

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
  const bodyText = translation && !showOriginal ? translation.translatedText : node.text;

  return (
    <div style={cardStyle}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: contTokens.gap }}>
        <div style={{ width: contTokens.avatar.size, height: contTokens.avatar.size, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceNested, flexShrink: 0 }}>
          {node.authorAvatar
            ? <img src={node.authorAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `hsl(${((node.authorHandle ?? 'x').charCodeAt(0) * 37) % 360}, 55%, 42%)`, color: '#fff', fontSize: 15, fontWeight: 700 }}>{((node.authorName ?? node.authorHandle ?? '').trim().charAt(0) || '?').toUpperCase()}</div>
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

      {/* "↳ replying to @X" — only on nested replies where the parent isn't the root poster */}
      {nested && node.parentAuthorHandle && (
        <p style={{
          fontSize: typeScale.metaSm[0], color: disc.textTertiary,
          marginBottom: 4, fontWeight: 500,
        }}>
          ↳ replying to @{node.parentAuthorHandle}
        </p>
      )}

      {/* Body */}
      <p style={{
        fontSize: nested ? typeScale.bodySm[0] : typeScale.bodyMd[0],
        lineHeight: `${nested ? typeScale.bodySm[1] : typeScale.bodyMd[1]}px`,
        fontWeight: typeScale.bodyMd[2],
        color: disc.textPrimary,
        marginBottom: contTokens.gap,
      }}>
        <RichText text={bodyText} facets={node.facets} baseColor={disc.textPrimary} />
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: contTokens.gap }}>
        <button
          onClick={handleTranslate}
          disabled={translating}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--blue)',
            fontSize: typeScale.metaSm[0],
            fontWeight: 600,
            padding: 0,
            cursor: translating ? 'default' : 'pointer',
            opacity: translating ? 0.7 : 1,
          }}
        >
          {translation ? (showOriginal ? 'Show translation' : 'Show original') : (translating ? 'Translating...' : 'Translate')}
        </button>
        {translation && (
          <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>
            from {translation.sourceLang}
          </span>
        )}
      </div>

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

      {/* Quote post embed */}
      {(node.embed?.kind === 'record' || node.embed?.kind === 'recordWithMedia') && node.embed.quotedText && (
        <div style={{
          marginBottom: contTokens.gap,
          background: disc.surfaceCard2,
          borderRadius: radius[12],
          padding: `${space[6]}px ${space[8]}px`,
          border: `0.5px solid ${disc.lineSubtle}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <span style={{ fontSize: typeScale.metaSm[0], fontWeight: 700, color: disc.textPrimary }}>
              {node.embed.quotedAuthorDisplayName || node.embed.quotedAuthorHandle || 'Unknown'}
            </span>
            {node.embed.quotedAuthorHandle && (
              <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>
                @{node.embed.quotedAuthorHandle}
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: typeScale.bodySm[0], color: disc.textSecondary, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {node.embed.quotedText}
          </p>
        </div>
      )}

      {/* Link preview card from recordWithMedia external media */}
      {node.embed?.kind === 'recordWithMedia' && node.embed.mediaExternal && (
        <a
          href={node.embed.mediaExternal.uri}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{
            display: 'block', marginBottom: contTokens.gap,
            background: disc.surfaceCard2, borderRadius: radius[12],
            textDecoration: 'none', overflow: 'hidden',
            border: `0.5px solid ${disc.lineSubtle}`,
          }}
        >
          {node.embed.mediaExternal.thumb && (
            <img src={node.embed.mediaExternal.thumb} alt="" style={{ width: '100%', height: 100, objectFit: 'cover' }} />
          )}
          <div style={{ padding: `${space[4]}px ${space[6]}px` }}>
            {node.embed.mediaExternal.title && (
              <p style={{ margin: '0 0 2px', fontSize: typeScale.chip[0], fontWeight: 600, color: disc.textPrimary }}>{node.embed.mediaExternal.title}</p>
            )}
            <p style={{ margin: 0, fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>{node.embed.mediaExternal.domain}</p>
          </div>
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
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

      {/* Action bar — reply / repost+quote / like / bookmark */}
      {!nested && (
        <div style={{
          display: 'flex', alignItems: 'center',
          gap: 0, marginTop: 2,
          borderTop: `0.5px solid ${disc.lineSubtle}`,
          paddingTop: 10,
          position: 'relative',
        }}>
          {/* Reply */}
          <button style={actionBtnStyle} onClick={e => e.stopPropagation()}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
            <span style={actionCountStyle}>{formatCount(node.replyCount)}</span>
          </button>

          {/* Repost / Quote — with dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              style={{ ...actionBtnStyle, color: reposted ? 'var(--green)' : disc.textTertiary }}
              onClick={e => { e.stopPropagation(); setShowRepostMenu(v => !v); }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={reposted ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/>
                <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
              </svg>
              <span style={{ ...actionCountStyle, color: reposted ? 'var(--green)' : disc.textTertiary }}>{formatCount(repostCount)}</span>
            </button>

            {/* Repost dropdown */}
            <AnimatePresence>
              {showRepostMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.95 }}
                  transition={{ duration: 0.12 }}
                  style={{
                    position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
                    background: disc.surfaceCard,
                    border: `0.5px solid ${disc.lineStrong}`,
                    borderRadius: radius[16],
                    overflow: 'hidden',
                    zIndex: 300,
                    minWidth: 160,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                  }}
                >
                  <button
                    onClick={handleRepost}
                    style={dropdownItemStyle}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={disc.textPrimary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/>
                      <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
                    </svg>
                    <span style={{ fontSize: typeScale.bodyMd[0], fontWeight: 600, color: disc.textPrimary }}>
                      {reposted ? 'Undo repost' : 'Repost'}
                    </span>
                  </button>
                  <div style={{ height: 0.5, background: disc.lineSubtle }} />
                  <button
                    onClick={e => { e.stopPropagation(); setShowRepostMenu(false); onQuoteComment?.(node); }}
                    style={dropdownItemStyle}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={disc.textPrimary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
                      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
                    </svg>
                    <span style={{ fontSize: typeScale.bodyMd[0], fontWeight: 600, color: disc.textPrimary }}>Quote post</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Like */}
          <button style={{ ...actionBtnStyle, color: liked ? 'var(--red)' : disc.textTertiary }} onClick={handleLike}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={liked ? 0 : 2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
            </svg>
            <span style={{ ...actionCountStyle, color: liked ? 'var(--red)' : disc.textTertiary }}>{formatCount(likeCount)}</span>
          </button>

          {/* Bookmark */}
          <button style={{ ...actionBtnStyle, color: bookmarked ? accent.primary : disc.textTertiary }} onClick={handleBookmark}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={bookmarked ? 0 : 2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
            </svg>
          </button>

          {/* Dismiss repost menu on outside click */}
          {showRepostMenu && (
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 299 }}
              onClick={e => { e.stopPropagation(); setShowRepostMenu(false); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5,
  background: 'none', border: 'none', padding: '2px 10px 2px 0',
  cursor: 'pointer', color: 'inherit',
};

const actionCountStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500,
};

const heroActionBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5,
  background: 'none', border: 'none', padding: '2px 14px 2px 0',
  cursor: 'pointer', color: 'rgba(255,255,255,0.55)',
};

const heroActionCountStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.55)',
};

const dropdownItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  width: '100%', padding: '12px 16px',
  background: 'none', border: 'none',
  cursor: 'pointer', textAlign: 'left',
};

// ─── QuoteComposer ────────────────────────────────────────────────────────
function QuoteComposer({ node, onClose }: { node: ThreadNode; onClose: () => void }) {
  const [text, setText] = useState('');

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end',
      zIndex: 400,
    }} onClick={onClose}>
      <div
        style={{
          width: '100%',
          background: disc.bgBase,
          borderRadius: `${radius[24]}px ${radius[24]}px 0 0`,
          padding: '20px 16px',
          paddingBottom: 'calc(var(--safe-bottom, 0px) + 20px)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: disc.textSecondary, fontSize: typeScale.bodyMd[0] }}
          >Cancel</button>
          <span style={{ fontSize: typeScale.chip[0], fontWeight: 700, color: disc.textPrimary }}>Quote post</span>
          <button
            style={{
              height: 32, padding: '0 16px', borderRadius: radius.full,
              background: accent.primary, border: 'none', cursor: 'pointer',
              color: '#fff', fontSize: typeScale.chip[0], fontWeight: 700,
              opacity: text.trim().length === 0 ? 0.45 : 1,
            }}
            disabled={text.trim().length === 0}
          >Post</button>
        </div>

        {/* Composer input */}
        <textarea
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Add a comment…"
          style={{
            width: '100%', minHeight: 72,
            background: 'transparent', border: 'none', outline: 'none', resize: 'none',
            fontSize: typeScale.bodyMd[0], lineHeight: `${typeScale.bodyMd[1]}px`,
            color: disc.textPrimary,
            fontFamily: 'inherit',
            marginBottom: 12,
          }}
        />

        {/* Quoted comment preview */}
        <div style={{
          border: `0.5px solid ${disc.lineStrong}`,
          borderRadius: radius[16],
          padding: `${space[6]}px ${space[8]}px`,
          background: disc.surfaceCard2,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceNested, flexShrink: 0 }}>
              {node.authorAvatar
                ? <img src={node.authorAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ width: '100%', height: '100%', background: `hsl(${((node.authorHandle ?? 'x').charCodeAt(0) * 37) % 360}, 55%, 42%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700 }}>{((node.authorName ?? node.authorHandle ?? '').trim().charAt(0) || '?').toUpperCase()}</div>
              }
            </div>
            <span style={{ fontSize: typeScale.metaLg[0], fontWeight: 700, color: disc.textPrimary }}>
              {node.authorName ?? node.authorHandle}
            </span>
            <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>
              @{node.authorHandle}
            </span>
          </div>
          <p style={{
            fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
            color: disc.textSecondary,
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
          }}>{node.text}</p>
        </div>
      </div>
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
  const translationPolicy = useTranslationStore((state) => state.policy);
  const { ensureThread, upsertThreadResult, setWriterResult, setUserFeedback, getThread } = useThreadStore();
  const verificationCache = React.useRef(new InMemoryVerificationCache());
  const [rootPost, setRootPost] = useState<MockPost | null>(null);
  const [replies, setReplies] = useState<ThreadNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ThreadFilter>('Top');
  const [quoteTarget, setQuoteTarget] = useState<ThreadNode | null>(null);
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

  const thread = getThread(entry.id);

  // ── Fetch thread + polling ────────────────────────────────────────────────
  // Initial load shows the loading spinner; background re-polls at 60s are
  // silent — detectTrigger short-circuits if nothing meaningful changed.
  const pollInFlight = React.useRef(false);
  const providersRef = React.useRef(createVerificationProviders());

  useEffect(() => {
    if (!session) return;
    ensureThread(entry.id);

    const controller = new AbortController();

    async function fetchAndRun(isInitial: boolean): Promise<void> {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      if (isInitial) { setLoading(true); setError(null); }

      try {
        const res = await atpCall(
          () => agent.getPostThread({ uri: entry.id, depth: 6 }),
          { signal: controller.signal },
        );
        const threadData = res?.data?.thread;
        if (!threadData || threadData.$type !== 'app.bsky.feed.defs#threadViewPost') {
          if (isInitial) setError('Thread not found');
          return;
        }
        const rootNode = resolveThread(threadData as any);
        if (!rootNode) return;

        if (isInitial) {
          const mapped = mapFeedViewPost({ post: (threadData as any).post, reply: undefined, reason: undefined });
          setRootPost(mapped);
          setReplies(rootNode.replies ?? []);
        } else {
          // On re-polls only update reply list if count changed
          setReplies(prev => {
            const next = rootNode.replies ?? [];
            return next.length !== prev.length ? next : prev;
          });
        }

        const result = await runVerifiedThreadPipeline({
          input: {
            rootUri: entry.id,
            rootText: rootNode.text,
            rootPost: nodeToThreadPost(rootNode),
            replies: rootNode.replies ?? [],
          },
          previous: getThread(entry.id)?.interpolator ?? null,
          providers: providersRef.current,
          cache: verificationCache.current,
          signal: controller.signal,
        });

        if (result.didMeaningfullyChange) {
          upsertThreadResult(entry.id, {
            interpolator: result.interpolator,
            scores: result.scores,
            verificationByPost: result.verificationByPost,
            rootVerification: result.rootVerification,
            confidence: result.confidence,
            summaryMode: result.summaryMode,
          });

          // ── Writer call (Qwen3-4B) ─────────────────────────────────────
          // Fire-and-forget after storing deterministic results.
          // Failure falls back silently to heuristic summaryText.
          try {
            const translationOutput = await translateWriterInput({
              rootPost: {
                id: rootNode.uri,
                text: rootNode.text,
              },
              selectedComments: (rootNode.replies ?? []).map((reply) => ({
                id: reply.uri,
                text: reply.text,
              })),
              targetLang: translationPolicy.userLanguage,
              mode: translationPolicy.localOnlyMode ? 'local_private' : 'server_default',
            });

            const translationById = {
              [translationOutput.rootPost.id]: {
                ...(translationOutput.rootPost.translatedText
                  ? { translatedText: translationOutput.rootPost.translatedText }
                  : {}),
                sourceLang: translationOutput.rootPost.sourceLang,
              },
              ...Object.fromEntries(
                translationOutput.selectedComments.map((comment) => [
                  comment.id,
                  {
                    ...(comment.translatedText ? { translatedText: comment.translatedText } : {}),
                    sourceLang: comment.sourceLang,
                  },
                ]),
              ),
            };

            const writerInput = buildThreadStateForWriter(
              entry.id,
              rootNode.text,
              result.interpolator,
              result.scores,
              rootNode.replies ?? [],
              result.confidence,
              translationById,
            );
            const writerResult = await callInterpolatorWriter(writerInput, controller.signal);
            if (!writerResult.abstained) {
              setWriterResult(entry.id, writerResult);
            }
          } catch (writerErr) {
            // AbortError is expected on unmount — not a real failure
            if (writerErr instanceof Error && writerErr.name === 'AbortError') return;
            // All other writer failures are non-fatal — heuristic summary remains visible
            console.warn('[StoryMode] writer call failed:', writerErr);
          }
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        if (isInitial) setError(e?.message ?? 'Failed to load thread');
      } finally {
        pollInFlight.current = false;
        if (isInitial) setLoading(false);
      }
    }

    fetchAndRun(true);
    const pollInterval = setInterval(() => fetchAndRun(false), 60_000);

    return () => {
      clearInterval(pollInterval);
      controller.abort();
    };
  }, [entry.id, session, translationPolicy.localOnlyMode, translationPolicy.userLanguage]);

  const handleFeedback = useCallback((replyUri: string, fb: ContributionScores['userFeedback']) => {
    setUserFeedback(entry.id, replyUri, fb);
  }, [entry.id]);

  // ── Filter replies ────────────────────────────────────────────────────────
  const filteredReplies = useMemo(() => {
    const scores = getThread(entry.id)?.scores ?? {};
    let sorted = [...replies];
    if (activeFilter === 'Top') {
      sorted.sort((a, b) => (scores[b.uri]?.finalInfluenceScore ?? 0) - (scores[a.uri]?.finalInfluenceScore ?? 0));
    } else if (activeFilter === 'Latest') {
      sorted.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    } else if (activeFilter === 'Clarifying') {
      sorted = sorted.filter(r => scores[r.uri]?.role === 'clarifying');
    } else if (activeFilter === 'New angles') {
      sorted = sorted.filter(r => ['new_information', 'useful_counterpoint'].includes(scores[r.uri]?.role ?? ''));
    } else if (activeFilter === 'Source-backed') {
      sorted = sorted.filter(r => {
        const s = scores[r.uri];
        return (s?.factual?.factualContributionScore ?? 0) > 0.4 && (s?.factual?.factualConfidence ?? 0) > 0.5;
      });
    }
    return sorted;
  }, [replies, activeFilter, entry.id, thread?.lastComputedAt]);

  const featuredReply = filteredReplies.find(r => {
    const s = getThread(entry.id)?.scores[r.uri];
    return (s?.finalInfluenceScore ?? 0) > 0.75;
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
              <PromptHeroCard
                post={rootPost}
                participantCount={replies.length}
                {...(thread?.rootVerification !== undefined ? { rootVerification: thread.rootVerification } : {})}
              />
            )}

            {/* InterpolatorCard */}
            <InterpolatorCard
              rootUri={entry.id}
              summaryText={thread?.interpolator?.summaryText ?? ''}
              writerSummary={thread?.writerResult?.collapsedSummary}
              summaryMode={thread?.summaryMode ?? undefined}
              writerWhatChanged={thread?.writerResult?.whatChanged}
              writerContributorBlurbs={thread?.writerResult?.contributorBlurbs}
              clarifications={thread?.interpolator?.clarificationsAdded ?? []}
              newAngles={thread?.interpolator?.newAnglesAdded ?? []}
              heatLevel={thread?.interpolator?.heatLevel ?? 0}
              repetitionLevel={thread?.interpolator?.repetitionLevel ?? 0}
              sourceSupportPresent={thread?.interpolator?.sourceSupportPresent ?? false}
              replyCount={replies.length}
              updatedAt={thread?.interpolator?.updatedAt ?? new Date().toISOString()}
              topContributors={thread?.interpolator?.topContributors ?? []}
              entityLandscape={thread?.interpolator?.entityLandscape ?? []}
              factualSignalPresent={thread?.interpolator?.factualSignalPresent ?? false}
            />

            {/* ThreadControls */}
            {replies.length > 0 && (
              <ThreadControls active={activeFilter} onChange={setActiveFilter} />
            )}

            {/* Featured contribution */}
            {featuredReply && activeFilter === 'Top' && (() => {
              const featuredScore = getThread(entry.id)?.scores[featuredReply.uri];
              return (
                <ContributionCard
                  key={`featured-${featuredReply.uri}`}
                  node={featuredReply}
                  {...(featuredScore !== undefined ? { score: featuredScore } : {})}
                  rootUri={entry.id}
                  featured
                  {...(followedDids.has(featuredReply.authorDid ?? '') ? { isFollowed: true } : {})}
                  onFeedback={handleFeedback}
                  onQuoteComment={setQuoteTarget}
                />
              );
            })()}

            {/* Contribution stack */}
            {filteredReplies
              .filter(r => r.uri !== featuredReply?.uri || activeFilter !== 'Top')
              .map(node => {
                const nodeScore = getThread(entry.id)?.scores[node.uri];
                return (
                  <ContributionCard
                    key={node.uri}
                    node={node}
                    {...(nodeScore !== undefined ? { score: nodeScore } : {})}
                    rootUri={entry.id}
                    {...(followedDids.has(node.authorDid ?? '') ? { isFollowed: true } : {})}
                    onFeedback={handleFeedback}
                    onQuoteComment={setQuoteTarget}
                  />
                );
              })
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

      {/* Quote composer overlay */}
      <AnimatePresence>
        {quoteTarget && (
          <QuoteComposer node={quoteTarget} onClose={() => setQuoteTarget(null)} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
