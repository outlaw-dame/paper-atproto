import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { formatTime } from '../data/mockData.js';
import TwemojiText from './TwemojiText.js';
import { useProfileNavigation } from '../hooks/useProfileNavigation.js';
import { useUiStore } from '../store/uiStore.js';
import { useSensitiveMediaStore } from '../store/sensitiveMediaStore.js';
export const ContextPost = ({ post, type, onClick, }) => {
    const navigateToProfile = useProfileNavigation();
    const openExploreSearch = useUiStore((state) => state.openExploreSearch);
    const sensitivePolicy = useSensitiveMediaStore((s) => s.policy);
    const quoteEmbed = post.embed?.type === 'quote' ? post.embed : null;
    const shouldBlurQuotedImages = sensitivePolicy.blurSensitiveMedia && Boolean(quoteEmbed?.post.sensitiveMedia?.isSensitive);
    const authorActor = post.author.did || post.author.handle;
    const authorInitial = (post.author.displayName || post.author.handle || '?').trim().charAt(0).toUpperCase() || '?';
    const contextLabel = type === 'thread' ? 'Thread start' : 'Earlier reply';
    const externalEmbed = post.embed?.type === 'external' ? post.embed : null;
    const videoEmbed = post.embed?.type === 'video' ? post.embed : null;
    const quotedExternalEmbed = quoteEmbed?.post.embed?.type === 'external' ? quoteEmbed.post.embed : null;
    const quotedVideoEmbed = quoteEmbed?.post.embed?.type === 'video' ? quoteEmbed.post.embed : null;
    const secondaryLabel = quoteEmbed
        ? 'Quote post'
        : post.article
            ? 'Article'
            : externalEmbed
                ? externalEmbed.domain
                : videoEmbed
                    ? `Video · ${videoEmbed.domain}`
                    : null;
    const handleHashtagClick = (tag) => {
        const normalized = tag.replace(/^#/, '').trim();
        if (!normalized)
            return;
        openExploreSearch(normalized);
    };
    return (_jsxs("div", { role: onClick ? 'button' : undefined, tabIndex: onClick ? 0 : undefined, "aria-label": type === 'thread'
            ? `Original post by ${post.author.displayName || post.author.handle}`
            : `Replied-to post by ${post.author.displayName || post.author.handle}`, onClick: onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined, onKeyDown: onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
        } } : undefined, style: {
            display: 'flex',
            paddingLeft: 16,
            paddingRight: 16,
            cursor: onClick ? 'pointer' : 'default',
        }, children: [_jsxs("div", { style: {
                    width: 40,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    flexShrink: 0,
                    marginRight: 10,
                }, children: [_jsx("div", { style: {
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            background: 'var(--fill-2)',
                            overflow: 'hidden',
                            flexShrink: 0,
                        }, children: post.author.avatar ? (_jsx("img", { src: post.author.avatar, alt: post.author.handle, style: { width: '100%', height: '100%', objectFit: 'cover' } })) : (_jsx("div", { style: {
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--label-2)',
                                fontWeight: 700,
                                fontSize: 'var(--type-label-md-size)',
                            }, children: authorInitial })) }), _jsx("div", { style: {
                            width: 2,
                            flex: 1,
                            minHeight: 12,
                            backgroundColor: 'var(--sep-opaque)',
                            borderRadius: 1,
                            marginTop: 4,
                        } })] }), _jsx("div", { style: { flex: 1, minWidth: 0, paddingBottom: 8, paddingTop: 2 }, children: _jsxs("div", { style: {
                        border: 'none',
                        borderRadius: 0,
                        background: 'transparent',
                        padding: '10px 0 12px',
                        borderBottom: '0.5px solid color-mix(in srgb, var(--sep) 40%, transparent)',
                    }, children: [_jsxs("div", { style: {
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                flexWrap: 'wrap',
                                marginBottom: 10,
                            }, children: [_jsx("span", { style: {
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 5,
                                        height: 22,
                                        borderRadius: 999,
                                        padding: '0 10px',
                                        fontSize: 'var(--type-meta-sm-size)',
                                        lineHeight: 'var(--type-meta-sm-line)',
                                        letterSpacing: '0.04em',
                                        fontWeight: 800,
                                        textTransform: 'uppercase',
                                        color: 'var(--blue)',
                                        background: 'rgba(0, 122, 255, 0.12)',
                                        border: '1px solid rgba(0, 122, 255, 0.18)',
                                    }, children: contextLabel }), secondaryLabel && (_jsx("span", { style: {
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        height: 22,
                                        borderRadius: 999,
                                        padding: '0 10px',
                                        fontSize: 'var(--type-meta-sm-size)',
                                        lineHeight: 'var(--type-meta-sm-line)',
                                        fontWeight: 700,
                                        color: 'var(--label-2)',
                                        background: 'var(--fill-1)',
                                        border: '1px solid var(--stroke-dim)',
                                    }, children: secondaryLabel })), _jsx("span", { style: {
                                        fontSize: 'var(--type-meta-sm-size)',
                                        lineHeight: 'var(--type-meta-sm-line)',
                                        color: 'var(--label-3)',
                                        fontWeight: 600,
                                    }, children: formatTime(post.createdAt) }), onClick && (_jsxs("span", { style: {
                                        marginLeft: 'auto',
                                        fontSize: 'var(--type-meta-sm-size)',
                                        color: 'var(--label-3)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 2,
                                        flexShrink: 0,
                                        opacity: 0.8,
                                    }, children: ["Open", _jsxs("svg", { width: "9", height: "9", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("line", { x1: "7", y1: "17", x2: "17", y2: "7" }), _jsx("polyline", { points: "7 7 17 7 17 17" })] })] }))] }), _jsxs("div", { style: {
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                marginBottom: 6,
                            }, children: [_jsx("button", { className: "interactive-link-button", onClick: (e) => { e.stopPropagation(); void navigateToProfile(authorActor); }, style: {
                                        fontSize: 'var(--type-label-md-size)',
                                        lineHeight: 'var(--type-label-md-line)',
                                        letterSpacing: 'var(--type-label-md-track)',
                                        fontWeight: 700,
                                        color: 'var(--label-1)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        background: 'none', border: 'none', padding: 0, cursor: 'pointer'
                                    }, children: post.author.displayName || post.author.handle }), _jsxs("button", { className: "interactive-link-button", onClick: (e) => { e.stopPropagation(); void navigateToProfile(authorActor); }, style: {
                                        fontSize: 'var(--type-meta-md-size)',
                                        lineHeight: 'var(--type-meta-md-line)',
                                        letterSpacing: 'var(--type-meta-md-track)',
                                        color: 'var(--label-3)',
                                        flexShrink: 0,
                                        background: 'none', border: 'none', padding: 0, cursor: 'pointer'
                                    }, children: ["@", post.author.handle] })] }), post.content.trim().length > 0 && (_jsx("p", { className: "clamp-3", style: {
                                margin: 0,
                                fontSize: 'var(--type-body-sm-size)',
                                lineHeight: 'var(--type-body-sm-line)',
                                letterSpacing: 'var(--type-body-sm-track)',
                                color: 'var(--label-1)',
                                wordBreak: 'break-word',
                            }, children: _jsx(TwemojiText, { text: post.content, onMention: (handle) => { void navigateToProfile(handle); }, onHashtag: handleHashtagClick }) })), quoteEmbed && (_jsxs("div", { style: {
                                marginTop: post.content.trim().length > 0 ? 10 : 0,
                                border: '1px solid var(--quote-border)',
                                borderRadius: 12,
                                background: 'var(--quote-surface)',
                                padding: '10px 12px',
                            }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }, children: [_jsxs("span", { style: {
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 5,
                                                fontSize: 'var(--type-meta-sm-size)',
                                                lineHeight: 'var(--type-meta-sm-line)',
                                                color: 'var(--label-3)',
                                                fontWeight: 700,
                                            }, children: [_jsxs("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.25, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M3 7h10a4 4 0 010 8H9" }), _jsx("path", { d: "M13 7l-4 4 4 4" })] }), "Quoted post"] }), _jsx("button", { className: "interactive-link-button", onClick: (e) => { e.stopPropagation(); void navigateToProfile(quoteEmbed.post.author.did || quoteEmbed.post.author.handle); }, style: {
                                                fontSize: 'var(--type-label-md-size)',
                                                lineHeight: 'var(--type-label-md-line)',
                                                fontWeight: 700,
                                                color: 'var(--label-1)',
                                                background: 'none',
                                                border: 'none',
                                                padding: 0,
                                                cursor: 'pointer',
                                            }, children: quoteEmbed.post.author.displayName || quoteEmbed.post.author.handle }), _jsxs("button", { className: "interactive-link-button", onClick: (e) => { e.stopPropagation(); void navigateToProfile(quoteEmbed.post.author.did || quoteEmbed.post.author.handle); }, style: {
                                                fontSize: 'var(--type-meta-md-size)',
                                                lineHeight: 'var(--type-meta-md-line)',
                                                color: 'var(--label-3)',
                                                background: 'none',
                                                border: 'none',
                                                padding: 0,
                                                cursor: 'pointer',
                                            }, children: ["@", quoteEmbed.post.author.handle] })] }), quoteEmbed.post.content.trim().length > 0 && (_jsx("p", { className: "clamp-2", style: {
                                        margin: 0,
                                        fontSize: 'var(--type-body-sm-size)',
                                        lineHeight: 'var(--type-body-sm-line)',
                                        color: 'var(--label-2)',
                                        wordBreak: 'break-word',
                                    }, children: _jsx(TwemojiText, { text: quoteEmbed.post.content, onMention: (handle) => { void navigateToProfile(handle); }, onHashtag: handleHashtagClick }) })), quoteEmbed.post.media && quoteEmbed.post.media.length > 0 && (_jsxs("div", { style: {
                                        marginTop: quoteEmbed.post.content.trim().length > 0 ? 8 : 0,
                                        position: 'relative',
                                        borderRadius: 8,
                                        overflow: 'hidden',
                                    }, children: [_jsx("div", { style: {
                                                display: 'grid',
                                                gridTemplateColumns: quoteEmbed.post.media.length === 1 ? '1fr' : '1fr 1fr',
                                                gap: 2,
                                                filter: shouldBlurQuotedImages ? 'blur(22px)' : 'none',
                                                transition: 'filter 0.18s ease',
                                                pointerEvents: shouldBlurQuotedImages ? 'none' : 'auto',
                                            }, children: quoteEmbed.post.media.slice(0, 4).map((img, idx) => (_jsx("div", { style: {
                                                    aspectRatio: quoteEmbed.post.media.length === 1 && img.aspectRatio ? String(img.aspectRatio) : '1 / 1',
                                                    background: 'var(--fill-2)',
                                                    overflow: 'hidden',
                                                    borderRadius: quoteEmbed.post.media.length === 1 ? 8 : 0,
                                                }, children: _jsx("img", { src: img.url, alt: img.alt ?? '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } }) }, idx))) }), shouldBlurQuotedImages && (_jsxs("div", { style: {
                                                position: 'absolute',
                                                inset: 0,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: 5,
                                                color: 'var(--label-2)',
                                                fontSize: 'var(--type-meta-sm-size)',
                                                fontWeight: 700,
                                                letterSpacing: '0.02em',
                                            }, children: [_jsx("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.25, strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" }) }), "Sensitive content"] }))] })), quotedExternalEmbed && (_jsx("div", { style: {
                                        marginTop: 8,
                                        borderTop: '0.5px solid var(--quote-preview-border)',
                                        paddingTop: 8,
                                    }, children: _jsx("a", { href: quotedExternalEmbed.url, target: "_blank", rel: "noopener noreferrer", onClick: (e) => e.stopPropagation(), style: {
                                            display: 'block',
                                            textDecoration: 'none',
                                            color: 'inherit',
                                        }, children: _jsxs("div", { style: {
                                                border: '1px solid var(--quote-preview-border)',
                                                borderRadius: 12,
                                                background: 'var(--quote-preview-surface)',
                                                overflow: 'hidden',
                                            }, children: [quotedExternalEmbed.thumb && (_jsx("div", { style: { aspectRatio: '1.91 / 1', width: '100%', background: 'var(--fill-2)', overflow: 'hidden' }, children: _jsx("img", { src: quotedExternalEmbed.thumb, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } }) })), _jsxs("div", { style: { padding: '9px 10px 10px' }, children: [_jsx("div", { style: {
                                                                fontSize: 'var(--type-meta-sm-size)',
                                                                lineHeight: 'var(--type-meta-sm-line)',
                                                                color: 'var(--label-3)',
                                                                fontWeight: 700,
                                                                marginBottom: 4,
                                                            }, children: "Linked preview" }), _jsx("div", { style: {
                                                                fontSize: 'var(--type-label-md-size)',
                                                                lineHeight: 'var(--type-label-md-line)',
                                                                color: 'var(--label-1)',
                                                                fontWeight: 700,
                                                                marginBottom: 2,
                                                            }, children: quotedExternalEmbed.title }), _jsx("div", { style: {
                                                                fontSize: 'var(--type-meta-md-size)',
                                                                lineHeight: 'var(--type-meta-md-line)',
                                                                color: 'var(--label-3)',
                                                            }, children: quotedExternalEmbed.domain }), quotedExternalEmbed.description && (_jsx("p", { className: "clamp-2", style: {
                                                                margin: '6px 0 0',
                                                                fontSize: 'var(--type-meta-md-size)',
                                                                lineHeight: 'var(--type-meta-md-line)',
                                                                color: 'var(--label-2)',
                                                            }, children: quotedExternalEmbed.description }))] })] }) }) })), quotedVideoEmbed && (_jsx("div", { style: {
                                        marginTop: 8,
                                        borderTop: '0.5px solid var(--quote-preview-border)',
                                        paddingTop: 8,
                                    }, children: _jsx("a", { href: quotedVideoEmbed.url, target: "_blank", rel: "noopener noreferrer", onClick: (e) => e.stopPropagation(), style: {
                                            display: 'block',
                                            textDecoration: 'none',
                                            color: 'inherit',
                                        }, children: _jsxs("div", { style: {
                                                border: '1px solid var(--quote-preview-border)',
                                                borderRadius: 12,
                                                background: 'var(--quote-preview-surface)',
                                                overflow: 'hidden',
                                            }, children: [quotedVideoEmbed.thumb && (_jsx("div", { style: { aspectRatio: '1.91 / 1', width: '100%', background: 'var(--fill-2)', overflow: 'hidden' }, children: _jsx("img", { src: quotedVideoEmbed.thumb, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } }) })), _jsxs("div", { style: { padding: '9px 10px 10px' }, children: [_jsx("div", { style: {
                                                                fontSize: 'var(--type-meta-sm-size)',
                                                                lineHeight: 'var(--type-meta-sm-line)',
                                                                color: 'var(--label-3)',
                                                                fontWeight: 700,
                                                                marginBottom: 4,
                                                            }, children: "Linked media" }), _jsx("div", { style: {
                                                                fontSize: 'var(--type-label-md-size)',
                                                                lineHeight: 'var(--type-label-md-line)',
                                                                color: 'var(--label-1)',
                                                                fontWeight: 700,
                                                                marginBottom: 2,
                                                            }, children: quotedVideoEmbed.title || quotedVideoEmbed.domain }), _jsx("div", { style: {
                                                                fontSize: 'var(--type-meta-md-size)',
                                                                lineHeight: 'var(--type-meta-md-line)',
                                                                color: 'var(--label-3)',
                                                            }, children: quotedVideoEmbed.domain })] })] }) }) })), quoteEmbed.externalLink && (_jsx("div", { style: {
                                        marginTop: 8,
                                        paddingTop: 8,
                                        borderTop: '0.5px solid var(--quote-preview-border)',
                                    }, children: _jsx("a", { href: quoteEmbed.externalLink.url, target: "_blank", rel: "noopener noreferrer", onClick: (e) => e.stopPropagation(), style: {
                                            display: 'block',
                                            textDecoration: 'none',
                                            color: 'inherit',
                                        }, children: _jsxs("div", { style: {
                                                border: '1px solid var(--quote-preview-border)',
                                                borderRadius: 12,
                                                background: 'var(--quote-preview-surface)',
                                                overflow: 'hidden',
                                            }, children: [quoteEmbed.externalLink.thumb && (_jsx("div", { style: { aspectRatio: '1.91 / 1', width: '100%', background: 'var(--fill-2)', overflow: 'hidden' }, children: _jsx("img", { src: quoteEmbed.externalLink.thumb, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } }) })), _jsxs("div", { style: { padding: '9px 10px 10px' }, children: [_jsx("div", { style: {
                                                                fontSize: 'var(--type-meta-sm-size)',
                                                                lineHeight: 'var(--type-meta-sm-line)',
                                                                color: 'var(--label-3)',
                                                                fontWeight: 700,
                                                                marginBottom: 4,
                                                            }, children: "Shared link" }), _jsx("div", { style: {
                                                                fontSize: 'var(--type-label-md-size)',
                                                                lineHeight: 'var(--type-label-md-line)',
                                                                color: 'var(--label-1)',
                                                                fontWeight: 700,
                                                                marginBottom: 2,
                                                            }, children: quoteEmbed.externalLink.title || quoteEmbed.externalLink.domain }), _jsx("div", { style: {
                                                                fontSize: 'var(--type-meta-md-size)',
                                                                lineHeight: 'var(--type-meta-md-line)',
                                                                color: 'var(--label-3)',
                                                            }, children: quoteEmbed.externalLink.domain }), quoteEmbed.externalLink.description && (_jsx("p", { className: "clamp-2", style: {
                                                                margin: '6px 0 0',
                                                                fontSize: 'var(--type-meta-md-size)',
                                                                lineHeight: 'var(--type-meta-md-line)',
                                                                color: 'var(--label-2)',
                                                            }, children: quoteEmbed.externalLink.description }))] })] }) }) }))] })), externalEmbed && (_jsxs("a", { href: externalEmbed.url, target: "_blank", rel: "noopener noreferrer", onClick: (e) => e.stopPropagation(), style: {
                                display: 'block',
                                marginTop: post.content.trim().length > 0 ? 10 : 0,
                                border: '1px solid var(--quote-preview-border)',
                                borderRadius: 12,
                                background: 'var(--quote-preview-surface)',
                                overflow: 'hidden',
                                textDecoration: 'none',
                                color: 'inherit',
                            }, children: [externalEmbed.thumb && (_jsx("div", { style: { aspectRatio: '1.91 / 1', width: '100%', background: 'var(--fill-2)', overflow: 'hidden' }, children: _jsx("img", { src: externalEmbed.thumb, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } }) })), _jsxs("div", { style: {
                                        padding: '10px 12px',
                                    }, children: [_jsx("div", { style: {
                                                fontSize: 'var(--type-meta-sm-size)',
                                                lineHeight: 'var(--type-meta-sm-line)',
                                                color: 'var(--label-3)',
                                                fontWeight: 700,
                                                marginBottom: 4,
                                            }, children: "Shared link" }), _jsx("div", { style: {
                                                fontSize: 'var(--type-label-md-size)',
                                                lineHeight: 'var(--type-label-md-line)',
                                                color: 'var(--label-1)',
                                                fontWeight: 700,
                                                marginBottom: 2,
                                            }, children: externalEmbed.title || externalEmbed.domain }), _jsx("div", { style: {
                                                fontSize: 'var(--type-meta-md-size)',
                                                lineHeight: 'var(--type-meta-md-line)',
                                                color: 'var(--label-3)',
                                            }, children: externalEmbed.domain }), externalEmbed.description && (_jsx("p", { className: "clamp-2", style: {
                                                margin: '6px 0 0',
                                                fontSize: 'var(--type-meta-md-size)',
                                                lineHeight: 'var(--type-meta-md-line)',
                                                color: 'var(--label-2)',
                                            }, children: externalEmbed.description }))] })] }))] }) })] }));
};
export default ContextPost;
//# sourceMappingURL=ContextPost.js.map