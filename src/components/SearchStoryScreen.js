import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { useDrag } from '@use-gesture/react';
import { useSessionStore } from '../store/sessionStore.js';
import { useUiStore } from '../store/uiStore.js';
import { atpCall } from '../lib/atproto/client.js';
import { mapFeedViewPost, mapPostViewToMockPost, hasDisplayableRecordContent } from '../atproto/mappers.js';
import { summarizeStoryEntities } from '../intelligence/entityLinking.js';
import { useTranslationStore } from '../store/translationStore.js';
import { translationClient } from '../lib/i18n/client.js';
import { heuristicDetectLanguage } from '../lib/i18n/detect.js';
import { hasMeaningfulTranslation, isLikelySameLanguage } from '../lib/i18n/normalize.js';
import { useProfileNavigation } from '../hooks/useProfileNavigation.js';
import { usePostFilterResults } from '../lib/contentFilters/usePostFilterResults.js';
import { warnMatchReasons } from '../lib/contentFilters/presentation.js';
import { storyProgress as spTokens, overviewCard as ocTokens, bottomQueryDock as bqdTokens, interpolator as intTokens, discovery as disc, accent, type as typeScale, radius, space, transitions, storyCardVariants, } from '../design/index.js';
const CARD_NAMES = ['Overview', 'Best Source', 'Related', 'Conversation'];
// ─── StoryProgressRail ────────────────────────────────────────────────────
function StoryProgressRail({ total, current }) {
    return (_jsx("div", { style: {
            display: 'flex', gap: spTokens.segmentGap,
            padding: '0 20px',
            height: spTokens.height,
        }, children: Array.from({ length: total }).map((_, i) => (_jsx("div", { style: {
                flex: 1, height: spTokens.height,
                borderRadius: spTokens.radius,
                background: i < current ? spTokens.complete : i === current ? spTokens.active : spTokens.track,
                boxShadow: i === current ? spTokens.currentGlow : 'none',
                transition: 'background 0.3s',
            } }, i))) }));
}
// ─── RichText inline renderer ─────────────────────────────────────────────
function RichText({ text, color }) {
    const navigateToProfile = useProfileNavigation();
    const openExploreSearch = useUiStore((s) => s.openExploreSearch);
    const parts = text.split(/(@[\w.]+|#\w+|https?:\/\/\S+)/g);
    return (_jsx("span", { children: parts.map((p, i) => {
            if (p.startsWith('@'))
                return _jsx("button", { className: "interactive-link-button", onClick: (e) => { e.stopPropagation(); void navigateToProfile(p); }, style: { color: accent.cyan400, font: 'inherit', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }, children: p }, i);
            if (p.startsWith('#')) {
                return (_jsx("button", { className: "interactive-link-button", onClick: (e) => {
                        e.stopPropagation();
                        const normalized = p.replace(/^#/, '').trim();
                        if (!normalized)
                            return;
                        openExploreSearch(normalized);
                    }, style: { color: accent.cyan400, font: 'inherit', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }, children: p }, i));
            }
            if (p.startsWith('http')) {
                try {
                    return _jsx("a", { href: p, target: "_blank", rel: "noopener noreferrer", style: { color: accent.cyan400 }, onClick: e => e.stopPropagation(), children: new URL(p).hostname.replace(/^www\./, '') }, i);
                }
                catch {
                    return _jsx("span", { children: p }, i);
                }
            }
            return _jsx("span", { style: { color }, children: p }, i);
        }) }));
}
// ─── OverviewCard ─────────────────────────────────────────────────────────
function OverviewCard({ posts, query, getTranslatedText }) {
    const navigateToProfile = useProfileNavigation();
    const top = posts[0];
    if (!top)
        return null;
    const topText = getTranslatedText(top);
    const img = top.images?.[0] ?? top.embed?.thumbnail;
    const domain = top.embed?.url ? (() => { try {
        return new URL(top.embed.url).hostname.replace(/^www\./, '');
    }
    catch {
        return '';
    } })() : '';
    return (_jsxs("div", { style: {
            borderRadius: ocTokens.radius,
            background: ocTokens.bg,
            boxShadow: ocTokens.shadow,
            overflow: 'hidden',
            border: `0.5px solid ${disc.lineSubtle}`,
        }, children: [img && (_jsxs("div", { style: { height: ocTokens.mediaHeight, overflow: 'hidden', position: 'relative' }, children: [_jsx("img", { src: img, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } }), _jsx("div", { style: { position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 40%, rgba(18,24,36,0.8) 100%)' } })] })), _jsxs("div", { style: { padding: `${ocTokens.padding}px` }, children: [_jsx("div", { style: { marginBottom: 10 }, children: _jsxs("span", { style: {
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                padding: '4px 10px', borderRadius: radius.full,
                                background: ocTokens.synopsisChip.bg,
                                border: `0.5px solid ${ocTokens.synopsisChip.border}`,
                                color: ocTokens.synopsisChip.text,
                                fontSize: typeScale.metaLg[0], fontWeight: 600,
                            }, children: [_jsx("span", { style: { width: 5, height: 5, borderRadius: '50%', background: '#7CE9FF', flexShrink: 0 } }), "Glympse Synopsis"] }) }), _jsx("p", { style: {
                            fontSize: typeScale.titleLg[0], lineHeight: `${typeScale.titleLg[1]}px`,
                            fontWeight: typeScale.titleLg[2], letterSpacing: typeScale.titleLg[3],
                            color: disc.textPrimary, marginBottom: 10,
                        }, children: _jsx(RichText, { text: topText.slice(0, 140), color: disc.textPrimary }) }), _jsxs("div", { style: { display: 'flex', gap: 16, marginBottom: 14 }, children: [[
                                { icon: '💬', val: top.replies, label: 'replies' },
                                { icon: '🔁', val: top.reposts, label: 'reposts' },
                                { icon: '❤️', val: top.likes, label: 'likes' },
                            ].map(s => (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 4 }, children: [_jsx("span", { style: { fontSize: 13 }, children: s.icon }), _jsx("span", { style: { fontSize: typeScale.metaLg[0], fontWeight: 600, color: disc.textSecondary }, children: s.val })] }, s.label))), _jsx("div", { style: { flex: 1 } }), _jsxs("span", { style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary }, children: [posts.length, " results"] })] }), (domain || top.author.handle) && (_jsxs("div", { style: {
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: `${space[4]}px ${space[6]}px`,
                            background: ocTokens.sourceStrip.bg,
                            borderRadius: radius[12],
                        }, children: [_jsx("div", { style: { width: 20, height: 20, borderRadius: 6, background: disc.surfaceFocus, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: top.author.avatar
                                    ? _jsx("img", { src: top.author.avatar, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 } })
                                    : _jsx("span", { style: { fontSize: 10, color: disc.textTertiary }, children: "@" }) }), domain ? (_jsx("span", { style: { fontSize: typeScale.metaSm[0], fontWeight: 500, color: ocTokens.sourceStrip.text }, children: domain })) : (_jsxs("button", { className: "interactive-link-button", onClick: (e) => { e.stopPropagation(); void navigateToProfile(top.author.did || top.author.handle); }, style: { fontSize: typeScale.metaSm[0], fontWeight: 500, color: ocTokens.sourceStrip.text, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }, children: ["@", top.author.handle] })), _jsx("div", { style: { flex: 1 } }), _jsx("span", { style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary }, children: top.timestamp })] }))] })] }));
}
// ─── BestSourceCard ───────────────────────────────────────────────────────
function BestSourceCard({ posts, getTranslatedText }) {
    const navigateToProfile = useProfileNavigation();
    const top = posts[0];
    if (!top)
        return null;
    const topText = getTranslatedText(top);
    return (_jsxs("div", { style: {
            borderRadius: ocTokens.radius,
            background: disc.surfaceCard2,
            boxShadow: ocTokens.shadow,
            padding: `${space[12]}px`,
            border: `0.5px solid ${disc.lineSubtle}`,
        }, children: [_jsx("p", { style: {
                    fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: disc.textTertiary, marginBottom: 16,
                }, children: "Best Source" }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }, children: [_jsx("div", { style: { width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceFocus, flexShrink: 0 }, children: top.author.avatar
                            ? _jsx("img", { src: top.author.avatar, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } })
                            : _jsx("div", { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: accent.indigo600, color: '#fff', fontSize: 16, fontWeight: 700 }, children: top.author.displayName[0] }) }), _jsxs("div", { children: [_jsx("button", { className: "interactive-link-button", onClick: (e) => { e.stopPropagation(); void navigateToProfile(top.author.did || top.author.handle); }, style: { fontSize: typeScale.chip[0], fontWeight: 700, color: disc.textPrimary, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }, children: top.author.displayName }), _jsxs("button", { className: "interactive-link-button", onClick: (e) => { e.stopPropagation(); void navigateToProfile(top.author.did || top.author.handle); }, style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }, children: ["@", top.author.handle] })] })] }), _jsx("p", { style: {
                    fontSize: typeScale.bodyMd[0], lineHeight: `${typeScale.bodyMd[1]}px`,
                    fontWeight: typeScale.bodyMd[2],
                    color: disc.textSecondary, marginBottom: 16,
                }, children: _jsx(RichText, { text: topText, color: disc.textSecondary }) }), top.embed && (top.embed.type === 'external' || top.embed.type === 'video') && (_jsxs("a", { href: top.embed.url, target: "_blank", rel: "noopener noreferrer", onClick: e => e.stopPropagation(), style: {
                    display: 'block',
                    background: disc.surfaceFocus,
                    borderRadius: radius[16],
                    padding: `${space[6]}px ${space[8]}px`,
                    textDecoration: 'none',
                    border: `0.5px solid ${disc.lineSubtle}`,
                }, children: [top.embed.thumb && (_jsx("img", { src: top.embed.thumb, alt: "", style: { width: '100%', height: 120, objectFit: 'cover', borderRadius: radius[12], marginBottom: 8 } })), top.embed.title && _jsx("p", { style: { fontSize: typeScale.chip[0], fontWeight: 600, color: disc.textPrimary, marginBottom: 4 }, children: top.embed.title }), _jsx("p", { style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary }, children: (() => { try {
                            return new URL(top.embed.url).hostname.replace(/^www\./, '');
                        }
                        catch {
                            return top.embed.url;
                        } })() })] }))] }));
}
// ─── RelatedEntitiesCard ──────────────────────────────────────────────────
function RelatedEntitiesCard({ posts }) {
    const navigateToProfile = useProfileNavigation();
    const entities = summarizeStoryEntities(posts.map(p => p.content));
    const topicEntities = entities
        .filter(entity => entity.entityKind === 'concept' || entity.entityKind === 'claim')
        .slice(0, 12);
    const actorEntities = entities
        .filter(entity => entity.entityKind === 'person' || entity.entityKind === 'org')
        .slice(0, 8);
    return (_jsxs("div", { style: {
            borderRadius: ocTokens.radius,
            background: disc.surfaceCard2,
            padding: `${space[12]}px`,
            border: `0.5px solid ${disc.lineSubtle}`,
        }, children: [_jsx("p", { style: {
                    fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: disc.textTertiary, marginBottom: 16,
                }, children: "Related Entities" }), topicEntities.length > 0 && (_jsxs("div", { style: { marginBottom: 20 }, children: [_jsx("p", { style: { fontSize: typeScale.metaSm[0], fontWeight: 600, color: disc.textTertiary, marginBottom: 8, letterSpacing: '0.04em', textTransform: 'uppercase' }, children: "Topics" }), _jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 8 }, children: topicEntities.map(topic => (_jsxs("span", { style: {
                                padding: '5px 12px', borderRadius: radius.full,
                                background: 'rgba(91,124,255,0.14)',
                                color: accent.primary,
                                fontSize: typeScale.chip[0], fontWeight: 600,
                            }, children: ["#", topic.label.replace(/\s+/g, ''), topic.mentionCount > 1 && _jsxs("span", { style: { marginLeft: 6, opacity: 0.75 }, children: ["x", topic.mentionCount] })] }, topic.canonicalId))) })] })), actorEntities.length > 0 && (_jsxs("div", { children: [_jsx("p", { style: { fontSize: typeScale.metaSm[0], fontWeight: 600, color: disc.textTertiary, marginBottom: 8, letterSpacing: '0.04em', textTransform: 'uppercase' }, children: "Mentioned" }), _jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 8 }, children: actorEntities.map(entity => (_jsxs("button", { className: "interactive-link-button", onClick: (e) => { e.stopPropagation(); void navigateToProfile(entity.label); }, style: {
                                padding: '5px 12px', borderRadius: radius.full,
                                background: 'rgba(124,233,255,0.12)',
                                color: accent.cyan400,
                                fontSize: typeScale.chip[0], fontWeight: 600,
                                border: 'none', cursor: 'pointer',
                            }, children: ["@", entity.label.replace(/^@/, ''), entity.aliasCount > 1 && _jsxs("span", { style: { marginLeft: 6, opacity: 0.75 }, children: ["~", entity.aliasCount] })] }, entity.canonicalId))) })] })), topicEntities.length === 0 && actorEntities.length === 0 && (_jsx("p", { style: { fontSize: typeScale.bodySm[0], color: disc.textTertiary }, children: "No entities detected in this result set." }))] }));
}
// ─── RelatedConversationCard ──────────────────────────────────────────────
function RelatedConversationCard({ posts, onOpenStory, getTranslatedText }) {
    const navigateToProfile = useProfileNavigation();
    return (_jsxs("div", { style: {
            borderRadius: ocTokens.radius,
            background: disc.surfaceCard2,
            padding: `${space[12]}px`,
            border: `0.5px solid ${disc.lineSubtle}`,
        }, children: [_jsx("p", { style: {
                    fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: disc.textTertiary, marginBottom: 16,
                }, children: "Related Conversations" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 12 }, children: posts.slice(1, 6).map(post => (_jsxs(motion.div, { whileTap: { scale: 0.985 }, onClick: () => onOpenStory({ type: 'post', id: post.id, title: post.content.slice(0, 80) }), style: {
                        background: disc.surfaceCard,
                        borderRadius: radius[20],
                        padding: `${space[8]}px ${space[8]}px`,
                        border: `0.5px solid ${disc.lineSubtle}`,
                        cursor: 'pointer',
                    }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }, children: [_jsx("div", { style: { width: 24, height: 24, borderRadius: '50%', overflow: 'hidden', background: disc.surfaceFocus, flexShrink: 0 }, children: post.author.avatar
                                        ? _jsx("img", { src: post.author.avatar, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } })
                                        : _jsx("div", { style: { width: '100%', height: '100%', background: accent.indigo600, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }, children: post.author.displayName[0] }) }), _jsx("button", { className: "interactive-link-button", onClick: (e) => { e.stopPropagation(); void navigateToProfile(post.author.did || post.author.handle); }, style: { fontSize: typeScale.metaLg[0], fontWeight: 600, color: disc.textPrimary, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }, children: post.author.displayName }), _jsx("span", { style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary }, children: post.timestamp })] }), _jsx("p", { style: {
                                fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
                                color: disc.textSecondary,
                                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                            }, children: _jsx(RichText, { text: getTranslatedText(post), color: disc.textSecondary }) }), _jsxs("div", { style: { display: 'flex', gap: 12, marginTop: 8 }, children: [_jsxs("span", { style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary }, children: ["\uD83D\uDCAC ", post.replyCount] }), _jsxs("span", { style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary }, children: ["\u2764\uFE0F ", post.likeCount] })] })] }, post.id))) })] }));
}
// ─── BottomQueryDock ──────────────────────────────────────────────────────
function BottomQueryDock({ query, onRefine }) {
    const [val, setVal] = useState(query);
    return (_jsxs("div", { style: {
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
        }, children: [_jsxs("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: disc.textTertiary, strokeWidth: 2, strokeLinecap: "round", children: [_jsx("circle", { cx: "11", cy: "11", r: "8" }), _jsx("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" })] }), _jsx("input", { value: val, onChange: e => setVal(e.target.value), onKeyDown: e => { if (e.key === 'Enter')
                    onRefine(val); }, placeholder: "Refine your search\u2026", style: {
                    flex: 1,
                    fontSize: typeScale.bodySm[0], fontWeight: typeScale.bodySm[2],
                    color: bqdTokens.text,
                    background: 'none', border: 'none', outline: 'none',
                } }), _jsx("button", { onClick: () => onRefine(val), style: {
                    width: 32, height: 32, borderRadius: '50%',
                    background: bqdTokens.actionBg, color: bqdTokens.actionFg,
                    border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                }, children: _jsxs("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", children: [_jsx("line", { x1: "5", y1: "12", x2: "19", y2: "12" }), _jsx("polyline", { points: "12 5 19 12 12 19" })] }) })] }));
}
function ModerationNoticeCard({ onReveal, matches, isHidden, }) {
    const reasons = warnMatchReasons(matches ?? []);
    return (_jsxs("div", { style: {
            borderRadius: ocTokens.radius,
            background: 'color-mix(in srgb, var(--surface-card) 90%, var(--orange) 10%)',
            border: `0.5px solid ${disc.lineSubtle}`,
            padding: `${space[12]}px`,
        }, children: [isHidden ? (_jsxs(_Fragment, { children: [_jsx("div", { style: { fontSize: typeScale.chip[0], color: disc.textSecondary, fontWeight: 700, marginBottom: 4 }, children: "Hidden by your moderation settings." }), _jsx("div", { style: { fontSize: 11, color: disc.textSecondary, marginBottom: 10 }, children: "This post includes muted words or topics and is hidden in this view." })] })) : reasons.length > 0 ? (_jsxs(_Fragment, { children: [_jsx("div", { style: { fontSize: typeScale.bodySm[0], color: disc.textPrimary, fontWeight: 700, marginBottom: 4 }, children: "Content warning" }), _jsx("div", { style: { fontSize: 11, color: disc.textSecondary, marginBottom: 8 }, children: "This post may include words or topics you asked to warn about." }), _jsx("div", { style: { fontSize: typeScale.chip[0], color: disc.textSecondary, fontWeight: 700, marginBottom: 6 }, children: "Matches filter:" }), _jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }, children: reasons.map((entry) => (_jsxs("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, border: `0.5px solid ${disc.lineSubtle}`, padding: '3px 8px', background: disc.surfaceCard }, children: [_jsx("span", { style: { fontSize: 11, color: disc.textPrimary, fontWeight: 700 }, children: entry.phrase }), _jsx("span", { style: { fontSize: 10, color: disc.textSecondary, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }, children: entry.reason === 'exact+semantic' ? 'exact + semantic' : entry.reason })] }, `${entry.phrase}:${entry.reason}`))) })] })) : (_jsxs(_Fragment, { children: [_jsx("div", { style: { fontSize: typeScale.chip[0], color: disc.textSecondary, fontWeight: 700, marginBottom: 4 }, children: "Hidden by your moderation settings." }), _jsx("div", { style: { fontSize: 11, color: disc.textSecondary, marginBottom: 10 }, children: "This post includes muted words or topics and is hidden in this view." })] })), _jsx("button", { onClick: onReveal, style: {
                    border: 'none',
                    background: 'transparent',
                    color: accent.primary,
                    fontSize: typeScale.chip[0],
                    fontWeight: 700,
                    padding: 0,
                    cursor: 'pointer',
                }, children: "Show post" })] }));
}
// ─── Main component ────────────────────────────────────────────────────────
export default function SearchStoryScreen({ query, onClose, onOpenStory }) {
    const { agent, session } = useSessionStore();
    const { policy: translationPolicy, byId: translationById, upsertTranslation } = useTranslationStore();
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [cardIdx, setCardIdx] = useState(0);
    const [dir, setDir] = useState(1);
    const [refinedQuery, setRefinedQuery] = useState(query);
    const [revealedFilteredPosts, setRevealedFilteredPosts] = useState({});
    const filterResults = usePostFilterResults(posts, 'explore');
    const getModerationMatches = useCallback((postId) => filterResults[postId] ?? [], [filterResults]);
    const isSuppressedByModeration = useCallback((postId) => {
        if (revealedFilteredPosts[postId])
            return false;
        const matches = getModerationMatches(postId);
        return matches.some((m) => m.action === 'hide' || m.action === 'warn');
    }, [getModerationMatches, revealedFilteredPosts]);
    const visiblePosts = useMemo(() => posts.filter((post) => !isSuppressedByModeration(post.id)), [posts, isSuppressedByModeration]);
    const firstSuppressedPost = useMemo(() => {
        const post = posts.find((candidate) => isSuppressedByModeration(candidate.id));
        if (!post)
            return null;
        const matches = getModerationMatches(post.id);
        const isHidden = matches.some((match) => match.action === 'hide');
        return { post, matches, isHidden };
    }, [posts, isSuppressedByModeration]);
    useEffect(() => {
        setRevealedFilteredPosts({});
    }, [refinedQuery]);
    useEffect(() => {
        if (!session)
            return;
        setLoading(true);
        atpCall(() => agent.app.bsky.feed.searchPosts({ q: refinedQuery, limit: 25 }))
            .then(res => {
            if (res?.data?.posts) {
                setPosts(res.data.posts
                    .filter((p) => hasDisplayableRecordContent(p?.record))
                    .map((p) => mapPostViewToMockPost(p)));
            }
        })
            .finally(() => setLoading(false));
    }, [refinedQuery, agent, session]);
    const getTranslatedText = useCallback((post) => {
        return translationById[post.id]?.translatedText ?? post.content;
    }, [translationById]);
    useEffect(() => {
        if (!translationPolicy.autoTranslateExplore)
            return;
        if (posts.length === 0)
            return;
        const visible = posts.slice(0, 6).filter((post) => {
            if (post.content.trim().length === 0 || translationById[post.id])
                return false;
            const detected = heuristicDetectLanguage(post.content);
            if (detected.language !== 'und' && isLikelySameLanguage(detected.language, translationPolicy.userLanguage))
                return false;
            return true;
        });
        if (visible.length === 0)
            return;
        Promise.allSettled(visible.map((post) => {
            const detected = heuristicDetectLanguage(post.content);
            return translationClient.translateInline({
                id: post.id,
                sourceText: post.content,
                targetLang: translationPolicy.userLanguage,
                mode: translationPolicy.localOnlyMode ? 'local_private' : 'server_default',
                ...(detected.language !== 'und' ? { sourceLang: detected.language } : {}),
            }).then((result) => {
                if (!hasMeaningfulTranslation(post.content, result.translatedText))
                    return;
                upsertTranslation(result);
            });
        })).catch(() => {
            // Keep original text when translation is unavailable.
        });
    }, [posts, translationById, translationPolicy.autoTranslateExplore, translationPolicy.localOnlyMode, translationPolicy.userLanguage, upsertTranslation]);
    const advance = useCallback(() => {
        if (cardIdx < CARD_NAMES.length - 1) {
            setDir(1);
            setCardIdx(i => i + 1);
        }
    }, [cardIdx]);
    const retreat = useCallback(() => {
        if (cardIdx > 0) {
            setDir(-1);
            setCardIdx(i => i - 1);
        }
    }, [cardIdx]);
    // Swipe gesture
    const bind = useDrag(({ swipe: [swipeX] }) => {
        if (swipeX === -1)
            advance();
        if (swipeX === 1)
            retreat();
    }, { axis: 'x', swipe: { velocity: 0.3 } });
    const cards = [
        _jsx(OverviewCard, { posts: visiblePosts, query: refinedQuery, getTranslatedText: getTranslatedText }, "overview"),
        _jsx(BestSourceCard, { posts: visiblePosts, getTranslatedText: getTranslatedText }, "source"),
        _jsx(RelatedEntitiesCard, { posts: visiblePosts }, "entities"),
        _jsx(RelatedConversationCard, { posts: visiblePosts, onOpenStory: onOpenStory, getTranslatedText: getTranslatedText }, "conversation"),
    ];
    const activeCard = cards[cardIdx];
    const allSuppressed = posts.length > 0 && visiblePosts.length === 0;
    return (_jsxs(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, style: {
            position: 'fixed', inset: 0,
            background: disc.bgBase,
            display: 'flex', flexDirection: 'column',
            zIndex: 200,
        }, children: [_jsx("div", { style: { position: 'absolute', inset: 0, pointerEvents: 'none', background: disc.bgAtmosphere } }), _jsxs("div", { style: {
                    position: 'relative', zIndex: 2,
                    flexShrink: 0,
                    paddingTop: 'calc(var(--safe-top) + 12px)',
                    padding: 'calc(var(--safe-top) + 12px) 20px 12px',
                    display: 'flex', alignItems: 'center', gap: 12,
                }, children: [_jsx("button", { onClick: onClose, style: {
                            width: 36, height: 36, borderRadius: '50%',
                            background: disc.surfaceCard, border: `0.5px solid ${disc.lineSubtle}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', flexShrink: 0,
                        }, children: _jsx("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: disc.textSecondary, strokeWidth: 2.5, strokeLinecap: "round", children: _jsx("polyline", { points: "15 18 9 12 15 6" }) }) }), _jsxs("p", { style: {
                            flex: 1,
                            fontSize: typeScale.titleSm[0], fontWeight: typeScale.titleSm[2],
                            letterSpacing: typeScale.titleSm[3],
                            color: disc.textPrimary,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }, children: ["\"", refinedQuery, "\""] }), _jsxs("span", { style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary }, children: [cardIdx + 1, " / ", CARD_NAMES.length] })] }), _jsx("div", { style: { position: 'relative', zIndex: 2, flexShrink: 0, paddingBottom: 12 }, children: _jsx(StoryProgressRail, { total: CARD_NAMES.length, current: cardIdx }) }), _jsx("div", { ...bind(), style: { flex: 1, position: 'relative', zIndex: 1, overflow: 'hidden', touchAction: 'pan-y' }, onClick: advance, children: loading ? (_jsx("div", { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }, children: _jsx("svg", { width: "28", height: "28", viewBox: "0 0 24 24", fill: "none", stroke: disc.textTertiary, strokeWidth: 2, strokeLinecap: "round", children: _jsx("path", { d: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83", children: _jsx("animateTransform", { attributeName: "transform", type: "rotate", from: "0 12 12", to: "360 12 12", dur: "0.8s", repeatCount: "indefinite" }) }) }) })) : (_jsx("div", { className: "scroll-y", style: { height: '100%', paddingBottom: 88 }, children: _jsx("div", { style: { padding: '0 20px' }, children: _jsx(AnimatePresence, { mode: "wait", custom: dir, children: _jsx(motion.div, { custom: dir, variants: storyCardVariants, initial: "enter", animate: "center", exit: "exit", transition: transitions.storyCard, children: allSuppressed && firstSuppressedPost
                                    ? (_jsx(ModerationNoticeCard, { matches: firstSuppressedPost.matches, isHidden: firstSuppressedPost.isHidden, onReveal: () => setRevealedFilteredPosts((prev) => ({ ...prev, [firstSuppressedPost.post.id]: true })) }))
                                    : activeCard }, cardIdx) }) }) })) }), _jsx(BottomQueryDock, { query: refinedQuery, onRefine: q => { setRefinedQuery(q); setCardIdx(0); } })] }));
}
//# sourceMappingURL=SearchStoryScreen.js.map