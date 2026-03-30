import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import InlineTranslation, { TranslateIcon } from './InlineTranslation';
import { AnimatePresence, motion } from 'framer-motion';
import { formatTime, formatCount } from '../data/mockData';
import { fetchOGData } from '../og.js';
import VideoPlayer from './VideoPlayer';
import TwemojiText from './TwemojiText';
import { useTranslationStore } from '../store/translationStore.js';
import { translationClient } from '../lib/i18n/client.js';
import { heuristicDetectLanguage } from '../lib/i18n/detect.js';
import { hasMeaningfulTranslation, isLikelySameLanguage } from '../lib/i18n/normalize.js';
import { OfficialSportsBadge, SportsPostIndicator } from './SportsAccountBadge.js';
import { sportsFeedService } from '../services/sportsFeed.js';
import { useSensitiveMediaStore } from '../store/sensitiveMediaStore.js';
import { detectSensitiveMedia } from '../lib/moderation/sensitiveMedia.js';
import { useProfileNavigation } from '../hooks/useProfileNavigation.js';
import { useUiStore } from '../store/uiStore.js';
import { recordSensitiveMediaImpression, recordSensitiveMediaReveal, recordSensitiveMediaRehide, } from '../perf/sensitiveMediaTelemetry.js';
import { openExternalUrl } from '../lib/safety/externalUrl.js';
export default function PostCard({ post, onOpenStory, onViewProfile, onToggleRepost, onToggleLike, onQuote, onReply, onBookmark, onMore, index, timelineHint, replyingTo, hasContextAbove }) {
    const [showRepostMenu, setShowRepostMenu] = useState(false);
    const [expandedAltIndex, setExpandedAltIndex] = useState(null);
    const [activeMediaIndex, setActiveMediaIndex] = useState(0);
    const [mediaViewportWidth, setMediaViewportWidth] = useState(0);
    const [isLightboxOpen, setIsLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);
    const [lightboxViewportWidth, setLightboxViewportWidth] = useState(0);
    const [isLightboxZoomed, setIsLightboxZoomed] = useState(false);
    const mediaScrollRef = useRef(null);
    const lightboxScrollRef = useRef(null);
    const { policy, byId, upsertTranslation } = useTranslationStore();
    const { policy: sensitivePolicy, revealedPostIds, revealPost, hidePost, } = useSensitiveMediaStore();
    const navigateToProfile = useProfileNavigation();
    const openExploreSearch = useUiStore((state) => state.openExploreSearch);
    const mediaItems = post.media ?? [];
    const carouselItems = useMemo(() => {
        const items = mediaItems.map((img, idx) => ({
            kind: 'image',
            key: `img-${idx}`,
            url: img.url,
            alt: img.alt ?? '',
            ...(typeof img.aspectRatio === 'number' ? { aspectRatio: img.aspectRatio } : {}),
        }));
        if (post.embed?.type === 'video') {
            items.push({
                kind: 'video',
                key: 'embed-video',
                url: post.embed.url,
                ...(post.embed.thumb ? { thumb: post.embed.thumb } : {}),
                ...(post.embed.title ? { title: post.embed.title } : {}),
                domain: post.embed.domain,
                ...(typeof post.embed.aspectRatio === 'number' ? { aspectRatio: post.embed.aspectRatio } : {}),
            });
        }
        return items;
    }, [mediaItems, post.embed]);
    const lightboxItems = useMemo(() => carouselItems.filter((item) => item.kind === 'image'), [carouselItems]);
    const carouselToLightboxIndex = useMemo(() => {
        const map = [];
        let imageIndex = 0;
        for (let i = 0; i < carouselItems.length; i += 1) {
            const item = carouselItems[i];
            if (!item)
                continue;
            if (item.kind === 'image') {
                map[i] = imageIndex;
                imageIndex += 1;
            }
            else {
                map[i] = -1;
            }
        }
        return map;
    }, [carouselItems]);
    const detectedPostLanguage = useMemo(() => heuristicDetectLanguage(post.content), [post.content]);
    const sensitiveImpressionLoggedRef = useRef(false);
    // Lazy-fetch author metadata for external link cards.
    // ATProto's external embed spec doesn't carry author/fediverse fields, so we
    // fetch them from the article page's meta tags (cached in og.ts).
    const [fetchedAuthor, setFetchedAuthor] = useState(null);
    const externalEmbedUrl = post.embed?.type === 'external' ? post.embed.url : null;
    useEffect(() => {
        if (!externalEmbedUrl)
            return;
        // Skip if the API already gave us author info
        if (post.embed?.type === 'external' && post.embed.authorName)
            return;
        let cancelled = false;
        fetchOGData(externalEmbedUrl).then((meta) => {
            if (cancelled || !meta)
                return;
            if (meta.author || meta.authorHandle) {
                setFetchedAuthor({
                    ...(meta.author ? { name: meta.author } : {}),
                    ...(meta.authorHandle ? { handle: meta.authorHandle } : {}),
                    ...(meta.authorProfileUrl ? { profileUrl: meta.authorProfileUrl } : {}),
                });
            }
        });
        return () => { cancelled = true; };
    }, [externalEmbedUrl]);
    const storyTitle = post.content.slice(0, 80);
    const openActorProfile = (actor) => {
        if (!actor)
            return;
        if (onViewProfile) {
            onViewProfile(actor);
            return;
        }
        void navigateToProfile(actor);
    };
    const handleProfileClick = (e) => {
        e.stopPropagation();
        openActorProfile(post.author.did || post.author.handle);
    };
    const handleMentionClick = (handle) => {
        openActorProfile(handle);
    };
    const handleHashtagClick = (tag) => {
        const normalized = tag.replace(/^#/, '').trim();
        if (!normalized)
            return;
        openExploreSearch(normalized);
    };
    // Handle "open story" click
    const handleCardClick = (e) => {
        // Don't trigger if clicking interactive elements
        if (e.target.closest('button, a, .video-player-wrapper')) {
            return;
        }
        onOpenStory({ id: post.id, type: 'post', title: storyTitle });
    };
    const handleRepostToggle = (e) => {
        e.stopPropagation();
        setShowRepostMenu(prev => !prev);
    };
    const sportsMetadata = useMemo(() => sportsFeedService.extractSportsMetadata(post), [post]);
    const sensitiveMedia = useMemo(() => detectSensitiveMedia(post), [post]);
    const isSensitiveMedia = sensitiveMedia.isSensitive;
    const isSensitiveMediaRevealed = !!revealedPostIds[post.id];
    const shouldBlurSensitiveMedia = sensitivePolicy.blurSensitiveMedia && isSensitiveMedia && !isSensitiveMediaRevealed;
    const sensitiveReasonLabel = sensitiveMedia.reasons.slice(0, 2).join(', ');
    const displayNameKey = `displayName:${post.author.did}`;
    const translatedDisplayName = byId[displayNameKey]?.translatedText;
    const canAutoInlineTranslate = useMemo(() => {
        const textLength = post.content.trim().length;
        if (textLength === 0 || textLength > 280)
            return false;
        if (detectedPostLanguage.language !== 'und' && isLikelySameLanguage(detectedPostLanguage.language, policy.userLanguage))
            return false;
        return true;
    }, [detectedPostLanguage.language, policy.userLanguage, post.content]);
    const cardDescription = post.embed?.type === 'external' ? (post.embed.description ?? '') : '';
    const cardTranslationId = post.embed?.type === 'external' ? `card:${post.id}:description` : null;
    const detectedCardLanguage = useMemo(() => {
        if (!cardDescription.trim())
            return { language: 'und', confidence: 0 };
        return heuristicDetectLanguage(cardDescription);
    }, [cardDescription]);
    useEffect(() => {
        if (!policy.autoTranslateFeed || !canAutoInlineTranslate)
            return;
        if (useTranslationStore.getState().byId[displayNameKey])
            return;
        // Keep display-name translation in sync with feed auto-translate policy.
        const dn = post.author.displayName || post.author.handle;
        if (!dn)
            return;
        const dnDetected = heuristicDetectLanguage(dn);
        if (dnDetected.language === 'und' || isLikelySameLanguage(dnDetected.language, policy.userLanguage))
            return;
        translationClient.translateInline({
            id: displayNameKey,
            sourceText: dn,
            targetLang: policy.userLanguage,
            mode: policy.localOnlyMode ? 'local_private' : 'server_default',
        }).then((result) => {
            if (!hasMeaningfulTranslation(dn, result.translatedText))
                return;
            upsertTranslation(result);
        }).catch(() => { });
    }, [canAutoInlineTranslate, displayNameKey, policy.autoTranslateFeed, policy.localOnlyMode, policy.userLanguage, post.author.displayName, post.author.handle, upsertTranslation]);
    useEffect(() => {
        if (!shouldBlurSensitiveMedia || sensitiveImpressionLoggedRef.current)
            return;
        sensitiveImpressionLoggedRef.current = true;
        recordSensitiveMediaImpression(sensitiveMedia.reasons.length, sensitivePolicy.telemetryOptIn);
    }, [shouldBlurSensitiveMedia, sensitiveMedia.reasons.length, sensitivePolicy.telemetryOptIn]);
    useEffect(() => {
        setExpandedAltIndex(null);
        setActiveMediaIndex(0);
        if (mediaScrollRef.current) {
            mediaScrollRef.current.scrollTo({ left: 0, behavior: 'auto' });
        }
    }, [post.id, carouselItems.length]);
    useEffect(() => {
        const node = mediaScrollRef.current;
        if (!node)
            return;
        const updateViewportWidth = () => setMediaViewportWidth(node.clientWidth);
        updateViewportWidth();
        if (typeof ResizeObserver === 'undefined')
            return;
        const observer = new ResizeObserver(updateViewportWidth);
        observer.observe(node);
        return () => observer.disconnect();
    }, [post.id, carouselItems.length]);
    useEffect(() => {
        if (!isLightboxOpen || typeof document === 'undefined')
            return;
        const priorOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = priorOverflow;
        };
    }, [isLightboxOpen]);
    useEffect(() => {
        if (!isLightboxOpen)
            return;
        const onKeyDown = (event) => {
            if (!lightboxItems.length)
                return;
            if (event.key === 'Escape') {
                setIsLightboxOpen(false);
            }
            else if (event.key === 'ArrowRight') {
                setIsLightboxZoomed(false);
                setLightboxIndex((prev) => Math.min(lightboxItems.length - 1, prev + 1));
            }
            else if (event.key === 'ArrowLeft') {
                setIsLightboxZoomed(false);
                setLightboxIndex((prev) => Math.max(0, prev - 1));
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isLightboxOpen, lightboxItems.length]);
    useEffect(() => {
        if (!isLightboxOpen)
            return;
        const node = lightboxScrollRef.current;
        if (!node)
            return;
        const width = lightboxViewportWidth || node.clientWidth;
        if (!width)
            return;
        node.scrollTo({ left: lightboxIndex * width, behavior: 'smooth' });
    }, [isLightboxOpen, lightboxIndex, lightboxViewportWidth]);
    useEffect(() => {
        if (!isLightboxOpen)
            return;
        const node = lightboxScrollRef.current;
        if (!node)
            return;
        const updateViewportWidth = () => setLightboxViewportWidth(node.clientWidth);
        updateViewportWidth();
        if (typeof ResizeObserver === 'undefined')
            return;
        const observer = new ResizeObserver(updateViewportWidth);
        observer.observe(node);
        return () => observer.disconnect();
    }, [isLightboxOpen]);
    useEffect(() => {
        if (shouldBlurSensitiveMedia)
            return;
        sensitiveImpressionLoggedRef.current = false;
    }, [shouldBlurSensitiveMedia]);
    const handleRevealSensitiveMedia = (e) => {
        e.stopPropagation();
        if (!sensitivePolicy.allowReveal)
            return;
        revealPost(post.id);
        recordSensitiveMediaReveal(sensitiveMedia.reasons.length, sensitivePolicy.telemetryOptIn);
    };
    const handleHideSensitiveMedia = (e) => {
        e.stopPropagation();
        hidePost(post.id);
        recordSensitiveMediaRehide(sensitiveMedia.reasons.length, sensitivePolicy.telemetryOptIn);
    };
    return (_jsxs(motion.div, { layout: "position", initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, delay: Math.min(index * 0.05, 0.3) }, onClick: handleCardClick, style: {
            background: 'transparent',
            borderRadius: 0,
            padding: '14px 16px 12px',
            marginBottom: 0,
            boxShadow: 'none',
            border: 'none',
            borderBottom: '0.5px solid color-mix(in srgb, var(--sep) 40%, transparent)',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'visible',
        }, children: [hasContextAbove && (_jsx("div", { style: {
                    position: 'absolute',
                    top: 0,
                    left: 35,
                    width: 2,
                    // Stop just above the avatar so the connector does not cut through it.
                    height: 12,
                    backgroundColor: 'var(--sep-opaque)',
                } })), _jsx("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 10 }, children: _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10 }, children: [_jsx("button", { type: "button", onClick: handleProfileClick, style: {
                                width: 40, height: 40, borderRadius: '50%',
                                background: 'var(--fill-2)', overflow: 'hidden',
                                flexShrink: 0, cursor: 'pointer', border: 'none', padding: 0,
                            }, children: post.author.avatar ? (_jsx("img", { src: post.author.avatar, alt: post.author.handle, style: { width: '100%', height: '100%', objectFit: 'cover' } })) : (_jsx("div", { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--label-2)', fontWeight: 700 }, children: post.author.handle[0] })) }), _jsxs("div", { onClick: handleProfileClick, role: "button", tabIndex: 0, className: "interactive-link-surface", onKeyDown: (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openActorProfile(post.author.did || post.author.handle);
                                }
                            }, style: { display: 'flex', flexDirection: 'column', gap: 2, cursor: 'pointer', minWidth: 0 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }, children: [_jsx("span", { style: { fontSize: 'var(--type-ui-title-sm-size)', lineHeight: 'var(--type-ui-title-sm-line)', fontWeight: 700, letterSpacing: 'var(--type-ui-title-sm-track)', color: 'var(--label-1)' }, children: translatedDisplayName || post.author.displayName || post.author.handle }), sportsMetadata.isOfficial ? _jsx(OfficialSportsBadge, { authorDid: post.author.did, size: "small" }) : null, post.article && (_jsx("span", { style: { background: 'var(--fill-3)', color: 'var(--label-2)', fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5, border: '1px solid var(--stroke-dim)' }, children: "Article" })), _jsxs("span", { style: { fontSize: 'var(--type-label-md-size)', lineHeight: 'var(--type-label-md-line)', letterSpacing: 'var(--type-label-md-track)', color: 'var(--label-3)' }, children: ["\u00B7 ", formatTime(post.createdAt)] })] }), _jsxs("span", { style: { fontSize: 'var(--type-label-md-size)', lineHeight: 'var(--type-label-md-line)', letterSpacing: 'var(--type-label-md-track)', color: 'var(--label-3)' }, children: ["@", post.author.handle] })] })] }) }), replyingTo && (_jsxs("p", { style: { fontSize: 'var(--type-meta-md-size)', lineHeight: 'var(--type-meta-md-line)', letterSpacing: 'var(--type-meta-md-track)', color: 'var(--label-3)', margin: '0 0 8px', fontWeight: 500 }, children: ["\u21B3 Replying to ", _jsxs("button", { className: "interactive-link-button", onClick: (e) => { e.stopPropagation(); handleMentionClick(replyingTo); }, style: { color: 'var(--blue)', font: 'inherit', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }, children: ["@", replyingTo] })] })), timelineHint && (_jsxs("div", { style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    margin: replyingTo ? '0 0 10px' : '0 0 8px',
                    padding: '4px 9px',
                    borderRadius: 999,
                    border: '1px solid var(--stroke-dim)',
                    background: 'var(--surface-2)',
                    color: 'var(--label-3)',
                    fontSize: 'var(--type-meta-sm-size)',
                    lineHeight: 'var(--type-meta-sm-line)',
                    letterSpacing: 'var(--type-meta-sm-track)',
                    fontWeight: 600,
                }, children: [_jsx("span", { children: timelineHint.direction }), timelineHint.branchDepth > 0 && _jsxs("span", { children: ["depth ", timelineHint.branchDepth] }), timelineHint.factualSignalPresent && _jsx("span", { children: "factual" }), timelineHint.sourceSupportPresent && _jsx("span", { children: "source-backed" })] })), post.article && (_jsxs("div", { style: { marginBottom: 12 }, children: [post.article.banner && (_jsx("div", { style: { marginBottom: 10, borderRadius: 10, overflow: 'hidden', background: 'var(--fill-2)', aspectRatio: '16/9' }, children: _jsx("img", { src: post.article.banner, alt: post.article.title || 'Article cover', style: { width: '100%', height: '100%', objectFit: 'cover' } }) })), post.article.title && (_jsx("h2", { style: { fontSize: 'var(--type-ui-title-md-size)', fontWeight: 800, color: 'var(--label-1)', marginBottom: 6, lineHeight: 1.25 }, children: post.article.title })), _jsx("p", { style: { fontSize: 'var(--type-body-md-size)', color: 'var(--label-2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }, children: _jsx(TwemojiText, { text: post.article.body, onMention: handleMentionClick, onHashtag: handleHashtagClick }) }), _jsx("div", { style: { marginTop: 8, fontSize: 'var(--type-meta-md-size)', color: 'var(--blue)', fontWeight: 700, letterSpacing: -0.1, textDecoration: 'underline', textUnderlineOffset: 2 }, children: "Read full article \u2192" })] })), post.content && !post.article && (_jsx(InlineTranslation, { postId: post.id, sourceText: post.content, sourceLang: detectedPostLanguage.language, targetLang: policy.userLanguage, autoTranslate: policy.autoTranslateFeed && canAutoInlineTranslate, localOnlyMode: policy.localOnlyMode, showTrigger: detectedPostLanguage.language === 'und' || !isLikelySameLanguage(detectedPostLanguage.language, policy.userLanguage), renderText: (displayText) => (_jsx("p", { style: {
                        fontSize: 'var(--type-body-md-size)', lineHeight: 'var(--type-body-md-line)', letterSpacing: 'var(--type-body-md-track)', color: 'var(--label-1)',
                        marginBottom: post.embed || post.media ? 12 : 6,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                    }, children: _jsx(TwemojiText, { text: displayText, facets: displayText === post.content ? post.facets : undefined, onMention: handleMentionClick, onHashtag: handleHashtagClick }) })) })), sportsMetadata.isSports ? (_jsx("div", { style: { marginBottom: 8 }, children: _jsx(SportsPostIndicator, { postType: sportsMetadata.postType, isLive: sportsMetadata.isLive, hasVideo: post.embed?.type === 'video' }) })) : null, shouldBlurSensitiveMedia && (_jsx("div", { style: {
                    marginBottom: 10,
                    border: '1px solid color-mix(in srgb, var(--orange) 35%, var(--sep))',
                    borderRadius: 12,
                    background: 'color-mix(in srgb, var(--surface-card) 82%, var(--orange) 10%)',
                    padding: '10px 12px',
                }, children: _jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, children: [_jsxs("div", { children: [_jsx("p", { style: { margin: 0, fontSize: 'var(--type-meta-md-size)', lineHeight: 'var(--type-meta-md-line)', fontWeight: 700, color: 'var(--label-1)' }, children: "Sensitive content warning" }), _jsx("p", { style: { margin: '4px 0 0', fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', color: 'var(--label-3)' }, children: sensitiveReasonLabel ? `Label: ${sensitiveReasonLabel}` : 'This media is flagged for sexual content, nudity, or graphic violence.' })] }), sensitivePolicy.allowReveal && (_jsx("button", { onClick: handleRevealSensitiveMedia, style: { border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 'var(--type-meta-md-size)', lineHeight: 'var(--type-meta-md-line)', fontWeight: 700, padding: 0, cursor: 'pointer' }, children: "Show media" }))] }) })), isSensitiveMedia && isSensitiveMediaRevealed && sensitivePolicy.blurSensitiveMedia && sensitivePolicy.allowReveal && (_jsx("div", { style: { marginBottom: 10 }, children: _jsx("button", { onClick: handleHideSensitiveMedia, style: { border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 'var(--type-meta-md-size)', lineHeight: 'var(--type-meta-md-line)', fontWeight: 700, padding: 0, cursor: 'pointer' }, children: "Hide sensitive media" }) })), carouselItems.length > 0 && (_jsxs("div", { style: { position: 'relative' }, children: [_jsxs("div", { style: {
                            marginTop: 8,
                            borderRadius: 12,
                            overflow: 'hidden',
                            filter: shouldBlurSensitiveMedia ? 'blur(22px)' : 'none',
                            transition: 'filter 0.18s ease',
                            pointerEvents: shouldBlurSensitiveMedia ? 'none' : 'auto',
                            position: 'relative',
                        }, children: [_jsx("div", { ref: mediaScrollRef, onScroll: (e) => {
                                    const node = e.currentTarget;
                                    const width = mediaViewportWidth || node.clientWidth;
                                    if (!width)
                                        return;
                                    const stride = carouselItems.length > 1 ? Math.max(1, width - 20) : width;
                                    const nextIndex = Math.max(0, Math.min(carouselItems.length - 1, Math.round(node.scrollLeft / stride)));
                                    setActiveMediaIndex(nextIndex);
                                }, style: {
                                    display: 'flex',
                                    overflowX: carouselItems.length > 1 ? 'auto' : 'hidden',
                                    overscrollBehaviorX: 'contain',
                                    scrollSnapType: carouselItems.length > 1 ? 'x mandatory' : 'none',
                                    scrollPaddingInline: carouselItems.length > 1 ? 10 : 0,
                                    paddingInline: carouselItems.length > 1 ? 10 : 0,
                                    scrollBehavior: 'smooth',
                                    scrollSnapStop: 'always',
                                    WebkitOverflowScrolling: 'touch',
                                    scrollbarWidth: 'none',
                                    touchAction: 'pan-y pinch-zoom',
                                    gap: carouselItems.length > 1 ? 8 : 0,
                                }, children: carouselItems.map((item, i) => {
                                    const alt = item.kind === 'image' ? item.alt.trim() : '';
                                    const hasAlt = alt.length > 0;
                                    return (_jsxs(motion.div, { animate: {
                                            scale: carouselItems.length > 1 ? (i === activeMediaIndex ? 1 : 0.985) : 1,
                                            y: carouselItems.length > 1 ? (i === activeMediaIndex ? 0 : 2) : 0,
                                            opacity: i === activeMediaIndex ? 1 : 0.96,
                                        }, transition: {
                                            type: 'spring',
                                            stiffness: 420,
                                            damping: 34,
                                            mass: 0.7,
                                        }, style: {
                                            aspectRatio: typeof item.aspectRatio === 'number' ? String(item.aspectRatio) : '16/9',
                                            position: 'relative',
                                            background: 'var(--fill-2)',
                                            flex: carouselItems.length > 1 ? '0 0 calc(100% - 28px)' : '0 0 100%',
                                            minWidth: carouselItems.length > 1 ? 'calc(100% - 28px)' : '100%',
                                            scrollSnapAlign: 'start',
                                            borderRadius: 10,
                                            overflow: 'hidden',
                                        }, children: [item.kind === 'image' ? (_jsx("img", { src: item.url, alt: item.alt, onClick: (e) => {
                                                    e.stopPropagation();
                                                    const imageIndex = carouselToLightboxIndex[i];
                                                    if (typeof imageIndex !== 'number' || imageIndex < 0)
                                                        return;
                                                    setLightboxIndex(imageIndex);
                                                    setIsLightboxZoomed(false);
                                                    setIsLightboxOpen(true);
                                                }, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' } })) : (_jsxs("div", { className: "video-player-wrapper", onClick: (e) => e.stopPropagation(), style: { position: 'absolute', inset: 0 }, children: [_jsx(VideoPlayer, { url: item.url, postId: post.id, ...(item.thumb ? { thumb: item.thumb } : {}), ...(typeof item.aspectRatio === 'number' ? { aspectRatio: item.aspectRatio } : {}), autoplay: false }), item.title && (_jsxs("div", { style: {
                                                            position: 'absolute',
                                                            left: 10,
                                                            right: 10,
                                                            bottom: 10,
                                                            background: 'rgba(0,0,0,0.42)',
                                                            borderRadius: 8,
                                                            padding: '8px 10px',
                                                            backdropFilter: 'blur(2px)',
                                                        }, children: [_jsx("p", { style: { margin: 0, fontWeight: 700, fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', color: '#fff' }, children: item.title }), _jsx("p", { style: { margin: '3px 0 0', fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', color: 'rgba(255,255,255,0.82)' }, children: item.domain })] }))] })), hasAlt && (_jsx("button", { onClick: (e) => {
                                                    e.stopPropagation();
                                                    setExpandedAltIndex(prev => (prev === i ? null : i));
                                                }, style: {
                                                    position: 'absolute',
                                                    right: 8,
                                                    bottom: 8,
                                                    border: 'none',
                                                    background: 'rgba(0,0,0,0.56)',
                                                    color: '#fff',
                                                    fontSize: 11,
                                                    fontWeight: 800,
                                                    borderRadius: 999,
                                                    padding: '4px 8px',
                                                    cursor: 'pointer',
                                                }, children: "ALT" }))] }, i));
                                }) }), carouselItems.length > 1 && (_jsxs(_Fragment, { children: [_jsxs("div", { style: {
                                            position: 'absolute',
                                            top: 10,
                                            right: 10,
                                            borderRadius: 999,
                                            background: 'rgba(0,0,0,0.52)',
                                            color: '#fff',
                                            fontSize: 11,
                                            fontWeight: 700,
                                            padding: '4px 9px',
                                        }, children: [activeMediaIndex + 1, "/", carouselItems.length] }), _jsxs("div", { style: {
                                            position: 'absolute',
                                            left: 8,
                                            right: 8,
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            pointerEvents: 'none',
                                        }, children: [_jsx("button", { onClick: (e) => {
                                                    e.stopPropagation();
                                                    const nextIndex = Math.max(0, activeMediaIndex - 1);
                                                    setExpandedAltIndex(prev => (prev !== null && prev !== nextIndex ? null : prev));
                                                    setActiveMediaIndex(nextIndex);
                                                    const width = mediaViewportWidth || mediaScrollRef.current?.clientWidth || 0;
                                                    const stride = carouselItems.length > 1 ? Math.max(1, width - 20) : width;
                                                    mediaScrollRef.current?.scrollTo({ left: nextIndex * stride, behavior: 'smooth' });
                                                }, disabled: activeMediaIndex === 0, style: {
                                                    pointerEvents: 'auto',
                                                    width: 28,
                                                    height: 28,
                                                    borderRadius: '50%',
                                                    border: 'none',
                                                    background: 'rgba(0,0,0,0.48)',
                                                    color: '#fff',
                                                    fontSize: 16,
                                                    fontWeight: 700,
                                                    cursor: activeMediaIndex === 0 ? 'default' : 'pointer',
                                                    opacity: activeMediaIndex === 0 ? 0.4 : 1,
                                                }, children: "\u2039" }), _jsx("button", { onClick: (e) => {
                                                    e.stopPropagation();
                                                    const nextIndex = Math.min(carouselItems.length - 1, activeMediaIndex + 1);
                                                    setExpandedAltIndex(prev => (prev !== null && prev !== nextIndex ? null : prev));
                                                    setActiveMediaIndex(nextIndex);
                                                    const width = mediaViewportWidth || mediaScrollRef.current?.clientWidth || 0;
                                                    const stride = carouselItems.length > 1 ? Math.max(1, width - 20) : width;
                                                    mediaScrollRef.current?.scrollTo({ left: nextIndex * stride, behavior: 'smooth' });
                                                }, disabled: activeMediaIndex === carouselItems.length - 1, style: {
                                                    pointerEvents: 'auto',
                                                    width: 28,
                                                    height: 28,
                                                    borderRadius: '50%',
                                                    border: 'none',
                                                    background: 'rgba(0,0,0,0.48)',
                                                    color: '#fff',
                                                    fontSize: 16,
                                                    fontWeight: 700,
                                                    cursor: activeMediaIndex === carouselItems.length - 1 ? 'default' : 'pointer',
                                                    opacity: activeMediaIndex === carouselItems.length - 1 ? 0.4 : 1,
                                                }, children: "\u203A" })] }), _jsx("div", { style: {
                                            position: 'absolute',
                                            left: 0,
                                            right: 0,
                                            bottom: 8,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 5,
                                            pointerEvents: 'none',
                                        }, children: carouselItems.map((_, dotIndex) => (_jsx("span", { style: {
                                                width: dotIndex === activeMediaIndex ? 16 : 6,
                                                height: 6,
                                                borderRadius: 999,
                                                background: dotIndex === activeMediaIndex ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.5)',
                                                transition: 'all 0.2s ease',
                                            } }, dotIndex))) })] }))] }), shouldBlurSensitiveMedia && (_jsx("div", { style: {
                            position: 'absolute',
                            inset: 0,
                            borderRadius: 12,
                            background: 'linear-gradient(180deg, rgba(0,0,0,0.35), rgba(0,0,0,0.56))',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            fontSize: 12,
                            fontWeight: 700,
                            textAlign: 'center',
                            padding: 12,
                        }, children: "Sensitive media hidden" })), expandedAltIndex !== null && carouselItems[expandedAltIndex]?.kind === 'image' && !shouldBlurSensitiveMedia && (_jsxs("div", { onClick: (e) => e.stopPropagation(), style: {
                            marginTop: 8,
                            border: '1px solid var(--stroke-dim)',
                            borderRadius: 12,
                            background: 'var(--fill-1)',
                            padding: '10px 12px',
                        }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }, children: [_jsxs("span", { style: { fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', letterSpacing: 'var(--type-meta-sm-track)', fontWeight: 700, color: 'var(--label-3)' }, children: ["Media description ", expandedAltIndex + 1, "/", carouselItems.length] }), _jsx("button", { onClick: (e) => {
                                            e.stopPropagation();
                                            setExpandedAltIndex(null);
                                        }, style: { border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', fontWeight: 700, padding: 0, cursor: 'pointer' }, children: "Hide" })] }), _jsx("p", { style: { margin: 0, fontSize: 'var(--type-meta-md-size)', lineHeight: 'var(--type-meta-md-line)', letterSpacing: 'var(--type-meta-md-track)', color: 'var(--label-2)', whiteSpace: 'pre-wrap' }, children: (carouselItems[expandedAltIndex]?.kind === 'image' ? carouselItems[expandedAltIndex].alt : '').trim() })] }))] })), _jsx(AnimatePresence, { children: isLightboxOpen && lightboxItems.length > 0 && (_jsxs(motion.div, { onClick: (e) => {
                        e.stopPropagation();
                        setIsLightboxOpen(false);
                    }, initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.2, ease: 'easeOut' }, style: {
                        position: 'fixed',
                        inset: 0,
                        zIndex: 9999,
                        background: 'rgba(0,0,0,0.94)',
                        display: 'flex',
                        flexDirection: 'column',
                    }, children: [_jsxs(motion.div, { initial: { opacity: 0, y: -10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -10 }, transition: { type: 'spring', stiffness: 280, damping: 30 }, style: {
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '16px 16px 8px',
                                color: '#fff',
                                flexShrink: 0,
                            }, children: [_jsx("button", { onClick: (e) => {
                                        e.stopPropagation();
                                        setIsLightboxOpen(false);
                                    }, style: {
                                        border: 'none',
                                        background: 'rgba(255,255,255,0.14)',
                                        color: '#fff',
                                        borderRadius: 999,
                                        width: 32,
                                        height: 32,
                                        fontSize: 16,
                                        lineHeight: 1,
                                        cursor: 'pointer',
                                    }, children: "\u2715" }), _jsxs("span", { style: { fontSize: 'var(--type-label-sm-size)', lineHeight: 'var(--type-label-sm-line)', fontWeight: 700 }, children: [lightboxIndex + 1, "/", lightboxItems.length] }), _jsx("button", { onClick: (e) => {
                                        e.stopPropagation();
                                        setIsLightboxZoomed((prev) => !prev);
                                    }, style: {
                                        border: 'none',
                                        background: 'rgba(255,255,255,0.14)',
                                        color: '#fff',
                                        borderRadius: 999,
                                        padding: '7px 12px',
                                        fontSize: 'var(--type-meta-md-size)',
                                        lineHeight: 'var(--type-meta-md-line)',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                    }, children: isLightboxZoomed ? 'Zoom out' : 'Zoom in' })] }), _jsx(motion.div, { ref: lightboxScrollRef, onClick: (e) => e.stopPropagation(), onScroll: (e) => {
                                const node = e.currentTarget;
                                const width = lightboxViewportWidth || node.clientWidth;
                                if (!width)
                                    return;
                                const nextIndex = Math.max(0, Math.min(lightboxItems.length - 1, Math.round(node.scrollLeft / width)));
                                if (nextIndex !== lightboxIndex) {
                                    setLightboxIndex(nextIndex);
                                    setIsLightboxZoomed(false);
                                }
                            }, initial: { opacity: 0, scale: 0.985 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.985 }, transition: { type: 'spring', stiffness: 240, damping: 28, mass: 0.8 }, style: {
                                flex: 1,
                                display: 'flex',
                                overflowX: 'auto',
                                scrollSnapType: 'x mandatory',
                                scrollBehavior: 'smooth',
                                WebkitOverflowScrolling: 'touch',
                                touchAction: 'pan-y pinch-zoom',
                            }, children: lightboxItems.map((img, i) => {
                                const zoomedCurrent = isLightboxZoomed && i === lightboxIndex;
                                return (_jsx("div", { style: {
                                        flex: '0 0 100%',
                                        minWidth: '100%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: 12,
                                        scrollSnapAlign: 'start',
                                    }, children: _jsx("img", { src: img.url, alt: img.alt ?? '', onClick: (e) => {
                                            e.stopPropagation();
                                            if (i !== lightboxIndex)
                                                return;
                                            setIsLightboxZoomed((prev) => !prev);
                                        }, style: {
                                            maxWidth: '100%',
                                            maxHeight: '100%',
                                            objectFit: 'contain',
                                            transform: zoomedCurrent ? 'scale(2)' : 'scale(1)',
                                            transformOrigin: 'center center',
                                            transition: 'transform 0.24s cubic-bezier(0.18, 0.8, 0.2, 1)',
                                            cursor: zoomedCurrent ? 'zoom-out' : 'zoom-in',
                                        } }) }, `lightbox-${i}`));
                            }) })] })) }), post.embed?.type === 'external' && (() => {
                const externalUrl = post.embed.url;
                return (_jsxs("div", { role: "link", tabIndex: 0, onClick: (e) => {
                        e.stopPropagation();
                        openExternalUrl(externalUrl);
                    }, onKeyDown: (e) => {
                        if (e.key !== 'Enter' && e.key !== ' ')
                            return;
                        e.preventDefault();
                        e.stopPropagation();
                        openExternalUrl(externalUrl);
                    }, style: {
                        display: 'block', textDecoration: 'none',
                        border: '1px solid var(--stroke-dim)', borderRadius: 12,
                        overflow: 'hidden', marginTop: 8, cursor: 'pointer'
                    }, children: [post.embed.thumb && (_jsx("div", { style: { aspectRatio: '1.91 / 1', width: '100%', background: 'var(--fill-2)', overflow: 'hidden' }, children: _jsx("img", { src: post.embed.thumb, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' } }) })), _jsxs("div", { style: { padding: '10px 12px', background: 'var(--fill-1)' }, children: [_jsx("div", { style: { fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', letterSpacing: 'var(--type-meta-sm-track)', color: 'var(--label-3)', marginBottom: 3 }, children: post.embed.domain }), _jsx("div", { style: { fontSize: 'var(--type-label-lg-size)', lineHeight: 'var(--type-label-lg-line)', letterSpacing: 'var(--type-label-lg-track)', fontWeight: 600, color: 'var(--label-1)', marginBottom: 4 }, children: post.embed.title }), (() => {
                                    // Merge API-provided author (rare) with lazily fetched meta-tag author
                                    const authorName = post.embed.authorName ?? fetchedAuthor?.name;
                                    // authorHandle is a fediverse handle e.g. "@user@mastodon.social"
                                    const authorHandle = fetchedAuthor?.handle;
                                    const authorProfileUrl = fetchedAuthor?.profileUrl;
                                    const publisher = post.embed.publisher;
                                    const hasAuthor = !!(authorName || authorHandle || publisher);
                                    return (_jsxs(_Fragment, { children: [post.embed.description && cardTranslationId && (_jsx(InlineTranslation, { postId: cardTranslationId, sourceText: post.embed.description, sourceLang: detectedCardLanguage.language, targetLang: policy.userLanguage, localOnlyMode: policy.localOnlyMode, showTrigger: detectedCardLanguage.language === 'und' || !isLikelySameLanguage(detectedCardLanguage.language, policy.userLanguage), renderText: (displayText) => (_jsx("div", { style: { fontSize: 'var(--type-meta-md-size)', lineHeight: 'var(--type-meta-md-line)', letterSpacing: 'var(--type-meta-md-track)', color: 'var(--label-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: hasAuthor ? 6 : 0 }, children: displayText })) })), hasAuthor && (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4, paddingTop: 6, borderTop: '0.5px solid var(--stroke-dim)' }, children: [authorName && (_jsxs("span", { style: { fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', color: 'var(--label-2)' }, children: ["By ", _jsx("span", { style: { fontWeight: 600, color: 'var(--label-1)' }, children: authorName })] })), authorHandle && (authorProfileUrl ? (_jsx("a", { href: authorProfileUrl, target: "_blank", rel: "noopener noreferrer", onClick: (e) => e.stopPropagation(), style: { fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', color: 'var(--blue)', textDecoration: 'none' }, children: authorHandle })) : (_jsx("span", { style: { fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', color: 'var(--blue)' }, children: authorHandle }))), publisher && (_jsx("span", { style: { fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', color: 'var(--label-3)' }, children: (authorName || authorHandle) ? `· ${publisher}` : publisher }))] }))] }));
                                })()] })] }));
            })(), post.embed?.type === 'quote' && (() => {
                const quotedPost = post.embed.post;
                const quotedActor = quotedPost.author.did || quotedPost.author.handle;
                const quotedExternalEmbed = quotedPost.embed?.type === 'external' ? quotedPost.embed : null;
                const quotedVideoEmbed = quotedPost.embed?.type === 'video' ? quotedPost.embed : null;
                const shouldBlurQuotedImages = sensitivePolicy.blurSensitiveMedia && Boolean(quotedPost.sensitiveMedia?.isSensitive);
                return (_jsxs("div", { style: {
                        border: '1px solid var(--quote-border)', borderRadius: 12,
                        padding: '10px 12px', marginTop: 8, background: 'var(--quote-surface)'
                    }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }, children: [_jsxs("span", { style: {
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 5,
                                        fontSize: 'var(--type-meta-sm-size)',
                                        lineHeight: 'var(--type-meta-sm-line)',
                                        fontWeight: 800,
                                        color: 'var(--label-3)',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.04em',
                                    }, children: [_jsxs("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.25, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M3 7h10a4 4 0 010 8H9" }), _jsx("path", { d: "M13 7l-4 4 4 4" })] }), "Quote post"] }), _jsx("span", { style: { fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', color: 'var(--label-3)', fontWeight: 600 }, children: formatTime(quotedPost.createdAt) })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }, children: [_jsx("div", { style: { width: 20, height: 20, borderRadius: '50%', background: 'var(--fill-3)', overflow: 'hidden', flexShrink: 0 }, children: quotedPost.author.avatar
                                        ? _jsx("img", { src: quotedPost.author.avatar, alt: quotedPost.author.handle, style: { width: '100%', height: '100%' } })
                                        : _jsx("div", { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--label-2)', fontSize: 10, fontWeight: 700 }, children: ((quotedPost.author.displayName || quotedPost.author.handle || '?').trim().charAt(0) || '?').toUpperCase() }) }), _jsx("button", { className: "interactive-link-button", onClick: (e) => { e.stopPropagation(); void navigateToProfile(quotedActor); }, style: { fontWeight: 600, fontSize: 'var(--type-label-md-size)', lineHeight: 'var(--type-label-md-line)', letterSpacing: 'var(--type-label-md-track)', color: 'var(--label-1)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }, children: quotedPost.author.displayName || quotedPost.author.handle }), _jsxs("button", { className: "interactive-link-button", onClick: (e) => { e.stopPropagation(); void navigateToProfile(quotedActor); }, style: { fontSize: 'var(--type-meta-md-size)', lineHeight: 'var(--type-meta-md-line)', letterSpacing: 'var(--type-meta-md-track)', color: 'var(--label-3)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }, children: ["@", quotedPost.author.handle] })] }), _jsx("p", { style: { fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', letterSpacing: 'var(--type-body-sm-track)', color: 'var(--label-1)' }, children: _jsx(TwemojiText, { text: quotedPost.content, onMention: handleMentionClick, onHashtag: handleHashtagClick }) }), quotedPost.media && quotedPost.media.length > 0 && (_jsxs("div", { style: {
                                marginTop: quotedPost.content.trim().length > 0 ? 8 : 0,
                                position: 'relative',
                                borderRadius: 8,
                                overflow: 'hidden',
                            }, children: [_jsx("div", { style: {
                                        display: 'grid',
                                        gridTemplateColumns: quotedPost.media.length === 1 ? '1fr' : '1fr 1fr',
                                        gap: 2,
                                        filter: shouldBlurQuotedImages ? 'blur(22px)' : 'none',
                                        transition: 'filter 0.18s ease',
                                        pointerEvents: shouldBlurQuotedImages ? 'none' : 'auto',
                                    }, children: quotedPost.media.slice(0, 4).map((img, idx) => (_jsx("div", { style: {
                                            aspectRatio: quotedPost.media.length === 1 && img.aspectRatio ? String(img.aspectRatio) : '1 / 1',
                                            background: 'var(--fill-2)',
                                            overflow: 'hidden',
                                            borderRadius: quotedPost.media.length === 1 ? 8 : 0,
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
                            }, children: _jsxs("div", { style: { border: '1px solid var(--quote-preview-border)', borderRadius: 12, background: 'var(--quote-preview-surface)', overflow: 'hidden' }, children: [quotedExternalEmbed.thumb && (_jsx("div", { style: { marginBottom: 0, overflow: 'hidden', background: 'var(--fill-2)', aspectRatio: '1.91 / 1' }, children: _jsx("img", { src: quotedExternalEmbed.thumb, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } }) })), _jsxs("div", { style: { padding: '9px 10px 10px' }, children: [_jsx("div", { style: { fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', color: 'var(--label-3)', marginBottom: 3 }, children: quotedExternalEmbed.domain }), _jsx("div", { style: { fontSize: 'var(--type-label-md-size)', lineHeight: 'var(--type-label-md-line)', color: 'var(--label-1)', fontWeight: 700, marginBottom: quotedExternalEmbed.description ? 4 : 0 }, children: quotedExternalEmbed.title }), quotedExternalEmbed.description && (_jsx("div", { style: { fontSize: 'var(--type-meta-md-size)', lineHeight: 'var(--type-meta-md-line)', color: 'var(--label-2)' }, children: quotedExternalEmbed.description }))] })] }) })), quotedVideoEmbed && (_jsx("div", { style: {
                                marginTop: 8,
                                borderTop: '0.5px solid var(--quote-preview-border)',
                                paddingTop: 8,
                            }, children: _jsxs("div", { style: { border: '1px solid var(--quote-preview-border)', borderRadius: 12, background: 'var(--quote-preview-surface)', overflow: 'hidden' }, children: [quotedVideoEmbed.thumb && (_jsx("div", { style: { marginBottom: 0, overflow: 'hidden', background: 'var(--fill-2)', aspectRatio: '1.91 / 1' }, children: _jsx("img", { src: quotedVideoEmbed.thumb, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } }) })), _jsxs("div", { style: { padding: '9px 10px 10px' }, children: [_jsx("div", { style: { fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', color: 'var(--label-3)', marginBottom: 3 }, children: quotedVideoEmbed.domain }), _jsx("div", { style: { fontSize: 'var(--type-label-md-size)', lineHeight: 'var(--type-label-md-line)', color: 'var(--label-1)', fontWeight: 700 }, children: quotedVideoEmbed.title || quotedVideoEmbed.domain })] })] }) })), post.embed.externalLink && (_jsx("div", { style: {
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop: '0.5px solid var(--quote-preview-border)',
                            }, children: _jsxs("div", { style: { border: '1px solid var(--quote-preview-border)', borderRadius: 12, background: 'var(--quote-preview-surface)', overflow: 'hidden' }, children: [post.embed.externalLink.thumb && (_jsx("div", { style: { overflow: 'hidden', background: 'var(--fill-2)', aspectRatio: '1.91 / 1' }, children: _jsx("img", { src: post.embed.externalLink.thumb, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } }) })), _jsxs("div", { style: { padding: '9px 10px 10px' }, children: [_jsx("div", { style: { fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', color: 'var(--label-3)', marginBottom: 2 }, children: post.embed.externalLink.domain }), post.embed.externalLink.title && (_jsx("div", { style: { fontSize: 'var(--type-label-md-size)', lineHeight: 'var(--type-label-md-line)', color: 'var(--label-1)', fontWeight: 700 }, children: post.embed.externalLink.title }))] })] }) }))] }));
            })(), _jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingRight: 4 }, children: [_jsx(ActionButton, { icon: "reply", count: post.replyCount, onClick: () => onReply?.(post) }), _jsx(ActionButton, { icon: "repost", count: post.repostCount, active: !!post.viewer?.repost, onClick: () => onToggleRepost?.(post) }), _jsx(ActionButton, { icon: "like", count: post.likeCount, active: !!post.viewer?.like, onClick: () => onToggleLike?.(post) }), _jsx(ActionButton, { icon: "bookmark", count: post.bookmarkCount || 0, active: !!post.viewer?.bookmark, onClick: () => onBookmark?.(post) }), _jsx(ActionButton, { icon: "more", count: 0, onClick: () => onMore?.(post) })] })] }));
}
// ─── Action Button ────────────────────────────────────────────────────────
function ActionButton({ icon, count, active, onClick }) {
    const color = active
        ? (icon === 'like' ? 'var(--red)' : 'var(--green)')
        : 'var(--label-3)';
    return (_jsxs("button", { style: {
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none',
            padding: '12px 8px', // Increased vertical padding for 44pt target
            cursor: 'pointer', color,
            marginLeft: -8,
            minWidth: 44, minHeight: 44, // HIG standard tap target
        }, onClick: (e) => { e.stopPropagation(); onClick?.(); }, children: [icon === 'reply' && (_jsx("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: active ? 2.5 : 2, strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" }) })), icon === 'repost' && (_jsxs("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: active ? 2.5 : 2, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M17 1l4 4-4 4" }), _jsx("path", { d: "M3 11V9a4 4 0 014-4h14" }), _jsx("path", { d: "M7 23l-4-4 4-4" }), _jsx("path", { d: "M21 13v2a4 4 0 01-4 4H3" })] })), icon === 'like' && (_jsx("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: active ? "currentColor" : "none", stroke: "currentColor", strokeWidth: active ? 0 : 2, strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" }) })), icon === 'bookmark' && (_jsx("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: active ? "currentColor" : "none", stroke: "currentColor", strokeWidth: active ? 0 : 2, strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" }) })), icon === 'more' && (_jsxs("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("circle", { cx: "12", cy: "12", r: "1" }), _jsx("circle", { cx: "12", cy: "5", r: "1" }), _jsx("circle", { cx: "12", cy: "19", r: "1" })] })), icon !== 'more' && _jsx("span", { style: { fontSize: 'var(--type-meta-md-size)', lineHeight: 'var(--type-meta-md-line)', letterSpacing: 'var(--type-meta-md-track)', fontWeight: 500, color: active ? color : 'var(--label-3)' }, children: formatCount(count) })] }));
}
//# sourceMappingURL=PostCard.js.map