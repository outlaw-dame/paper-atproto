// ─── SearchStoryScreen — Discovery Mode card-deck reader ──────────────────
// Glympse Core Wireframe Spec v1 — Screen 2
//
// Structure:
//   StoryProgressRail (top)
//   QuietTopBar (back + query)
//   Card deck (swipe/tap to advance):
//     0. OverviewCard       — synopsis, media, source strip
//     1. BestSourceCard     — top source post with facets
//     2. RelatedEntitiesCard — mentioned actors + hashtag clusters
//     3. RelatedConversationCard — top reply threads
//   BottomQueryDock (refine query)

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDrag } from '@use-gesture/react';
import { useSessionStore } from '../store/sessionStore';
import { useUiStore } from '../store/uiStore';
import { useExploreAiInsight } from '../conversation/discovery/exploreAiInsight';
import { useAppearanceStore } from '../store/appearanceStore';
import type { MockPost } from '../data/mockData';
import type { StoryEntry } from '../App';
import { useTranslationStore } from '../store/translationStore';
import { translationClient } from '../lib/i18n/client';
import { hasTranslatableLanguageSignal, heuristicDetectLanguage } from '../lib/i18n/detect';
import { hasMeaningfulTranslation, isLikelySameLanguage } from '../lib/i18n/normalize';
import { useProfileNavigation } from '../hooks/useProfileNavigation';
import { usePostFilterResults } from '../lib/contentFilters/usePostFilterResults';
import { warnMatchReasons } from '../lib/contentFilters/presentation';
import type { PostFilterMatch } from '../lib/contentFilters/types';
import ProfileCardTrigger from './ProfileCardTrigger';
import {
  rootUriForStoryPost,
  type StoryProjectedPost,
  type StoryProjection,
} from '../conversation/projections/storyProjection';
import { useConversationBatchHydration } from '../conversation/sessionHydration';
import { useStoryProjection } from '../conversation/sessionSelectors';
import { useStorySearchResults } from '../conversation/discovery/storySearch';
import {
  storyProgress as spTokens,
  overviewCard as ocTokens,
  bottomQueryDock as bqdTokens,
  discovery as disc,
  accent,
  type as typeScale,
  radius,
  space,
  transitions,
  storyCardVariants,
} from '../design/index';
import { postLabelChips, type LabelChip } from '../lib/atproto/labelPresentation';

interface Props {
  query: string;
  onClose: () => void;
  onOpenStory: (e: StoryEntry) => void;
}

const CARD_NAMES = ['Overview', 'Best Source', 'Related', 'Conversation'] as const;
type CardName = typeof CARD_NAMES[number];

const chipStyleByTone: Record<'neutral' | 'warning' | 'danger' | 'info', React.CSSProperties> = {
  neutral: { background: 'var(--fill-3)', color: 'var(--label-2)' },
  warning: { background: 'rgba(255,149,0,0.18)', color: '#ffb454' },
  danger: { background: 'rgba(255,77,79,0.18)', color: '#ff7b7d' },
  info: { background: 'rgba(124,233,255,0.2)', color: '#6de7ff' },
};

function LabelChipRow({ chips }: { chips: LabelChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {chips.map((chip) => (
        <span
          key={chip.key}
          style={{
            fontSize: 10,
            fontWeight: 700,
            borderRadius: 999,
            padding: '2px 8px',
            ...chipStyleByTone[chip.tone],
          }}
        >
          {chip.text}
        </span>
      ))}
    </div>
  );
}

// ─── StoryProgressRail ────────────────────────────────────────────────────
function StoryProgressRail({ total, current }: { total: number; current: number }) {
  return (
    <div style={{
      display: 'flex', gap: spTokens.segmentGap,
      padding: '0 20px',
      height: spTokens.height,
    }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          flex: 1, height: spTokens.height,
          borderRadius: spTokens.radius,
          background: i < current ? spTokens.complete : i === current ? spTokens.active : spTokens.track,
          boxShadow: i === current ? spTokens.currentGlow : 'none',
          transition: 'background 0.3s',
        }} />
      ))}
    </div>
  );
}

// ─── RichText inline renderer ─────────────────────────────────────────────
function RichText({ text, color }: { text: string; color: string }) {
  const navigateToProfile = useProfileNavigation();
  const openExploreSearch = useUiStore((s) => s.openExploreSearch);
  const parts = text.split(/(@[\w.]+|#\w+|https?:\/\/\S+)/g);
  return (
    <span>
      {parts.map((p, i) => {
        if (p.startsWith('@')) return <button key={i} className="interactive-link-button" onClick={(e) => { e.stopPropagation(); void navigateToProfile(p); }} style={{ color: accent.cyan400, font: 'inherit', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{p}</button>;
        if (p.startsWith('#')) {
          return (
            <button
              key={i}
              className="interactive-link-button"
              onClick={(e) => {
                e.stopPropagation();
                const normalized = p.replace(/^#/, '').trim();
                if (!normalized) return;
                openExploreSearch(normalized);
              }}
              style={{ color: accent.cyan400, font: 'inherit', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {p}
            </button>
          );
        }
        if (p.startsWith('http')) {
          try {
            return <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ color: accent.cyan400 }} onClick={e => e.stopPropagation()}>{new URL(p).hostname.replace(/^www\./, '')}</a>;
          } catch { return <span key={i}>{p}</span>; }
        }
        return <span key={i} style={{ color }}>{p}</span>;
      })}
    </span>
  );
}

// ─── AiInsightBlock ───────────────────────────────────────────────────────
function AiInsightBlock({
  insight,
  shortInsight,
  provider,
  loading,
}: {
  insight: string | null;
  shortInsight: string | null;
  provider: string | null;
  loading: boolean;
}) {
  if (!loading && !insight) return null;
  return (
    <div style={{
      marginBottom: 14,
      borderRadius: 14,
      background: 'linear-gradient(135deg, rgba(91,124,255,0.13) 0%, rgba(124,233,255,0.09) 100%)',
      border: '0.5px solid rgba(124,233,255,0.28)',
      padding: '12px 14px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Ambient glow */}
      <div style={{
        position: 'absolute', top: -16, right: -16,
        width: 80, height: 80, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,233,255,0.14) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: loading ? 0 : 8 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill={accent.cyan400} aria-hidden="true">
          <path d="M12 2l1.8 7.2L21 7l-5.4 5.4L21 18l-7.2-1.8L12 24l-1.8-7.2L3 18l5.4-5.6L3 7l7.2 2.2L12 2z"/>
        </svg>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: accent.cyan400 }}>
          AI Insight
        </span>
        {provider && !loading && (
          <span style={{ fontSize: 9, color: disc.textTertiary, fontWeight: 600, marginLeft: 2 }}>
            · {provider}
          </span>
        )}
      </div>
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingTop: 4 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={accent.cyan400} strokeWidth={2} strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
            </path>
          </svg>
          <span style={{ fontSize: 11, color: disc.textTertiary, fontWeight: 600 }}>Synthesising…</span>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, lineHeight: '18px', color: disc.textPrimary, fontWeight: 500, margin: 0 }}>
            {insight}
          </p>
          {shortInsight && (
            <p style={{ marginTop: 6, fontSize: 11, lineHeight: '15px', color: disc.textSecondary, fontWeight: 600, fontStyle: 'italic', margin: '6px 0 0' }}>
              {shortInsight}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ─── OverviewCard ─────────────────────────────────────────────────────────
function OverviewCard({
  overview,
  resultCount,
  showAtprotoLabelChips,
  aiInsight,
  aiShortInsight,
  aiInsightProvider,
  aiInsightLoading,
}: {
  overview: StoryProjectedPost | null;
  resultCount: number;
  showAtprotoLabelChips: boolean;
  aiInsight: string | null;
  aiShortInsight: string | null;
  aiInsightProvider: string | null;
  aiInsightLoading: boolean;
}) {
  const navigateToProfile = useProfileNavigation();
  if (!overview) return null;
  const { post: top, profileCardData: standardProfileCardData, text: topText } = overview;
  const mediaEmbed = top.embed?.type === 'external' || top.embed?.type === 'video' ? top.embed : null;
  const img = overview.imageUrl;
  const domain = overview.domain ?? '';
  const synopsisText = overview.synopsisText ?? topText.slice(0, 140);
  const moderationLabelChips = showAtprotoLabelChips
    ? postLabelChips({
      contentLabels: top.contentLabels,
      labelDetails: top.labelDetails,
      authorDid: top.author.did,
      maxChips: 1,
      includeLabellerProvenance: true,
    })
    : [];

  return (
    <div style={{
      borderRadius: ocTokens.radius,
      background: ocTokens.bg,
      boxShadow: ocTokens.shadow,
      overflow: 'hidden',
      border: `0.5px solid ${disc.lineSubtle}`,
    }}>
      {/* Media */}
      {img && (
        <div style={{ height: ocTokens.mediaHeight, overflow: 'hidden', position: 'relative' }}>
          <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 40%, rgba(18,24,36,0.8) 100%)' }} />
        </div>
      )}

      <div style={{ padding: `${ocTokens.padding}px` }}>
        {/* AI Insight block — shown when AI insight is active */}
        <AiInsightBlock
          insight={aiInsight}
          shortInsight={aiShortInsight}
          provider={aiInsightProvider}
          loading={aiInsightLoading}
        />

        {/* Synopsis chip */}
        <div style={{ marginBottom: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: radius.full,
            background: ocTokens.synopsisChip.bg,
            border: `0.5px solid ${ocTokens.synopsisChip.border}`,
            color: ocTokens.synopsisChip.text,
            fontSize: typeScale.metaLg[0], fontWeight: 600,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#7CE9FF', flexShrink: 0 }} />
            Glympse Synopsis
          </span>
        </div>

        {/* Title */}
        <p style={{
          fontSize: typeScale.titleLg[0], lineHeight: `${typeScale.titleLg[1]}px`,
          fontWeight: typeScale.titleLg[2], letterSpacing: typeScale.titleLg[3],
          color: disc.textPrimary, marginBottom: 10,
        }}>
          <RichText text={synopsisText} color={disc.textPrimary} />
        </p>

        {(overview.isSessionBacked || overview.sourceSupportPresent || overview.direction) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {overview.isSessionBacked && (
              <span style={{
                padding: '4px 10px',
                borderRadius: radius.full,
                background: 'rgba(124,233,255,0.12)',
                color: accent.cyan400,
                fontSize: typeScale.metaSm[0],
                fontWeight: 700,
              }}>
                Thread-aware
              </span>
            )}
            {overview.sourceSupportPresent && (
              <span style={{
                padding: '4px 10px',
                borderRadius: radius.full,
                background: 'rgba(91,124,255,0.14)',
                color: accent.primary,
                fontSize: typeScale.metaSm[0],
                fontWeight: 700,
              }}>
                Source-backed
              </span>
            )}
            {overview.direction && (
              <span style={{
                padding: '4px 10px',
                borderRadius: radius.full,
                background: disc.surfaceFocus,
                color: disc.textSecondary,
                fontSize: typeScale.metaSm[0],
                fontWeight: 700,
                textTransform: 'capitalize',
              }}>
                {overview.direction}
              </span>
            )}
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
          {[
            { icon: '💬', val: top.replyCount, label: 'replies' },
            { icon: '🔁', val: top.repostCount, label: 'reposts' },
            { icon: '❤️', val: top.likeCount, label: 'likes' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 13 }}>{s.icon}</span>
              <span style={{ fontSize: typeScale.metaLg[0], fontWeight: 600, color: disc.textSecondary }}>{s.val}</span>
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>{resultCount} results</span>
        </div>

        {/* Source strip */}
        {(domain || top.author.handle) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: `${space[4]}px ${space[6]}px`,
            background: ocTokens.sourceStrip.bg,
            borderRadius: radius[12],
          }}>
            <div style={{ width: 20, height: 20, borderRadius: 6, background: disc.surfaceFocus, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {top.author.avatar
                ? <img src={top.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />
                : <span style={{ fontSize: 10, color: disc.textTertiary }}>@</span>
              }
            </div>
            {domain ? (
              <span style={{ fontSize: typeScale.metaSm[0], fontWeight: 500, color: ocTokens.sourceStrip.text }}>
                {domain}
              </span>
            ) : (
              <ProfileCardTrigger data={standardProfileCardData} did={top.author.did} disabled={!standardProfileCardData}>
                <button className="interactive-link-button" onClick={(e) => { e.stopPropagation(); void navigateToProfile(top.author.did || top.author.handle); }} style={{ fontSize: typeScale.metaSm[0], fontWeight: 500, color: ocTokens.sourceStrip.text, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                  @{top.author.handle}
                </button>
              </ProfileCardTrigger>
            )}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>
              {top.timestamp}
            </span>
          </div>
        )}
        {moderationLabelChips.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <LabelChipRow chips={moderationLabelChips} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── BestSourceCard ───────────────────────────────────────────────────────
function BestSourceCard({
  source,
  showAtprotoLabelChips,
}: {
  source: StoryProjectedPost | null;
  showAtprotoLabelChips: boolean;
}) {
  const navigateToProfile = useProfileNavigation();
  if (!source) return null;
  const { post: top, profileCardData: standardProfileCardData, text: topText } = source;
  const sessionSummary = source.synopsisText && source.synopsisText !== topText
    ? source.synopsisText
    : undefined;
  const moderationLabelChips = showAtprotoLabelChips
    ? postLabelChips({
      contentLabels: top.contentLabels,
      labelDetails: top.labelDetails,
      authorDid: top.author.did,
      maxChips: 2,
      includeLabellerProvenance: true,
    })
    : [];
  return (
    <div style={{
      borderRadius: ocTokens.radius,
      background: disc.surfaceCard2,
      boxShadow: ocTokens.shadow,
      padding: `${space[12]}px`,
      border: `0.5px solid ${disc.lineSubtle}`,
    }}>
      <p style={{
        fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: disc.textTertiary, marginBottom: 16,
      }}>Best Source</p>

      {/* Author */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <ProfileCardTrigger data={standardProfileCardData} did={top.author.did} disabled={!standardProfileCardData}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceFocus, flexShrink: 0 }}>
            {top.author.avatar
              ? <img src={top.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: accent.indigo600, color: '#fff', fontSize: 16, fontWeight: 700 }}>{top.author.displayName[0]}</div>
            }
          </div>
        </ProfileCardTrigger>
        <ProfileCardTrigger data={standardProfileCardData} did={top.author.did} disabled={!standardProfileCardData}>
          <div>
            <button className="interactive-link-button" onClick={(e) => { e.stopPropagation(); void navigateToProfile(top.author.did || top.author.handle); }} style={{ fontSize: typeScale.chip[0], fontWeight: 700, color: disc.textPrimary, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>{top.author.displayName}</button>
            <button className="interactive-link-button" onClick={(e) => { e.stopPropagation(); void navigateToProfile(top.author.did || top.author.handle); }} style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>@{top.author.handle}</button>
          </div>
        </ProfileCardTrigger>
      </div>

      {/* Full text */}
      <p style={{
        fontSize: typeScale.bodyMd[0], lineHeight: `${typeScale.bodyMd[1]}px`,
        fontWeight: typeScale.bodyMd[2],
        color: disc.textSecondary, marginBottom: 16,
      }}>
        <RichText text={topText} color={disc.textSecondary} />
      </p>
      {moderationLabelChips.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <LabelChipRow chips={moderationLabelChips} />
        </div>
      )}

      {sessionSummary && (
        <div style={{
          marginBottom: 16,
          padding: `${space[6]}px ${space[8]}px`,
          borderRadius: radius[12],
          background: disc.surfaceFocus,
          border: `0.5px solid ${disc.lineSubtle}`,
        }}>
          <p style={{
            fontSize: typeScale.metaSm[0],
            fontWeight: 700,
            color: disc.textTertiary,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            marginBottom: 4,
          }}>
            Thread context
          </p>
          <p style={{ fontSize: typeScale.bodySm[0], color: disc.textSecondary }}>
            <RichText text={sessionSummary} color={disc.textSecondary} />
          </p>
        </div>
      )}

      {/* Embed if present */}
      {top.embed && (top.embed.type === 'external' || top.embed.type === 'video') && (
        <a
          href={top.embed.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{
            display: 'block',
            background: disc.surfaceFocus,
            borderRadius: radius[16],
            padding: `${space[6]}px ${space[8]}px`,
            textDecoration: 'none',
            border: `0.5px solid ${disc.lineSubtle}`,
          }}
        >
          {top.embed.thumb && (
            <img src={top.embed.thumb} alt="" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: radius[12], marginBottom: 8 }} />
          )}
          {top.embed.title && <p style={{ fontSize: typeScale.chip[0], fontWeight: 600, color: disc.textPrimary, marginBottom: 4 }}>{top.embed.title}</p>}
          <p style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>
            {(() => { try { return new URL(top.embed.url).hostname.replace(/^www\./, ''); } catch { return top.embed.url; } })()}
          </p>
        </a>
      )}
    </div>
  );
}

// ─── RelatedEntitiesCard ──────────────────────────────────────────────────
function RelatedEntitiesCard({ entities }: { entities: StoryProjection['relatedEntities'] }) {
  const navigateToProfile = useProfileNavigation();
  const topicEntities = entities.topics;
  const actorEntities = entities.actors;

  return (
    <div style={{
      borderRadius: ocTokens.radius,
      background: disc.surfaceCard2,
      padding: `${space[12]}px`,
      border: `0.5px solid ${disc.lineSubtle}`,
    }}>
      <p style={{
        fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: disc.textTertiary, marginBottom: 16,
      }}>Related Entities</p>

      {topicEntities.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: typeScale.metaSm[0], fontWeight: 600, color: disc.textTertiary, marginBottom: 8, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Topics</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {topicEntities.map(topic => (
              <span key={topic.canonicalId} style={{
                padding: '5px 12px', borderRadius: radius.full,
                background: 'rgba(91,124,255,0.14)',
                color: accent.primary,
                fontSize: typeScale.chip[0], fontWeight: 600,
              }}>
                #{topic.label.replace(/\s+/g, '')}
                {topic.mentionCount > 1 && <span style={{ marginLeft: 6, opacity: 0.75 }}>x{topic.mentionCount}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {actorEntities.length > 0 && (
        <div>
          <p style={{ fontSize: typeScale.metaSm[0], fontWeight: 600, color: disc.textTertiary, marginBottom: 8, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Mentioned</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {actorEntities.map(entity => (
              <button key={entity.canonicalId} className="interactive-link-button" onClick={(e) => { e.stopPropagation(); void navigateToProfile(entity.label); }} style={{
                padding: '5px 12px', borderRadius: radius.full,
                background: 'rgba(124,233,255,0.12)',
                color: accent.cyan400,
                fontSize: typeScale.chip[0], fontWeight: 600,
                border: 'none', cursor: 'pointer',
              }}>
                @{entity.label.replace(/^@/, '')}
                {entity.aliasCount > 1 && <span style={{ marginLeft: 6, opacity: 0.75 }}>~{entity.aliasCount}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {topicEntities.length === 0 && actorEntities.length === 0 && (
        <p style={{ fontSize: typeScale.bodySm[0], color: disc.textTertiary }}>No entities detected in this result set.</p>
      )}
    </div>
  );
}

// ─── RelatedConversationCard ──────────────────────────────────────────────
function RelatedConversationCard({
  conversations,
  onOpenStory,
  showAtprotoLabelChips,
}: {
  conversations: StoryProjectedPost[];
  onOpenStory: (e: StoryEntry) => void;
  showAtprotoLabelChips: boolean;
}) {
  const navigateToProfile = useProfileNavigation();
  return (
    <div style={{
      borderRadius: ocTokens.radius,
      background: disc.surfaceCard2,
      padding: `${space[12]}px`,
      border: `0.5px solid ${disc.lineSubtle}`,
    }}>
      <p style={{
        fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: disc.textTertiary, marginBottom: 16,
      }}>Related Conversations</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {conversations.map(({
          post,
          profileCardData: standardProfileCardData,
          text,
          synopsisText,
          direction,
          sourceSupportPresent,
          isSessionBacked,
        }) => {
          const moderationLabelChips = showAtprotoLabelChips
            ? postLabelChips({
              contentLabels: post.contentLabels,
              labelDetails: post.labelDetails,
              authorDid: post.author.did,
              maxChips: 1,
              includeLabellerProvenance: true,
            })
            : [];
          return (
            <motion.div
              key={post.id}
              whileTap={{ scale: 0.985 }}
              onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.content.slice(0, 80) })}
              style={{
                background: disc.surfaceCard,
                borderRadius: radius[20],
                padding: `${space[8]}px ${space[8]}px`,
                border: `0.5px solid ${disc.lineSubtle}`,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <ProfileCardTrigger data={standardProfileCardData} did={post.author.did} disabled={!standardProfileCardData}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceFocus, flexShrink: 0 }}>
                    {post.author.avatar
                      ? <img src={post.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ width: '100%', height: '100%', background: accent.indigo600, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>{post.author.displayName[0]}</div>
                    }
                  </div>
                </ProfileCardTrigger>
                <ProfileCardTrigger data={standardProfileCardData} did={post.author.did} disabled={!standardProfileCardData}>
                  <button className="interactive-link-button" onClick={(e) => { e.stopPropagation(); void navigateToProfile(post.author.did || post.author.handle); }} style={{ fontSize: typeScale.metaLg[0], fontWeight: 600, color: disc.textPrimary, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>{post.author.displayName}</button>
                </ProfileCardTrigger>
                <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>{post.timestamp}</span>
              </div>
              <p style={{
                fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
                color: disc.textSecondary,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                <RichText text={text} color={disc.textSecondary} />
              </p>
              {moderationLabelChips.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <LabelChipRow chips={moderationLabelChips} />
                </div>
              )}
              {synopsisText && synopsisText !== text && (
                <p style={{
                  marginTop: 8,
                  fontSize: typeScale.metaSm[0],
                  color: disc.textTertiary,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  <RichText text={synopsisText} color={disc.textTertiary} />
                </p>
              )}
              {(isSessionBacked || sourceSupportPresent || direction) && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {isSessionBacked && (
                    <span style={{
                      fontSize: typeScale.metaSm[0],
                      color: accent.cyan400,
                      fontWeight: 700,
                    }}>
                      Thread-aware
                    </span>
                  )}
                  {sourceSupportPresent && (
                    <span style={{
                      fontSize: typeScale.metaSm[0],
                      color: accent.primary,
                      fontWeight: 700,
                    }}>
                      Source-backed
                    </span>
                  )}
                  {direction && (
                    <span style={{
                      fontSize: typeScale.metaSm[0],
                      color: disc.textTertiary,
                      fontWeight: 700,
                      textTransform: 'capitalize',
                    }}>
                      {direction}
                    </span>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>💬 {post.replyCount}</span>
                <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>❤️ {post.likeCount}</span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BottomQueryDock ──────────────────────────────────────────────────────
function BottomQueryDock({ query, onRefine }: { query: string; onRefine: (q: string) => void }) {
  const [val, setVal] = useState(query);
  return (
    <div style={{
      position: 'absolute', bottom: 'calc(var(--safe-bottom) + 16px)',
      left: 20, right: 20,
      height: bqdTokens.height,
      borderRadius: bqdTokens.radius,
      background: bqdTokens.bg,
      border: `0.5px solid ${bqdTokens.border}`,
      backdropFilter: `blur(${bqdTokens.blur})`,
      WebkitBackdropFilter: `blur(${bqdTokens.blur})`,
      boxShadow: bqdTokens.shadow,
      display: 'flex', alignItems: 'center',
      padding: `0 ${bqdTokens.paddingX}px`,
      gap: 10,
      zIndex: 10,
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={2} strokeLinecap="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onRefine(val); }}
        placeholder="Refine your search…"
        style={{
          flex: 1,
          fontSize: typeScale.bodySm[0], fontWeight: typeScale.bodySm[2],
          color: bqdTokens.text,
          background: 'none', border: 'none', outline: 'none',
        }}
      />
      <button
        onClick={() => onRefine(val)}
        style={{
          width: 32, height: 32, borderRadius: '50%',
          background: bqdTokens.actionBg, color: bqdTokens.actionFg,
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
        </svg>
      </button>
    </div>
  );
}

function ModerationNoticeCard({
  onReveal,
  matches,
  isHidden,
}: {
  onReveal: () => void;
  matches?: PostFilterMatch[];
  isHidden?: boolean;
}) {
  const reasons = warnMatchReasons(matches ?? []);
  return (
    <div style={{
      borderRadius: ocTokens.radius,
      background: 'color-mix(in srgb, var(--surface-card) 90%, var(--orange) 10%)',
      border: `0.5px solid ${disc.lineSubtle}`,
      padding: `${space[12]}px`,
    }}>
      {isHidden ? (
        <>
          <div style={{ fontSize: typeScale.chip[0], color: disc.textSecondary, fontWeight: 700, marginBottom: 4 }}>
            Hidden by your moderation settings.
          </div>
          <div style={{ fontSize: 11, color: disc.textSecondary, marginBottom: 10 }}>
            This post includes muted words or topics and is hidden in this view.
          </div>
        </>
      ) : reasons.length > 0 ? (
        <>
          <div style={{ fontSize: typeScale.bodySm[0], color: disc.textPrimary, fontWeight: 700, marginBottom: 4 }}>
            Content warning
          </div>
          <div style={{ fontSize: 11, color: disc.textSecondary, marginBottom: 8 }}>
            This post may include words or topics you asked to warn about.
          </div>
          <div style={{ fontSize: typeScale.chip[0], color: disc.textSecondary, fontWeight: 700, marginBottom: 6 }}>
            Matches filter:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {reasons.map((entry) => (
              <span key={`${entry.phrase}:${entry.reason}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, border: `0.5px solid ${disc.lineSubtle}`, padding: '3px 8px', background: disc.surfaceCard }}>
                <span style={{ fontSize: 11, color: disc.textPrimary, fontWeight: 700 }}>{entry.phrase}</span>
                <span style={{ fontSize: 10, color: disc.textSecondary, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  {entry.reason === 'exact+semantic' ? 'exact + semantic' : entry.reason}
                </span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: typeScale.chip[0], color: disc.textSecondary, fontWeight: 700, marginBottom: 4 }}>
            Hidden by your moderation settings.
          </div>
          <div style={{ fontSize: 11, color: disc.textSecondary, marginBottom: 10 }}>
            This post includes muted words or topics and is hidden in this view.
          </div>
        </>
      )}
      <button
        onClick={onReveal}
        style={{
          border: 'none',
          background: 'transparent',
          color: accent.primary,
          fontSize: typeScale.chip[0],
          fontWeight: 700,
          padding: 0,
          cursor: 'pointer',
        }}
      >
        Show post
      </button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function SearchStoryScreen({ query, onClose, onOpenStory }: Props) {
  const { agent, session } = useSessionStore();
  const showAtprotoLabelChips = useAppearanceStore((state) => state.showAtprotoLabelChips);
  const exploreAiInsightEnabled = useUiStore((state) => state.exploreAiInsightEnabled);
  const { policy: translationPolicy, byId: translationById, upsertTranslation } = useTranslationStore();
  const [cardIdx, setCardIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const [refinedQuery, setRefinedQuery] = useState(query);
  const [searchSort, setSearchSort] = useState<'top' | 'latest'>('top');
  const [revealedFilteredPosts, setRevealedFilteredPosts] = useState<Record<string, boolean>>({});
  const {
    posts,
    loading,
    loadingMorePosts,
    hasMorePosts,
    loadMorePosts,
  } = useStorySearchResults({
    query: refinedQuery,
    searchSort,
    agent,
    enabled: Boolean(session && agent),
  });
  const filterResults = usePostFilterResults(posts, 'explore');

  const getModerationMatches = useCallback((postId: string) => filterResults[postId] ?? [], [filterResults]);
  const isSuppressedByModeration = useCallback((postId: string) => {
    if (revealedFilteredPosts[postId]) return false;
    const matches = getModerationMatches(postId);
    return matches.some((m) => m.action === 'hide' || m.action === 'warn');
  }, [getModerationMatches, revealedFilteredPosts]);

  const visiblePosts = useMemo(
    () => posts.filter((post) => !isSuppressedByModeration(post.id)),
    [posts, isSuppressedByModeration],
  );
  const firstSuppressedPost = useMemo(
    () => {
      const post = posts.find((candidate) => isSuppressedByModeration(candidate.id));
      if (!post) return null;
      const matches = getModerationMatches(post.id);
      const isHidden = matches.some((match) => match.action === 'hide');
      return { post, matches, isHidden };
    },
    [posts, isSuppressedByModeration],
  );

  useEffect(() => {
    setRevealedFilteredPosts({});
  }, [refinedQuery]);

  const getTranslatedText = useCallback((post: MockPost): string => {
    return translationById[post.id]?.translatedText ?? post.content;
  }, [translationById]);

  const visibleStoryRootCandidates = useMemo(
    () => visiblePosts
      .slice(0, 6)
      .map((post) => rootUriForStoryPost(post)),
    [visiblePosts],
  );

  useConversationBatchHydration({
    enabled: Boolean(session && agent && visiblePosts.length > 0),
    rootUris: visibleStoryRootCandidates,
    mode: 'story',
    agent,
    translationPolicy,
    maxTargets: 6,
  });

  const storyProjection = useStoryProjection({
    query: refinedQuery,
    posts: visiblePosts,
    getTranslatedText,
  });

  useEffect(() => {
    if (!translationPolicy.autoTranslateExplore) return;
    if (posts.length === 0) return;

    const visible = posts.slice(0, 6).filter((post) => {
      if (post.content.trim().length === 0 || translationById[post.id]) return false;
      if (!hasTranslatableLanguageSignal(post.content)) return false;
      const detected = heuristicDetectLanguage(post.content);
      if (detected.language !== 'und' && isLikelySameLanguage(detected.language, translationPolicy.userLanguage)) return false;
      return true;
    });
    if (visible.length === 0) return;

    Promise.allSettled(
      visible.map((post) =>
        {
          const detected = heuristicDetectLanguage(post.content);
          return translationClient.translateInline({
            id: post.id,
            sourceText: post.content,
            targetLang: translationPolicy.userLanguage,
            mode: translationPolicy.localOnlyMode ? 'local_private' : 'server_default',
            ...(detected.language !== 'und' ? { sourceLang: detected.language } : {}),
          }).then((result) => {
            if (!hasMeaningfulTranslation(post.content, result.translatedText)) return;
            upsertTranslation(result);
          });
        }
      ),
    ).catch(() => {
      // Keep original text when translation is unavailable.
    });
  }, [posts, translationById, translationPolicy.autoTranslateExplore, translationPolicy.localOnlyMode, translationPolicy.userLanguage, upsertTranslation]);

  // Build a minimal page shape for the AI insight hook from story posts.
  const storyInsightPage = useMemo(() => ({
    posts: visiblePosts,
    actors: [],
    feedItems: [],
    intent: {
      kind: 'general' as const,
      label: 'General discovery',
      confidence: 0.6,
      reasons: ['story_screen'],
      queryHasVisualIntent: false,
    },
    postCursor: null,
    tagPostCursor: null,
    actorCursor: null,
    semanticActorDids: new Set<string>(),
    keywordActorDids: new Set<string>(),
    hasMorePosts: false,
    hasMoreActors: false,
  }), [visiblePosts]);

  const {
    insight: aiInsight,
    shortInsight: aiShortInsight,
    provider: aiInsightProvider,
    loading: aiInsightLoading,
  } = useExploreAiInsight({
    page: storyInsightPage,
    query: refinedQuery,
    actorDid: session?.did ?? null,
    enabled: exploreAiInsightEnabled && visiblePosts.length >= 2,
  });

  const advance = useCallback(() => {
    if (cardIdx < CARD_NAMES.length - 1) { setDir(1); setCardIdx(i => i + 1); }
  }, [cardIdx]);

  const retreat = useCallback(() => {
    if (cardIdx > 0) { setDir(-1); setCardIdx(i => i - 1); }
  }, [cardIdx]);

  // Swipe gesture
  const bind = useDrag(({ swipe: [swipeX] }) => {
    if (swipeX === -1) advance();
    if (swipeX === 1) retreat();
  }, { axis: 'x', swipe: { velocity: 0.3 } });

  const cards = [
    <OverviewCard
      key="overview"
      overview={storyProjection.overview}
      resultCount={storyProjection.resultCount}
      showAtprotoLabelChips={showAtprotoLabelChips}
      aiInsight={aiInsight}
      aiShortInsight={aiShortInsight}
      aiInsightProvider={aiInsightProvider}
      aiInsightLoading={aiInsightLoading}
    />,
    <BestSourceCard key="source" source={storyProjection.bestSource} showAtprotoLabelChips={showAtprotoLabelChips} />,
    <RelatedEntitiesCard key="entities" entities={storyProjection.relatedEntities} />,
    <RelatedConversationCard
      key="conversation"
      conversations={storyProjection.relatedConversations}
      onOpenStory={onOpenStory}
      showAtprotoLabelChips={showAtprotoLabelChips}
    />,
  ];

  const activeCard = cards[cardIdx];
  const allSuppressed = posts.length > 0 && visiblePosts.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0,
        background: disc.bgBase,
        display: 'flex', flexDirection: 'column',
        zIndex: 200,
      }}
    >
      {/* Atmosphere */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: disc.bgAtmosphere }} />

      {/* Top bar */}
      <div style={{
        position: 'relative', zIndex: 2,
        flexShrink: 0,
        paddingTop: 'calc(var(--safe-top) + 12px)',
        padding: 'calc(var(--safe-top) + 12px) 20px 12px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={onClose} style={{
          width: 36, height: 36, borderRadius: '50%',
          background: disc.surfaceCard, border: `0.5px solid ${disc.lineSubtle}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={disc.textSecondary} strokeWidth={2.5} strokeLinecap="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <p style={{
          flex: 1,
          fontSize: typeScale.titleSm[0], fontWeight: typeScale.titleSm[2],
          letterSpacing: typeScale.titleSm[3],
          color: disc.textPrimary,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>"{refinedQuery}"</p>
        <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>
          {cardIdx + 1} / {CARD_NAMES.length}
        </span>
      </div>

      {/* Progress rail */}
      <div style={{ position: 'relative', zIndex: 2, flexShrink: 0, paddingBottom: 12 }}>
        <StoryProgressRail total={CARD_NAMES.length} current={cardIdx} />
      </div>

      <div style={{ position: 'relative', zIndex: 2, padding: '0 20px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setSearchSort('top')}
          style={{
            border: 'none',
            borderRadius: 999,
            padding: '6px 12px',
            cursor: 'pointer',
            background: searchSort === 'top' ? accent.primary : disc.surfaceCard,
            color: searchSort === 'top' ? '#fff' : disc.textSecondary,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Top
        </button>
        <button
          type="button"
          onClick={() => setSearchSort('latest')}
          style={{
            border: 'none',
            borderRadius: 999,
            padding: '6px 12px',
            cursor: 'pointer',
            background: searchSort === 'latest' ? accent.primary : disc.surfaceCard,
            color: searchSort === 'latest' ? '#fff' : disc.textSecondary,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Latest
        </button>
        {hasMorePosts && (
          <button
            type="button"
            onClick={loadMorePosts}
            disabled={loadingMorePosts}
            style={{
              border: 'none',
              borderRadius: 999,
              padding: '6px 12px',
              cursor: loadingMorePosts ? 'default' : 'pointer',
              background: loadingMorePosts ? disc.surfaceFocus : 'rgba(124,233,255,0.18)',
              color: disc.textPrimary,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {loadingMorePosts ? 'Loading…' : 'Load More'}
          </button>
        )}
      </div>

      {/* Card area */}
      <div
        {...bind()}
        style={{ flex: 1, position: 'relative', zIndex: 1, overflow: 'hidden', touchAction: 'pan-y' }}
        onClick={advance}
      >
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={2} strokeLinecap="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
              </path>
            </svg>
          </div>
        ) : (
          <div className="scroll-y" style={{ height: '100%', paddingBottom: 88 }}>
            <div style={{ padding: '0 20px' }}>
              <AnimatePresence mode="wait" custom={dir}>
                <motion.div
                  key={cardIdx}
                  custom={dir}
                  variants={storyCardVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={transitions.storyCard}
                >
                  {allSuppressed && firstSuppressedPost
                    ? (
                      <ModerationNoticeCard
                        matches={firstSuppressedPost.matches}
                        isHidden={firstSuppressedPost.isHidden}
                        onReveal={() => setRevealedFilteredPosts((prev) => ({ ...prev, [firstSuppressedPost.post.id]: true }))}
                      />
                    )
                    : activeCard}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* Bottom query dock */}
      <BottomQueryDock query={refinedQuery} onRefine={q => { setRefinedQuery(q); setCardIdx(0); }} />
    </motion.div>
  );
}
