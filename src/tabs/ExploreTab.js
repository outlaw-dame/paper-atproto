import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { useSessionStore } from '../store/sessionStore.js';
import { atpCall, atpMutate } from '../lib/atproto/client.js';
import { mapFeedViewPost, hasDisplayableRecordContent } from '../atproto/mappers.js';
import { useUiStore } from '../store/uiStore.js';
import { useTranslationStore } from '../store/translationStore.js';
import { useActivityStore } from '../store/activityStore.js';
import { translationClient } from '../lib/i18n/client.js';
import { heuristicDetectLanguage } from '../lib/i18n/detect.js';
import { hasMeaningfulTranslation, isLikelySameLanguage } from '../lib/i18n/normalize.js';
import { usePostFilterResults } from '../lib/contentFilters/usePostFilterResults.js';
import { warnMatchReasons } from '../lib/contentFilters/presentation.js';
import { feedService } from '../feeds.js';
import { hybridSearch } from '../search.js';
import { searchPodcastIndex } from '../lib/podcastIndexClient.js';
import { usePlatform, getButtonTokens, getIconBtnTokens } from '../hooks/usePlatform.js';
import { useProfileNavigation } from '../hooks/useProfileNavigation.js';
import { searchHeroField as shfTokens, quickFilterChip as qfcTokens, featuredStoryCard as fscTokens, trendingTopicCard as ttcTokens, liveClusterCard as lccTokens, overviewCard, discovery as disc, accent, type as typeScale, radius, space, shadowDark, transitions, fadeVariants, slideUpVariants, } from '../design/index.js';
import LiveSportsMoments from '../components/LiveSportsMoments.js';
import { sportsStore } from '../sports/sportsStore.js';
import { sportsFeedService } from '../services/sportsFeed.js';
import { WriterEntitySheet, EntityChip } from '../components/EntitySheet.js';
function mapFeedRowToExploreFeedResult(row) {
    return {
        id: String(row.id),
        title: String(row.title || 'Untitled feed item'),
        ...(row.content ? { content: String(row.content) } : {}),
        link: String(row.link || ''),
        ...(row.pub_date ? { pubDate: String(row.pub_date) } : {}),
        ...(row.author ? { author: String(row.author) } : {}),
        ...(row.enclosure_type ? { enclosureType: String(row.enclosure_type) } : {}),
        ...(row.feed_title ? { feedTitle: String(row.feed_title) } : {}),
        ...(row.feed_category ? { feedCategory: String(row.feed_category) } : {}),
        ...(typeof row.rrf_score === 'number' ? { score: row.rrf_score } : {}),
        source: 'local',
    };
}
function mapPodcastFeedToExploreFeedResult(feed) {
    const categories = feed?.categories && typeof feed.categories === 'object'
        ? Object.values(feed.categories).filter((value) => typeof value === 'string')
        : [];
    return {
        id: `podcast-index:${String(feed?.id ?? feed?.url ?? Math.random())}`,
        title: String(feed?.title || 'Untitled podcast'),
        ...(feed?.description ? { content: String(feed.description) } : {}),
        link: String(feed?.url || ''),
        ...(feed?.author ? { author: String(feed.author) } : {}),
        enclosureType: 'audio/mpeg',
        feedTitle: String(feed?.title || 'Podcast'),
        ...(categories.length > 0 ? { feedCategory: String(categories[0]) } : { feedCategory: 'Podcast' }),
        source: 'podcast-index',
    };
}
// ─── Discovery phrases ────────────────────────────────────────────────────
const DISCOVERY_PHRASES = [
    "What's happening",
    "Explore the conversation",
    "Find what matters",
];
const DISCOVER_FEED_URI = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';
// "Quiet Posters" by @why.bsky.team — posts from your quieter followers
const QUIET_FEED_URI = 'at://did:plc:vpkhqolt662uhesyj6nxm7ys/app.bsky.feed.generator/infreq';
/**
 * Score a post by engagement metrics for ranking in top stories.
 * Weights: likes (1x) + reposts (2x) + replies (1.5x) + quotes (1.5x).
 */
function scorePostEngagement(post) {
    const quoteCount = (post.embed?.type === 'quote' ? 1 : 0);
    return post.likeCount + post.repostCount * 2 + post.replyCount * 1.5 + quoteCount * 1.5;
}
const QUICK_FILTERS = ['Live', 'Topics', 'Conversations', 'Feeds', 'Sources'];
const QUICK_FILTER_SECTION_MAP = {
    Live: ['live-sports', 'sports-pulse', 'live-clusters'],
    Topics: ['top-stories', 'trending-topics'],
    Conversations: ['top-stories', 'live-clusters'],
    Feeds: ['feed-items', 'feeds-to-follow'],
    Sources: ['sources', 'top-stories'],
};
function canAutoInlineTranslateExplore(post) {
    const textLength = post.content.trim().length;
    if (textLength === 0 || textLength > 280)
        return false;
    return true;
}
function getAuthorInitial(displayName, handle) {
    return ((displayName ?? handle ?? '').trim().charAt(0) || '?').toUpperCase();
}
function getPrimaryPostText(post) {
    const articleBody = post.article?.body?.trim();
    if (articleBody)
        return articleBody;
    return post.content.trim();
}
// ─── Shared sub-components ────────────────────────────────────────────────
function DiscoverySpinner() {
    return (_jsx("div", { style: { display: 'flex', justifyContent: 'center', padding: '32px 0' }, children: _jsx("svg", { width: "24", height: "24", viewBox: "0 0 24 24", fill: "none", stroke: disc.textTertiary, strokeWidth: 2, strokeLinecap: "round", children: _jsx("path", { d: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83", children: _jsx("animateTransform", { attributeName: "transform", type: "rotate", from: "0 12 12", to: "360 12 12", dur: "0.8s", repeatCount: "indefinite" }) }) }) }));
}
function SynopsisChip({ label }) {
    return (_jsxs("span", { style: {
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: radius.full,
            background: overviewCard.synopsisChip.bg,
            border: `0.5px solid ${overviewCard.synopsisChip.border}`,
            color: overviewCard.synopsisChip.text,
            fontSize: typeScale.metaLg[0], lineHeight: `${typeScale.metaLg[1]}px`,
            fontWeight: typeScale.metaLg[2], letterSpacing: typeScale.metaLg[3],
        }, children: [_jsx("span", { style: { width: 5, height: 5, borderRadius: '50%', background: '#7CE9FF', flexShrink: 0 } }), label] }));
}
// ─── RichPostText — inline #hashtag linkification ────────────────────────
function RichPostText({ text, onHashtag, onMention, style }) {
    const parts = text.split(/(@[\w.]+|#\w+)/g);
    return (_jsx("span", { style: style, children: parts.map((part, i) => part.startsWith('@') ? (_jsx("button", { className: "interactive-link-button", onClick: e => { e.stopPropagation(); onMention?.(part.slice(1)); }, style: { color: accent.cyan400, font: 'inherit', fontWeight: 700, background: 'none', border: 'none', cursor: onMention ? 'pointer' : 'default', padding: 0 }, children: part }, i)) : part.startsWith('#') ? (_jsx("button", { className: "interactive-link-button", onClick: e => { e.stopPropagation(); onHashtag?.(part.slice(1)); }, style: { color: accent.cyan400, font: 'inherit', fontWeight: 700, background: 'none', border: 'none', cursor: onHashtag ? 'pointer' : 'default', padding: 0 }, children: part }, i)) : part) }));
}
// ─── Entity extraction from post content ─────────────────────────────────
// Derives lightweight WriterEntity objects from hashtags and @mentions.
// Used until the full AI pipeline provides entities for Explore cards.
function extractPostEntities(content) {
    const seen = new Set();
    const entities = [];
    // Hashtags → topic entities
    for (const match of content.matchAll(/#(\w+)/g)) {
        const label = match[1];
        if (!label || label.length < 2 || seen.has(label.toLowerCase()))
            continue;
        seen.add(label.toLowerCase());
        entities.push({ id: `tag-${label.toLowerCase()}`, label: `#${label}`, type: 'topic', confidence: 0.70, impact: 0.40 });
        if (entities.length >= 4)
            break;
    }
    // @mentions → person entities (only if space for more)
    if (entities.length < 4) {
        for (const match of content.matchAll(/@([\w.]+)/g)) {
            const handle = match[1];
            if (!handle || handle.length < 2 || seen.has(handle.toLowerCase()))
                continue;
            seen.add(handle.toLowerCase());
            entities.push({ id: `person-${handle.toLowerCase()}`, label: `@${handle}`, type: 'person', confidence: 0.65, impact: 0.35 });
            if (entities.length >= 4)
                break;
        }
    }
    return entities;
}
// ─── FeaturedSearchStoryCard — Gist-inspired flush link story card ────────
function FeaturedSearchStoryCard({ post, onTap, onHashtag, onEntityTap, translation, showOriginal, translating, translationError, autoTranslated, translatedDisplayName, onToggleTranslate, onClearTranslation, }) {
    const navigateToProfile = useProfileNavigation();
    const targetLanguage = useTranslationStore((state) => state.policy.userLanguage);
    const embed = post.embed?.type === 'external' ? post.embed : null;
    const img = post.article?.banner ?? post.media?.[0]?.url ?? embed?.thumb;
    const domain = embed?.domain ?? (post.article ? 'Long-form' : '');
    const detectedLanguage = heuristicDetectLanguage(post.content);
    const hasRenderableTranslation = !!translation && hasMeaningfulTranslation(post.content, translation.translatedText);
    const shouldOfferTranslation = hasRenderableTranslation
        || detectedLanguage.language === 'und'
        || !isLikelySameLanguage(detectedLanguage.language, targetLanguage);
    const bodyText = post.article?.body
        ? post.article.body
        : (hasRenderableTranslation && !showOriginal ? translation.translatedText : post.content);
    const hashtags = Array.from(new Set((bodyText.match(/#\w+/g) ?? []))).slice(0, 5);
    // Entity chips: prefer AI-extracted, fall back to content-derived
    const entityChips = extractPostEntities(bodyText).filter(e => e.type !== 'topic' || !hashtags.includes(e.label));
    return (_jsxs(motion.div, { whileTap: { scale: 0.985 }, onClick: onTap, style: {
            borderRadius: fscTokens.radius,
            overflow: 'hidden',
            background: fscTokens.bg,
            boxShadow: fscTokens.shadow,
            cursor: 'pointer',
            border: `0.5px solid ${disc.lineSubtle}`,
        }, children: [_jsxs("div", { style: { position: 'relative', height: 210, background: disc.surfaceFocus, overflow: 'hidden' }, children: [img ? (_jsx("img", { src: img, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } })) : (_jsx("div", { style: {
                            width: '100%', height: '100%',
                            background: `radial-gradient(ellipse at 20% 60%, rgba(91,124,255,0.35) 0%, transparent 55%),
                         radial-gradient(ellipse at 78% 20%, rgba(124,233,255,0.15) 0%, transparent 50%),
                         ${disc.surfaceCard}`,
                        } })), _jsx("div", { style: {
                            position: 'absolute', inset: 0,
                            background: `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.05) 45%, ${fscTokens.bg} 100%)`,
                        } }), domain && (_jsxs("div", { style: {
                            position: 'absolute', bottom: 14, left: 14,
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            background: 'rgba(7,11,18,0.76)',
                            backdropFilter: 'blur(14px)',
                            WebkitBackdropFilter: 'blur(14px)',
                            border: '0.5px solid rgba(255,255,255,0.09)',
                            borderRadius: radius.full,
                            padding: '4px 10px 4px 7px',
                        }, children: [_jsx("div", { style: { width: 14, height: 14, borderRadius: 4, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsxs("svg", { width: "9", height: "9", viewBox: "0 0 24 24", fill: "none", stroke: "rgba(255,255,255,0.55)", strokeWidth: 2.5, strokeLinecap: "round", children: [_jsx("circle", { cx: "12", cy: "12", r: "10" }), _jsx("line", { x1: "2", y1: "12", x2: "22", y2: "12" }), _jsx("path", { d: "M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" })] }) }), _jsx("span", { style: { fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.75)', letterSpacing: '0.01em' }, children: domain })] })), _jsxs("div", { style: {
                            position: 'absolute', top: 12, right: 12,
                            background: 'rgba(7,11,18,0.6)',
                            backdropFilter: 'blur(10px)',
                            WebkitBackdropFilter: 'blur(10px)',
                            border: '0.5px solid rgba(255,255,255,0.09)',
                            borderRadius: radius.full,
                            padding: '4px 9px',
                            display: 'flex', alignItems: 'center', gap: 4,
                        }, children: [_jsxs("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: accent.cyan400, strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" }), _jsx("polyline", { points: "15 3 21 3 21 9" }), _jsx("line", { x1: "10", y1: "14", x2: "21", y2: "3" })] }), _jsx("span", { style: { fontSize: 11, fontWeight: 600, color: accent.cyan400 }, children: "Open" })] })] }), _jsxs("div", { style: { padding: `14px ${space[10]}px ${space[10]}px` }, children: [hashtags.length > 0 && (_jsx("div", { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }, children: hashtags.map(tag => (_jsx("button", { onClick: e => { e.stopPropagation(); onHashtag?.(tag.slice(1)); }, style: {
                                display: 'inline-flex', alignItems: 'center',
                                padding: '3px 9px', borderRadius: radius.full,
                                background: 'rgba(91,124,255,0.13)',
                                border: '0.5px solid rgba(91,124,255,0.3)',
                                color: accent.primary,
                                fontSize: 12, fontWeight: 600, letterSpacing: '0.01em',
                                cursor: 'pointer',
                            }, children: tag }, tag))) })), onEntityTap && entityChips.length > 0 && (_jsx("div", { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }, children: entityChips.map(e => (_jsx(EntityChip, { entity: e, onTap: onEntityTap, size: "sm" }, e.id))) })), _jsx("p", { style: {
                            fontSize: typeScale.titleSm[0], lineHeight: `${typeScale.titleSm[1]}px`,
                            fontWeight: 600, letterSpacing: typeScale.titleSm[3],
                            color: disc.textPrimary, marginBottom: 8,
                            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }, children: _jsx(RichPostText, { text: bodyText, ...(onHashtag ? { onHashtag } : {}), onMention: (handle) => { void navigateToProfile(handle); } }) }), (post.article?.title || embed?.title) && (post.article?.title ?? embed?.title ?? '').trim() !== bodyText.trim() && (_jsx("p", { style: {
                            fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
                            color: disc.textSecondary, marginBottom: 8,
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }, children: post.article?.title ?? embed?.title })), post.content.trim().length > 0 && shouldOfferTranslation && (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: translation && !showOriginal ? 10 : 6 }, children: [_jsx("button", { onClick: onToggleTranslate, disabled: translating, style: {
                                    border: 'none',
                                    background: 'transparent',
                                    color: accent.primary,
                                    fontSize: 12,
                                    fontWeight: 700,
                                    padding: 0,
                                    cursor: translating ? 'default' : 'pointer',
                                    opacity: translating ? 0.65 : 1,
                                }, children: hasRenderableTranslation
                                    ? (showOriginal ? 'Show translation' : 'Show original')
                                    : (translating
                                        ? 'Translating...'
                                        : 'Translate') }), translationError && !hasRenderableTranslation && (_jsx("span", { style: { fontSize: 11, color: '#ff6b6b', fontWeight: 600 }, children: "No translation available" }))] })), hasRenderableTranslation && !showOriginal && (_jsx("div", { style: {
                            marginBottom: 8,
                            border: `0.5px solid ${disc.lineSubtle}`,
                            borderRadius: radius[10],
                            background: 'rgba(91,124,255,0.08)',
                            overflow: 'hidden',
                        }, children: _jsxs("div", { style: {
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 8,
                                padding: '7px 9px',
                                borderBottom: `0.5px solid ${disc.lineSubtle}`,
                            }, children: [_jsx("span", { style: { fontSize: 11, color: disc.textSecondary, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, children: autoTranslated
                                        ? `Auto-translated from ${translation.sourceLang}`
                                        : `Translated from ${translation.sourceLang}` }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }, children: [_jsx("button", { onClick: onToggleTranslate, style: { border: 'none', background: 'transparent', color: accent.primary, fontSize: 11, fontWeight: 700, padding: 0, cursor: 'pointer' }, children: "Show original" }), _jsx("button", { onClick: onClearTranslation, style: { border: 'none', background: 'transparent', color: disc.textTertiary, fontSize: 11, fontWeight: 600, padding: 0, cursor: 'pointer' }, children: "Clear" })] })] }) })), (embed?.authorName || embed?.publisher) && (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }, children: [_jsx("span", { style: {
                                    display: 'inline-flex', alignItems: 'center',
                                    padding: '2px 8px', borderRadius: radius.full,
                                    background: 'rgba(124,233,255,0.10)',
                                    border: `0.5px solid rgba(124,233,255,0.22)`,
                                    fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: accent.cyan400,
                                    textTransform: 'uppercase',
                                }, children: "Featured" }), embed?.authorName && (_jsxs("span", { style: { fontSize: 12, color: disc.textSecondary, fontWeight: 500 }, children: ["By ", _jsx("span", { style: { color: disc.textPrimary, fontWeight: 600 }, children: embed.authorName })] })), embed?.publisher && (_jsxs("span", { style: { fontSize: 12, color: disc.textTertiary }, children: ["\u00B7 ", embed.publisher] }))] })), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, borderTop: `0.5px solid ${disc.lineSubtle}`, marginTop: 12 }, children: [_jsx("div", { style: { width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceFocus, flexShrink: 0 }, children: post.author.avatar
                                    ? _jsx("img", { src: post.author.avatar, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } })
                                    : _jsx("div", { style: { width: '100%', height: '100%', background: accent.indigo600, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700 }, children: getAuthorInitial(post.author.displayName, post.author.handle) }) }), _jsx("button", { onClick: (e) => { e.stopPropagation(); void navigateToProfile(post.author.did || post.author.handle); }, style: { fontSize: 12, fontWeight: 500, color: disc.textSecondary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }, children: translatedDisplayName || post.author.displayName }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }, children: [_jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: disc.textTertiary }, children: [_jsx("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", children: _jsx("path", { d: "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" }) }), post.likeCount.toLocaleString()] }), _jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: disc.textTertiary }, children: [_jsx("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" }) }), post.replyCount.toLocaleString()] })] })] })] })] }));
}
// ─── LinkedPostMiniCard — horizontal strip of popular link posts ──────────
function LinkedPostMiniCard({ post, onTap, onHashtag, translation, showOriginal, translating, translationError, autoTranslated, onToggleTranslate, onClearTranslation, }) {
    const navigateToProfile = useProfileNavigation();
    const targetLanguage = useTranslationStore((state) => state.policy.userLanguage);
    const embed = post.embed?.type === 'external' ? post.embed : null;
    const img = post.article?.banner ?? post.media?.[0]?.url ?? embed?.thumb;
    const domain = embed?.domain ?? (post.article ? 'Long-form' : '');
    const detectedLanguage = heuristicDetectLanguage(post.content);
    const hasRenderableTranslation = !!translation && hasMeaningfulTranslation(post.content, translation.translatedText);
    const shouldOfferTranslation = hasRenderableTranslation
        || detectedLanguage.language === 'und'
        || !isLikelySameLanguage(detectedLanguage.language, targetLanguage);
    const bodyText = post.article?.body
        ? post.article.body
        : (hasRenderableTranslation && !showOriginal ? translation.translatedText : post.content);
    return (_jsxs(motion.div, { whileTap: { scale: 0.96 }, onClick: onTap, style: {
            flexShrink: 0, width: 182,
            borderRadius: radius[20],
            overflow: 'hidden',
            background: disc.surfaceCard2,
            border: `0.5px solid ${disc.lineSubtle}`,
            cursor: 'pointer',
            display: 'flex', flexDirection: 'column',
        }, children: [_jsxs("div", { style: { height: 96, background: disc.surfaceFocus, position: 'relative', overflow: 'hidden', flexShrink: 0 }, children: [img ? (_jsx("img", { src: img, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } })) : (_jsx("div", { style: { width: '100%', height: '100%', background: `radial-gradient(circle at 50% 60%, rgba(91,124,255,0.22), ${disc.surfaceCard2})` } })), _jsx("div", { style: {
                            position: 'absolute', inset: 0,
                            background: `linear-gradient(to bottom, rgba(0,0,0,0) 30%, ${disc.surfaceCard2} 100%)`,
                        } })] }), _jsxs("div", { style: { padding: '8px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }, children: [_jsx("p", { style: {
                            fontSize: 13, fontWeight: 600, lineHeight: '18px', color: disc.textPrimary,
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }, children: _jsx(RichPostText, { text: bodyText, ...(onHashtag ? { onHashtag } : {}), onMention: (handle) => { void navigateToProfile(handle); } }) }), post.content.trim().length > 0 && shouldOfferTranslation && (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("button", { onClick: onToggleTranslate, disabled: translating, style: {
                                    border: 'none',
                                    background: 'transparent',
                                    color: accent.primary,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: 0,
                                    cursor: translating ? 'default' : 'pointer',
                                    opacity: translating ? 0.65 : 1,
                                }, children: hasRenderableTranslation
                                    ? (showOriginal ? 'Show translation' : 'Show original')
                                    : (translating
                                        ? 'Translating...'
                                        : 'Translate') }), translationError && !hasRenderableTranslation && (_jsx("span", { style: { fontSize: 10, color: '#ff6b6b', fontWeight: 600 }, children: "No translation available" }))] })), hasRenderableTranslation && !showOriginal && (_jsxs("div", { style: {
                            border: `0.5px solid ${disc.lineSubtle}`,
                            borderRadius: radius[10],
                            background: 'rgba(91,124,255,0.08)',
                            padding: '7px 9px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                        }, children: [_jsx("span", { style: { fontSize: 11, color: disc.textSecondary, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, children: autoTranslated ? `Auto-translated from ${translation.sourceLang}` : `Translated from ${translation.sourceLang}` }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }, children: [_jsx("button", { onClick: onToggleTranslate, style: { border: 'none', background: 'transparent', color: accent.primary, fontSize: 11, fontWeight: 700, padding: 0, cursor: 'pointer' }, children: "Show original" }), _jsx("button", { onClick: onClearTranslation, style: { border: 'none', background: 'transparent', color: disc.textTertiary, fontSize: 11, fontWeight: 600, padding: 0, cursor: 'pointer' }, children: "Clear" })] })] })), domain && (_jsx("span", { style: {
                            fontSize: 11, color: disc.textTertiary, fontWeight: 500,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }, children: domain })), (embed?.authorName || embed?.publisher) && (_jsxs("span", { style: {
                            fontSize: 11, color: disc.textSecondary, fontWeight: 500,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }, children: [embed?.authorName ? `By ${embed.authorName}` : embed?.publisher, embed?.authorName && embed?.publisher ? ` · ${embed.publisher}` : ''] })), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }, children: [_jsxs("button", { onClick: (e) => { e.stopPropagation(); void navigateToProfile(post.author.did || post.author.handle); }, style: { border: 'none', background: 'none', padding: 0, fontSize: 11, color: disc.textSecondary, fontWeight: 600, cursor: 'pointer', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: ["@", post.author.handle] }), _jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: disc.textTertiary }, children: [_jsx("svg", { width: "10", height: "10", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", children: _jsx("path", { d: "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" }) }), post.likeCount.toLocaleString()] })] })] })] }));
}
// ─── TrendingTopicCard ────────────────────────────────────────────────────
function TrendingTopicCard({ topic, signal, onTap }) {
    return (_jsxs(motion.div, { whileTap: { scale: 0.96 }, onClick: onTap, style: {
            flexShrink: 0,
            width: ttcTokens.width, height: ttcTokens.height,
            borderRadius: ttcTokens.radius,
            background: ttcTokens.bg,
            padding: `${ttcTokens.padding}px`,
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            cursor: 'pointer',
            border: `0.5px solid ${disc.lineSubtle}`,
        }, children: [_jsx("p", { style: {
                    fontSize: typeScale.chip[0], lineHeight: `${typeScale.chip[1]}px`,
                    fontWeight: typeScale.chip[2],
                    color: disc.textPrimary,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }, children: topic }), _jsx("span", { style: {
                    fontSize: typeScale.metaSm[0], lineHeight: `${typeScale.metaSm[1]}px`,
                    fontWeight: typeScale.metaSm[2], letterSpacing: typeScale.metaSm[3],
                    color: accent.cyan400,
                }, children: signal })] }));
}
// ─── LiveClusterCard ──────────────────────────────────────────────────────
function LiveClusterCard({ title, summary, count, onTap }) {
    return (_jsxs(motion.div, { whileTap: { scale: 0.985 }, onClick: onTap, style: {
            borderRadius: lccTokens.radius,
            background: lccTokens.bg,
            padding: `${lccTokens.padding}px`,
            boxShadow: lccTokens.shadow,
            border: `0.5px solid ${disc.lineSubtle}`,
            cursor: 'pointer',
            display: 'flex', flexDirection: 'column', gap: 6,
        }, children: [_jsx("p", { style: {
                    fontSize: typeScale.titleSm[0], lineHeight: `${typeScale.titleSm[1]}px`,
                    fontWeight: typeScale.titleSm[2], letterSpacing: typeScale.titleSm[3],
                    color: disc.textPrimary,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }, children: title }), _jsx("p", { style: {
                    fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
                    fontWeight: typeScale.bodySm[2],
                    color: disc.textSecondary,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }, children: summary }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsxs("span", { style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary, fontWeight: 500 }, children: [count, " active threads"] }), _jsx("div", { style: { flex: 1 } }), _jsx("span", { style: {
                            padding: '3px 10px', borderRadius: radius.full,
                            background: 'rgba(91,124,255,0.15)', color: accent.primary,
                            fontSize: typeScale.metaSm[0], fontWeight: 600,
                        }, children: "Open Story \u2192" })] })] }));
}
// ─── FeedCard ─────────────────────────────────────────────────────────────
function FeedCard({ gen, onFollow }) {
    const [following, setFollowing] = useState(gen.viewer?.like !== undefined);
    const navigateToProfile = useProfileNavigation();
    return (_jsxs(motion.div, { whileTap: { scale: 0.97 }, style: {
            flexShrink: 0, width: 180,
            background: disc.surfaceCard2, borderRadius: radius[24],
            padding: `${space[8]}px ${space[8]}px ${space[6]}px`,
            display: 'flex', flexDirection: 'column', gap: 8,
            border: `0.5px solid ${disc.lineSubtle}`,
            cursor: 'pointer',
        }, children: [_jsx("div", { style: { width: 40, height: 40, borderRadius: 12, overflow: 'hidden', background: disc.surfaceFocus, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: gen.avatar
                    ? _jsx("img", { src: gen.avatar, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } })
                    : _jsx("span", { style: { fontSize: 20 }, children: "\u26A1" }) }), _jsxs("div", { children: [_jsx("p", { style: { fontSize: typeScale.chip[0], fontWeight: 700, color: disc.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }, children: gen.displayName }), _jsxs("button", { className: "interactive-link-button", onClick: (e) => { e.stopPropagation(); void navigateToProfile(gen.creator.did || gen.creator.handle); }, style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }, children: ["by @", gen.creator.handle.replace('.bsky.social', '')] })] }), _jsx("button", { onClick: e => { e.stopPropagation(); setFollowing(v => !v); onFollow(gen.uri); }, style: {
                    padding: '5px 0', borderRadius: radius[8], marginTop: 'auto',
                    background: following ? disc.surfaceFocus : accent.primary,
                    color: following ? disc.textSecondary : '#fff',
                    fontSize: typeScale.metaLg[0], fontWeight: 600,
                    border: 'none', cursor: 'pointer',
                }, children: following ? 'Following' : 'Follow' })] }));
}
// ─── DomainCapsule ────────────────────────────────────────────────────────
function DomainCapsule({ domain, description }) {
    return (_jsxs(motion.div, { whileTap: { scale: 0.97 }, style: {
            flexShrink: 0, width: 160, height: 72,
            background: disc.surfaceCard2, borderRadius: radius[20],
            padding: `${space[6]}px ${space[8]}px`,
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            border: `0.5px solid ${disc.lineSubtle}`,
            cursor: 'pointer',
        }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [_jsx("div", { style: { width: 18, height: 18, borderRadius: 5, background: disc.surfaceFocus, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: _jsxs("svg", { width: "10", height: "10", viewBox: "0 0 24 24", fill: "none", stroke: disc.textTertiary, strokeWidth: 2, strokeLinecap: "round", children: [_jsx("circle", { cx: "12", cy: "12", r: "10" }), _jsx("line", { x1: "2", y1: "12", x2: "22", y2: "12" })] }) }), _jsx("span", { style: { fontSize: typeScale.chip[0], fontWeight: 600, color: disc.textPrimary }, children: domain })] }), _jsx("p", { style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: description })] }));
}
// ─── Section header ───────────────────────────────────────────────────────
function SectionHeader({ title }) {
    return (_jsx("p", { style: {
            fontSize: typeScale.metaLg[0], lineHeight: `${typeScale.metaLg[1]}px`,
            fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: disc.textTertiary,
            marginBottom: space[4],
        }, children: title }));
}
// ─── ActorRow (search results) ────────────────────────────────────────────
function ActorRow({ actor, onFollow }) {
    const [following, setFollowing] = useState(actor.viewer?.following !== undefined);
    const navigateToProfile = useProfileNavigation();
    return (_jsxs("div", { style: {
            display: 'flex', alignItems: 'center', gap: 12,
            padding: `${space[6]}px 0`,
            borderBottom: `0.5px solid ${disc.lineSubtle}`,
        }, children: [_jsx("div", { style: { width: 42, height: 42, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceFocus, flexShrink: 0 }, children: actor.avatar
                    ? _jsx("img", { src: actor.avatar, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } })
                    : _jsx("div", { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: accent.indigo600, color: '#fff', fontSize: 16, fontWeight: 700 }, children: (actor.displayName ?? actor.handle)[0] }) }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsx("button", { className: "interactive-link-button", onClick: () => { void navigateToProfile(actor.did || actor.handle); }, style: { fontSize: typeScale.chip[0], fontWeight: 700, color: disc.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', maxWidth: '100%' }, children: actor.displayName ?? actor.handle }), _jsxs("button", { className: "interactive-link-button", onClick: () => { void navigateToProfile(actor.did || actor.handle); }, style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }, children: ["@", actor.handle] })] }), _jsx("button", { onClick: () => { setFollowing(v => !v); onFollow(actor.did); }, style: {
                    padding: '6px 14px', borderRadius: radius.full, flexShrink: 0,
                    background: following ? disc.surfaceFocus : accent.primary,
                    color: following ? disc.textSecondary : '#fff',
                    fontSize: typeScale.metaLg[0], fontWeight: 600,
                    border: 'none', cursor: 'pointer',
                }, children: following ? 'Following' : 'Follow' })] }));
}
// ─── Main component ────────────────────────────────────────────────────────
export default function ExploreTab({ onOpenStory }) {
    const { agent, session, sessionReady } = useSessionStore();
    const exploreSearchQuery = useUiStore((state) => state.exploreSearchQuery);
    const clearExploreSearch = useUiStore((state) => state.clearExploreSearch);
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
    const [activeFilter, setActiveFilter] = useState(null);
    const [searchPosts, setSearchPosts] = useState([]);
    const [searchFeedItems, setSearchFeedItems] = useState([]);
    const [recentFeedItems, setRecentFeedItems] = useState([]);
    const [searchActors, setSearchActors] = useState([]);
    const [addingPodcastFeedByUrl, setAddingPodcastFeedByUrl] = useState({});
    const [podcastFeedAddStatus, setPodcastFeedAddStatus] = useState(null);
    const [suggestedFeeds, setSuggestedFeeds] = useState([]);
    const [suggestedActors, setSuggestedActors] = useState([]);
    const [featuredPost, setFeaturedPost] = useState(null);
    const [linkPosts, setLinkPosts] = useState([]);
    const [trendingPosts, setTrendingPosts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [discoverLoading, setDiscoverLoading] = useState(true);
    const [focused, setFocused] = useState(false);
    const [featuredIdx, setFeaturedIdx] = useState(0);
    const [sidePosts, setSidePosts] = useState([]);
    const [showOriginalById, setShowOriginalById] = useState({});
    const [translatingById, setTranslatingById] = useState({});
    const [translationErrorById, setTranslationErrorById] = useState({});
    const [revealedFilteredPosts, setRevealedFilteredPosts] = useState({});
    const autoTranslatedIdsRef = useRef(new Set());
    const autoAttemptedIdsRef = useRef(new Set());
    const carouselIntervalRef = useRef(null);
    const inputRef = useRef(null);
    const phraseIdx = useRef(Math.floor(Math.random() * DISCOVERY_PHRASES.length));
    // Entity sheet state — Narwhal v3 Phase C
    const [activeEntity, setActiveEntity] = useState(null);
    const exploreVisiblePool = useMemo(() => {
        const merged = [
            ...(featuredPost ? [featuredPost] : []),
            ...linkPosts,
            ...sidePosts,
            ...searchPosts,
            ...trendingPosts,
        ];
        const byId = new Map();
        for (const post of merged)
            byId.set(post.id, post);
        return [...byId.values()];
    }, [featuredPost, linkPosts, sidePosts, searchPosts, trendingPosts]);
    const filterResults = usePostFilterResults(exploreVisiblePool, 'explore');
    const filteredLinkPosts = useMemo(() => linkPosts.filter((post) => !(filterResults[post.id] ?? []).some((m) => m.action === 'hide')), [filterResults, linkPosts]);
    const filteredSidePosts = useMemo(() => sidePosts.filter((post) => !(filterResults[post.id] ?? []).some((m) => m.action === 'hide')), [filterResults, sidePosts]);
    const visibleDiscoverSections = useMemo(() => (activeFilter ? new Set(QUICK_FILTER_SECTION_MAP[activeFilter]) : null), [activeFilter]);
    const showDiscoverSection = useCallback((section) => visibleDiscoverSections == null || visibleDiscoverSections.has(section), [visibleDiscoverSections]);
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
        if (!exploreSearchQuery)
            return;
        const trimmed = exploreSearchQuery.trim();
        if (!trimmed) {
            clearExploreSearch();
            return;
        }
        const normalized = trimmed.replace(/^#/, '');
        const nextQuery = normalized ? `#${normalized}` : trimmed;
        setQuery(nextQuery);
        setDebouncedQuery(nextQuery);
        clearExploreSearch();
    }, [clearExploreSearch, exploreSearchQuery]);
    // Live search
    useEffect(() => {
        if (!debouncedQuery.trim()) {
            setSearchPosts([]);
            setSearchFeedItems([]);
            setSearchActors([]);
            return;
        }
        if (!sessionReady)
            return;
        setLoading(true);
        Promise.all([
            atpCall(() => agent.app.bsky.feed.searchPosts({ q: debouncedQuery, limit: 20 })).catch(() => null),
            atpCall(() => agent.searchActors({ term: debouncedQuery, limit: 8 })).catch(() => null),
            hybridSearch.searchFeedItems(debouncedQuery, 12).catch(() => null),
            searchPodcastIndex(debouncedQuery, 8).catch(() => []),
        ]).then(([postsRes, actorsRes, feedRes, podcastIndexFeeds]) => {
            if (postsRes?.data?.posts) {
                setSearchPosts(postsRes.data.posts
                    .filter((p) => hasDisplayableRecordContent(p?.record))
                    .map((p) => mapFeedViewPost({ post: p, reply: undefined, reason: undefined })));
            }
            if (actorsRes?.data?.actors)
                setSearchActors(actorsRes.data.actors);
            const localResults = feedRes?.rows
                ? feedRes.rows.map(mapFeedRowToExploreFeedResult)
                : [];
            const podcastResults = Array.isArray(podcastIndexFeeds)
                ? podcastIndexFeeds.map(mapPodcastFeedToExploreFeedResult)
                : [];
            const seenLinks = new Set();
            const merged = [...localResults, ...podcastResults].filter((item) => {
                const key = item.link.trim().toLowerCase();
                if (!key)
                    return false;
                if (seenLinks.has(key))
                    return false;
                seenLinks.add(key);
                return true;
            });
            setSearchFeedItems(merged);
        }).finally(() => setLoading(false));
    }, [debouncedQuery, agent, session, sessionReady]);
    // Discover content: whats-hot + trending feeds + quiet posters
    useEffect(() => {
        if (!sessionReady)
            return;
        setDiscoverLoading(true);
        const catchWithLog = (label) => (err) => {
            const e = err;
            console.warn(`[Explore] ${label} failed — status: ${e?.status ?? '?'}, error: ${e?.error ?? e?.message ?? String(err)}`, err);
            return null;
        };
        Promise.all([
            atpCall(() => agent.app.bsky.feed.getSuggestedFeeds({ limit: 10 })).catch(catchWithLog('getSuggestedFeeds')),
            (session?.did
                ? atpCall(() => agent.getSuggestions({ limit: 10, relativeToDid: session.did }))
                : Promise.resolve(null)).catch(catchWithLog('getSuggestions')),
            // Whats-hot feed
            atpCall(() => agent.app.bsky.feed.getFeed({ feed: DISCOVER_FEED_URI, limit: 50 })).catch(catchWithLog('getFeed:whats-hot')),
            // Trending topics → posts matching trending tags
            atpCall(() => agent.app.bsky.unspecced.getTrendingTopics({ limit: 5 })).catch(catchWithLog('getTrendingTopics')),
            // Quiet posters feed
            atpCall(() => agent.app.bsky.feed.getFeed({ feed: QUIET_FEED_URI, limit: 20 })).catch(catchWithLog('getFeed:quiet-posters')),
        ]).then(async ([feedsRes, actorsRes, whatsHotRes, trendingTopicsRes, quietRes]) => {
            if (feedsRes?.data?.feeds)
                setSuggestedFeeds(feedsRes.data.feeds);
            if (actorsRes?.data?.actors)
                setSuggestedActors(actorsRes.data.actors);
            // Collect posts from whats-hot
            const whatsHotPosts = whatsHotRes?.data?.feed?.length
                ? whatsHotRes.data.feed
                    .filter((item) => hasDisplayableRecordContent(item.post?.record))
                    .map((item) => mapFeedViewPost(item))
                : [];
            // Collect posts from trending topics (fetch top post per trending topic)
            let trendingPosts = [];
            if (trendingTopicsRes?.data?.topics?.length) {
                const topicLabels = trendingTopicsRes.data.topics.slice(0, 3).map((t) => t.topic || t.tag);
                const trendingSearchResults = await Promise.all(topicLabels.map((topic) => atpCall(() => agent.app.bsky.feed.searchPosts({ q: topic, limit: 8 })).catch(() => null)));
                trendingPosts = trendingSearchResults
                    .filter(r => r?.data?.posts?.length)
                    .flatMap((r) => r.data.posts.filter((p) => hasDisplayableRecordContent(p?.record)).slice(0, 2))
                    .map((p) => mapFeedViewPost({ post: p, reply: undefined, reason: undefined }));
            }
            // Combine whats-hot and trending, dedupe by post URI
            const allPosts = [...whatsHotPosts, ...trendingPosts];
            const byUri = new Map();
            for (const post of allPosts)
                byUri.set(post.id, post);
            const combined = [...byUri.values()];
            // Sort combined by engagement score
            const byEngagement = [...combined].sort((a, b) => scorePostEngagement(b) - scorePostEngagement(a));
            // ─── Top tier: posts with external links (high engagement) ──────────
            const featuredCandidates = byEngagement
                .filter(p => p.embed?.type === 'external' || !!p.article)
                .slice(0, 6);
            setLinkPosts(featuredCandidates);
            setFeaturedPost(featuredCandidates[0] ?? byEngagement[0] ?? null);
            setTrendingPosts(byEngagement.slice(0, 10));
            // ─── Side-strip formula ──────────────────────────────────────────
            const topIds = new Set(featuredCandidates.map(p => p.id));
            // Mid-tier: high-engagement posts (not already in top links)
            const midTier = byEngagement
                .filter(p => !topIds.has(p.id))
                .slice(0, 6);
            // Link posts from outside top 6: secondary batch of external-link posts
            const secondaryLinks = byEngagement
                .filter(p => (p.embed?.type === 'external' || !!p.article) && !topIds.has(p.id))
                .sort((a, b) => scorePostEngagement(b) - scorePostEngagement(a))
                .slice(0, 4);
            // Quiet posters: from dedicated feed, text length > 40 chars
            const quietMapped = quietRes?.data?.feed?.length
                ? quietRes.data.feed
                    .filter((item) => hasDisplayableRecordContent(item.post?.record))
                    .map((item) => mapFeedViewPost(item))
                    .filter((post) => getPrimaryPostText(post).length > 40)
                    .slice(0, 3)
                : [];
            // Underdogs: low-engagement posts with potential
            const underdogs = byEngagement
                .filter(p => !topIds.has(p.id) && scorePostEngagement(p) > 5)
                .sort((a, b) => scorePostEngagement(a) - scorePostEngagement(b))
                .slice(0, 3);
            // Assemble side-strip:
            // ~70% from secondary links + mid-tier (quality content with links)
            // ~5% from quiet posters (underrated creators)
            // ~25% from underdogs (good engagement, emerging stories)
            const seen = new Set(topIds);
            const combined2 = [];
            // Add secondary links and mid-tier (~70%)
            for (const p of [...secondaryLinks, ...midTier]) {
                if (!seen.has(p.id)) {
                    seen.add(p.id);
                    combined2.push(p);
                }
            }
            // Add quiet posters (~5%)
            for (const p of quietMapped) {
                if (!seen.has(p.id)) {
                    seen.add(p.id);
                    combined2.push(p);
                }
            }
            // Add underdogs (~25%)
            for (const p of underdogs) {
                if (!seen.has(p.id)) {
                    seen.add(p.id);
                    combined2.push(p);
                }
            }
            setSidePosts(combined2.slice(0, 10));
        }).finally(() => setDiscoverLoading(false));
    }, [agent, session, sessionReady]);
    // Reset carousel index when link posts refresh
    useEffect(() => { setFeaturedIdx(0); }, [linkPosts]);
    // Auto-advance carousel — restarts on manual tap
    const restartCarousel = useCallback(() => {
        if (carouselIntervalRef.current)
            clearInterval(carouselIntervalRef.current);
        if (linkPosts.length <= 1)
            return;
        carouselIntervalRef.current = setInterval(() => {
            setFeaturedIdx(i => (i + 1) % linkPosts.length);
        }, 5000);
    }, [linkPosts.length]);
    useEffect(() => {
        restartCarousel();
        return () => { if (carouselIntervalRef.current)
            clearInterval(carouselIntervalRef.current); };
    }, [restartCarousel]);
    useEffect(() => {
        const enableMockSports = (import.meta.env?.VITE_ENABLE_MOCK_SPORTS === 'true');
        if (enableMockSports) {
            sportsStore.loadSampleGames();
            for (const game of sportsStore.getGames()) {
                sportsStore.startPolling(game.id, 'mock');
            }
        }
        else {
            const leagues = ['nba', 'nfl', 'mlb', 'nhl'];
            sportsStore.loadFromEspn([...leagues]).catch(() => {
                // Keep discovery usable even if sports API is temporarily unreachable.
            });
            sportsStore.startEspnAutoRefresh([...leagues], 45_000);
        }
        return () => {
            sportsStore.stopAllPolling();
            sportsStore.stopEspnAutoRefresh();
            if (enableMockSports)
                sportsStore.clear();
        };
    }, []);
    const handleAddPodcastFeed = useCallback(async (feedUrl) => {
        const normalized = feedUrl.trim();
        if (!normalized)
            return;
        setPodcastFeedAddStatus(null);
        setAddingPodcastFeedByUrl((prev) => ({ ...prev, [normalized]: true }));
        try {
            await feedService.addFeed(normalized, 'Podcasts');
            setPodcastFeedAddStatus('Podcast feed added.');
            addAppNotification({
                title: 'Podcast Added',
                message: `Subscribed to ${normalized}`,
                level: 'success',
            });
        }
        catch {
            setPodcastFeedAddStatus('Unable to add this podcast feed right now.');
            addAppNotification({
                title: 'Podcast Add Failed',
                message: `Could not subscribe to ${normalized}`,
                level: 'warning',
            });
        }
        finally {
            setAddingPodcastFeedByUrl((prev) => ({ ...prev, [normalized]: false }));
        }
    }, [addAppNotification]);
    useEffect(() => {
        let canceled = false;
        feedService.getRecentFeedItems(12)
            .then((rows) => {
            if (canceled)
                return;
            setRecentFeedItems(rows.map(mapFeedRowToExploreFeedResult));
        })
            .catch(() => {
            if (canceled)
                return;
            setRecentFeedItems([]);
        });
        return () => {
            canceled = true;
        };
    }, [sessionReady]);
    const handleFollow = useCallback(async (did) => {
        if (!session)
            return;
        await atpMutate(() => agent.follow(did));
    }, [agent, session]);
    const handleFollowFeed = useCallback(async (uri) => {
        // Feed like/follow via ATProto
    }, []);
    const isSearching = debouncedQuery.trim().length > 0;
    const trendingTopics = trendingPosts.flatMap(p => (getPrimaryPostText(p).match(/#\w+/g) ?? []).slice(0, 2)).filter((v, i, a) => a.indexOf(v) === i).slice(0, 8);
    // ─── Live clusters from suggestedActors (placeholder) ───────────────────
    const liveClusters = suggestedActors.slice(0, 3).map(a => ({
        title: a.displayName ?? a.handle,
        summary: a.description ?? 'Active discussion happening now',
        count: Math.floor(Math.random() * 40) + 5,
        id: a.did,
    }));
    // ─── Domains from trending posts ────────────────────────────────────────
    const domains = trendingPosts
        .filter(p => p.embed?.url)
        .map(p => {
        try {
            const h = new URL(p.embed.url).hostname.replace(/^www\./, '');
            return { domain: h, description: p.embed?.title ?? 'Source' };
        }
        catch {
            return null;
        }
    })
        .filter(Boolean)
        .filter((v, i, a) => a.findIndex(x => x?.domain === v?.domain) === i)
        .slice(0, 6);
    const hasVisibleDiscoverContent = useMemo(() => {
        if (visibleDiscoverSections == null)
            return true;
        return (visibleDiscoverSections.has('live-sports') ||
            (visibleDiscoverSections.has('sports-pulse') && sportsPulsePosts.length > 0) ||
            (visibleDiscoverSections.has('feed-items') && recentFeedItems.length > 0) ||
            (visibleDiscoverSections.has('top-stories') && filteredLinkPosts.length > 0) ||
            (visibleDiscoverSections.has('trending-topics') && trendingTopics.length > 0) ||
            (visibleDiscoverSections.has('live-clusters') && liveClusters.length > 0) ||
            (visibleDiscoverSections.has('feeds-to-follow') && suggestedFeeds.length > 0) ||
            (visibleDiscoverSections.has('sources') && domains.length > 0));
    }, [
        domains.length,
        filteredLinkPosts.length,
        liveClusters.length,
        recentFeedItems.length,
        sportsPulsePosts.length,
        suggestedFeeds.length,
        trendingTopics.length,
        visibleDiscoverSections,
    ]);
    const handleToggleTranslate = useCallback(async (event, post) => {
        event.stopPropagation();
        const detected = heuristicDetectLanguage(post.content);
        const hasRenderableTranslation = !!translationById[post.id] && hasMeaningfulTranslation(post.content, translationById[post.id].translatedText);
        if (hasRenderableTranslation) {
            setShowOriginalById((prev) => ({ ...prev, [post.id]: !prev[post.id] }));
            return;
        }
        if (!post.content.trim())
            return;
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
        }
        catch (err) {
            console.warn('[ExploreTab] translation failed', err);
            setTranslationErrorById((prev) => ({ ...prev, [post.id]: true }));
        }
        finally {
            setTranslatingById((prev) => ({ ...prev, [post.id]: false }));
        }
    }, [translationById, translationPolicy.localOnlyMode, translationPolicy.userLanguage, upsertTranslation]);
    const handleClearTranslation = useCallback((event, postId) => {
        event.stopPropagation();
        clearTranslation(postId);
        setShowOriginalById((prev) => ({ ...prev, [postId]: false }));
        setTranslationErrorById((prev) => ({ ...prev, [postId]: false }));
        autoTranslatedIdsRef.current.delete(postId);
    }, [clearTranslation]);
    useEffect(() => {
        if (!translationPolicy.autoTranslateExplore)
            return;
        if (!sessionReady)
            return;
        const visible = isSearching
            ? searchPosts.slice(0, 8)
            : [
                ...(featuredPost ? [featuredPost] : []),
                ...linkPosts.slice(0, 3),
                ...sidePosts.slice(0, 4),
            ];
        const unique = new Map();
        for (const post of visible)
            unique.set(post.id, post);
        const missing = [...unique.values()].filter((post) => {
            if (!canAutoInlineTranslateExplore(post))
                return false;
            if (!post.content.trim())
                return false;
            if (autoAttemptedIdsRef.current.has(post.id))
                return false;
            if (translatingById[post.id])
                return false;
            if (translationById[post.id])
                return false;
            // Skip posts already in the user's language
            const detected = heuristicDetectLanguage(post.content);
            if (detected.language !== 'und' && isLikelySameLanguage(detected.language, translationPolicy.userLanguage))
                return false;
            return true;
        });
        if (missing.length === 0)
            return;
        for (const post of missing) {
            autoAttemptedIdsRef.current.add(post.id);
            setTranslatingById((prev) => ({ ...prev, [post.id]: true }));
            setTranslationErrorById((prev) => ({ ...prev, [post.id]: false }));
        }
        Promise.allSettled(missing.map((post) => translationClient.translateInline({
            id: post.id,
            sourceText: post.content,
            targetLang: translationPolicy.userLanguage,
            mode: translationPolicy.localOnlyMode ? 'local_private' : 'server_default',
            ...(heuristicDetectLanguage(post.content).language !== 'und'
                ? { sourceLang: heuristicDetectLanguage(post.content).language }
                : {}),
        }).then((result) => {
            if (!hasMeaningfulTranslation(post.content, result.translatedText))
                return;
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
                    }).then(upsertTranslation).catch(() => { });
                }
            }
        }).catch((err) => {
            console.warn('[ExploreTab] auto translation failed', err);
            setTranslationErrorById((prev) => ({ ...prev, [post.id]: true }));
        }).finally(() => {
            setTranslatingById((prev) => ({ ...prev, [post.id]: false }));
        }))).catch(() => {
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
    return (_jsxs("div", { style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: disc.bgBase,
            position: 'relative', overflow: 'hidden',
        }, children: [_jsx("div", { style: {
                    position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
                    background: disc.bgAtmosphere,
                } }), _jsx(WriterEntitySheet, { entity: activeEntity, relatedPosts: exploreVisiblePool, onClose: () => setActiveEntity(null) }), _jsxs("div", { style: {
                    position: 'relative', zIndex: 2,
                    flexShrink: 0,
                    paddingTop: 'calc(var(--safe-top) + 8px)',
                    padding: 'calc(var(--safe-top) + 8px) 20px 0',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    height: 'calc(var(--safe-top) + 49px)',
                }, children: [_jsx("button", { "aria-label": "Account", style: { width: iconBtnTokens.size, height: iconBtnTokens.size, borderRadius: '50%', background: disc.surfaceCard2, border: `0.5px solid ${disc.lineSubtle}`, overflow: 'hidden', cursor: 'pointer' }, children: _jsxs("svg", { width: iconBtnTokens.size, height: iconBtnTokens.size, viewBox: "0 0 24 24", fill: "none", stroke: disc.textTertiary, strokeWidth: 1.5, strokeLinecap: "round", children: [_jsx("path", { d: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" }), _jsx("circle", { cx: "12", cy: "7", r: "4" })] }) }), _jsx("span", { style: {
                            fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em',
                            color: disc.textSecondary,
                        }, children: "Glympse" }), _jsx("button", { "aria-label": "More options", style: { width: iconBtnTokens.size, height: iconBtnTokens.size, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }, children: _jsxs("svg", { width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: disc.textTertiary, strokeWidth: 2, strokeLinecap: "round", children: [_jsx("circle", { cx: "12", cy: "5", r: "1", fill: disc.textTertiary }), _jsx("circle", { cx: "12", cy: "12", r: "1", fill: disc.textTertiary }), _jsx("circle", { cx: "12", cy: "19", r: "1", fill: disc.textTertiary })] }) })] }), _jsxs("div", { className: "scroll-y", style: { flex: 1, position: 'relative', zIndex: 1 }, children: [_jsxs("div", { style: { padding: '20px 20px 0' }, children: [_jsx(AnimatePresence, { mode: "wait", children: !isSearching && (_jsxs(motion.div, { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: transitions.fadeIn, style: { marginBottom: 20 }, children: [_jsx("h1", { style: {
                                                fontSize: typeScale.displayLg[0], lineHeight: `${typeScale.displayLg[1]}px`,
                                                fontWeight: typeScale.displayLg[2], letterSpacing: typeScale.displayLg[3],
                                                color: disc.textPrimary, margin: 0,
                                            }, children: DISCOVERY_PHRASES[phraseIdx.current] }), _jsx("p", { style: {
                                                fontSize: typeScale.bodyMd[0], lineHeight: `${typeScale.bodyMd[1]}px`,
                                                fontWeight: typeScale.bodyMd[2],
                                                color: disc.textSecondary, marginTop: 6,
                                            }, children: "Stories, threads, and ideas worth your attention" })] }, "hero")) }), _jsxs("div", { style: {
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    marginBottom: 12,
                                }, children: [_jsxs(motion.div, { animate: { boxShadow: focused ? shfTokens.focus.glow : shfTokens.shadow }, style: {
                                            flex: 1,
                                            height: shfTokens.height,
                                            borderRadius: shfTokens.radius,
                                            background: shfTokens.discovery.bg,
                                            border: `1px solid ${focused ? shfTokens.focus.border : shfTokens.discovery.border}`,
                                            display: 'flex', alignItems: 'center', gap: shfTokens.iconGap,
                                            padding: `0 ${shfTokens.paddingX}px`,
                                            transition: 'border-color 0.15s, box-shadow 0.15s',
                                        }, children: [_jsxs("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: shfTokens.discovery.icon, strokeWidth: 2, strokeLinecap: "round", children: [_jsx("circle", { cx: "11", cy: "11", r: "8" }), _jsx("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" })] }), _jsx("input", { ref: inputRef, value: query, onChange: e => setQuery(e.target.value), onFocus: () => setFocused(true), onBlur: () => setFocused(false), onKeyDown: (e) => {
                                                    if (e.key === 'Enter' && query.trim().length > 1) {
                                                        e.currentTarget.blur();
                                                        useUiStore.getState().openSearchStory(query.trim());
                                                    }
                                                }, placeholder: "Search stories, topics, feeds", autoCapitalize: "none", autoCorrect: "off", spellCheck: false, style: {
                                                    flex: 1,
                                                    fontSize: typeScale.bodyLg[0], lineHeight: `${typeScale.bodyLg[1]}px`,
                                                    fontWeight: typeScale.bodyLg[2],
                                                    color: shfTokens.discovery.text,
                                                    background: 'none', border: 'none', outline: 'none',
                                                } }), query && (_jsx("button", { onClick: () => setQuery(''), style: { color: disc.textTertiary, background: 'none', border: 'none', cursor: 'pointer', minWidth: touchLike ? 36 : 28, minHeight: touchLike ? 36 : 28, borderRadius: '50%', display: 'flex' }, children: _jsxs("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", children: [_jsx("line", { x1: "18", y1: "6", x2: "6", y2: "18" }), _jsx("line", { x1: "6", y1: "6", x2: "18", y2: "18" })] }) }))] }), _jsx(AnimatePresence, { children: (isSearching || focused) && (_jsx(motion.button, { initial: { opacity: 0, width: 0 }, animate: { opacity: 1, width: 'auto' }, exit: { opacity: 0, width: 0 }, onClick: () => { setQuery(''); inputRef.current?.blur(); setFocused(false); }, style: {
                                                minHeight: touchLike ? 40 : 34,
                                                padding: touchLike ? '0 6px' : 0,
                                                fontSize: touchLike ? Math.max(typeScale.chip[0], 14) : typeScale.chip[0], fontWeight: 600,
                                                color: accent.primary,
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                whiteSpace: 'nowrap', overflow: 'hidden',
                                            }, children: "Cancel" })) })] }), _jsx(AnimatePresence, { children: query.trim().length > 1 && (_jsxs(motion.button, { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 4 }, onClick: () => useUiStore.getState().openSearchStory(query.trim()), style: {
                                        width: '100%', height: buttonTokens.height,
                                        borderRadius: radius.full,
                                        background: accent.primary,
                                        color: '#fff',
                                        border: 'none', cursor: 'pointer',
                                        fontSize: buttonTokens.fontSize, fontWeight: 700,
                                        marginBottom: 12,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    }, children: [_jsxs("svg", { width: "15", height: "15", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", children: [_jsx("circle", { cx: "11", cy: "11", r: "8" }), _jsx("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" })] }), "Search Story: \"", query, "\""] })) }), _jsx(AnimatePresence, { children: !isSearching && (_jsx(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, style: { display: 'flex', gap: qfcTokens.gap, overflowX: 'auto', paddingBottom: 4, marginBottom: 18, scrollbarWidth: 'none' }, children: QUICK_FILTERS.map(f => (_jsx("button", { onClick: () => setActiveFilter(activeFilter === f ? null : f), style: {
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
                                        }, children: f }, f))) })) })] }), _jsx(AnimatePresence, { mode: "wait", children: isSearching ? (_jsx(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, style: { padding: '0 20px' }, children: loading ? _jsx(DiscoverySpinner, {}) : (_jsxs(_Fragment, { children: [searchActors.length > 0 && (_jsxs("div", { style: { marginBottom: 24 }, children: [_jsx(SectionHeader, { title: "People" }), _jsx("div", { style: { background: disc.surfaceCard, borderRadius: radius[24], padding: `0 ${space[8]}px`, border: `0.5px solid ${disc.lineSubtle}` }, children: searchActors.map(a => _jsx(ActorRow, { actor: a, onFollow: handleFollow }, a.did)) })] })), searchPosts.filter((post) => !(filterResults[post.id] ?? []).some((m) => m.action === 'hide')).length > 0 && (_jsxs("div", { style: { marginBottom: 24 }, children: [_jsx(SectionHeader, { title: "Posts" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 12 }, children: searchPosts.slice(0, 8).map(post => ((() => {
                                                    const matches = filterResults[post.id] ?? [];
                                                    const isHidden = matches.some((m) => m.action === 'hide');
                                                    const isWarned = matches.some((m) => m.action === 'warn');
                                                    const isRevealed = !!revealedFilteredPosts[post.id];
                                                    if (isHidden)
                                                        return null;
                                                    if (isWarned && !isRevealed) {
                                                        const reasons = warnMatchReasons(matches);
                                                        return (_jsxs("div", { style: { border: `0.5px solid ${disc.lineSubtle}`, borderRadius: radius[16], padding: '10px 12px', background: 'rgba(255,149,0,0.08)' }, children: [_jsx("div", { style: { fontSize: 13, fontWeight: 700, color: disc.textPrimary, marginBottom: 4 }, children: "Content warning" }), _jsx("div", { style: { fontSize: 11, color: disc.textSecondary, marginBottom: 8 }, children: "This post may include words or topics you asked to warn about." }), _jsx("div", { style: { fontSize: 12, fontWeight: 700, color: disc.textSecondary, marginBottom: 6 }, children: "Matches filter:" }), _jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }, children: reasons.map((entry) => (_jsxs("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, border: `0.5px solid ${disc.lineSubtle}`, padding: '3px 8px', background: disc.surfaceCard }, children: [_jsx("span", { style: { fontSize: 11, color: disc.textPrimary, fontWeight: 700 }, children: entry.phrase }), _jsx("span", { style: { fontSize: 10, color: disc.textSecondary, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }, children: entry.reason === 'exact+semantic' ? 'exact + semantic' : entry.reason })] }, `${entry.phrase}:${entry.reason}`))) }), _jsx("button", { onClick: () => setRevealedFilteredPosts((prev) => ({ ...prev, [post.id]: true })), style: { border: 'none', background: 'transparent', color: accent.primary, fontSize: 12, fontWeight: 700, padding: 0, cursor: 'pointer' }, children: "Show post" })] }, post.id));
                                                    }
                                                    const inlineDetectedLanguage = heuristicDetectLanguage(post.content);
                                                    const hasInlineTranslation = !!translationById[post.id] && hasMeaningfulTranslation(post.content, translationById[post.id].translatedText);
                                                    const shouldOfferInlineTranslation = hasInlineTranslation
                                                        || inlineDetectedLanguage.language === 'und'
                                                        || !isLikelySameLanguage(inlineDetectedLanguage.language, translationPolicy.userLanguage);
                                                    return (_jsxs(motion.div, { whileTap: { scale: 0.985 }, onClick: () => onOpenStory({ type: 'post', id: post.id, title: post.content.slice(0, 80) }), style: {
                                                            background: disc.surfaceCard, borderRadius: radius[24],
                                                            padding: `${space[8]}px ${space[10]}px`,
                                                            border: `0.5px solid ${disc.lineSubtle}`,
                                                            cursor: 'pointer',
                                                        }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }, children: [_jsx("div", { style: { width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceFocus, flexShrink: 0 }, children: post.author.avatar
                                                                            ? _jsx("img", { src: post.author.avatar, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } })
                                                                            : _jsx("div", { style: { width: '100%', height: '100%', background: accent.indigo600, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }, children: getAuthorInitial(post.author.displayName, post.author.handle) }) }), _jsx("button", { className: "interactive-link-button", onClick: (event) => { event.stopPropagation(); void navigateToProfile(post.author.did || post.author.handle); }, style: { fontSize: typeScale.metaLg[0], fontWeight: 600, color: disc.textPrimary, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }, children: post.author.displayName }), _jsxs("button", { className: "interactive-link-button", onClick: (event) => { event.stopPropagation(); void navigateToProfile(post.author.did || post.author.handle); }, style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }, children: ["@", post.author.handle] })] }), _jsx("p", { style: { fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`, color: disc.textSecondary, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }, children: hasInlineTranslation && !showOriginalById[post.id]
                                                                    ? translationById[post.id].translatedText
                                                                    : post.content }), post.content.trim().length > 0 && shouldOfferInlineTranslation && (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }, children: [_jsx("button", { onClick: (event) => handleToggleTranslate(event, post), disabled: !!translatingById[post.id], style: {
                                                                            border: 'none',
                                                                            background: 'transparent',
                                                                            color: accent.primary,
                                                                            fontSize: 12,
                                                                            fontWeight: 700,
                                                                            padding: 0,
                                                                            cursor: translatingById[post.id] ? 'default' : 'pointer',
                                                                            opacity: translatingById[post.id] ? 0.65 : 1,
                                                                        }, children: hasInlineTranslation
                                                                            ? (showOriginalById[post.id] ? 'Show translation' : 'Show original')
                                                                            : (translatingById[post.id]
                                                                                ? 'Translating...'
                                                                                : 'Translate') }), translationErrorById[post.id] && !hasInlineTranslation && (_jsx("span", { style: { fontSize: 11, color: '#ff6b6b', fontWeight: 600 }, children: "No translation available" }))] })), hasInlineTranslation && !showOriginalById[post.id] && (_jsx("div", { style: {
                                                                    marginTop: 8,
                                                                    border: `0.5px solid ${disc.lineSubtle}`,
                                                                    borderRadius: radius[10],
                                                                    background: 'rgba(91,124,255,0.08)',
                                                                    overflow: 'hidden',
                                                                }, children: _jsxs("div", { style: {
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'space-between',
                                                                        gap: 8,
                                                                        padding: '7px 9px',
                                                                    }, children: [_jsx("span", { style: { fontSize: 11, color: disc.textSecondary, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, children: autoTranslatedIdsRef.current.has(post.id)
                                                                                ? `Auto-translated from ${translationById[post.id].sourceLang}`
                                                                                : `Translated from ${translationById[post.id].sourceLang}` }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }, children: [_jsx("button", { onClick: (event) => handleToggleTranslate(event, post), style: { border: 'none', background: 'transparent', color: accent.primary, fontSize: 11, fontWeight: 700, padding: 0, cursor: 'pointer' }, children: "Show original" }), _jsx("button", { onClick: (event) => handleClearTranslation(event, post.id), style: { border: 'none', background: 'transparent', color: disc.textTertiary, fontSize: 11, fontWeight: 600, padding: 0, cursor: 'pointer' }, children: "Clear" })] })] }) }))] }, post.id));
                                                })())) })] })), searchFeedItems.length > 0 && (_jsxs("div", { style: { marginBottom: 24 }, children: [_jsx(SectionHeader, { title: "Feeds & Podcasts" }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 10 }, children: [searchFeedItems.slice(0, 10).map((item) => {
                                                        const isPodcast = item.source === 'podcast-index' || (item.enclosureType || '').startsWith('audio/');
                                                        const isAdding = Boolean(addingPodcastFeedByUrl[item.link]);
                                                        return (_jsxs("div", { style: {
                                                                background: disc.surfaceCard,
                                                                borderRadius: radius[16],
                                                                padding: `${space[8]}px ${space[10]}px`,
                                                                border: `0.5px solid ${disc.lineSubtle}`,
                                                            }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, children: [_jsx("p", { style: { margin: 0, fontSize: typeScale.bodySm[0], fontWeight: 700, color: disc.textPrimary }, children: item.title }), isPodcast && (_jsx("span", { style: { fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '3px 8px', background: 'rgba(91,124,255,0.2)', color: accent.cyan400 }, children: "Podcast" }))] }), _jsxs("p", { style: { margin: '4px 0 0', fontSize: typeScale.metaSm[0], color: disc.textSecondary }, children: [(item.feedTitle || 'Feed'), " \u2022 ", (item.feedCategory || 'General')] }), item.content && (_jsx("p", { style: { margin: '6px 0 0', fontSize: typeScale.bodySm[0], color: disc.textTertiary, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }, children: item.content })), _jsxs("div", { style: { marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("a", { href: item.link, target: "_blank", rel: "noreferrer", style: {
                                                                                color: accent.primary,
                                                                                fontSize: typeScale.metaSm[0],
                                                                                fontWeight: 700,
                                                                                textDecoration: 'none',
                                                                            }, children: "Open feed" }), item.source === 'podcast-index' && (_jsx("button", { type: "button", onClick: () => handleAddPodcastFeed(item.link), disabled: isAdding, style: {
                                                                                border: 'none',
                                                                                borderRadius: 999,
                                                                                padding: '5px 10px',
                                                                                cursor: isAdding ? 'default' : 'pointer',
                                                                                background: isAdding ? disc.surfaceCard : accent.primary,
                                                                                color: '#fff',
                                                                                fontSize: 11,
                                                                                fontWeight: 700,
                                                                            }, children: isAdding ? 'Adding...' : 'Add Podcast' }))] })] }, item.id));
                                                    }), podcastFeedAddStatus && (_jsx("p", { style: { margin: 0, fontSize: typeScale.metaSm[0], color: disc.textSecondary }, children: podcastFeedAddStatus }))] })] })), searchActors.length === 0 && searchPosts.length === 0 && searchFeedItems.length === 0 && (_jsx("div", { style: { padding: '40px 0', textAlign: 'center' }, children: _jsxs("p", { style: { fontSize: typeScale.bodySm[0], color: disc.textTertiary }, children: ["No results for \"", debouncedQuery, "\""] }) }))] })) }, "search")) : (_jsx(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, children: discoverLoading ? (_jsx("div", { style: { padding: '0 20px' }, children: _jsx(DiscoverySpinner, {}) })) : (_jsxs("div", { style: { padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 28 }, children: [activeFilter && !hasVisibleDiscoverContent && (_jsx("div", { style: {
                                            borderRadius: radius[20],
                                            background: disc.surfaceCard,
                                            border: `0.5px solid ${disc.lineSubtle}`,
                                            padding: `${space[8]}px ${space[10]}px`,
                                        }, children: _jsxs("p", { style: { margin: 0, fontSize: typeScale.bodySm[0], color: disc.textSecondary }, children: ["No ", activeFilter.toLowerCase(), " results are available right now."] }) })), showDiscoverSection('live-sports') && (_jsxs("div", { children: [_jsx(SectionHeader, { title: "Live Sports Moments" }), _jsx(LiveSportsMoments, { maxGames: 3, onGameClick: (gameId) => {
                                                    const game = sportsStore.getGame(gameId);
                                                    const query = game
                                                        ? (game.hashtags[0] ? `#${game.hashtags[0]}` : `${game.awayTeam.name} ${game.homeTeam.name}`)
                                                        : gameId;
                                                    useUiStore.getState().openSearchStory(query);
                                                } })] })), showDiscoverSection('sports-pulse') && sportsPulsePosts.length > 0 && (_jsxs("div", { children: [_jsx(SectionHeader, { title: "Sports Pulse" }), _jsx("div", { style: { display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2 }, children: sportsPulsePosts.map((p) => (_jsx(LinkedPostMiniCard, { post: p, translation: translationById[p.id], showOriginal: !!showOriginalById[p.id], translating: !!translatingById[p.id], translationError: !!translationErrorById[p.id], autoTranslated: autoTranslatedIdsRef.current.has(p.id), onToggleTranslate: (event) => handleToggleTranslate(event, p), onClearTranslation: (event) => handleClearTranslation(event, p.id), onTap: () => onOpenStory({ type: 'post', id: p.id, title: p.content.slice(0, 80) }), onHashtag: tag => useUiStore.getState().openExploreSearch(tag) }, p.id))) })] })), showDiscoverSection('feed-items') && recentFeedItems.length > 0 && (_jsxs("div", { children: [_jsx(SectionHeader, { title: "From Your Feeds" }), _jsx("div", { style: { display: 'grid', gap: 10 }, children: recentFeedItems.slice(0, 6).map((item) => {
                                                    const isPodcast = (item.enclosureType || '').startsWith('audio/');
                                                    return (_jsxs("a", { href: item.link, target: "_blank", rel: "noreferrer", style: {
                                                            display: 'block',
                                                            background: disc.surfaceCard,
                                                            borderRadius: radius[16],
                                                            padding: `${space[8]}px ${space[10]}px`,
                                                            border: `0.5px solid ${disc.lineSubtle}`,
                                                            textDecoration: 'none',
                                                        }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, children: [_jsx("p", { style: { margin: 0, fontSize: typeScale.bodySm[0], fontWeight: 700, color: disc.textPrimary }, children: item.title }), isPodcast && (_jsx("span", { style: { fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 7px', background: 'rgba(91,124,255,0.2)', color: accent.cyan400 }, children: "Podcast" }))] }), _jsxs("p", { style: { margin: '4px 0 0', fontSize: typeScale.metaSm[0], color: disc.textSecondary }, children: [(item.feedTitle || 'Feed'), " \u2022 ", (item.feedCategory || 'General')] })] }, item.id));
                                                }) })] })), showDiscoverSection('top-stories') && filteredLinkPosts.length > 0 && (_jsxs("div", { style: { marginBottom: 24 }, children: [_jsx(SectionHeader, { title: "Top Stories" }), _jsx("div", { style: { position: 'relative' }, children: _jsx(AnimatePresence, { mode: "wait", initial: false, children: _jsx(motion.div, { initial: { opacity: 0, scale: 0.975 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0 }, transition: { duration: 0.38, ease: [0.25, 0.1, 0.25, 1] }, children: (() => {
                                                            const p = filteredLinkPosts[featuredIdx] ?? filteredLinkPosts[0];
                                                            if (!p)
                                                                return null;
                                                            const matches = filterResults[p.id] ?? [];
                                                            const isWarned = matches.some((m) => m.action === 'warn');
                                                            const isRevealed = !!revealedFilteredPosts[p.id];
                                                            if (isWarned && !isRevealed) {
                                                                const reasons = warnMatchReasons(matches);
                                                                return (_jsxs("div", { style: { border: `0.5px solid ${disc.lineSubtle}`, borderRadius: radius[20], padding: '12px 14px', background: 'rgba(255,149,0,0.08)' }, children: [_jsx("div", { style: { fontSize: 13, fontWeight: 700, color: disc.textPrimary, marginBottom: 4 }, children: "Content warning" }), _jsx("div", { style: { fontSize: 11, color: disc.textSecondary, marginBottom: 8 }, children: "This post may include words or topics you asked to warn about." }), _jsx("div", { style: { fontSize: 12, fontWeight: 700, color: disc.textSecondary, marginBottom: 6 }, children: "Matches filter:" }), _jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }, children: reasons.map((entry) => (_jsxs("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, border: `0.5px solid ${disc.lineSubtle}`, padding: '3px 8px', background: disc.surfaceCard }, children: [_jsx("span", { style: { fontSize: 11, color: disc.textPrimary, fontWeight: 700 }, children: entry.phrase }), _jsx("span", { style: { fontSize: 10, color: disc.textSecondary, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }, children: entry.reason === 'exact+semantic' ? 'exact + semantic' : entry.reason })] }, `${entry.phrase}:${entry.reason}`))) }), _jsx("button", { onClick: () => setRevealedFilteredPosts((prev) => ({ ...prev, [p.id]: true })), style: { border: 'none', background: 'transparent', color: accent.primary, fontSize: 12, fontWeight: 700, padding: 0, cursor: 'pointer' }, children: "Show post" })] }));
                                                            }
                                                            return (_jsx(FeaturedSearchStoryCard, { post: p, translation: translationById[p.id], showOriginal: !!showOriginalById[p.id], translating: !!translatingById[p.id], translationError: !!translationErrorById[p.id], autoTranslated: autoTranslatedIdsRef.current.has(p.id), translatedDisplayName: translationById[`displayName:${p.author.did}`]?.translatedText, onToggleTranslate: (event) => handleToggleTranslate(event, p), onClearTranslation: (event) => handleClearTranslation(event, p.id), onTap: () => onOpenStory({ type: 'post', id: p.id, title: p.content.slice(0, 80) }), onHashtag: tag => useUiStore.getState().openExploreSearch(tag), onEntityTap: (e) => setActiveEntity(e) }));
                                                        })() }, filteredLinkPosts[featuredIdx]?.id ?? filteredLinkPosts[0]?.id ?? featuredIdx) }) }), filteredLinkPosts.length > 1 && (_jsx("div", { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5, marginTop: 10, marginBottom: 2 }, children: filteredLinkPosts.map((_, i) => (_jsx("button", { onClick: () => { setFeaturedIdx(i); restartCarousel(); }, style: { background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', display: 'flex', alignItems: 'center' }, children: _jsx(motion.div, { animate: { width: i === featuredIdx ? 20 : 6 }, transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }, style: {
                                                            height: 4, borderRadius: 2,
                                                            overflow: 'hidden', position: 'relative',
                                                            background: disc.lineSubtle,
                                                        }, children: i === featuredIdx && (_jsx(motion.div, { initial: { scaleX: 0 }, animate: { scaleX: 1 }, transition: { duration: 5, ease: 'linear' }, style: {
                                                                position: 'absolute', inset: 0,
                                                                background: accent.primary,
                                                                transformOrigin: 'left center',
                                                            } }, `fill-${featuredIdx}`)) }) }, i))) })), filteredSidePosts.length > 0 && (_jsx("div", { style: { display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2, marginTop: 12 }, children: filteredSidePosts.map(p => {
                                                    const matches = filterResults[p.id] ?? [];
                                                    const isWarned = matches.some((m) => m.action === 'warn');
                                                    const isRevealed = !!revealedFilteredPosts[p.id];
                                                    if (isWarned && !isRevealed) {
                                                        const reasons = warnMatchReasons(matches);
                                                        return (_jsxs("div", { style: { flexShrink: 0, width: 182, border: `0.5px solid ${disc.lineSubtle}`, borderRadius: radius[20], padding: '10px 12px', background: 'rgba(255,149,0,0.08)' }, children: [_jsx("div", { style: { fontSize: 12, fontWeight: 700, color: disc.textPrimary, marginBottom: 4 }, children: "Content warning" }), _jsx("div", { style: { fontSize: 10, color: disc.textSecondary, marginBottom: 8 }, children: "This post may include words or topics you asked to warn about." }), _jsx("div", { style: { fontSize: 11, fontWeight: 700, color: disc.textSecondary, marginBottom: 6 }, children: "Matches filter:" }), _jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }, children: reasons.map((entry) => (_jsxs("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 3, borderRadius: 999, border: `0.5px solid ${disc.lineSubtle}`, padding: '2px 7px', background: disc.surfaceCard }, children: [_jsx("span", { style: { fontSize: 10, color: disc.textPrimary, fontWeight: 700 }, children: entry.phrase }), _jsx("span", { style: { fontSize: 9, color: disc.textSecondary, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }, children: entry.reason === 'exact+semantic' ? 'exact + semantic' : entry.reason })] }, `${entry.phrase}:${entry.reason}`))) }), _jsx("button", { onClick: () => setRevealedFilteredPosts((prev) => ({ ...prev, [p.id]: true })), style: { border: 'none', background: 'transparent', color: accent.primary, fontSize: 11, fontWeight: 700, padding: 0, cursor: 'pointer' }, children: "Show post" })] }, p.id));
                                                    }
                                                    return (_jsx(LinkedPostMiniCard, { post: p, translation: translationById[p.id], showOriginal: !!showOriginalById[p.id], translating: !!translatingById[p.id], translationError: !!translationErrorById[p.id], autoTranslated: autoTranslatedIdsRef.current.has(p.id), onToggleTranslate: (event) => handleToggleTranslate(event, p), onClearTranslation: (event) => handleClearTranslation(event, p.id), onTap: () => onOpenStory({ type: 'post', id: p.id, title: p.content.slice(0, 80) }), onHashtag: tag => useUiStore.getState().openExploreSearch(tag) }, p.id));
                                                }) }))] })), showDiscoverSection('trending-topics') && trendingTopics.length > 0 && (_jsxs("div", { children: [_jsx(SectionHeader, { title: "Trending Topics" }), _jsx("div", { style: { display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 4 }, children: trendingTopics.map((t, i) => (_jsx(TrendingTopicCard, { topic: t, signal: i < 2 ? 'active now' : i < 4 ? 'rising' : 'new', onTap: () => { setQuery(t); } }, t))) })] })), showDiscoverSection('live-clusters') && liveClusters.length > 0 && (_jsxs("div", { children: [_jsx(SectionHeader, { title: "Live Clusters" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 12 }, children: liveClusters.map(c => (_jsx(LiveClusterCard, { title: c.title, summary: c.summary, count: c.count, onTap: () => onOpenStory({ type: 'topic', id: c.id, title: c.title }) }, c.id))) })] })), showDiscoverSection('feeds-to-follow') && suggestedFeeds.length > 0 && (_jsxs("div", { children: [_jsx(SectionHeader, { title: "Feeds to Follow" }), _jsx("div", { style: { display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 4 }, children: suggestedFeeds.map(gen => _jsx(FeedCard, { gen: gen, onFollow: handleFollowFeed }, gen.uri)) })] })), showDiscoverSection('sources') && domains.length > 0 && (_jsxs("div", { children: [_jsx(SectionHeader, { title: "Sources" }), _jsx("div", { style: { display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 4 }, children: domains.map(d => _jsx(DomainCapsule, { domain: d.domain, description: d.description }, d.domain)) })] })), !activeFilter && suggestedActors.length > 0 && (_jsxs("div", { children: [_jsx(SectionHeader, { title: "People to Follow" }), _jsx("div", { style: { background: disc.surfaceCard, borderRadius: radius[24], padding: `0 ${space[8]}px`, border: `0.5px solid ${disc.lineSubtle}` }, children: suggestedActors.slice(0, 5).map(a => _jsx(ActorRow, { actor: a, onFollow: handleFollow }, a.did)) })] })), _jsx("div", { style: { height: 24 } })] })) }, "discover")) })] })] }));
}
//# sourceMappingURL=ExploreTab.js.map