// ─── Explore Landing — Discovery Mode ────────────────────────────────────
// Glympse Core Wireframe Spec v1 — Screen 1
// Dark, cinematic, Gist-derived discovery foyer.
//
// Structure (top to bottom):
//   TopBar → HeroTitleBlock → SearchHeroField → QuickFilterRow
//   → FeaturedSearchStoryCard → TrendingTopicsRow → LiveClustersSection
//   → FeedsAndPacksRow → SourcesAndDomainsRow

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSessionStore } from '../store/sessionStore';
import { atpCall } from '../lib/atproto/client';
import type { MockPost } from '../data/mockData';
import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';
import type { StoryEntry } from '../App';
import { useUiStore } from '../store/uiStore';
import { useTranslationStore } from '../store/translationStore';
import { useActivityStore } from '../store/activityStore';
import { translationClient } from '../lib/i18n/client';
import { hasTranslatableLanguageSignal, heuristicDetectLanguage } from '../lib/i18n/detect';
import { hasMeaningfulTranslation, isLikelySameLanguage } from '../lib/i18n/normalize';
import { usePostFilterResults } from '../lib/contentFilters/usePostFilterResults';
import { warnMatchReasons } from '../lib/contentFilters/presentation';
import { usePlatform, getButtonTokens, getIconBtnTokens } from '../hooks/usePlatform';
import { useProfileNavigation } from '../hooks/useProfileNavigation';
import { useAppearanceStore } from '../store/appearanceStore';
import { actorLabelChips } from '../lib/atproto/labelPresentation';
import { useExploreSearchResults } from '../conversation/discovery/exploreSearch';
import { useExploreAiInsight } from '../conversation/discovery/exploreAiInsight';
import { useTimelineConversationHintsProjection } from '../conversation/sessionSelectors';
import { scorePostEngagement, useExploreDiscoverContent } from '../conversation/discovery/exploreDiscovery';
import { projectExploreDiscoverView } from '../conversation/discovery/exploreProjection';
import { useExploreActorRecommendations } from '../conversation/discovery/exploreRecommendations';
import {
  QUICK_FILTERS,
  type QuickFilter,
  type DiscoverSectionKey,
  getExploreStoryTitle,
  normalizeExternalExploreSearchQuery,
  normalizeHashtagFeedNavigationQuery,
  normalizePeopleFeedNavigationQuery,
  normalizeSearchStoryNavigationQuery,
  resolveVisibleDiscoverSections,
  shouldShowDiscoverSection,
} from '../conversation/discovery/exploreSurface';
import { subscribeToExternalFeed } from '../lib/feedSubscriptions';
import { normalizeExternalFeedUrl } from '../lib/feedUrls';
import { readViewScrollPosition, writeViewScrollPosition } from '../lib/viewResume';
import {
  searchHeroField as shfTokens,
  quickFilterChip as qfcTokens,
  featuredStoryCard as fscTokens,
  trendingTopicCard as ttcTokens,
  liveClusterCard as lccTokens,
  overviewCard,
  discovery as disc,
  accent,
  type as typeScale,
  radius,
  space,
  shadowDark,
  transitions,
  fadeVariants,
  slideUpVariants,
} from '../design/index';
import LiveSportsMoments from '../components/LiveSportsMoments';
import { sportsStore } from '../sports/sportsStore';
import { sportsFeedService } from '../services/sportsFeed';
import { WriterEntitySheet, EntityChip } from '../components/EntitySheet';
import type { WriterEntity } from '../intelligence/llmContracts';

interface Props {
  onOpenStory: (e: StoryEntry) => void;
}

// ─── Discovery phrases ────────────────────────────────────────────────────
const DISCOVERY_PHRASES = [
  "What's happening",
  "Explore the conversation",
  "Find what matters",
];

function canAutoInlineTranslateExplore(post: MockPost): boolean {
  if (!hasTranslatableLanguageSignal(post.content)) return false;
  const textLength = post.content.trim().length;
  if (textLength === 0 || textLength > 280) return false;
  return true;
}

function getAuthorInitial(displayName?: string, handle?: string): string {
  return ((displayName ?? handle ?? '').trim().charAt(0) || '?').toUpperCase();
}

function buildStoryExplanationChips(params: {
  post: MockPost;
  rank: number;
  featured: boolean;
  searching: boolean;
  intentLabel?: string;
}): string[] {
  const chips: string[] = [];
  const { post, rank, featured, searching, intentLabel } = params;

  if (featured) chips.push('Top story selection');
  if (post.embed?.type === 'external' || post.article) chips.push('Has source link');
  if (post.article?.body) chips.push('Long-form context');
  if (post.replyCount >= 5) chips.push('Active discussion');
  if (post.repostCount >= 3) chips.push('Shared widely');
  if (rank === 0 && scorePostEngagement(post) > 0) chips.push('High engagement signal');
  if (searching && intentLabel) chips.push(intentLabel);

  return Array.from(new Set(chips)).slice(0, 2);
}

function truncateCardText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  const sliced = normalized.slice(0, maxChars + 1);
  const boundary = Math.max(sliced.lastIndexOf(' '), sliced.lastIndexOf('.'));
  const safe = boundary > maxChars * 0.55 ? sliced.slice(0, boundary) : sliced.slice(0, maxChars);
  return `${safe.trim()}...`;
}

function resolvePostSurfaceKind(post: MockPost): string {
  if (post.article) return 'Feature story';
  switch (post.embed?.type) {
    case 'external':
      return 'Linked article';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    case 'quote':
      return 'Quoted post';
    default:
      return post.replyCount >= 6 ? 'Active thread' : 'Post';
  }
}

function resolvePostPrimaryAction(post: MockPost): string {
  if (post.article || post.embed?.type === 'external') return 'Read article';
  if (post.embed?.type === 'video') return 'Watch media';
  if (post.embed?.type === 'audio') return 'Listen now';
  if (post.embed?.type === 'quote') return 'Open quote';
  return post.replyCount >= 4 ? 'Open thread' : 'Open post';
}

function resolvePostDiveHint(post: MockPost): string {
  if (post.article || post.embed?.type === 'external') return 'Open the source and follow the thread around it.';
  if (post.embed?.type === 'video') return 'Watch the media, then open the surrounding thread.';
  if (post.embed?.type === 'audio') return 'Listen first, then inspect the conversation around it.';
  if (post.replyCount >= 6) return 'See who is shaping the conversation and why it is moving.';
  return 'Dive into the post and inspect the related entities.';
}

function resolvePostHeadline(post: MockPost, bodyText: string): string {
  const candidate = post.article?.title
    ?? (post.embed?.type === 'external' ? post.embed.title : undefined)
    ?? (post.embed?.type === 'video' ? post.embed.title : undefined)
    ?? (post.embed?.type === 'audio' ? post.embed.title : undefined)
    ?? bodyText;
  return truncateCardText(candidate || bodyText, 110);
}

function resolvePostSynopsis(post: MockPost, bodyText: string, headline: string, preferredSynopsis?: string): string {
  const normalizedPreferred = preferredSynopsis?.replace(/\s+/g, ' ').trim();
  if (normalizedPreferred) {
    return truncateCardText(normalizedPreferred, 170);
  }
  const candidate = post.embed?.type === 'external'
    ? (post.embed.description || post.article?.body || post.content)
    : post.embed?.type === 'video'
      ? (post.embed.description || post.content)
      : post.embed?.type === 'audio'
        ? (post.embed.description || post.content)
        : post.article?.body || post.content;
  const normalizedCandidate = candidate.replace(/\s+/g, ' ').trim();
  const normalizedHeadline = headline.replace(/\s+/g, ' ').trim();
  const synopsisSource = normalizedCandidate === normalizedHeadline ? bodyText : normalizedCandidate;
  return truncateCardText(synopsisSource, 170);
}

function buildWhySurfaceLines(params: {
  post: MockPost;
  explanationChips?: string[];
  intentLabel?: string;
  maxLines?: number;
  sessionHint?: {
    compactSummary?: string | undefined;
    sourceSupportPresent: boolean;
    factualSignalPresent: boolean;
    continuityLabel?: string | undefined;
  } | null;
}): string[] {
  const lines: string[] = [];
  const { post, explanationChips, intentLabel, sessionHint, maxLines = 3 } = params;

  const sourceDomain = post.embed?.type === 'external' || post.embed?.type === 'video' || post.embed?.type === 'audio'
    ? post.embed.domain
    : null;

  const pushLine = (line: string) => {
    if (lines.length >= maxLines) return;
    const normalized = truncateCardText(line, 90).trim();
    if (!normalized) return;
    lines.push(normalized);
  };

  if (sessionHint?.sourceSupportPresent) {
    pushLine('The surrounding thread includes source-backed context.');
  }
  if (sessionHint?.factualSignalPresent) {
    pushLine('Replies add factual or corrective signal beyond the root post.');
  }
  if (sessionHint?.continuityLabel) {
    pushLine(sessionHint.continuityLabel);
  }
  if (sessionHint?.compactSummary) {
    pushLine(`Conversation snapshot: ${sessionHint.compactSummary}`);
  }
  if (post.article || post.embed?.type === 'external') {
    pushLine(sourceDomain
      ? `Includes a linked source from ${sourceDomain}.`
      : 'Includes a linked source you can open directly.');
  }
  if (post.embed?.type === 'video') {
    pushLine(sourceDomain
      ? `Video context is available from ${sourceDomain}.`
      : 'This includes video context that is better watched directly.');
  }
  if (post.embed?.type === 'audio') {
    pushLine(sourceDomain
      ? `Audio context is available from ${sourceDomain}.`
      : 'This includes audio context that is better heard directly.');
  }
  if (post.embed?.type === 'quote') {
    pushLine('This includes quoted context from a related post.');
  }
  if (post.replyCount >= 12) {
    pushLine('The thread is highly active and worth opening for full context.');
  } else if (post.replyCount >= 5) {
    pushLine('The thread is active enough to reward opening the conversation.');
  }
  if (post.repostCount >= 8) {
    pushLine('This post is being reshared widely across the graph.');
  }
  if (intentLabel) {
    pushLine(`Matches your ${intentLabel.toLowerCase()} search.`);
  }
  if (lines.length < maxLines && explanationChips && explanationChips.length > 0) {
    pushLine(`Selection signals: ${explanationChips.slice(0, 2).join(' + ')}.`);
  }
  if (lines.length < maxLines) {
    for (const chip of explanationChips ?? []) {
      if (lines.length >= maxLines) break;
      pushLine(chip);
    }
  }

  return Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean))).slice(0, maxLines);
}

function ActionChipButton({ label, onTap }: { label: string; onTap: () => void }) {
  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onTap();
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 12px',
        borderRadius: radius.full,
        border: 'none',
        background: accent.primary,
        color: '#fff',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.01em',
        cursor: 'pointer',
        boxShadow: '0 10px 24px rgba(91,124,255,0.24)',
      }}
    >
      {label}
      <span aria-hidden="true">↗</span>
    </button>
  );
}

function WhySurfaceReveal({ lines, compact = false }: { lines: string[]; compact?: boolean }) {
  const [open, setOpen] = useState(false);

  if (lines.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: compact ? 4 : 6 }}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        style={{
          border: 'none',
          background: 'transparent',
          color: disc.textSecondary,
          fontSize: compact ? 10 : 11,
          fontWeight: 700,
          padding: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {open ? 'Hide why' : 'Why this?'}
        <motion.span
          aria-hidden="true"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          style={{ display: 'inline-flex' }}
        >
          ▾
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            onClick={(event) => event.stopPropagation()}
            initial={{ opacity: 0, y: -2, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -2, height: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            style={{
              width: '100%',
              overflow: 'hidden',
              padding: compact ? '6px 8px' : '8px 10px',
              borderRadius: compact ? 10 : 12,
              background: compact ? 'rgba(124,233,255,0.06)' : 'rgba(124,233,255,0.08)',
              border: '0.5px solid rgba(124,233,255,0.18)',
              display: 'grid',
              gap: compact ? 4 : 5,
            }}
          >
            {lines.map((line) => (
              <p
                key={line}
                style={{
                  margin: 0,
                  fontSize: compact ? 10 : 11,
                  lineHeight: compact ? '14px' : '15px',
                  color: disc.textSecondary,
                  fontWeight: 600,
                }}
              >
                {line}
              </p>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────

function DiscoverySpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={2} strokeLinecap="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
        </path>
      </svg>
    </div>
  );
}

function SynopsisChip({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: radius.full,
      background: overviewCard.synopsisChip.bg,
      border: `0.5px solid ${overviewCard.synopsisChip.border}`,
      color: overviewCard.synopsisChip.text,
      fontSize: typeScale.metaLg[0], lineHeight: `${typeScale.metaLg[1]}px`,
      fontWeight: typeScale.metaLg[2], letterSpacing: typeScale.metaLg[3],
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#7CE9FF', flexShrink: 0 }} />
      {label}
    </span>
  );
}

// ─── RichPostText — inline #hashtag linkification ────────────────────────
function RichPostText({ text, onHashtag, onMention, style }: {
  text: string;
  onHashtag?: ((tag: string) => void) | undefined;
  onMention?: ((handle: string) => void) | undefined;
  style?: React.CSSProperties;
}) {
  const parts = text.split(/(@[\w.]+|#\w+)/g);
  return (
    <span style={style}>
      {parts.map((part, i) =>
        part.startsWith('@') ? (
          <button
            key={i}
              className="interactive-link-button"
              onClick={e => { e.stopPropagation(); onMention?.(part.slice(1)); }}
              style={{ color: accent.cyan400, font: 'inherit', fontWeight: 700, background: 'none', border: 'none', cursor: onMention ? 'pointer' : 'default', padding: 0 }}
          >{part}</button>
        ) : part.startsWith('#') ? (
          <button
            key={i}
              className="interactive-link-button"
              onClick={e => { e.stopPropagation(); onHashtag?.(part.slice(1)); }}
              style={{ color: accent.cyan400, font: 'inherit', fontWeight: 700, background: 'none', border: 'none', cursor: onHashtag ? 'pointer' : 'default', padding: 0 }}
          >{part}</button>
        ) : part
      )}
    </span>
  );
}

// ─── Entity extraction from post content ─────────────────────────────────
// Derives lightweight WriterEntity objects from hashtags and @mentions.
// Used until the full AI pipeline provides entities for Explore cards.

function extractPostEntities(content: string): WriterEntity[] {
  const seen = new Set<string>();
  const entities: WriterEntity[] = [];

  // Hashtags → topic entities
  for (const match of content.matchAll(/#(\w+)/g)) {
    const label = match[1];
    if (!label || label.length < 2 || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    entities.push({ id: `tag-${label.toLowerCase()}`, label: `#${label}`, type: 'topic', confidence: 0.70, impact: 0.40 });
    if (entities.length >= 4) break;
  }

  // @mentions → person entities (only if space for more)
  if (entities.length < 4) {
    for (const match of content.matchAll(/@([\w.]+)/g)) {
      const handle = match[1];
      if (!handle || handle.length < 2 || seen.has(handle.toLowerCase())) continue;
      seen.add(handle.toLowerCase());
      entities.push({ id: `person-${handle.toLowerCase()}`, label: `@${handle}`, type: 'person', confidence: 0.65, impact: 0.35 });
      if (entities.length >= 4) break;
    }
  }

  return entities;
}

// ─── FeaturedSearchStoryCard — Gist-inspired flush link story card ────────
function FeaturedSearchStoryCard({
  post,
  onTap,
  onHashtag,
  onEntityTap,
  translation,
  showOriginal,
  translating,
  translationError,
  autoTranslated,
  translatedDisplayName,
  onToggleTranslate,
  onClearTranslation,
  explanationChips,
  sessionSynopsis,
  whySurfaceLines,
}: {
  post: MockPost;
  onTap: () => void;
  onHashtag?: ((tag: string) => void) | undefined;
  onEntityTap?: ((entity: WriterEntity) => void) | undefined;
  translation?: { translatedText: string; sourceLang: string } | undefined;
  showOriginal: boolean;
  translating: boolean;
  translationError: boolean;
  autoTranslated: boolean;
  translatedDisplayName?: string | undefined;
  onToggleTranslate: (event: React.MouseEvent) => void;
  onClearTranslation: (event: React.MouseEvent) => void;
  explanationChips?: string[];
  sessionSynopsis?: string | undefined;
  whySurfaceLines?: string[];
}) {
  const navigateToProfile = useProfileNavigation();
  const targetLanguage = useTranslationStore((state) => state.policy.userLanguage);
  const embed = post.embed?.type === 'external' ? post.embed : null;
  const img = post.article?.banner ?? post.media?.[0]?.url ?? embed?.thumb;
  const domain = embed?.domain ?? (post.article ? 'Long-form' : '');
  const detectedLanguage = heuristicDetectLanguage(post.content);
  const hasRenderableTranslation = !!translation && hasMeaningfulTranslation(post.content, translation.translatedText);
  const hasTranslatableSignal = hasTranslatableLanguageSignal(post.content);
  const shouldOfferTranslation = hasRenderableTranslation
    || (hasTranslatableSignal
      && (detectedLanguage.language === 'und'
        || !isLikelySameLanguage(detectedLanguage.language, targetLanguage)));
  const bodyText = post.article?.body
    ? post.article.body
    : (hasRenderableTranslation && !showOriginal ? translation.translatedText : post.content);
  const surfaceKind = resolvePostSurfaceKind(post);
  const primaryAction = resolvePostPrimaryAction(post);
  const diveHint = resolvePostDiveHint(post);
  const headline = resolvePostHeadline(post, bodyText);
  const synopsis = resolvePostSynopsis(post, bodyText, headline, sessionSynopsis);
  const hashtags: string[] = Array.from(new Set((bodyText.match(/#\w+/g) ?? []) as string[])).slice(0, 5);
  // Entity chips: prefer AI-extracted, fall back to content-derived
  const entityChips = extractPostEntities(bodyText).filter(e => e.type !== 'topic' || !hashtags.includes(e.label));

  return (
    <motion.div
      whileTap={{ scale: 0.985 }}
      onClick={onTap}
      style={{
        borderRadius: fscTokens.radius,
        overflow: 'hidden',
        background: fscTokens.bg,
        boxShadow: fscTokens.shadow,
        cursor: 'pointer',
        border: `0.5px solid ${disc.lineSubtle}`,
      }}
    >
      {/* ── Hero zone: image + gradient scrim that bleeds into card bg ── */}
      <div style={{ position: 'relative', height: 210, background: disc.surfaceFocus, overflow: 'hidden' }}>
        {img ? (
          <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: `radial-gradient(ellipse at 20% 60%, rgba(91,124,255,0.35) 0%, transparent 55%),
                         radial-gradient(ellipse at 78% 20%, rgba(124,233,255,0.15) 0%, transparent 50%),
                         ${disc.surfaceCard}`,
          }} />
        )}
        {/* Gradient scrim: fades to exact card bg so there is NO hard edge */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.05) 45%, ${fscTokens.bg} 100%)`,
        }} />
        {/* Domain pill overlaid in lower-left of hero */}
        {domain && (
          <div style={{
            position: 'absolute', bottom: 14, left: 14,
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'rgba(7,11,18,0.76)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: '0.5px solid rgba(255,255,255,0.09)',
            borderRadius: radius.full,
            padding: '4px 10px 4px 7px',
          }}>
            <div style={{ width: 14, height: 14, borderRadius: 4, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2.5} strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
              </svg>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.75)', letterSpacing: '0.01em' }}>{domain}</span>
          </div>
        )}
      </div>

      {/* ── Content zone — seamlessly attached below hero ── */}
      <div style={{ padding: `14px ${space[10]}px ${space[10]}px` }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <SynopsisChip label={surfaceKind} />
          <span style={{ fontSize: 11, color: disc.textTertiary, fontWeight: 600 }}>
            {post.replyCount > 0 ? `${post.replyCount} replies` : `${post.likeCount.toLocaleString()} likes`}
          </span>
        </div>

        {/* Hashtag chips */}
        {hashtags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {hashtags.map(tag => (
              <button
                key={tag}
                onClick={e => { e.stopPropagation(); onHashtag?.(tag.slice(1)); }}
                style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '3px 9px', borderRadius: radius.full,
                  background: 'rgba(91,124,255,0.13)',
                  border: '0.5px solid rgba(91,124,255,0.3)',
                  color: accent.primary,
                  fontSize: 12, fontWeight: 600, letterSpacing: '0.01em',
                  cursor: 'pointer',
                }}
              >{tag}</button>
            ))}
          </div>
        )}

        {explanationChips && explanationChips.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {explanationChips.map((chip) => (
              <span
                key={`${post.id}:${chip}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '3px 9px',
                  borderRadius: radius.full,
                  background: 'rgba(124,233,255,0.12)',
                  border: '0.5px solid rgba(124,233,255,0.28)',
                  color: accent.cyan400,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.01em',
                }}
              >
                {chip}
              </span>
            ))}
          </div>
        )}

        {/* Entity chips — tappable, open EntitySheet */}
        {onEntityTap && entityChips.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {entityChips.map(e => (
              <EntityChip key={e.id} entity={e} onTap={onEntityTap} size="sm" />
            ))}
          </div>
        )}

        {/* Headline */}
        <p style={{
          fontSize: typeScale.titleSm[0], lineHeight: `${typeScale.titleSm[1]}px`,
          fontWeight: 700, letterSpacing: typeScale.titleSm[3],
          color: disc.textPrimary, marginBottom: 8,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          <RichPostText text={headline} {...(onHashtag ? { onHashtag } : {})} onMention={(handle) => { void navigateToProfile(handle); }} />
        </p>

        {/* Synopsis */}
        {synopsis && synopsis !== headline && (
          <p style={{
            fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
            color: disc.textSecondary, marginBottom: 10,
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{synopsis}</p>
        )}

        {post.content.trim().length > 0 && shouldOfferTranslation && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: translation && !showOriginal ? 10 : 6 }}>
            <button
              onClick={onToggleTranslate}
              disabled={translating}
              style={{
                border: 'none',
                background: 'transparent',
                color: accent.primary,
                fontSize: 12,
                fontWeight: 700,
                padding: 0,
                cursor: translating ? 'default' : 'pointer',
                opacity: translating ? 0.65 : 1,
              }}
            >
              {hasRenderableTranslation
                ? (showOriginal ? 'Show translation' : 'Show original')
                : (translating
                  ? 'Translating...'
                  : 'Translate')}
            </button>
            {translationError && !hasRenderableTranslation && (
              <span style={{ fontSize: 11, color: '#ff6b6b', fontWeight: 600 }}>No translation available</span>
            )}
          </div>
        )}

        {hasRenderableTranslation && !showOriginal && (
          <div style={{
            marginBottom: 8,
            border: `0.5px solid ${disc.lineSubtle}`,
            borderRadius: 10,
            background: 'rgba(91,124,255,0.08)',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '7px 9px',
              borderBottom: `0.5px solid ${disc.lineSubtle}`,
            }}>
              <span style={{ fontSize: 11, color: disc.textSecondary, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {autoTranslated
                  ? `Auto-translated from ${translation.sourceLang}`
                  : `Translated from ${translation.sourceLang}`}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <button
                  onClick={onToggleTranslate}
                  style={{ border: 'none', background: 'transparent', color: accent.primary, fontSize: 11, fontWeight: 700, padding: 0, cursor: 'pointer' }}
                >
                  Show original
                </button>
                <button
                  onClick={onClearTranslation}
                  style={{ border: 'none', background: 'transparent', color: disc.textTertiary, fontSize: 11, fontWeight: 600, padding: 0, cursor: 'pointer' }}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Article author / publisher row */}
        {(embed?.authorName || embed?.publisher) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '2px 8px', borderRadius: radius.full,
              background: 'rgba(124,233,255,0.10)',
              border: `0.5px solid rgba(124,233,255,0.22)`,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: accent.cyan400,
              textTransform: 'uppercase',
            }}>Featured</span>
            {embed?.authorName && (
              <span style={{ fontSize: 12, color: disc.textSecondary, fontWeight: 500 }}>
                By <span style={{ color: disc.textPrimary, fontWeight: 600 }}>{embed.authorName}</span>
              </span>
            )}
            {embed?.publisher && (
              <span style={{ fontSize: 12, color: disc.textTertiary }}>
                · {embed.publisher}
              </span>
            )}
          </div>
        )}

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          paddingTop: 2,
          marginBottom: 12,
        }}>
          <ActionChipButton label={primaryAction} onTap={onTap} />
          <div style={{ flex: 1, minWidth: 160, display: 'grid', gap: 6 }}>
            <span style={{
              fontSize: 11,
              lineHeight: '15px',
              color: disc.textTertiary,
              fontWeight: 600,
            }}>
              {diveHint}
            </span>
            <WhySurfaceReveal lines={whySurfaceLines ?? []} />
          </div>
        </div>

        {/* Footer: author avatar + name + engagement */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, borderTop: `0.5px solid ${disc.lineSubtle}`, marginTop: 12 }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceFocus, flexShrink: 0 }}>
            {post.author.avatar
              ? <img src={post.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ width: '100%', height: '100%', background: accent.indigo600, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700 }}>{getAuthorInitial(post.author.displayName, post.author.handle)}</div>
            }
          </div>
          <button onClick={(e) => { e.stopPropagation(); void navigateToProfile(post.author.did || post.author.handle); }} style={{ fontSize: 12, fontWeight: 500, color: disc.textSecondary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
            {translatedDisplayName || post.author.displayName}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: disc.textTertiary }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
              {post.likeCount.toLocaleString()}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: disc.textTertiary }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              {post.replyCount.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── LinkedPostMiniCard — horizontal strip of popular link posts ──────────
function LinkedPostMiniCard({
  post,
  onTap,
  onHashtag,
  translation,
  showOriginal,
  translating,
  translationError,
  autoTranslated,
  onToggleTranslate,
  onClearTranslation,
  explanationChips,
  sessionSynopsis,
  whySurfaceLines,
}: {
  post: MockPost;
  onTap: () => void;
  onHashtag?: ((tag: string) => void) | undefined;
  translation?: { translatedText: string; sourceLang: string } | undefined;
  showOriginal: boolean;
  translating: boolean;
  translationError: boolean;
  autoTranslated: boolean;
  onToggleTranslate: (event: React.MouseEvent) => void;
  onClearTranslation: (event: React.MouseEvent) => void;
  explanationChips?: string[];
  sessionSynopsis?: string | undefined;
  whySurfaceLines?: string[];
}) {
  const navigateToProfile = useProfileNavigation();
  const targetLanguage = useTranslationStore((state) => state.policy.userLanguage);
  const embed = post.embed?.type === 'external' ? post.embed : null;
  const img = post.article?.banner ?? post.media?.[0]?.url ?? embed?.thumb;
  const domain = embed?.domain ?? (post.article ? 'Long-form' : '');
  const detectedLanguage = heuristicDetectLanguage(post.content);
  const hasRenderableTranslation = !!translation && hasMeaningfulTranslation(post.content, translation.translatedText);
  const hasTranslatableSignal = hasTranslatableLanguageSignal(post.content);
  const shouldOfferTranslation = hasRenderableTranslation
    || (hasTranslatableSignal
      && (detectedLanguage.language === 'und'
        || !isLikelySameLanguage(detectedLanguage.language, targetLanguage)));

  const bodyText = post.article?.body
    ? post.article.body
    : (hasRenderableTranslation && !showOriginal ? translation.translatedText : post.content);
  const surfaceKind = resolvePostSurfaceKind(post);
  const primaryAction = resolvePostPrimaryAction(post);
  const headline = resolvePostHeadline(post, bodyText);
  const synopsis = resolvePostSynopsis(post, bodyText, headline, sessionSynopsis);

  return (
    <motion.div
      whileTap={{ scale: 0.96 }}
      onClick={onTap}
      style={{
        flexShrink: 0, width: 182,
        borderRadius: radius[20],
        overflow: 'hidden',
        background: disc.surfaceCard2,
        border: `0.5px solid ${disc.lineSubtle}`,
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Thumbnail with gradient scrim */}
      <div style={{ height: 96, background: disc.surfaceFocus, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
        {img ? (
          <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: `radial-gradient(circle at 50% 60%, rgba(91,124,255,0.22), ${disc.surfaceCard2})` }} />
        )}
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(to bottom, rgba(0,0,0,0) 30%, ${disc.surfaceCard2} 100%)`,
        }} />
      </div>
      {/* Text content */}
      <div style={{ padding: '8px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '3px 8px',
            borderRadius: radius.full,
            background: 'rgba(91,124,255,0.12)',
            color: accent.primary,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
          }}>
            {surfaceKind}
          </span>
          <span style={{ fontSize: 10, color: disc.textTertiary, fontWeight: 600 }}>
            {post.replyCount > 0 ? `${post.replyCount} replies` : `${post.likeCount.toLocaleString()} likes`}
          </span>
        </div>
        <p style={{
          fontSize: 13, fontWeight: 700, lineHeight: '18px', color: disc.textPrimary,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          <RichPostText text={headline} {...(onHashtag ? { onHashtag } : {})} onMention={(handle) => { void navigateToProfile(handle); }} />
        </p>
        {synopsis && synopsis !== headline && (
          <p style={{
            fontSize: 11,
            lineHeight: '16px',
            color: disc.textSecondary,
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {synopsis}
          </p>
        )}
        {post.content.trim().length > 0 && shouldOfferTranslation && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={onToggleTranslate}
              disabled={translating}
              style={{
                border: 'none',
                background: 'transparent',
                color: accent.primary,
                fontSize: 11,
                fontWeight: 700,
                padding: 0,
                cursor: translating ? 'default' : 'pointer',
                opacity: translating ? 0.65 : 1,
              }}
            >
              {hasRenderableTranslation
                ? (showOriginal ? 'Show translation' : 'Show original')
                : (translating
                  ? 'Translating...'
                  : 'Translate')}
            </button>
            {translationError && !hasRenderableTranslation && (
              <span style={{ fontSize: 10, color: '#ff6b6b', fontWeight: 600 }}>No translation available</span>
            )}
          </div>
        )}
        {hasRenderableTranslation && !showOriginal && (
          <div style={{
            border: `0.5px solid ${disc.lineSubtle}`,
            borderRadius: 10,
            background: 'rgba(91,124,255,0.08)',
            padding: '7px 9px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}>
            <span style={{ fontSize: 11, color: disc.textSecondary, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {autoTranslated ? `Auto-translated from ${translation.sourceLang}` : `Translated from ${translation.sourceLang}`}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <button
                onClick={onToggleTranslate}
                style={{ border: 'none', background: 'transparent', color: accent.primary, fontSize: 11, fontWeight: 700, padding: 0, cursor: 'pointer' }}
              >
                Show original
              </button>
              <button
                onClick={onClearTranslation}
                style={{ border: 'none', background: 'transparent', color: disc.textTertiary, fontSize: 11, fontWeight: 600, padding: 0, cursor: 'pointer' }}
              >
                Clear
              </button>
            </div>
          </div>
        )}
        {domain && (
          <span style={{
            fontSize: 11, color: disc.textTertiary, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{domain}</span>
        )}
        {(embed?.authorName || embed?.publisher) && (
          <span style={{
            fontSize: 11, color: disc.textSecondary, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {embed?.authorName ? `By ${embed.authorName}` : embed?.publisher}
            {embed?.authorName && embed?.publisher ? ` · ${embed.publisher}` : ''}
          </span>
        )}
        {explanationChips && explanationChips.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {explanationChips.map((chip) => (
              <span
                key={`${post.id}:${chip}`}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: '2px 7px',
                  background: 'rgba(124,233,255,0.14)',
                  color: accent.cyan400,
                  border: `0.5px solid ${disc.lineSubtle}`,
                }}
              >
                {chip}
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 6 }}>
          <ActionChipButton label={primaryAction} onTap={onTap} />
        </div>
        <WhySurfaceReveal lines={whySurfaceLines ?? []} compact />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <button onClick={(e) => { e.stopPropagation(); void navigateToProfile(post.author.did || post.author.handle); }} style={{ border: 'none', background: 'none', padding: 0, fontSize: 11, color: disc.textSecondary, fontWeight: 600, cursor: 'pointer', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            @{post.author.handle}
          </button>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: disc.textTertiary }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
            {post.likeCount.toLocaleString()}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── TrendingTopicCard ────────────────────────────────────────────────────
function TrendingTopicCard({ topic, signal, onTap }: { topic: string; signal: string; onTap: () => void }) {
  return (
    <motion.div
      whileTap={{ scale: 0.96 }}
      onClick={onTap}
      style={{
        flexShrink: 0,
        width: ttcTokens.width, height: ttcTokens.height,
        borderRadius: ttcTokens.radius,
        background: ttcTokens.bg,
        padding: `${ttcTokens.padding}px`,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        cursor: 'pointer',
        border: `0.5px solid ${disc.lineSubtle}`,
      }}
    >
      <p style={{
        fontSize: typeScale.chip[0], lineHeight: `${typeScale.chip[1]}px`,
        fontWeight: typeScale.chip[2],
        color: disc.textPrimary,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{topic}</p>
      <span style={{
        fontSize: typeScale.metaSm[0], lineHeight: `${typeScale.metaSm[1]}px`,
        fontWeight: typeScale.metaSm[2], letterSpacing: typeScale.metaSm[3],
        color: accent.cyan400,
      }}>{signal}</span>
    </motion.div>
  );
}

// ─── LiveClusterCard ──────────────────────────────────────────────────────
function LiveClusterCard({ title, summary, count, onTap }: { title: string; summary: string; count: number; onTap: () => void }) {
  return (
    <motion.div
      whileTap={{ scale: 0.985 }}
      onClick={onTap}
      style={{
        borderRadius: lccTokens.radius,
        background: lccTokens.bg,
        padding: `${lccTokens.padding}px`,
        boxShadow: lccTokens.shadow,
        border: `0.5px solid ${disc.lineSubtle}`,
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}
    >
      <p style={{
        fontSize: typeScale.titleSm[0], lineHeight: `${typeScale.titleSm[1]}px`,
        fontWeight: typeScale.titleSm[2], letterSpacing: typeScale.titleSm[3],
        color: disc.textPrimary,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{title}</p>
      <p style={{
        fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
        fontWeight: typeScale.bodySm[2],
        color: disc.textSecondary,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{summary}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary, fontWeight: 500 }}>
          {count} active threads
        </span>
      </div>
    </motion.div>
  );
}

// ─── FeedCard ─────────────────────────────────────────────────────────────
function FeedCard({ gen, onFollow }: { gen: AppBskyFeedDefs.GeneratorView; onFollow: (uri: string) => void }) {
  const [following, setFollowing] = useState(gen.viewer?.like !== undefined);
  const navigateToProfile = useProfileNavigation();
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      style={{
        flexShrink: 0, width: 180,
        background: disc.surfaceCard2, borderRadius: radius[24],
        padding: `${space[8]}px ${space[8]}px ${space[6]}px`,
        display: 'flex', flexDirection: 'column', gap: 8,
        border: `0.5px solid ${disc.lineSubtle}`,
        cursor: 'pointer',
      }}
    >
      <div style={{ width: 40, height: 40, borderRadius: 12, overflow: 'hidden', background: disc.surfaceFocus, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {gen.avatar
          ? <img src={gen.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 20 }}>⚡</span>
        }
      </div>
      <div>
        <p style={{ fontSize: typeScale.chip[0], fontWeight: 700, color: disc.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
          {gen.displayName}
        </p>
        <button className="interactive-link-button" onClick={(e) => { e.stopPropagation(); void navigateToProfile(gen.creator.did || gen.creator.handle); }} style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
          by @{gen.creator.handle.replace('.bsky.social', '')}
        </button>
      </div>
      <button
        onClick={e => { e.stopPropagation(); setFollowing(v => !v); onFollow(gen.uri); }}
        style={{
          padding: '5px 0', borderRadius: radius[8], marginTop: 'auto',
          background: following ? disc.surfaceFocus : accent.primary,
          color: following ? disc.textSecondary : '#fff',
          fontSize: typeScale.metaLg[0], fontWeight: 600,
          border: 'none', cursor: 'pointer',
        }}
      >
        {following ? 'Following' : 'Follow'}
      </button>
    </motion.div>
  );
}

// ─── DomainCapsule ────────────────────────────────────────────────────────
function DomainCapsule({ domain, description, reason, evidenceCount }: { domain: string; description: string; reason?: string; evidenceCount?: number }) {
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      style={{
        flexShrink: 0, width: 160, height: 72,
        background: disc.surfaceCard2, borderRadius: radius[20],
        padding: `${space[6]}px ${space[8]}px`,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        border: `0.5px solid ${disc.lineSubtle}`,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 18, height: 18, borderRadius: 5, background: disc.surfaceFocus, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={2} strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
          </svg>
        </div>
        <span style={{ fontSize: typeScale.chip[0], fontWeight: 600, color: disc.textPrimary }}>{domain}</span>
      </div>
      <p style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{description}</p>
      {(reason || evidenceCount) && (
        <p style={{ margin: 0, fontSize: 10, color: accent.cyan400, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {reason ?? `Referenced by ${evidenceCount} stories`}
        </p>
      )}
    </motion.div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────
function SectionHeader({ title }: { title: string }) {
  return (
    <p style={{
      fontSize: typeScale.metaLg[0], lineHeight: `${typeScale.metaLg[1]}px`,
      fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const,
      color: disc.textTertiary,
      marginBottom: space[4],
    }}>{title}</p>
  );
}

// ─── ActorRow (search results) ────────────────────────────────────────────
function ActorRow({
  actor,
  onFollow,
  showMatchChips = false,
  semanticMatch = false,
  keywordMatch = false,
  recommendationReasons = [],
  recommendationConfidence,
  onDismiss,
}: {
  actor: AppBskyActorDefs.ProfileView;
  onFollow: (did: string) => void;
  showMatchChips?: boolean;
  semanticMatch?: boolean;
  keywordMatch?: boolean;
  recommendationReasons?: string[];
  recommendationConfidence?: number;
  onDismiss?: ((did: string) => void) | undefined;
}) {
  const [following, setFollowing] = useState(actor.viewer?.following !== undefined);
  const navigateToProfile = useProfileNavigation();
  const showProvenanceChips = useAppearanceStore((state) => state.showProvenanceChips);
  const showAtprotoLabelChips = useAppearanceStore((state) => state.showAtprotoLabelChips);
  const followedBy = Boolean(actor.viewer?.followedBy);
  const isMutual = following && followedBy;
  const isMuted = Boolean(actor.viewer?.muted);
  const isBlocking = Boolean(actor.viewer?.blocking);
  const isBlockedBy = Boolean(actor.viewer?.blockedBy);
  const labels = showAtprotoLabelChips
    ? actorLabelChips({ labels: (actor as any).labels, actorDid: actor.did, maxChips: 3 })
    : [];

  const chipStyleByTone: Record<'neutral' | 'warning' | 'danger' | 'info', React.CSSProperties> = {
    neutral: { background: disc.surfaceFocus, color: disc.textSecondary },
    warning: { background: 'rgba(255,149,0,0.18)', color: '#ffb454' },
    danger: { background: 'rgba(255,77,79,0.18)', color: '#ff7b7d' },
    info: { background: 'rgba(124,233,255,0.2)', color: accent.cyan400 },
  };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: `${space[6]}px 0`,
      borderBottom: `0.5px solid ${disc.lineSubtle}`,
    }}>
      <div style={{ width: 42, height: 42, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceFocus, flexShrink: 0 }}>
        {actor.avatar
          ? <img src={actor.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: accent.indigo600, color: '#fff', fontSize: 16, fontWeight: 700 }}>
              {(actor.displayName ?? actor.handle)[0]}
            </div>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <button className="interactive-link-button" onClick={() => { void navigateToProfile(actor.did || actor.handle); }} style={{ fontSize: typeScale.chip[0], fontWeight: 700, color: disc.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', maxWidth: '100%' }}>
          {actor.displayName ?? actor.handle}
        </button>
        <button className="interactive-link-button" onClick={() => { void navigateToProfile(actor.did || actor.handle); }} style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>@{actor.handle}</button>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {isMutual && (
            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: 'rgba(91,124,255,0.15)', color: accent.primary }}>
              Mutual
            </span>
          )}
          {!isMutual && following && (
            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: disc.surfaceFocus, color: disc.textSecondary }}>
              Following
            </span>
          )}
          {!isMutual && followedBy && (
            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: 'rgba(124,233,255,0.16)', color: accent.cyan400 }}>
              Follows you
            </span>
          )}
          {isMuted && (
            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: 'rgba(255,149,0,0.18)', color: '#ffb454' }}>
              Muted
            </span>
          )}
          {isBlocking && (
            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: 'rgba(255,77,79,0.18)', color: '#ff7b7d' }}>
              Blocked
            </span>
          )}
          {isBlockedBy && (
            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: 'rgba(255,77,79,0.12)', color: '#ff9d9e' }}>
              Blocks you
            </span>
          )}
          {showMatchChips && showProvenanceChips && semanticMatch && keywordMatch && (
            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: 'rgba(124,233,255,0.2)', color: accent.cyan400 }}>
              Semantic + keyword
            </span>
          )}
          {showMatchChips && showProvenanceChips && semanticMatch && !keywordMatch && (
            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: 'rgba(124,233,255,0.2)', color: accent.cyan400 }}>
              Semantic match
            </span>
          )}
          {showMatchChips && showProvenanceChips && !semanticMatch && keywordMatch && (
            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: disc.surfaceFocus, color: disc.textSecondary }}>
              Keyword match
            </span>
          )}
          {!showMatchChips && recommendationReasons.map((reason) => (
            <span
              key={`${actor.did}:${reason}`}
              style={{
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 999,
                padding: '2px 8px',
                background: reason === 'Sensitive content'
                  ? 'rgba(255,149,0,0.18)'
                  : 'rgba(124,233,255,0.2)',
                color: reason === 'Sensitive content' ? '#ffb454' : accent.cyan400,
              }}
            >
              {reason}
            </span>
          ))}
          {!showMatchChips && typeof recommendationConfidence === 'number' && Number.isFinite(recommendationConfidence) && (
            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: disc.surfaceFocus, color: disc.textSecondary }}>
              Match {Math.round(Math.max(0, Math.min(1, recommendationConfidence)) * 100)}%
            </span>
          )}
          {labels.map((label) => (
            <span
              key={label.key}
              style={{
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 999,
                padding: '2px 8px',
                ...chipStyleByTone[label.tone],
              }}
            >
              {label.text}
            </span>
          ))}
        </div>
      </div>
      <button
        onClick={() => { setFollowing(v => !v); onFollow(actor.did); }}
        style={{
          padding: '6px 14px', borderRadius: radius.full, flexShrink: 0,
          background: following ? disc.surfaceFocus : accent.primary,
          color: following ? disc.textSecondary : '#fff',
          fontSize: typeScale.metaLg[0], fontWeight: 600,
          border: 'none', cursor: 'pointer',
        }}
      >
        {following ? 'Following' : 'Follow'}
      </button>
      {onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(actor.did)}
          aria-label="Hide suggestion"
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: `0.5px solid ${disc.lineSubtle}`,
            background: disc.surfaceCard,
            color: disc.textSecondary,
            fontSize: 16,
            lineHeight: '28px',
            textAlign: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function ExploreTab({ onOpenStory }: Props) {
  const { agent, session, sessionReady } = useSessionStore();
  const exploreSearchQuery = useUiStore((state) => state.exploreSearchQuery);
  const clearExploreSearch = useUiStore((state) => state.clearExploreSearch);
  const exploreAiInsightEnabled = useUiStore((state) => state.exploreAiInsightEnabled);
  const toggleExploreAiInsight = useUiStore((state) => state.toggleExploreAiInsight);
  const navigateToProfile = useProfileNavigation();
  const platform = usePlatform();
  const buttonTokens = getButtonTokens(platform);
  const iconBtnTokens = getIconBtnTokens(platform);
  const touchLike = platform.isMobile || platform.prefersCoarsePointer || platform.hasAnyCoarsePointer;
  const { policy: translationPolicy, byId: translationById, upsertTranslation } = useTranslationStore();
  const clearTranslation = useTranslationStore((state) => state.clearTranslation);
  const addAppNotification = useActivityStore((state) => state.addAppNotification);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<QuickFilter | null>(null);
  const [searchSort, setSearchSort] = useState<'top' | 'latest'>('top');
  const [addingPodcastFeedByUrl, setAddingPodcastFeedByUrl] = useState<Record<string, boolean>>({});
  const [podcastFeedAddStatus, setPodcastFeedAddStatus] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [featuredIdx, setFeaturedIdx] = useState(0);
  const [showOriginalById, setShowOriginalById] = useState<Record<string, boolean>>({});
  const [translatingById, setTranslatingById] = useState<Record<string, boolean>>({});
  const [translationErrorById, setTranslationErrorById] = useState<Record<string, boolean>>({});
  const [revealedFilteredPosts, setRevealedFilteredPosts] = useState<Record<string, boolean>>({});
  const autoTranslatedIdsRef = useRef<Set<string>>(new Set());
  const autoAttemptedIdsRef = useRef<Set<string>>(new Set());
  const carouselIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const phraseIdx = useRef(Math.floor(Math.random() * DISCOVERY_PHRASES.length));
  const viewResumeKey = useMemo(() => {
    if (!session?.did) return null;
    return `explore:${session.did}`;
  }, [session?.did]);

  const persistViewScroll = useCallback(() => {
    if (!viewResumeKey || !scrollRef.current) return;
    writeViewScrollPosition(viewResumeKey, scrollRef.current.scrollTop);
  }, [viewResumeKey]);

  useEffect(() => {
    if (!viewResumeKey) return;
    const top = readViewScrollPosition(viewResumeKey);
    if (top <= 0) return;

    const timer = window.setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = top;
      }
    }, 50);

    return () => {
      window.clearTimeout(timer);
    };
  }, [viewResumeKey]);

  useEffect(() => {
    return () => {
      persistViewScroll();
    };
  }, [persistViewScroll]);
  // Entity sheet state — Narwhal v3 Phase C
  const [activeEntity, setActiveEntity] = useState<WriterEntity | null>(null);
  const {
    posts: searchPosts,
    actors: searchActors,
    feedItems: searchFeedItems,
    intent: searchIntent,
    semanticActorDids: searchSemanticActorDids,
    keywordActorDids: searchKeywordActorDids,
    hasMorePosts: hasMoreSearchPosts,
    hasMoreActors: hasMoreSearchActors,
    loading,
    loadingMorePosts: loadingMoreSearchPosts,
    loadingMoreActors: loadingMoreSearchActors,
    loadMorePosts: loadMoreSearchPosts,
    loadMoreActors: loadMoreSearchActors,
  } = useExploreSearchResults({
    query: debouncedQuery,
    searchSort,
    agent,
    enabled: sessionReady,
  });
  const exploreSearchPage = {
    posts: searchPosts,
    actors: searchActors,
    feedItems: searchFeedItems,
    intent: searchIntent,
    postCursor: null,
    tagPostCursor: null,
    actorCursor: null,
    semanticActorDids: searchSemanticActorDids,
    keywordActorDids: searchKeywordActorDids,
    hasMorePosts: hasMoreSearchPosts,
    hasMoreActors: hasMoreSearchActors,
  };

  const {
    insight: aiInsight,
    shortInsight: aiShortInsight,
    provider: aiInsightProvider,
    loading: aiInsightLoading,
  } = useExploreAiInsight({
    page: exploreSearchPage,
    query: debouncedQuery,
    actorDid: session?.did ?? null,
    enabled: exploreAiInsightEnabled && Boolean(debouncedQuery) && !loading,
  });

  const {
    suggestedFeeds,
    suggestedActors,
    suggestedActorRecommendations,
    featuredPost,
    linkPosts,
    trendingPosts,
    sidePosts,
    recentFeedItems,
    loading: discoverLoading,
  } = useExploreDiscoverContent({
    agent,
    sessionDid: session?.did ?? null,
    enabled: sessionReady,
  });
  const {
    visibleSuggestedActorRecommendations,
    visibleSuggestedActors,
    followSuggestedActor,
    dismissSuggestedActor,
  } = useExploreActorRecommendations({
    agent,
    sessionDid: session?.did ?? null,
    suggestedActors,
    suggestedActorRecommendations,
  });

  const exploreVisiblePool = useMemo(() => {
    const merged = [
      ...(featuredPost ? [featuredPost] : []),
      ...linkPosts,
      ...sidePosts,
      ...searchPosts,
      ...trendingPosts,
    ];
    const byId = new Map<string, MockPost>();
    for (const post of merged) byId.set(post.id, post);
    return [...byId.values()];
  }, [featuredPost, linkPosts, sidePosts, searchPosts, trendingPosts]);

  const filterResults = usePostFilterResults(exploreVisiblePool, 'explore');
  const timelineHintsByPostId = useTimelineConversationHintsProjection(exploreVisiblePool);

  const filteredLinkPosts = useMemo(
    () => linkPosts.filter((post) => !(filterResults[post.id] ?? []).some((m) => m.action === 'hide')),
    [filterResults, linkPosts],
  );
  const filteredSidePosts = useMemo(
    () => sidePosts.filter((post) => !(filterResults[post.id] ?? []).some((m) => m.action === 'hide')),
    [filterResults, sidePosts],
  );
  const visibleDiscoverSections = useMemo(
    () => resolveVisibleDiscoverSections(activeFilter),
    [activeFilter],
  );
  const showDiscoverSection = useCallback(
    (section: DiscoverSectionKey) => shouldShowDiscoverSection(visibleDiscoverSections, section),
    [visibleDiscoverSections],
  );

  const sportsPulsePosts = useMemo(() => {
    const candidates = [...filteredLinkPosts, ...filteredSidePosts, ...trendingPosts];
    return sportsFeedService
      .filterPosts(candidates, { sortBy: 'engagement' }, sportsStore.getLiveGames())
      .slice(0, 8);
  }, [filteredLinkPosts, filteredSidePosts, trendingPosts]);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 400);
    return () => clearTimeout(t);
  }, [query]);

  // Accept external hashtag navigation and open Explore post results directly.
  useEffect(() => {
    if (!exploreSearchQuery) return;
    const nextQuery = normalizeExternalExploreSearchQuery(exploreSearchQuery);
    if (!nextQuery) {
      clearExploreSearch();
      return;
    }
    setQuery(nextQuery);
    setDebouncedQuery(nextQuery);
    clearExploreSearch();
  }, [clearExploreSearch, exploreSearchQuery]);

  // Reset carousel index when link posts refresh
  useEffect(() => { setFeaturedIdx(0); }, [linkPosts]);

  // Auto-advance carousel — restarts on manual tap
  const restartCarousel = useCallback(() => {
    if (carouselIntervalRef.current) clearInterval(carouselIntervalRef.current);
    if (linkPosts.length <= 1) return;
    carouselIntervalRef.current = setInterval(() => {
      setFeaturedIdx(i => (i + 1) % linkPosts.length);
    }, 5000);
  }, [linkPosts.length]);

  useEffect(() => {
    restartCarousel();
    return () => { if (carouselIntervalRef.current) clearInterval(carouselIntervalRef.current); };
  }, [restartCarousel]);

  useEffect(() => {
    const enableMockSports = ((import.meta as any).env?.VITE_ENABLE_MOCK_SPORTS === 'true');
    if (enableMockSports) {
      sportsStore.loadSampleGames();
      for (const game of sportsStore.getGames()) {
        sportsStore.startPolling(game.id, 'mock');
      }
    } else {
      const leagues = ['nba', 'nfl', 'mlb', 'nhl'] as const;
      sportsStore.loadFromEspn([...leagues]).catch(() => {
        // Keep discovery usable even if sports API is temporarily unreachable.
      });
      sportsStore.startEspnAutoRefresh([...leagues], 45_000);
    }
    return () => {
      sportsStore.stopAllPolling();
      sportsStore.stopEspnAutoRefresh();
      if (enableMockSports) sportsStore.clear();
    };
  }, []);

  const handleAddPodcastFeed = useCallback(async (feedUrl: string) => {
    const normalized = normalizeExternalFeedUrl(feedUrl);
    if (!normalized) {
      setPodcastFeedAddStatus('Enter a valid http(s) podcast feed URL.');
      addAppNotification({
        title: 'Invalid Feed URL',
        message: 'Podcast subscriptions only support valid http(s) feed URLs.',
        level: 'warning',
      });
      return;
    }
    setPodcastFeedAddStatus(null);
    setAddingPodcastFeedByUrl((prev) => ({ ...prev, [normalized]: true }));
    try {
      const subscription = await subscribeToExternalFeed({
        rawUrl: normalized,
        category: 'Podcasts',
      });
      if (!subscription.ok) {
        throw subscription;
      }
      setPodcastFeedAddStatus('Podcast feed added.');
      addAppNotification({
        title: 'Podcast Added',
        message: `Subscribed to ${normalized}`,
        level: 'success',
      });
    } catch {
      setPodcastFeedAddStatus('Unable to add this podcast feed right now.');
      addAppNotification({
        title: 'Podcast Add Failed',
        message: `Could not subscribe to ${normalized}`,
        level: 'warning',
      });
    } finally {
      setAddingPodcastFeedByUrl((prev) => ({ ...prev, [normalized]: false }));
    }
  }, [addAppNotification]);

  const handleFollowFeed = useCallback(async (uri: string) => {
    // Feed like/follow via ATProto
  }, []);

  const openSearchStory = useCallback((rawQuery: string) => {
    const normalized = normalizeSearchStoryNavigationQuery(rawQuery);
    if (!normalized) return;
    useUiStore.getState().openSearchStory(normalized);
  }, []);

  const openHashtagFeed = useCallback((rawTag: string) => {
    const normalized = normalizeHashtagFeedNavigationQuery(rawTag);
    if (!normalized) return;
    useUiStore.getState().openHashtagFeed(normalized);
  }, []);

  const openPeopleFeed = useCallback((rawQuery: string) => {
    const normalized = normalizePeopleFeedNavigationQuery(rawQuery);
    if (!normalized) return;
    useUiStore.getState().openPeopleFeed(normalized);
  }, []);

  const isSearching = debouncedQuery.trim().length > 0;
  const discoverStoryExplanations = useMemo(() => {
    const output = new Map<string, string[]>();
    filteredLinkPosts.forEach((post, index) => {
      output.set(post.id, buildStoryExplanationChips({
        post,
        rank: index,
        featured: index === featuredIdx,
        searching: false,
      }));
    });
    filteredSidePosts.forEach((post, index) => {
      if (!output.has(post.id)) {
        output.set(post.id, buildStoryExplanationChips({
          post,
          rank: index,
          featured: false,
          searching: false,
        }));
      }
    });
    return output;
  }, [featuredIdx, filteredLinkPosts, filteredSidePosts]);

  const searchStoryExplanations = useMemo(() => {
    const output = new Map<string, string[]>();
    searchPosts.forEach((post, index) => {
      output.set(post.id, buildStoryExplanationChips({
        post,
        rank: index,
        featured: false,
        searching: true,
        intentLabel: searchIntent.label,
      }));
    });
    return output;
  }, [searchIntent.label, searchPosts]);

  const getSessionSynopsis = useCallback((post: MockPost) => {
    return timelineHintsByPostId[post.id]?.compactSummary;
  }, [timelineHintsByPostId]);

  const getWhySurfaceLines = useCallback((post: MockPost, options?: {
    intentLabel?: string;
    explanationChips?: string[];
    maxLines?: number;
  }) => {
    const hint = timelineHintsByPostId[post.id];
    return buildWhySurfaceLines({
      post,
      ...(options?.intentLabel ? { intentLabel: options.intentLabel } : {}),
      ...(typeof options?.maxLines === 'number' ? { maxLines: options.maxLines } : {}),
      ...(options?.explanationChips ? { explanationChips: options.explanationChips } : {}),
      sessionHint: hint
        ? {
            compactSummary: hint.compactSummary,
            sourceSupportPresent: hint.sourceSupportPresent,
            factualSignalPresent: hint.factualSignalPresent,
            ...(hint.continuityLabel ? { continuityLabel: hint.continuityLabel } : {}),
          }
        : null,
    });
  }, [timelineHintsByPostId]);

  const {
    trendingTopics,
    liveClusters,
    domains,
    hasVisibleDiscoverContent,
  } = useMemo(() => projectExploreDiscoverView({
    trendingPosts,
    suggestedActors: visibleSuggestedActors,
    visibleDiscoverSections,
    sportsPulsePostCount: sportsPulsePosts.length,
    recentFeedItemCount: recentFeedItems.length,
    filteredLinkPostCount: filteredLinkPosts.length,
    suggestedFeedCount: suggestedFeeds.length,
  }), [
    filteredLinkPosts.length,
    recentFeedItems.length,
    sportsPulsePosts.length,
    visibleSuggestedActors,
    suggestedFeeds.length,
    trendingPosts,
    visibleDiscoverSections,
  ]);

  const handleToggleTranslate = useCallback(async (event: React.MouseEvent, post: MockPost) => {
    event.stopPropagation();

    const detected = heuristicDetectLanguage(post.content);
    const translation = translationById[post.id];
    const hasRenderableTranslation = !!translation && hasMeaningfulTranslation(post.content, translation.translatedText);

    if (hasRenderableTranslation) {
      setShowOriginalById((prev) => ({ ...prev, [post.id]: !prev[post.id] }));
      return;
    }

    if (!post.content.trim()) return;

    setTranslatingById((prev) => ({ ...prev, [post.id]: true }));
    setTranslationErrorById((prev) => ({ ...prev, [post.id]: false }));
    try {
      const result = await translationClient.translateInline({
        id: post.id,
        sourceText: post.content,
        targetLang: translationPolicy.userLanguage,
        mode: translationPolicy.localOnlyMode ? 'local_private' : 'server_default',
        ...(detected.language !== 'und' ? { sourceLang: detected.language } : {}),
      });
      if (!hasMeaningfulTranslation(post.content, result.translatedText)) {
        setTranslationErrorById((prev) => ({ ...prev, [post.id]: true }));
        return;
      }
      upsertTranslation(result);
      setShowOriginalById((prev) => ({ ...prev, [post.id]: false }));
    } catch (err) {
      console.warn('[ExploreTab] translation failed', err);
      setTranslationErrorById((prev) => ({ ...prev, [post.id]: true }));
    } finally {
      setTranslatingById((prev) => ({ ...prev, [post.id]: false }));
    }
  }, [translationById, translationPolicy.localOnlyMode, translationPolicy.userLanguage, upsertTranslation]);

  const handleClearTranslation = useCallback((event: React.MouseEvent, postId: string) => {
    event.stopPropagation();
    clearTranslation(postId);
    setShowOriginalById((prev) => ({ ...prev, [postId]: false }));
    setTranslationErrorById((prev) => ({ ...prev, [postId]: false }));
    autoTranslatedIdsRef.current.delete(postId);
  }, [clearTranslation]);

  useEffect(() => {
    if (!translationPolicy.autoTranslateExplore) return;
    if (!sessionReady) return;

    const visible = isSearching
      ? searchPosts.slice(0, 8)
      : [
          ...(featuredPost ? [featuredPost] : []),
          ...linkPosts.slice(0, 3),
          ...sidePosts.slice(0, 4),
        ];

    const unique = new Map<string, MockPost>();
    for (const post of visible) unique.set(post.id, post);

    const missing = [...unique.values()].filter((post) => {
      if (!canAutoInlineTranslateExplore(post)) return false;
      if (!post.content.trim()) return false;
      if (autoAttemptedIdsRef.current.has(post.id)) return false;
      if (translatingById[post.id]) return false;
      if (translationById[post.id]) return false;
      if (!hasTranslatableLanguageSignal(post.content)) return false;
      // Skip posts already in the user's language
      const detected = heuristicDetectLanguage(post.content);
      if (detected.language !== 'und' && isLikelySameLanguage(detected.language, translationPolicy.userLanguage)) return false;
      return true;
    });

    if (missing.length === 0) return;

    for (const post of missing) {
      autoAttemptedIdsRef.current.add(post.id);
      setTranslatingById((prev) => ({ ...prev, [post.id]: true }));
      setTranslationErrorById((prev) => ({ ...prev, [post.id]: false }));
    }

    Promise.allSettled(
      missing.map((post) =>
        translationClient.translateInline({
          id: post.id,
          sourceText: post.content,
          targetLang: translationPolicy.userLanguage,
          mode: translationPolicy.localOnlyMode ? 'local_private' : 'server_default',
          ...(heuristicDetectLanguage(post.content).language !== 'und'
            ? { sourceLang: heuristicDetectLanguage(post.content).language }
            : {}),
        }).then((result) => {
          if (!hasMeaningfulTranslation(post.content, result.translatedText)) return;
          autoTranslatedIdsRef.current.add(post.id);
          upsertTranslation(result);
          setShowOriginalById((prev) => ({ ...prev, [post.id]: false }));
          // Also translate display name if it appears to be in a non-target language
          const dn = post.author.displayName || post.author.handle;
          const dnKey = `displayName:${post.author.did}`;
          if (dn && !translationById[dnKey]) {
            const dnDetected = heuristicDetectLanguage(dn);
            if (dnDetected.language !== 'und' && !isLikelySameLanguage(dnDetected.language, translationPolicy.userLanguage)) {
              translationClient.translateInline({
                id: dnKey,
                sourceText: dn,
                targetLang: translationPolicy.userLanguage,
                mode: translationPolicy.localOnlyMode ? 'local_private' : 'server_default',
              }).then(upsertTranslation).catch(() => {});
            }
          }
        }).catch((err) => {
          console.warn('[ExploreTab] auto translation failed', err);
          setTranslationErrorById((prev) => ({ ...prev, [post.id]: true }));
        }).finally(() => {
          setTranslatingById((prev) => ({ ...prev, [post.id]: false }));
        }),
      ),
    ).catch(() => {
      // Translation failure should not break Explore rendering.
    });
  }, [
    featuredPost,
    isSearching,
    linkPosts,
    searchPosts,
    sidePosts,
    sessionReady,
    translationById,
    translationPolicy.autoTranslateExplore,
    translationPolicy.localOnlyMode,
    translationPolicy.userLanguage,
    translatingById,
    upsertTranslation,
  ]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: disc.bgBase,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Atmospheric background */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: disc.bgAtmosphere,
      }} />

      {/* Entity sheet — Narwhal v3 Phase C */}
      <WriterEntitySheet
        entity={activeEntity}
        relatedPosts={exploreVisiblePool}
        onClose={() => setActiveEntity(null)}
      />

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative', zIndex: 2,
        flexShrink: 0,
        paddingTop: 'calc(var(--safe-top) + 8px)',
        padding: 'calc(var(--safe-top) + 8px) 20px 0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 'calc(var(--safe-top) + 49px)',
      }}>
        {/* Avatar / account switcher */}
        <button
          aria-label="Account"
          style={{ width: iconBtnTokens.size, height: iconBtnTokens.size, borderRadius: '50%', background: disc.surfaceCard2, border: `0.5px solid ${disc.lineSubtle}`, overflow: 'hidden', cursor: 'pointer' }}
        >
          <svg width={iconBtnTokens.size} height={iconBtnTokens.size} viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={1.5} strokeLinecap="round">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
        </button>
        {/* Wordmark */}
        <span style={{
          fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em',
          color: disc.textSecondary,
        }}>Glympse</span>
        {/* Overflow */}
        <button aria-label="More options" style={{ width: iconBtnTokens.size, height: iconBtnTokens.size, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={disc.textTertiary} strokeWidth={2} strokeLinecap="round">
            <circle cx="12" cy="5" r="1" fill={disc.textTertiary}/>
            <circle cx="12" cy="12" r="1" fill={disc.textTertiary}/>
            <circle cx="12" cy="19" r="1" fill={disc.textTertiary}/>
          </svg>
        </button>
      </div>

      {/* ── Scrollable content ───────────────────────────────────────────── */}
      <div ref={scrollRef} className="scroll-y" style={{ flex: 1, position: 'relative', zIndex: 1 }} onScroll={persistViewScroll}>
        <div style={{ padding: '20px 20px 0' }}>

          {/* ── Hero title block ──────────────────────────────────────── */}
          <AnimatePresence mode="wait">
            {!isSearching && (
              <motion.div
                key="hero"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={transitions.fadeIn}
                style={{ marginBottom: 20 }}
              >
                <h1 style={{
                  fontSize: typeScale.displayLg[0], lineHeight: `${typeScale.displayLg[1]}px`,
                  fontWeight: typeScale.displayLg[2], letterSpacing: typeScale.displayLg[3],
                  color: disc.textPrimary, margin: 0,
                }}>
                  {DISCOVERY_PHRASES[phraseIdx.current]}
                </h1>
                <p style={{
                  fontSize: typeScale.bodyMd[0], lineHeight: `${typeScale.bodyMd[1]}px`,
                  fontWeight: typeScale.bodyMd[2],
                  color: disc.textSecondary, marginTop: 6,
                }}>
                  Stories, threads, and ideas worth your attention
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Search hero field ─────────────────────────────────────── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            marginBottom: 12,
          }}>
            <motion.div
              animate={{ boxShadow: focused ? shfTokens.focus.glow : shfTokens.shadow }}
              style={{
                flex: 1,
                height: shfTokens.height,
                borderRadius: shfTokens.radius,
                background: shfTokens.discovery.bg,
                border: `1px solid ${focused ? shfTokens.focus.border : shfTokens.discovery.border}`,
                display: 'flex', alignItems: 'center', gap: shfTokens.iconGap,
                padding: `0 ${shfTokens.paddingX}px`,
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={shfTokens.discovery.icon} strokeWidth={2} strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && query.trim().length > 1) {
                    e.currentTarget.blur();
                    openSearchStory(query);
                  }
                }}
                placeholder="Search stories, topics, feeds"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  flex: 1,
                  fontSize: typeScale.bodyLg[0], lineHeight: `${typeScale.bodyLg[1]}px`,
                  fontWeight: typeScale.bodyLg[2],
                  color: shfTokens.discovery.text,
                  background: 'none', border: 'none', outline: 'none',
                }}
              />
              {query && (
                <button onClick={() => setQuery('')} style={{ color: disc.textTertiary, background: 'none', border: 'none', cursor: 'pointer', minWidth: touchLike ? 36 : 28, minHeight: touchLike ? 36 : 28, borderRadius: '50%', display: 'flex' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              )}
            </motion.div>
            <AnimatePresence>
              {(isSearching || focused) && (
                <motion.button
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  onClick={() => { setQuery(''); inputRef.current?.blur(); setFocused(false); }}
                  style={{
                    minHeight: touchLike ? 40 : 34,
                    padding: touchLike ? '0 6px' : 0,
                    fontSize: touchLike ? Math.max(typeScale.chip[0], 14) : typeScale.chip[0], fontWeight: 600,
                    color: accent.primary,
                    background: 'none', border: 'none', cursor: 'pointer',
                    whiteSpace: 'nowrap', overflow: 'hidden',
                  }}
                >
                  Cancel
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* ── Search Story CTA (shows when query is non-empty) ─────── */}
          <AnimatePresence>
            {query.trim().length > 1 && (
              <motion.button
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                onClick={() => openSearchStory(query)}
                style={{
                  width: '100%', height: buttonTokens.height,
                  borderRadius: radius.full,
                  background: accent.primary,
                  color: '#fff',
                  border: 'none', cursor: 'pointer',
                  fontSize: buttonTokens.fontSize, fontWeight: 700,
                  marginBottom: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                Search Story: "{query}"
              </motion.button>
            )}
          </AnimatePresence>

          {/* ── Quick filter chips ────────────────────────────────────── */}
          <AnimatePresence>
            {!isSearching && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ display: 'flex', gap: qfcTokens.gap, overflowX: 'auto', paddingBottom: 4, marginBottom: 18, scrollbarWidth: 'none' }}
              >
                {QUICK_FILTERS.map(f => (
                  <button
                    key={f}
                    onClick={() => setActiveFilter(activeFilter === f ? null : f)}
                    style={{
                      flexShrink: 0,
                      minHeight: touchLike ? 34 : qfcTokens.height,
                      padding: `0 ${touchLike ? Math.max(qfcTokens.paddingX - 1, 11) : qfcTokens.paddingX}px`,
                      borderRadius: qfcTokens.radius,
                      background: activeFilter === f ? qfcTokens.discovery.activeBg : qfcTokens.discovery.bg,
                      border: `0.5px solid ${qfcTokens.discovery.border}`,
                      color: activeFilter === f ? qfcTokens.discovery.activeText : qfcTokens.discovery.text,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.14s',
                    }}
                  >{f}</button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Search results ─────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {isSearching ? (
            <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: '0 20px' }}>
              {loading ? <DiscoverySpinner /> : (
                <>
                  <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
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
                    <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '4px 8px', background: 'rgba(124,233,255,0.16)', color: accent.cyan400 }}>
                      {searchIntent.label}
                    </span>
                    <span style={{ fontSize: 11, color: disc.textTertiary }}>
                      Confidence {Math.round(Math.max(0, Math.min(1, searchIntent.confidence)) * 100)}%
                    </span>
                    <div style={{ flex: 1 }} />
                    {/* AI insight toggle */}
                    <button
                      type="button"
                      onClick={toggleExploreAiInsight}
                      title={exploreAiInsightEnabled ? 'Disable AI insight' : 'Enable AI insight'}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        border: 'none',
                        borderRadius: 999,
                        padding: '6px 11px',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 700,
                        transition: 'all 0.18s',
                        ...(exploreAiInsightEnabled
                          ? {
                              background: 'linear-gradient(135deg, rgba(91,124,255,0.35) 0%, rgba(124,233,255,0.25) 100%)',
                              color: accent.cyan400,
                              boxShadow: '0 0 12px rgba(124,233,255,0.28), inset 0 0 0 0.5px rgba(124,233,255,0.4)',
                            }
                          : {
                              background: disc.surfaceCard,
                              color: disc.textTertiary,
                              boxShadow: `inset 0 0 0 0.5px ${disc.lineSubtle}`,
                            }),
                      }}
                    >
                      {/* Sparkle / AI icon */}
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 2l1.8 7.2L21 7l-5.4 5.4L21 18l-7.2-1.8L12 24l-1.8-7.2L3 18l5.4-5.6L3 7l7.2 2.2L12 2z"/>
                      </svg>
                      AI
                    </button>
                  </div>

                  {/* ── AI Insight banner ─────────────────────────────── */}
                  <AnimatePresence>
                    {exploreAiInsightEnabled && (aiInsightLoading || aiInsight) && (
                      <motion.div
                        key="ai-insight-banner"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.22, ease: 'easeOut' }}
                        style={{
                          marginBottom: 18,
                          borderRadius: 18,
                          background: 'linear-gradient(135deg, rgba(91,124,255,0.13) 0%, rgba(124,233,255,0.09) 100%)',
                          border: '0.5px solid rgba(124,233,255,0.28)',
                          padding: '14px 16px',
                          position: 'relative',
                          overflow: 'hidden',
                        }}
                      >
                        {/* Ambient glow layer */}
                        <div style={{
                          position: 'absolute', top: -20, right: -20,
                          width: 100, height: 100,
                          borderRadius: '50%',
                          background: 'radial-gradient(circle, rgba(124,233,255,0.12) 0%, transparent 70%)',
                          pointerEvents: 'none',
                        }} />
                        {/* Header row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: aiInsightLoading ? 0 : 10 }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill={accent.cyan400} aria-hidden="true">
                            <path d="M12 2l1.8 7.2L21 7l-5.4 5.4L21 18l-7.2-1.8L12 24l-1.8-7.2L3 18l5.4-5.6L3 7l7.2 2.2L12 2z"/>
                          </svg>
                          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: accent.cyan400 }}>
                            AI Insight
                          </span>
                          {aiInsightProvider && !aiInsightLoading && (
                            <span style={{ fontSize: 10, color: disc.textTertiary, fontWeight: 600, marginLeft: 4 }}>
                              via {aiInsightProvider}
                            </span>
                          )}
                        </div>
                        {aiInsightLoading ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={accent.cyan400} strokeWidth={2} strokeLinecap="round">
                              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
                                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
                              </path>
                            </svg>
                            <span style={{ fontSize: 12, color: disc.textTertiary, fontWeight: 600 }}>Synthesising results…</span>
                          </div>
                        ) : (
                          <>
                            <p style={{
                              fontSize: 13,
                              lineHeight: '20px',
                              color: disc.textPrimary,
                              fontWeight: 500,
                              margin: 0,
                            }}>
                              {aiInsight}
                            </p>
                            {aiShortInsight && (
                              <p style={{
                                marginTop: 8,
                                fontSize: 11,
                                lineHeight: '16px',
                                color: disc.textSecondary,
                                fontWeight: 600,
                                fontStyle: 'italic',
                                margin: '8px 0 0',
                              }}>
                                {aiShortInsight}
                              </p>
                            )}
                          </>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {searchPosts.filter((post) => !(filterResults[post.id] ?? []).some((m) => m.action === 'hide')).length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <SectionHeader title="Posts" />
                      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2 }}>
                        {searchPosts.filter((post) => !(filterResults[post.id] ?? []).some((m) => m.action === 'hide')).slice(0, 12).map((post) => (
                          (() => {
                            const explanationChips = searchStoryExplanations.get(post.id);
                            const whySurfaceLines = getWhySurfaceLines(post, {
                              intentLabel: searchIntent.label,
                              maxLines: 2,
                              ...(explanationChips ? { explanationChips } : {}),
                            });
                            return (
                              <LinkedPostMiniCard
                                key={post.id}
                                post={post}
                                {...(explanationChips ? { explanationChips } : {})}
                                sessionSynopsis={getSessionSynopsis(post)}
                                whySurfaceLines={whySurfaceLines}
                                translation={translationById[post.id]}
                                showOriginal={!!showOriginalById[post.id]}
                                translating={!!translatingById[post.id]}
                                translationError={!!translationErrorById[post.id]}
                                autoTranslated={autoTranslatedIdsRef.current.has(post.id)}
                                onToggleTranslate={(event) => handleToggleTranslate(event, post)}
                                onClearTranslation={(event) => handleClearTranslation(event, post.id)}
                                onTap={() => onOpenStory({ type: 'post', id: post.id, title: getExploreStoryTitle(post.content) })}
                                onHashtag={openHashtagFeed}
                              />
                            );
                          })()
                        ))}
                      </div>
                      {hasMoreSearchPosts && (
                        <button
                          type="button"
                          onClick={loadMoreSearchPosts}
                          disabled={loadingMoreSearchPosts}
                          style={{
                            marginTop: 10,
                            border: 'none',
                            borderRadius: 999,
                            padding: '7px 12px',
                            cursor: loadingMoreSearchPosts ? 'default' : 'pointer',
                            background: loadingMoreSearchPosts ? disc.surfaceFocus : accent.primary,
                            color: '#fff',
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {loadingMoreSearchPosts ? 'Loading more posts...' : 'Load more posts'}
                        </button>
                      )}
                    </div>
                  )}
                  {searchActors.length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <SectionHeader title="People" />
                      <div style={{ background: disc.surfaceCard, borderRadius: radius[24], padding: `0 ${space[8]}px`, border: `0.5px solid ${disc.lineSubtle}` }}>
                        {searchActors.map((a) => {
                          const didKey = a.did.trim().toLowerCase();
                          return (
                            <ActorRow
                              key={a.did}
                              actor={a}
                              onFollow={followSuggestedActor}
                              showMatchChips
                              semanticMatch={searchSemanticActorDids.has(didKey)}
                              keywordMatch={searchKeywordActorDids.has(didKey)}
                            />
                          );
                        })}
                      </div>
                      {hasMoreSearchActors && (
                        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            onClick={loadMoreSearchActors}
                            disabled={loadingMoreSearchActors}
                            style={{
                              flex: 1,
                              border: 'none',
                              borderRadius: 999,
                              padding: '7px 12px',
                              cursor: loadingMoreSearchActors ? 'default' : 'pointer',
                              background: loadingMoreSearchActors ? disc.surfaceFocus : accent.primary,
                              color: '#fff',
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {loadingMoreSearchActors ? 'Loading more people...' : 'Load more people'}
                          </button>
                          <button
                            type="button"
                            onClick={() => openPeopleFeed(query)}
                            style={{
                              border: `1px solid ${accent.primary}`,
                              borderRadius: 999,
                              padding: '6px 12px',
                              cursor: 'pointer',
                              background: 'none',
                              color: accent.primary,
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            View all
                          </button>
                        </div>
                      )} 
                    </div>
                  )}
                  {searchFeedItems.length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <SectionHeader title="Feeds & Podcasts" />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {searchFeedItems.slice(0, 10).map((item) => {
                          const isPodcast = item.source === 'podcast-index' || (item.enclosureType || '').startsWith('audio/');
                          const isAdding = Boolean(addingPodcastFeedByUrl[item.link]);
                          return (
                            <div
                              key={item.id}
                              style={{
                                background: disc.surfaceCard,
                                borderRadius: radius[16],
                                padding: `${space[8]}px ${space[10]}px`,
                                border: `0.5px solid ${disc.lineSubtle}`,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <p style={{ margin: 0, fontSize: typeScale.bodySm[0], fontWeight: 700, color: disc.textPrimary }}>{item.title}</p>
                                {isPodcast && (
                                  <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '3px 8px', background: 'rgba(91,124,255,0.2)', color: accent.cyan400 }}>
                                    Podcast
                                  </span>
                                )}
                              </div>
                              <p style={{ margin: '4px 0 0', fontSize: typeScale.metaSm[0], color: disc.textSecondary }}>
                                {(item.feedTitle || 'Feed')} • {(item.feedCategory || 'General')}
                              </p>
                              {item.content && (
                                <p style={{ margin: '6px 0 0', fontSize: typeScale.bodySm[0], color: disc.textTertiary, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                  {item.content}
                                </p>
                              )}
                              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <a
                                  href={item.link}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{
                                    color: accent.primary,
                                    fontSize: typeScale.metaSm[0],
                                    fontWeight: 700,
                                    textDecoration: 'none',
                                  }}
                                >
                                  Open feed
                                </a>
                                {item.source === 'podcast-index' && (
                                  <button
                                    type="button"
                                    onClick={() => handleAddPodcastFeed(item.link)}
                                    disabled={isAdding}
                                    style={{
                                      border: 'none',
                                      borderRadius: 999,
                                      padding: '5px 10px',
                                      cursor: isAdding ? 'default' : 'pointer',
                                      background: isAdding ? disc.surfaceCard : accent.primary,
                                      color: '#fff',
                                      fontSize: 11,
                                      fontWeight: 700,
                                    }}
                                  >
                                    {isAdding ? 'Adding...' : 'Add Podcast'}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {podcastFeedAddStatus && (
                          <p style={{ margin: 0, fontSize: typeScale.metaSm[0], color: disc.textSecondary }}>
                            {podcastFeedAddStatus}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {searchActors.length === 0 && searchPosts.length === 0 && searchFeedItems.length === 0 && (
                    <div style={{ padding: '40px 0', textAlign: 'center' }}>
                      <p style={{ fontSize: typeScale.bodySm[0], color: disc.textTertiary }}>No results for "{debouncedQuery}"</p>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          ) : (
            <motion.div key="discover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {discoverLoading ? (
                <div style={{ padding: '0 20px' }}><DiscoverySpinner /></div>
              ) : (
                <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 28 }}>

                  {activeFilter && !hasVisibleDiscoverContent && (
                    <div style={{
                      borderRadius: radius[20],
                      background: disc.surfaceCard,
                      border: `0.5px solid ${disc.lineSubtle}`,
                      padding: `${space[8]}px ${space[10]}px`,
                    }}>
                      <p style={{ margin: 0, fontSize: typeScale.bodySm[0], color: disc.textSecondary }}>
                        No {activeFilter.toLowerCase()} results are available right now.
                      </p>
                    </div>
                  )}

                  {showDiscoverSection('live-sports') && (
                  <div>
                    <SectionHeader title="Live Sports Moments" />
                    <LiveSportsMoments
                      maxGames={3}
                      onGameClick={(gameId) => {
                        const game = sportsStore.getGame(gameId);
                        const query = game
                          ? (game.hashtags[0] ? `#${game.hashtags[0]}` : `${game.awayTeam.name} ${game.homeTeam.name}`)
                          : gameId;
                        openSearchStory(query);
                      }}
                    />
                  </div>
                  )}

                  {showDiscoverSection('sports-pulse') && sportsPulsePosts.length > 0 && (
                    <div>
                      <SectionHeader title="Sports Pulse" />
                      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2 }}>
                        {sportsPulsePosts.map((p) => (
                          (() => {
                            const whySurfaceLines = getWhySurfaceLines(p, { maxLines: 2 });
                            return (
                          <LinkedPostMiniCard
                            key={p.id}
                            post={p}
                            sessionSynopsis={getSessionSynopsis(p)}
                            whySurfaceLines={whySurfaceLines}
                            translation={translationById[p.id]}
                            showOriginal={!!showOriginalById[p.id]}
                            translating={!!translatingById[p.id]}
                            translationError={!!translationErrorById[p.id]}
                            autoTranslated={autoTranslatedIdsRef.current.has(p.id)}
                            onToggleTranslate={(event) => handleToggleTranslate(event, p)}
                            onClearTranslation={(event) => handleClearTranslation(event, p.id)}
                            onTap={() => onOpenStory({ type: 'post', id: p.id, title: getExploreStoryTitle(p.content) })}
                            onHashtag={openHashtagFeed}
                          />
                            );
                          })()
                        ))}
                      </div>
                    </div>
                  )}

                  {showDiscoverSection('feed-items') && recentFeedItems.length > 0 && (
                    <div>
                      <SectionHeader title="From Your Feeds" />
                      <div style={{ display: 'grid', gap: 10 }}>
                        {recentFeedItems.slice(0, 6).map((item) => {
                          const isPodcast = (item.enclosureType || '').startsWith('audio/');
                          return (
                            <a
                              key={item.id}
                              href={item.link}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: 'block',
                                background: disc.surfaceCard,
                                borderRadius: radius[16],
                                padding: `${space[8]}px ${space[10]}px`,
                                border: `0.5px solid ${disc.lineSubtle}`,
                                textDecoration: 'none',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <p style={{ margin: 0, fontSize: typeScale.bodySm[0], fontWeight: 700, color: disc.textPrimary }}>{item.title}</p>
                                {isPodcast && (
                                  <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 7px', background: 'rgba(91,124,255,0.2)', color: accent.cyan400 }}>
                                    Podcast
                                  </span>
                                )}
                              </div>
                              <p style={{ margin: '4px 0 0', fontSize: typeScale.metaSm[0], color: disc.textSecondary }}>
                                {(item.feedTitle || 'Feed')} • {(item.feedCategory || 'General')}
                              </p>
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Featured Story Carousel */}
                  {showDiscoverSection('top-stories') && filteredLinkPosts.length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <SectionHeader title="Top Stories" />

                      {/* Hero card — crossfades between link posts */}
                      <div style={{ position: 'relative' }}>
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.div
                            key={filteredLinkPosts[featuredIdx]?.id ?? filteredLinkPosts[0]?.id ?? featuredIdx}
                            initial={{ opacity: 0, scale: 0.975 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.38, ease: [0.25, 0.1, 0.25, 1] }}
                          >
                            {(() => {
                              const p = filteredLinkPosts[featuredIdx] ?? filteredLinkPosts[0];
                              if (!p) return null;
                              const matches = filterResults[p.id] ?? [];
                              const isWarned = matches.some((m) => m.action === 'warn');
                              const isRevealed = !!revealedFilteredPosts[p.id];
                              if (isWarned && !isRevealed) {
                                const reasons = warnMatchReasons(matches);
                                return (
                                  <div style={{ border: `0.5px solid ${disc.lineSubtle}`, borderRadius: radius[20], padding: '12px 14px', background: 'rgba(255,149,0,0.08)' }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: disc.textPrimary, marginBottom: 4 }}>Content warning</div>
                                    <div style={{ fontSize: 11, color: disc.textSecondary, marginBottom: 8 }}>This post may include words or topics you asked to warn about.</div>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: disc.textSecondary, marginBottom: 6 }}>Matches filter:</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                                      {reasons.map((entry) => (
                                        <span key={`${entry.phrase}:${entry.reason}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, border: `0.5px solid ${disc.lineSubtle}`, padding: '3px 8px', background: disc.surfaceCard }}>
                                          <span style={{ fontSize: 11, color: disc.textPrimary, fontWeight: 700 }}>{entry.phrase}</span>
                                          <span style={{ fontSize: 10, color: disc.textSecondary, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                            {entry.reason === 'exact+semantic' ? 'exact + semantic' : entry.reason}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                    <button onClick={() => setRevealedFilteredPosts((prev) => ({ ...prev, [p.id]: true }))} style={{ border: 'none', background: 'transparent', color: accent.primary, fontSize: 12, fontWeight: 700, padding: 0, cursor: 'pointer' }}>
                                      Show post
                                    </button>
                                  </div>
                                );
                              }
                              return (
                                (() => {
                                  const explanationChips = discoverStoryExplanations.get(p.id);
                                  const whySurfaceLines = getWhySurfaceLines(p, explanationChips ? { explanationChips } : undefined);
                                  return (
                                    <FeaturedSearchStoryCard
                                      post={p}
                                      {...(explanationChips ? { explanationChips } : {})}
                                      sessionSynopsis={getSessionSynopsis(p)}
                                      whySurfaceLines={whySurfaceLines}
                                      translation={translationById[p.id]}
                                      showOriginal={!!showOriginalById[p.id]}
                                      translating={!!translatingById[p.id]}
                                      translationError={!!translationErrorById[p.id]}
                                      autoTranslated={autoTranslatedIdsRef.current.has(p.id)}
                                      translatedDisplayName={translationById[`displayName:${p.author.did}`]?.translatedText}
                                      onToggleTranslate={(event) => handleToggleTranslate(event, p)}
                                      onClearTranslation={(event) => handleClearTranslation(event, p.id)}
                                      onTap={() => onOpenStory({ type: 'post', id: p.id, title: getExploreStoryTitle(p.content) })}
                                      onHashtag={openHashtagFeed}
                                      onEntityTap={(e) => setActiveEntity(e)}
                                    />
                                  );
                                })()
                              );
                            })()}
                          </motion.div>
                        </AnimatePresence>
                      </div>

                      {/* Progress dots — tap to jump, active pill fills over 5s */}
                      {filteredLinkPosts.length > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5, marginTop: 10, marginBottom: 2 }}>
                          {filteredLinkPosts.map((_, i) => (
                            <button
                              key={i}
                              onClick={() => { setFeaturedIdx(i); restartCarousel(); }}
                              style={{ background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                            >
                              <motion.div
                                animate={{ width: i === featuredIdx ? 20 : 6 }}
                                transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
                                style={{
                                  height: 4, borderRadius: 2,
                                  overflow: 'hidden', position: 'relative',
                                  background: disc.lineSubtle,
                                }}
                              >
                                {i === featuredIdx && (
                                  <motion.div
                                    key={`fill-${featuredIdx}`}
                                    initial={{ scaleX: 0 }}
                                    animate={{ scaleX: 1 }}
                                    transition={{ duration: 5, ease: 'linear' }}
                                    style={{
                                      position: 'absolute', inset: 0,
                                      background: accent.primary,
                                      transformOrigin: 'left center',
                                    }}
                                  />
                                )}
                              </motion.div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Side strip: trending + underdogs */}
                      {filteredSidePosts.length > 0 && (
                        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2, marginTop: 12 }}>
                          {filteredSidePosts.map(p => {
                            const matches = filterResults[p.id] ?? [];
                            const isWarned = matches.some((m) => m.action === 'warn');
                            const isRevealed = !!revealedFilteredPosts[p.id];
                            if (isWarned && !isRevealed) {
                              const reasons = warnMatchReasons(matches);
                              return (
                                <div key={p.id} style={{ flexShrink: 0, width: 182, border: `0.5px solid ${disc.lineSubtle}`, borderRadius: radius[20], padding: '10px 12px', background: 'rgba(255,149,0,0.08)' }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: disc.textPrimary, marginBottom: 4 }}>Content warning</div>
                                  <div style={{ fontSize: 10, color: disc.textSecondary, marginBottom: 8 }}>This post may include words or topics you asked to warn about.</div>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: disc.textSecondary, marginBottom: 6 }}>Matches filter:</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                                    {reasons.map((entry) => (
                                      <span key={`${entry.phrase}:${entry.reason}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, borderRadius: 999, border: `0.5px solid ${disc.lineSubtle}`, padding: '2px 7px', background: disc.surfaceCard }}>
                                        <span style={{ fontSize: 10, color: disc.textPrimary, fontWeight: 700 }}>{entry.phrase}</span>
                                        <span style={{ fontSize: 9, color: disc.textSecondary, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                          {entry.reason === 'exact+semantic' ? 'exact + semantic' : entry.reason}
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                  <button onClick={() => setRevealedFilteredPosts((prev) => ({ ...prev, [p.id]: true }))} style={{ border: 'none', background: 'transparent', color: accent.primary, fontSize: 11, fontWeight: 700, padding: 0, cursor: 'pointer' }}>
                                    Show post
                                  </button>
                                </div>
                              );
                            }
                            return (
                              (() => {
                                const explanationChips = discoverStoryExplanations.get(p.id);
                                const whySurfaceLines = getWhySurfaceLines(p, {
                                  maxLines: 2,
                                  ...(explanationChips ? { explanationChips } : {}),
                                });
                                return (
                                  <LinkedPostMiniCard
                                    key={p.id}
                                    post={p}
                                    {...(explanationChips ? { explanationChips } : {})}
                                    sessionSynopsis={getSessionSynopsis(p)}
                                    whySurfaceLines={whySurfaceLines}
                                    translation={translationById[p.id]}
                                    showOriginal={!!showOriginalById[p.id]}
                                    translating={!!translatingById[p.id]}
                                    translationError={!!translationErrorById[p.id]}
                                    autoTranslated={autoTranslatedIdsRef.current.has(p.id)}
                                    onToggleTranslate={(event) => handleToggleTranslate(event, p)}
                                    onClearTranslation={(event) => handleClearTranslation(event, p.id)}
                                    onTap={() => onOpenStory({ type: 'post', id: p.id, title: getExploreStoryTitle(p.content) })}
                                    onHashtag={openHashtagFeed}
                                  />
                                );
                              })()
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Trending Topics */}
                  {showDiscoverSection('trending-topics') && trendingTopics.length > 0 && (
                    <div>
                      <SectionHeader title="Trending Topics" />
                      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 4 }}>
                        {trendingTopics.map((t, i) => (
                          <TrendingTopicCard
                            key={t}
                            topic={t}
                            signal={i < 2 ? 'active now' : i < 4 ? 'rising' : 'new'}
                            onTap={() => { setQuery(t); }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Live Clusters */}
                  {showDiscoverSection('live-clusters') && liveClusters.length > 0 && (
                    <div>
                      <SectionHeader title="Live Clusters" />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {liveClusters.map(c => (
                          <LiveClusterCard
                            key={c.id}
                            title={c.title}
                            summary={c.summary}
                            count={c.count}
                            onTap={() => onOpenStory({ type: 'topic', id: c.id, title: c.title })}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Feeds & Packs */}
                  {showDiscoverSection('feeds-to-follow') && suggestedFeeds.length > 0 && (
                    <div>
                      <SectionHeader title="Feeds to Follow" />
                      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 4 }}>
                        {suggestedFeeds.map(gen => <FeedCard key={gen.uri} gen={gen} onFollow={handleFollowFeed} />)}
                      </div>
                    </div>
                  )}

                  {/* Sources & Domains */}
                  {showDiscoverSection('sources') && domains.length > 0 && (
                    <div>
                      <SectionHeader title="Sources" />
                      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 4 }}>
                        {domains.map((d) => (
                          <DomainCapsule
                            key={d.domain}
                            domain={d.domain}
                            description={d.description}
                            reason={d.reason}
                            evidenceCount={d.evidenceCount}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* People to follow */}
                  {!activeFilter && visibleSuggestedActors.length > 0 && (
                    <div>
                      <SectionHeader title="People to Follow" />
                      <div style={{ background: disc.surfaceCard, borderRadius: radius[24], padding: `0 ${space[8]}px`, border: `0.5px solid ${disc.lineSubtle}` }}>
                        {(visibleSuggestedActorRecommendations.length > 0
                          ? visibleSuggestedActorRecommendations
                          : visibleSuggestedActors.map((actor) => ({
                              actor,
                              score: 0,
                              confidence: 0.5,
                              reasons: [] as string[],
                              semanticMatch: false,
                              graphMatch: false,
                              serverMatch: true,
                            }))
                        )
                          .slice(0, 5)
                          .map((recommendation) => (
                            <ActorRow
                              key={recommendation.actor.did}
                              actor={recommendation.actor}
                              onFollow={followSuggestedActor}
                              recommendationReasons={recommendation.reasons}
                              recommendationConfidence={recommendation.confidence}
                              onDismiss={(did) => dismissSuggestedActor(did, recommendation.confidence)}
                            />
                          ))}
                      </div>
                    </div>
                  )}

                  <div style={{ height: 24 }} />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
