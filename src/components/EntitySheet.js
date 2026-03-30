import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// ─── EntitySheet ──────────────────────────────────────────────────────────
// Two exports:
//  - default EntitySheet: app-level navigation (EntityEntry from App.tsx)
//  - WriterEntitySheet: Narwhal v3 AI entity chips (WriterEntity from llmContracts)
//
// Both render as a spring-animated bottom sheet with a blur backdrop.
import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MOCK_POSTS } from '../data/mockData.js';
import { discovery as disc, accent, type as typeScale, radius, space, } from '../design/index.js';
// ─── Shared ───────────────────────────────────────────────────────────────
const WRITER_TYPE_META = {
    person: { label: 'Person', color: '#BF8FFF', bg: 'rgba(191,143,255,0.12)' },
    organization: { label: 'Org', color: accent.cyan400, bg: 'rgba(124,233,255,0.10)' },
    topic: { label: 'Topic', color: accent.primary, bg: 'rgba(91,124,255,0.12)' },
    event: { label: 'Event', color: '#F97316', bg: 'rgba(249,115,22,0.12)' },
    team: { label: 'Team', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
    product: { label: 'Product', color: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
    rule: { label: 'Rule / Policy', color: '#63DCB4', bg: 'rgba(99,220,180,0.12)' },
    source: { label: 'Source', color: '#94A3B8', bg: 'rgba(148,163,184,0.12)' },
};
const FALLBACK_TYPE_META = WRITER_TYPE_META['topic'];
function TypeBadge({ type, label }) {
    const meta = WRITER_TYPE_META[type] ?? FALLBACK_TYPE_META;
    return (_jsx("span", { style: {
            display: 'inline-flex', alignItems: 'center',
            padding: '2px 9px', borderRadius: radius.full,
            background: meta.bg,
            border: `0.5px solid ${meta.color}40`,
            color: meta.color,
            fontSize: typeScale.metaSm[0], fontWeight: 700,
            letterSpacing: '0.03em',
        }, children: label ?? meta.label }));
}
function SheetBackdrop({ onClick }) {
    return (_jsx(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, onClick: onClick, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 250 } }));
}
function SheetDragHandle() {
    return (_jsx("div", { style: { display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }, children: _jsx("div", { style: { width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)' } }) }));
}
function RelatedPostRow({ post, needle }) {
    const lower = post.content.toLowerCase();
    const idx = lower.indexOf(needle);
    const snippet = idx >= 0
        ? post.content.slice(Math.max(0, idx - 20), idx + needle.length + 40).trim()
        : post.content.slice(0, 80).trim();
    const hasEllipsisLeft = idx > 20;
    const hasEllipsisRight = (hasEllipsisLeft ? idx - 20 + needle.length + 40 : needle.length + 40) < post.content.length;
    return (_jsxs("div", { style: {
            padding: `${space[6]}px ${space[8]}px`,
            background: 'rgba(255,255,255,0.04)',
            borderRadius: radius[12],
            border: `0.5px solid ${disc.lineSubtle}`,
        }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }, children: [_jsx("div", { style: {
                            width: 18, height: 18, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                            background: `hsl(${((post.author.handle ?? 'x').charCodeAt(0) * 37) % 360}, 55%, 40%)`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', fontSize: 9, fontWeight: 700,
                        }, children: post.author.avatar
                            ? _jsx("img", { src: post.author.avatar, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } })
                            : ((post.author.displayName ?? post.author.handle ?? '').trim().charAt(0) || '?').toUpperCase() }), _jsxs("span", { style: { fontSize: typeScale.metaSm[0], fontWeight: 700, color: disc.textSecondary }, children: ["@", post.author.handle] })] }), _jsxs("p", { style: {
                    margin: 0,
                    fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
                    color: disc.textTertiary,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }, children: [hasEllipsisLeft ? '…' : '', snippet, hasEllipsisRight ? '…' : ''] })] }));
}
export function WriterEntitySheet({ entity, relatedPosts = [], onClose }) {
    useEffect(() => {
        const handler = (e) => { if (e.key === 'Escape')
            onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);
    const needle = entity ? entity.label.replace(/^[@#]/, '').toLowerCase() : '';
    const mentioningPosts = relatedPosts
        .filter(p => needle.length > 1 && p.content.toLowerCase().includes(needle))
        .slice(0, 5);
    return (_jsx(AnimatePresence, { children: entity && (_jsxs(_Fragment, { children: [_jsx(SheetBackdrop, { onClick: onClose }), _jsxs(motion.div, { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' }, transition: { type: 'spring', stiffness: 340, damping: 32 }, style: {
                        position: 'fixed', left: 0, right: 0, bottom: 0,
                        background: disc.bgBase,
                        borderRadius: `${radius[20]}px ${radius[20]}px 0 0`,
                        border: `0.5px solid ${disc.lineSubtle}`,
                        borderBottom: 'none',
                        zIndex: 251,
                        maxHeight: '72vh', overflowY: 'auto', overscrollBehavior: 'contain',
                    }, children: [_jsx(SheetDragHandle, {}), _jsxs("div", { style: {
                                display: 'flex', alignItems: 'flex-start', gap: 12,
                                padding: `${space[4]}px ${space[10]}px ${space[4]}px`,
                            }, children: [_jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }, children: [_jsx(TypeBadge, { type: entity.type }), entity.confidence >= 0.60 && (_jsxs("span", { style: { fontSize: typeScale.metaSm[0], fontWeight: 600, color: disc.textTertiary }, children: [Math.round(entity.confidence * 100), "% confident"] }))] }), _jsx("h2", { style: {
                                                margin: 0,
                                                fontSize: typeScale.titleMd[0], lineHeight: `${typeScale.titleMd[1]}px`,
                                                fontWeight: 700, color: disc.textPrimary,
                                            }, children: entity.label })] }), _jsx("button", { onClick: onClose, style: {
                                        width: 32, height: 32, borderRadius: '50%',
                                        background: 'rgba(255,255,255,0.08)',
                                        border: `0.5px solid ${disc.lineSubtle}`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', flexShrink: 0,
                                    }, children: _jsxs("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: disc.textSecondary, strokeWidth: 2.5, strokeLinecap: "round", children: [_jsx("line", { x1: "18", y1: "6", x2: "6", y2: "18" }), _jsx("line", { x1: "6", y1: "6", x2: "18", y2: "18" })] }) })] }), entity.impact > 0 && (_jsx("div", { style: { padding: `0 ${space[10]}px`, marginBottom: space[6] }, children: _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("div", { style: { flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }, children: _jsx("div", { style: {
                                                height: '100%', width: `${Math.round(entity.impact * 100)}%`,
                                                background: `linear-gradient(90deg, ${accent.primary}, ${accent.cyan400})`,
                                                borderRadius: 2, transition: 'width 0.4s ease',
                                            } }) }), _jsxs("span", { style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary, fontWeight: 600, whiteSpace: 'nowrap' }, children: [Math.round(entity.impact * 100), "% impact"] })] }) })), _jsx("div", { style: { height: '0.5px', background: disc.lineSubtle, margin: `0 ${space[10]}px ${space[8]}px` } }), _jsx("div", { style: { padding: `0 ${space[10]}px ${space[10]}px` }, children: mentioningPosts.length > 0 ? (_jsxs(_Fragment, { children: [_jsxs("p", { style: {
                                            fontSize: typeScale.metaLg[0], fontWeight: 700, color: disc.textTertiary,
                                            letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: space[6],
                                        }, children: ["Mentioned in ", mentioningPosts.length, " post", mentioningPosts.length > 1 ? 's' : ''] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: space[4] }, children: mentioningPosts.map(p => (_jsx(RelatedPostRow, { post: p, needle: needle }, p.id))) })] })) : (_jsx("p", { style: {
                                    fontSize: typeScale.bodySm[0], color: disc.textTertiary,
                                    fontStyle: 'italic', textAlign: 'center', padding: `${space[8]}px 0`,
                                }, children: "No matching posts in the current feed." })) }), _jsx("div", { style: { height: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' } })] })] })) }));
}
// ─── EntityChip ───────────────────────────────────────────────────────────
// Tappable chip for use in Explore story cards and InterpolatorCard.
export function EntityChip({ entity, onTap, size = 'md', }) {
    const meta = WRITER_TYPE_META[entity.type] ?? FALLBACK_TYPE_META;
    const pad = size === 'sm' ? '2px 8px' : '3px 10px';
    const fs = size === 'sm' ? 11 : typeScale.metaLg[0];
    return (_jsxs("button", { onClick: e => { e.stopPropagation(); onTap(entity); }, style: {
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: pad, borderRadius: radius.full,
            background: meta.bg,
            border: `0.5px solid ${meta.color}50`,
            color: meta.color,
            fontSize: fs, fontWeight: 700, letterSpacing: '0.01em',
            cursor: 'pointer',
            flexShrink: 0,
        }, children: [_jsx("span", { style: { opacity: 0.7, fontSize: fs - 1 }, children: entity.type === 'person' ? '👤' : entity.type === 'organization' || entity.type === 'team' ? '🏢' : '#' }), entity.label] }));
}
// ─── Legacy EntitySheet (app-level entity navigation) ─────────────────────
// Kept for existing EntityEntry navigation (EntityEntry from App.tsx).
const LEGACY_TYPE_COLOR = {
    person: 'var(--blue)',
    topic: 'var(--purple)',
    feed: 'var(--teal)',
};
const ACTIONS = [
    { label: 'Follow', emoji: '＋' },
    { label: 'Save', emoji: '🔖' },
    { label: 'Mute', emoji: '🔇' },
    { label: 'List', emoji: '📋' },
];
export default function EntitySheet({ entity, onClose, onOpenStory }) {
    const color = LEGACY_TYPE_COLOR[entity.type] || 'var(--blue)';
    const related = MOCK_POSTS.slice(0, 3);
    return (_jsxs(_Fragment, { children: [_jsx(SheetBackdrop, { onClick: onClose }), _jsxs(motion.div, { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' }, transition: { type: 'spring', stiffness: 380, damping: 40 }, style: {
                    position: 'fixed', left: 0, right: 0, bottom: 0,
                    background: 'var(--surface)', borderRadius: '24px 24px 0 0',
                    zIndex: 251, paddingBottom: 'var(--safe-bottom)',
                    boxShadow: '0 -4px 32px rgba(0,0,0,0.16)',
                    maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
                }, children: [_jsx(SheetDragHandle, {}), _jsxs("div", { style: { overflowY: 'auto', flex: 1 }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-start', padding: '8px 16px 16px', gap: 14 }, children: [_jsx("div", { style: { width: 52, height: 52, borderRadius: 16, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx("span", { style: { fontSize: 22, fontWeight: 700, color }, children: entity.name[0] }) }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("p", { style: { fontSize: 17, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.4, marginBottom: 5 }, children: entity.name }), _jsx("span", { style: { fontSize: 12, fontWeight: 600, color, background: color + '15', padding: '3px 10px', borderRadius: 100, textTransform: 'capitalize' }, children: entity.type })] }), _jsx("button", { onClick: onClose, style: { padding: 6, color: 'var(--label-3)', flexShrink: 0 }, children: _jsxs("svg", { width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("line", { x1: "18", y1: "6", x2: "6", y2: "18" }), _jsx("line", { x1: "6", y1: "6", x2: "18", y2: "18" })] }) })] }), _jsxs("div", { style: { margin: '0 16px 16px', background: 'var(--bg)', borderRadius: 14, padding: '10px 14px', display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, children: [_jsx("span", { style: { fontSize: 16, flexShrink: 0, marginTop: 1 }, children: "\u2139\uFE0F" }), _jsxs("div", { children: [_jsx("p", { style: { fontSize: 11, fontWeight: 700, color: 'var(--label-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }, children: "Why you're seeing this" }), _jsx("p", { style: { fontSize: 14, color: 'var(--label-2)', lineHeight: 1.4 }, children: entity.reason })] })] }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, padding: '0 16px 16px' }, children: ACTIONS.map(a => (_jsxs("button", { style: {
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                                        padding: '12px 8px', borderRadius: 14, background: 'var(--bg)',
                                        fontSize: 11, fontWeight: 600, color: 'var(--label-2)',
                                        border: 'none', cursor: 'pointer',
                                    }, children: [_jsx("span", { style: { fontSize: 20 }, children: a.emoji }), a.label] }, a.label))) }), _jsx("div", { style: { padding: '0 16px 16px' }, children: _jsxs("button", { onClick: () => { onOpenStory({ type: 'topic', id: entity.id, title: entity.name }); onClose(); }, style: {
                                        width: '100%', padding: '14px 0', borderRadius: 14,
                                        background: 'var(--blue)', color: '#fff',
                                        fontSize: 15, fontWeight: 600, letterSpacing: -0.2,
                                        border: 'none', cursor: 'pointer',
                                    }, children: ["\u2726 Open Story for ", entity.name] }) }), _jsxs("div", { style: { padding: '0 16px 24px' }, children: [_jsx("p", { style: { fontSize: 12, fontWeight: 700, color: 'var(--label-3)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }, children: "Related Posts" }), related.map((post, i) => (_jsxs("div", { style: {
                                            display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10,
                                            padding: '10px 12px', borderRadius: 12, background: 'var(--bg)', marginBottom: 6,
                                        }, children: [_jsx("div", { style: { width: 28, height: 28, borderRadius: '50%', background: ['var(--blue)', 'var(--indigo)', 'var(--green)'][i], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0 }, children: post.author.displayName[0] }), _jsxs("p", { style: { flex: 1, fontSize: 13, color: 'var(--label-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: [post.content.slice(0, 60), "\u2026"] }), _jsx("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "var(--label-4)", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", style: { flexShrink: 0 }, children: _jsx("polyline", { points: "9 18 15 12 9 6" }) })] }, post.id)))] })] })] })] }));
}
//# sourceMappingURL=EntitySheet.js.map