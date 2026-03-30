import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSessionStore } from '../store/sessionStore.js';
import { useUiStore } from '../store/uiStore.js';
import { useActivityStore } from '../store/activityStore.js';
import { atpCall } from '../lib/atproto/client.js';
import { mapNotification } from '../atproto/mappers.js';
import { formatTime } from '../data/mockData.js';
const NOTIF_CONFIG = {
    like: { symbol: '♥', color: 'var(--red)', bg: 'rgba(255,69,58,0.12)' },
    repost: { symbol: '↺', color: 'var(--green)', bg: 'rgba(48,209,88,0.12)' },
    reply: { symbol: '↩', color: 'var(--blue)', bg: 'rgba(10,132,255,0.12)' },
    follow: { symbol: '+', color: 'var(--purple)', bg: 'rgba(191,90,242,0.12)' },
    mention: { symbol: '@', color: 'var(--orange)', bg: 'rgba(255,159,10,0.12)' },
    quote: { symbol: '"', color: 'var(--teal)', bg: 'rgba(90,200,250,0.12)' },
    app: { symbol: '•', color: 'var(--indigo)', bg: 'rgba(88,86,214,0.12)' },
};
const FILTERS = ['All', 'Mentions', 'Likes', 'Follows', 'App'];
function normalizeReason(rawReason) {
    const value = rawReason.toLowerCase();
    if (value.startsWith('like'))
        return 'like';
    if (value.startsWith('repost'))
        return 'repost';
    if (value.startsWith('reply'))
        return 'reply';
    if (value.startsWith('follow'))
        return 'follow';
    if (value.startsWith('mention'))
        return 'mention';
    if (value.startsWith('quote'))
        return 'quote';
    return 'app';
}
function inferTargetNoun(reason, subjectUri) {
    const lower = reason.toLowerCase();
    if (lower.includes('repost'))
        return 'repost';
    if ((subjectUri || '').includes('/app.bsky.feed.repost/'))
        return 'repost';
    return 'post';
}
function toReasonText(reason, subjectUri) {
    const normalized = normalizeReason(reason);
    const target = inferTargetNoun(reason, subjectUri);
    switch (normalized) {
        case 'follow':
            return 'followed you';
        case 'like':
            return `liked your ${target}`;
        case 'repost':
            return `reposted your ${target}`;
        case 'reply':
            return `replied to your ${target}`;
        case 'mention':
            return 'mentioned you';
        case 'quote':
            return `quoted your ${target}`;
        default:
            return `sent ${reason} activity`;
    }
}
function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}
function extractSubjectText(record) {
    const fromSimple = record?.text || record?.body || record?.content || record?.description;
    if (typeof fromSimple === 'string' && fromSimple.trim())
        return fromSimple.trim();
    if (Array.isArray(record?.facets) && typeof record?.text === 'string') {
        return record.text.trim();
    }
    return '';
}
function Spinner() {
    return (_jsx("div", { style: { display: 'flex', justifyContent: 'center', padding: '40px 0' }, children: _jsx("svg", { width: "28", height: "28", viewBox: "0 0 24 24", fill: "none", stroke: "var(--blue)", strokeWidth: 2.5, strokeLinecap: "round", children: _jsx("path", { d: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83", children: _jsx("animateTransform", { attributeName: "transform", type: "rotate", from: "0 12 12", to: "360 12 12", dur: "0.8s", repeatCount: "indefinite" }) }) }) }));
}
export default function ActivityTab() {
    const { agent, session } = useSessionStore();
    const setUnreadCount = useUiStore((state) => state.setUnreadCount);
    const appNotifications = useActivityStore((state) => state.appNotifications);
    const markAllAppRead = useActivityStore((state) => state.markAllAppRead);
    const [filter, setFilter] = useState('All');
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchNotifications = useCallback(async () => {
        if (!session)
            return;
        setLoading(true);
        setError(null);
        try {
            const res = await atpCall((s) => agent.listNotifications({ limit: 50 }));
            const mapped = res.data.notifications.map(mapNotification);
            const postSubjectUris = Array.from(new Set(mapped
                .map((n) => n.subjectUri)
                .filter((uri) => Boolean(uri && uri.includes('/app.bsky.feed.post/')))));
            const subjectTextByUri = new Map();
            const chunks = chunkArray(postSubjectUris, 25);
            for (const uris of chunks) {
                try {
                    const postsRes = await atpCall((s) => agent.getPosts({ uris }));
                    for (const post of postsRes.data.posts) {
                        const text = extractSubjectText(post.record);
                        if (text)
                            subjectTextByUri.set(post.uri, text);
                    }
                }
                catch {
                    // Ignore per-chunk subject lookup failures.
                }
            }
            const atpNotifications = mapped.map((n) => {
                const type = normalizeReason(n.reason);
                const subjectSnippet = n.subjectUri ? subjectTextByUri.get(n.subjectUri) : undefined;
                return {
                    id: n.uri,
                    type,
                    displayName: n.author.displayName,
                    ...(n.author.avatar ? { avatar: n.author.avatar } : {}),
                    content: toReasonText(n.reason, n.subjectUri),
                    time: n.indexedAt,
                    read: n.isRead,
                    ...(n.subjectUri ? { subjectUri: n.subjectUri } : {}),
                    ...(subjectSnippet ? { subjectSnippet } : {}),
                };
            });
            const appItems = appNotifications.map((n) => ({
                id: n.id,
                type: 'app',
                displayName: n.title,
                content: n.message,
                time: n.createdAt,
                read: n.read,
            }));
            const merged = [...atpNotifications, ...appItems].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
            setNotifications(merged);
        }
        catch (err) {
            setError(err?.message ?? 'Failed to load notifications');
        }
        finally {
            setLoading(false);
        }
    }, [agent, appNotifications, session]);
    useEffect(() => {
        fetchNotifications();
    }, [fetchNotifications]);
    useEffect(() => {
        setUnreadCount(notifications.filter((item) => !item.read).length);
    }, [notifications, setUnreadCount]);
    const markAllRead = useCallback(async () => {
        if (!session)
            return;
        try {
            await atpCall((s) => agent.updateSeenNotifications());
            markAllAppRead();
            setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        }
        catch {
            // Ignore mark-read failure and keep the current state.
        }
    }, [agent, markAllAppRead, session]);
    const filtered = notifications.filter((n) => {
        if (filter === 'All')
            return true;
        if (filter === 'Mentions')
            return n.type === 'mention' || n.type === 'reply';
        if (filter === 'Likes')
            return n.type === 'like';
        if (filter === 'Follows')
            return n.type === 'follow';
        if (filter === 'App')
            return n.type === 'app';
        return true;
    });
    const newItems = filtered.filter((n) => !n.read);
    const oldItems = filtered.filter((n) => n.read);
    const unreadCount = notifications.filter((n) => !n.read).length;
    return (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }, children: [_jsxs("div", { style: {
                    flexShrink: 0,
                    paddingTop: 'calc(var(--safe-top) + 12px)',
                    background: 'transparent',
                }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '0 16px 10px', gap: 12 }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }, children: [_jsx("span", { style: {
                                            fontFamily: 'var(--font-ui)',
                                            fontSize: 'var(--type-ui-headline-md-size)',
                                            lineHeight: 'var(--type-ui-headline-md-line)',
                                            fontWeight: 'var(--type-ui-headline-md-weight)',
                                            letterSpacing: 'var(--type-ui-headline-md-track)',
                                            color: 'var(--label-1)',
                                        }, children: "Activity" }), unreadCount > 0 && (_jsx("span", { style: {
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            minWidth: 20,
                                            height: 20,
                                            padding: '0 6px',
                                            borderRadius: 100,
                                            background: 'var(--blue)',
                                            color: '#fff',
                                            fontFamily: 'var(--font-ui)',
                                            fontSize: 'var(--type-meta-sm-size)',
                                            fontWeight: 700,
                                            letterSpacing: 'var(--type-meta-sm-track)',
                                            fontVariantNumeric: 'tabular-nums',
                                        }, children: unreadCount }))] }), unreadCount > 0 && (_jsx("button", { onClick: markAllRead, style: {
                                    fontFamily: 'var(--font-ui)',
                                    fontSize: 'var(--type-label-md-size)',
                                    lineHeight: 'var(--type-label-md-line)',
                                    fontWeight: 600,
                                    letterSpacing: 'var(--type-label-md-track)',
                                    color: 'var(--blue)',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                }, children: "Mark all read" })), _jsx("button", { onClick: fetchNotifications, style: { color: 'var(--label-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }, children: _jsxs("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("polyline", { points: "23 4 23 10 17 10" }), _jsx("polyline", { points: "1 20 1 14 7 14" }), _jsx("path", { d: "M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" })] }) })] }), _jsx("div", { style: { display: 'flex', flexDirection: 'row', padding: '0 16px 12px', gap: 8 }, children: FILTERS.map((f) => (_jsx("button", { onClick: () => setFilter(f), style: {
                                padding: '6px 14px',
                                borderRadius: 100,
                                fontFamily: 'var(--font-ui)',
                                fontSize: 'var(--type-label-md-size)',
                                lineHeight: 'var(--type-label-md-line)',
                                fontWeight: filter === f ? 600 : 400,
                                letterSpacing: 'var(--type-label-md-track)',
                                color: filter === f ? '#fff' : 'var(--label-2)',
                                background: filter === f ? 'var(--blue)' : 'var(--fill-2)',
                                border: 'none',
                                cursor: 'pointer',
                                transition: 'all 0.15s',
                            }, children: f }, f))) })] }), _jsxs("div", { className: "scroll-y", style: { flex: 1 }, children: [_jsx(AnimatePresence, { mode: "wait", children: loading ? (_jsx(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, children: _jsx(Spinner, {}) }, "loading")) : error ? (_jsxs(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, style: { padding: '32px 16px', textAlign: 'center' }, children: [_jsx("p", { style: {
                                        fontFamily: 'var(--font-ui)',
                                        fontSize: 'var(--type-body-sm-size)',
                                        lineHeight: 'var(--type-body-sm-line)',
                                        fontWeight: 'var(--type-body-sm-weight)',
                                        letterSpacing: 'var(--type-body-sm-track)',
                                        color: 'var(--red)',
                                        marginBottom: 12,
                                    }, children: error }), _jsx("button", { onClick: fetchNotifications, style: {
                                        fontFamily: 'var(--font-ui)',
                                        fontSize: 'var(--type-label-md-size)',
                                        lineHeight: 'var(--type-label-md-line)',
                                        fontWeight: 600,
                                        letterSpacing: 'var(--type-label-md-track)',
                                        color: 'var(--blue)',
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                    }, children: "Try again" })] }, "error")) : filtered.length === 0 ? (_jsxs(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, style: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px', gap: 12 }, children: [_jsx("div", { style: { width: 48, height: 48, borderRadius: '50%', background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: _jsxs("svg", { width: "22", height: "22", viewBox: "0 0 24 24", fill: "none", stroke: "var(--label-3)", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" }), _jsx("path", { d: "M13.73 21a2 2 0 01-3.46 0" })] }) }), _jsx("p", { style: {
                                        fontFamily: 'var(--font-ui)',
                                        fontSize: 'var(--type-body-sm-size)',
                                        lineHeight: 'var(--type-body-sm-line)',
                                        fontWeight: 'var(--type-body-sm-weight)',
                                        letterSpacing: 'var(--type-body-sm-track)',
                                        color: 'var(--label-3)',
                                    }, children: "No notifications yet" })] }, "empty")) : (_jsxs(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, children: [newItems.length > 0 && (_jsxs(_Fragment, { children: [_jsx("p", { style: { fontFamily: 'var(--font-ui)', fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--label-3)', padding: '16px 16px 8px' }, children: "New" }), _jsx("div", { style: { background: 'var(--surface)', borderRadius: 16, margin: '0 12px 8px', overflow: 'hidden' }, children: newItems.map((n, i) => (_jsx(NotifRow, { n: n, index: i, last: i === newItems.length - 1 }, n.id))) })] })), oldItems.length > 0 && (_jsxs(_Fragment, { children: [_jsx("p", { style: { fontFamily: 'var(--font-ui)', fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--label-3)', padding: '16px 16px 8px' }, children: "Earlier" }), _jsx("div", { style: { background: 'var(--surface)', borderRadius: 16, margin: '0 12px 8px', overflow: 'hidden' }, children: oldItems.map((n, i) => (_jsx(NotifRow, { n: n, index: i, last: i === oldItems.length - 1 }, n.id))) })] }))] }, "list")) }), _jsx("div", { style: { height: 24 } })] })] }));
}
function NotifRow({ n, index, last }) {
    const cfg = NOTIF_CONFIG[n.type] ?? NOTIF_CONFIG.app;
    return (_jsxs(motion.div, { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { delay: index * 0.03 }, style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            padding: '12px 16px',
            borderBottom: last ? 'none' : '0.5px solid color-mix(in srgb, var(--sep) 35%, transparent)',
            background: n.read ? 'none' : 'rgba(0,122,255,0.04)',
        }, children: [_jsxs("div", { style: { position: 'relative' }, children: [_jsx("div", { style: { width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', background: 'var(--fill-2)' }, children: n.avatar ? (_jsx("img", { src: n.avatar, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } })) : (_jsx("div", { style: {
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: cfg.bg,
                                color: cfg.color,
                                fontFamily: 'var(--font-ui)',
                                fontSize: 'var(--type-label-lg-size)',
                                fontWeight: 700,
                            }, children: n.displayName[0] })) }), _jsx("div", { style: {
                            position: 'absolute',
                            bottom: -2,
                            right: -2,
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            background: cfg.bg,
                            color: cfg.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontFamily: 'var(--font-ui)',
                            fontSize: 'var(--type-meta-sm-size)',
                            fontWeight: 700,
                            border: '1.5px solid var(--surface)',
                        }, children: cfg.symbol })] }), _jsxs("div", { style: { marginTop: 8, width: '100%' }, children: [_jsxs("p", { style: {
                            margin: 0,
                            fontFamily: 'var(--font-ui)',
                            fontSize: 'var(--type-body-sm-size)',
                            lineHeight: 'var(--type-body-sm-line)',
                            fontWeight: 'var(--type-body-sm-weight)',
                            letterSpacing: 'var(--type-body-sm-track)',
                            color: 'var(--label-1)',
                        }, children: [_jsx("strong", { children: n.displayName }), " ", n.content, ".", ' ', _jsx("span", { style: { color: 'var(--label-3)', fontVariantNumeric: 'tabular-nums' }, children: formatTime(n.time) })] }), n.subjectSnippet && (_jsx("div", { style: {
                            marginTop: 8,
                            borderRadius: 12,
                            border: '0.5px solid color-mix(in srgb, var(--sep) 45%, transparent)',
                            background: 'var(--fill-1)',
                            padding: '8px 10px',
                        }, children: _jsx("p", { style: {
                                margin: 0,
                                fontFamily: 'var(--font-ui)',
                                fontSize: 'var(--type-meta-sm-size)',
                                lineHeight: 'var(--type-body-sm-line)',
                                fontWeight: 500,
                                letterSpacing: 'var(--type-meta-sm-track)',
                                color: 'var(--label-2)',
                                display: '-webkit-box',
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                            }, children: n.subjectSnippet }) }))] })] }));
}
//# sourceMappingURL=ActivityTab.js.map