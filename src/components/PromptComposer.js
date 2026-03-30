import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// ─── PromptComposer — Hosted Thread creation screen ──────────────────────
// Glympse Core Wireframe Spec v1 — Screen 4
//
// Two-step flow:
//   Step 1 — Editorial Form:
//     PromptField (the "cover line" — what is this discussion about?)
//     DescriptionField (optional context)
//     TopicChips (quick topic tags)
//     SourceField (optional URL or @handle)
//     Audience selector
//     Preview CTA → Step 2
//
//   Step 2 — Preview:
//     PromptHeroCard stub (dark hero preview)
//     Post / Back actions
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSessionStore } from '../store/sessionStore.js';
import { atpMutate } from '../lib/atproto/client.js';
import ComposerGuidanceBanner from './ComposerGuidanceBanner.js';
import MentalHealthSupportBanner from './MentalHealthSupportBanner.js';
import { buildHostedThreadComposerContext } from '../intelligence/composer/contextBuilder.js';
import { useComposerGuidance } from '../hooks/useComposerGuidance.js';
import { promptHero as phTokens, discussion as disc, accent, type as typeScale, radius, space, transitions, slideUpVariants, } from '../design/index.js';
const SUGGESTED_TOPICS = [
    '#OpenSocial', '#Community', '#decentralized', '#openprotocol',
    '#tech', '#ai', '#privacy', '#fediverse', '#web3', '#identity',
];
const AUDIENCE_OPTIONS = ['Everyone', 'Following', 'Mentioned'];
// ─── PromptHeroPreview ────────────────────────────────────────────────────
function PromptHeroPreview({ prompt, description, source, topics, audience, profile, }) {
    return (_jsxs("div", { style: {
            borderRadius: phTokens.radius,
            background: phTokens.bg,
            padding: `${phTokens.padding}px`,
            boxShadow: phTokens.shadow,
            overflow: 'hidden',
        }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }, children: [_jsx("div", { style: { display: 'flex' }, children: [0, 1, 2].map(i => (_jsx("div", { style: {
                                width: 24, height: 24, borderRadius: '50%',
                                background: `hsl(${i * 80 + 200}, 60%, 40%)`,
                                border: '1.5px solid rgba(255,255,255,0.15)',
                                marginLeft: i > 0 ? -8 : 0,
                            } }, i))) }), _jsxs("span", { style: { fontSize: typeScale.metaLg[0], fontWeight: 500, color: phTokens.meta }, children: ["Open to ", audience.toLowerCase()] })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }, children: [_jsx("div", { style: { width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }, children: profile?.avatar
                            ? _jsx("img", { src: profile.avatar, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } })
                            : _jsx("div", { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }, children: (profile?.displayName ?? profile?.handle ?? '?')[0] }) }), _jsxs("span", { style: { fontSize: typeScale.metaLg[0], fontWeight: 600, color: phTokens.meta }, children: ["@", profile?.handle ?? 'you'] }), _jsx("span", { style: { fontSize: typeScale.metaSm[0], color: phTokens.meta }, children: "\u00B7 just now" })] }), _jsx("p", { style: {
                    fontSize: typeScale.titleXl[0], lineHeight: `${typeScale.titleXl[1]}px`,
                    fontWeight: typeScale.titleXl[2], letterSpacing: typeScale.titleXl[3],
                    color: phTokens.text, marginBottom: description ? 12 : 16,
                }, children: prompt || _jsx("span", { style: { opacity: 0.4 }, children: "Your prompt will appear here\u2026" }) }), description && (_jsx("p", { style: {
                    fontSize: typeScale.bodyMd[0], lineHeight: `${typeScale.bodyMd[1]}px`,
                    color: 'rgba(255,255,255,0.65)', marginBottom: 14,
                }, children: description })), topics.length > 0 && (_jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }, children: topics.map(t => (_jsx("span", { style: {
                        padding: '4px 10px', borderRadius: radius.full,
                        background: 'rgba(91,124,255,0.18)',
                        color: 'rgba(180,195,255,0.9)',
                        fontSize: typeScale.metaLg[0], fontWeight: 600,
                    }, children: t }, t))) })), source && (_jsx("div", { style: {
                    padding: `${space[4]}px ${space[6]}px`,
                    background: 'rgba(255,255,255,0.06)',
                    borderRadius: radius[12],
                    border: `0.5px solid ${phTokens.line}`,
                    marginBottom: 16,
                }, children: _jsx("span", { style: { fontSize: typeScale.metaSm[0], color: phTokens.meta }, children: source.startsWith('http') ? (() => { try {
                        return new URL(source).hostname.replace(/^www\./, '');
                    }
                    catch {
                        return source;
                    } })() : source }) })), _jsx("div", { style: { height: 0.5, background: phTokens.line, marginBottom: 16 } }), _jsxs("div", { style: {
                    width: '100%',
                    height: phTokens.cta.height,
                    borderRadius: phTokens.cta.radius,
                    background: phTokens.cta.bg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }, children: [_jsx("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: phTokens.cta.icon, strokeWidth: 2.5, strokeLinecap: "round", children: _jsx("path", { d: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" }) }), _jsx("span", { style: { fontSize: typeScale.buttonMd[0], fontWeight: typeScale.buttonMd[2], color: phTokens.cta.text }, children: "Share your point of view" })] })] }));
}
// ─── Main component ────────────────────────────────────────────────────────
export default function PromptComposer({ onClose, onPosted }) {
    const { agent, session, profile } = useSessionStore();
    const [step, setStep] = useState('form');
    const [prompt, setPrompt] = useState('');
    const [description, setDescription] = useState('');
    const [source, setSource] = useState('');
    const [topics, setTopics] = useState([]);
    const [customTopic, setCustomTopic] = useState('');
    const [audience, setAudience] = useState('Everyone');
    const [audienceOpen, setAudienceOpen] = useState(false);
    const [posting, setPosting] = useState(false);
    const [error, setError] = useState(null);
    const [mentalHealthDismissedAt, setMentalHealthDismissedAt] = useState(null);
    const promptRef = useRef(null);
    const mentalHealthGuidanceDraftRef = useRef(null);
    const toggleTopic = (t) => {
        setTopics(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
    };
    const addCustomTopic = () => {
        const t = customTopic.trim();
        if (!t)
            return;
        const tag = t.startsWith('#') ? t : `#${t}`;
        if (!topics.includes(tag))
            setTopics(prev => [...prev, tag]);
        setCustomTopic('');
    };
    const canPreview = prompt.trim().length >= 10;
    const canPost = canPreview && !posting;
    const composerContext = useMemo(() => buildHostedThreadComposerContext({
        prompt,
        description,
        source,
        topics,
        audience,
    }), [audience, description, prompt, source, topics]);
    const { draftId: composerGuidanceDraftId, guidance: composerGuidance, dismissedAt: composerGuidanceDismissedAt, dismissGuidance, } = useComposerGuidance({
        surfaceId: 'prompt-composer',
        context: composerContext,
        debounceMs: 450,
    });
    useEffect(() => {
        if (!composerGuidance.heuristics.hasMentalHealthCrisis) {
            mentalHealthGuidanceDraftRef.current = null;
            return;
        }
        if (mentalHealthGuidanceDraftRef.current !== composerGuidanceDraftId) {
            mentalHealthGuidanceDraftRef.current = composerGuidanceDraftId;
            setMentalHealthDismissedAt(null);
        }
    }, [composerGuidance.heuristics.hasMentalHealthCrisis, composerGuidanceDraftId]);
    const handlePost = useCallback(async () => {
        if (!canPost || !session)
            return;
        setPosting(true);
        setError(null);
        try {
            // Build the post text: prompt + description + topics + source
            const parts = [prompt.trim()];
            if (description.trim())
                parts.push('\n' + description.trim());
            if (topics.length > 0)
                parts.push('\n' + topics.join(' '));
            if (source.trim())
                parts.push('\n' + source.trim());
            const text = parts.join('');
            await atpMutate(() => agent.post({ text, createdAt: new Date().toISOString() }));
            onPosted?.();
            onClose();
        }
        catch (e) {
            setError(e.message ?? 'Failed to post');
            setPosting(false);
        }
    }, [canPost, session, prompt, description, topics, source, agent, onPosted, onClose]);
    const profileData = profile ? {
        displayName: profile.displayName,
        handle: profile.handle,
        avatar: profile.avatar,
    } : null;
    return (_jsxs(motion.div, { initial: { opacity: 0, y: '100%' }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: '100%' }, transition: transitions.sheetEntry, style: {
            position: 'fixed', inset: 0,
            background: disc.bgBase,
            display: 'flex', flexDirection: 'column',
            zIndex: 300,
        }, children: [_jsxs("div", { style: {
                    flexShrink: 0,
                    paddingTop: 'calc(var(--safe-top) + 12px)',
                    padding: 'calc(var(--safe-top) + 12px) 20px 12px',
                    display: 'flex', alignItems: 'center', gap: 12,
                    borderBottom: `0.5px solid ${disc.lineSubtle}`,
                    background: disc.bgBase,
                }, children: [_jsx("button", { onClick: step === 'preview' ? () => setStep('form') : onClose, style: {
                            width: 36, height: 36, borderRadius: '50%',
                            background: disc.surfaceCard2, border: `0.5px solid ${disc.lineSubtle}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', flexShrink: 0,
                        }, children: step === 'preview' ? (_jsx("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: disc.textSecondary, strokeWidth: 2.5, strokeLinecap: "round", children: _jsx("polyline", { points: "15 18 9 12 15 6" }) })) : (_jsxs("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: disc.textSecondary, strokeWidth: 2.5, strokeLinecap: "round", children: [_jsx("line", { x1: "18", y1: "6", x2: "6", y2: "18" }), _jsx("line", { x1: "6", y1: "6", x2: "18", y2: "18" })] })) }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("p", { style: {
                                    fontSize: typeScale.titleSm[0], fontWeight: typeScale.titleSm[2],
                                    letterSpacing: typeScale.titleSm[3], color: disc.textPrimary,
                                }, children: step === 'form' ? 'Start a Discussion' : 'Preview' }), _jsx("p", { style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary }, children: step === 'form' ? 'Your prompt becomes the cover line' : 'How it will appear' })] }), step === 'form' ? (_jsx("button", { onClick: () => setStep('preview'), disabled: !canPreview, style: {
                            height: 36, padding: '0 18px', borderRadius: radius.full,
                            background: canPreview ? accent.primary : disc.surfaceCard2,
                            color: canPreview ? '#fff' : disc.textTertiary,
                            border: 'none', cursor: canPreview ? 'pointer' : 'default',
                            fontSize: typeScale.chip[0], fontWeight: 600,
                            transition: 'all 0.15s',
                        }, children: "Preview" })) : (_jsxs("button", { onClick: handlePost, disabled: !canPost, style: {
                            height: 36, padding: '0 18px', borderRadius: radius.full,
                            background: canPost ? accent.primary : disc.surfaceCard2,
                            color: canPost ? '#fff' : disc.textTertiary,
                            border: 'none', cursor: canPost ? 'pointer' : 'default',
                            fontSize: typeScale.chip[0], fontWeight: 600,
                            display: 'flex', alignItems: 'center', gap: 6,
                            transition: 'all 0.15s',
                        }, children: [posting ? (_jsx("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", children: _jsx("path", { d: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83", children: _jsx("animateTransform", { attributeName: "transform", type: "rotate", from: "0 12 12", to: "360 12 12", dur: "0.8s", repeatCount: "indefinite" }) }) })) : null, "Post"] }))] }), _jsx("div", { className: "scroll-y", style: { flex: 1 }, children: _jsx(AnimatePresence, { mode: "wait", children: step === 'form' ? (_jsxs(motion.div, { initial: { opacity: 0, x: -20 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -20 }, transition: { duration: 0.18 }, style: { padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24 }, children: [_jsxs("div", { children: [_jsxs("label", { style: {
                                            display: 'block', marginBottom: 8,
                                            fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.04em',
                                            textTransform: 'uppercase', color: disc.textTertiary,
                                        }, children: ["Prompt ", _jsx("span", { style: { color: accent.primary }, children: "*" })] }), _jsx("p", { style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary, marginBottom: 10 }, children: "This becomes the \"cover line\" \u2014 the central question or claim your discussion is built around." }), _jsx("textarea", { ref: promptRef, value: prompt, onChange: e => setPrompt(e.target.value), placeholder: "What's the central question or claim?", rows: 3, style: {
                                            width: '100%', boxSizing: 'border-box',
                                            background: disc.surfaceCard2,
                                            border: `0.5px solid ${prompt.length > 0 ? accent.primary : disc.lineSubtle}`,
                                            borderRadius: radius[20],
                                            padding: `${space[10]}px ${space[10]}px`,
                                            fontSize: typeScale.bodyMd[0], lineHeight: `${typeScale.bodyMd[1]}px`,
                                            fontWeight: typeScale.bodyMd[2],
                                            color: disc.textPrimary,
                                            resize: 'none', outline: 'none',
                                            transition: 'border-color 0.15s',
                                        } }), _jsx("div", { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 4 }, children: _jsx("span", { style: {
                                                fontSize: typeScale.metaSm[0],
                                                color: prompt.length > 280 ? '#FF6B6B' : disc.textTertiary,
                                                fontVariantNumeric: 'tabular-nums',
                                            }, children: 280 - prompt.length }) })] }), _jsxs("div", { children: [_jsxs("label", { style: {
                                            display: 'block', marginBottom: 8,
                                            fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.04em',
                                            textTransform: 'uppercase', color: disc.textTertiary,
                                        }, children: ["Context ", _jsx("span", { style: { opacity: 0.5 }, children: "(optional)" })] }), _jsx("textarea", { value: description, onChange: e => setDescription(e.target.value), placeholder: "Add background, nuance, or framing\u2026", rows: 2, style: {
                                            width: '100%', boxSizing: 'border-box',
                                            background: disc.surfaceCard2,
                                            border: `0.5px solid ${disc.lineSubtle}`,
                                            borderRadius: radius[20],
                                            padding: `${space[10]}px ${space[10]}px`,
                                            fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
                                            color: disc.textPrimary,
                                            resize: 'none', outline: 'none',
                                        } })] }), _jsx(AnimatePresence, { children: (composerGuidance.level !== 'ok' || composerGuidance.heuristics.parentSignals.length > 0) && composerGuidanceDismissedAt === null && (_jsx(ComposerGuidanceBanner, { guidance: composerGuidance, onDismiss: dismissGuidance })) }), _jsx(AnimatePresence, { children: composerGuidance.heuristics.hasMentalHealthCrisis && mentalHealthDismissedAt === null && (_jsx(MentalHealthSupportBanner, { category: composerGuidance.heuristics.mentalHealthCategory, onDismiss: () => setMentalHealthDismissedAt(Date.now()) })) }), _jsxs("div", { children: [_jsxs("label", { style: {
                                            display: 'block', marginBottom: 8,
                                            fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.04em',
                                            textTransform: 'uppercase', color: disc.textTertiary,
                                        }, children: ["Topics ", _jsx("span", { style: { opacity: 0.5 }, children: "(optional)" })] }), _jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }, children: SUGGESTED_TOPICS.map(t => (_jsx("button", { onClick: () => toggleTopic(t), style: {
                                                padding: '6px 14px', borderRadius: radius.full,
                                                background: topics.includes(t) ? 'rgba(91,124,255,0.18)' : disc.surfaceCard2,
                                                border: `0.5px solid ${topics.includes(t) ? accent.primary : disc.lineSubtle}`,
                                                color: topics.includes(t) ? accent.primary : disc.textSecondary,
                                                fontSize: typeScale.chip[0], fontWeight: 600,
                                                cursor: 'pointer', transition: 'all 0.12s',
                                            }, children: t }, t))) }), _jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsx("input", { value: customTopic, onChange: e => setCustomTopic(e.target.value), onKeyDown: e => { if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    addCustomTopic();
                                                } }, placeholder: "Add custom topic\u2026", style: {
                                                    flex: 1,
                                                    background: disc.surfaceCard2,
                                                    border: `0.5px solid ${disc.lineSubtle}`,
                                                    borderRadius: radius[16],
                                                    padding: `${space[6]}px ${space[8]}px`,
                                                    fontSize: typeScale.bodySm[0], color: disc.textPrimary,
                                                    outline: 'none',
                                                } }), _jsx("button", { onClick: addCustomTopic, style: {
                                                    width: 36, height: 36, borderRadius: '50%',
                                                    background: disc.surfaceCard2, border: `0.5px solid ${disc.lineSubtle}`,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    cursor: 'pointer',
                                                }, children: _jsxs("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: disc.textSecondary, strokeWidth: 2.5, strokeLinecap: "round", children: [_jsx("line", { x1: "12", y1: "5", x2: "12", y2: "19" }), _jsx("line", { x1: "5", y1: "12", x2: "19", y2: "12" })] }) })] }), topics.length > 0 && (_jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }, children: topics.map(t => (_jsxs("span", { style: {
                                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                                padding: '4px 10px', borderRadius: radius.full,
                                                background: 'rgba(91,124,255,0.18)',
                                                color: accent.primary,
                                                fontSize: typeScale.metaLg[0], fontWeight: 600,
                                            }, children: [t, _jsx("button", { onClick: () => toggleTopic(t), style: { background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: accent.primary }, children: _jsxs("svg", { width: "10", height: "10", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round", children: [_jsx("line", { x1: "18", y1: "6", x2: "6", y2: "18" }), _jsx("line", { x1: "6", y1: "6", x2: "18", y2: "18" })] }) })] }, t))) }))] }), _jsxs("div", { children: [_jsxs("label", { style: {
                                            display: 'block', marginBottom: 8,
                                            fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.04em',
                                            textTransform: 'uppercase', color: disc.textTertiary,
                                        }, children: ["Source ", _jsx("span", { style: { opacity: 0.5 }, children: "(optional)" })] }), _jsx("p", { style: { fontSize: typeScale.metaSm[0], color: disc.textTertiary, marginBottom: 10 }, children: "Link an article, paper, or @handle that sparked this discussion." }), _jsx("input", { value: source, onChange: e => setSource(e.target.value), placeholder: "https://\u2026 or @handle", style: {
                                            width: '100%', boxSizing: 'border-box',
                                            background: disc.surfaceCard2,
                                            border: `0.5px solid ${disc.lineSubtle}`,
                                            borderRadius: radius[16],
                                            padding: `${space[8]}px ${space[10]}px`,
                                            fontSize: typeScale.bodySm[0], color: disc.textPrimary,
                                            outline: 'none',
                                        } })] }), _jsxs("div", { children: [_jsx("label", { style: {
                                            display: 'block', marginBottom: 8,
                                            fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.04em',
                                            textTransform: 'uppercase', color: disc.textTertiary,
                                        }, children: "Audience" }), _jsxs("div", { style: { position: 'relative', display: 'inline-block' }, children: [_jsxs("button", { onClick: () => setAudienceOpen(v => !v), style: {
                                                    display: 'flex', alignItems: 'center', gap: 8,
                                                    height: 40, padding: '0 16px',
                                                    borderRadius: radius.full,
                                                    background: disc.surfaceCard2,
                                                    border: `0.5px solid ${disc.lineSubtle}`,
                                                    color: disc.textPrimary,
                                                    fontSize: typeScale.chip[0], fontWeight: 600,
                                                    cursor: 'pointer',
                                                }, children: [audience, _jsx("svg", { width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", children: _jsx("polyline", { points: "6 9 12 15 18 9" }) })] }), _jsx(AnimatePresence, { children: audienceOpen && (_jsx(motion.div, { initial: { opacity: 0, scale: 0.95, y: -4 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.95, y: -4 }, transition: { duration: 0.12 }, style: {
                                                        position: 'absolute', top: 44, left: 0, zIndex: 10,
                                                        background: disc.surfaceCard2,
                                                        border: `0.5px solid ${disc.lineSubtle}`,
                                                        borderRadius: radius[20],
                                                        overflow: 'hidden', minWidth: 160,
                                                        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                                                    }, children: AUDIENCE_OPTIONS.map(opt => (_jsxs("button", { onClick: () => { setAudience(opt); setAudienceOpen(false); }, style: {
                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                            width: '100%', padding: '12px 16px',
                                                            background: 'none', border: 'none', cursor: 'pointer',
                                                            color: disc.textPrimary,
                                                            fontSize: typeScale.chip[0], fontWeight: audience === opt ? 700 : 500,
                                                            borderBottom: opt !== 'Mentioned' ? `0.5px solid ${disc.lineSubtle}` : 'none',
                                                        }, children: [opt, audience === opt && (_jsx("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: accent.primary, strokeWidth: 2.5, strokeLinecap: "round", children: _jsx("polyline", { points: "20 6 9 17 4 12" }) }))] }, opt))) })) })] })] }), error && (_jsx("div", { style: {
                                    padding: `${space[8]}px ${space[10]}px`,
                                    borderRadius: radius[16],
                                    background: 'rgba(255,80,80,0.12)',
                                    border: '0.5px solid rgba(255,80,80,0.3)',
                                }, children: _jsx("p", { style: { fontSize: typeScale.bodySm[0], color: '#FF8080' }, children: error }) })), _jsx("div", { style: { height: 32 } })] }, "form")) : (_jsxs(motion.div, { initial: { opacity: 0, x: 20 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 20 }, transition: { duration: 0.18 }, style: { padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("div", { style: { flex: 1, height: 0.5, background: disc.lineSubtle } }), _jsx("span", { style: { fontSize: typeScale.metaSm[0], fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: disc.textTertiary }, children: "Preview" }), _jsx("div", { style: { flex: 1, height: 0.5, background: disc.lineSubtle } })] }), _jsx(PromptHeroPreview, { prompt: prompt, description: description, source: source, topics: topics, audience: audience, profile: profileData }), _jsx("div", { style: {
                                    padding: `${space[8]}px ${space[10]}px`,
                                    borderRadius: radius[16],
                                    background: disc.surfaceCard2,
                                    border: `0.5px solid ${disc.lineSubtle}`,
                                }, children: _jsx("p", { style: { fontSize: typeScale.bodySm[0], color: disc.textTertiary }, children: "This will be published as a standard post. The hosted conversation view is generated automatically when others engage with it." }) }), error && (_jsx("div", { style: {
                                    padding: `${space[8]}px ${space[10]}px`,
                                    borderRadius: radius[16],
                                    background: 'rgba(255,80,80,0.12)',
                                    border: '0.5px solid rgba(255,80,80,0.3)',
                                }, children: _jsx("p", { style: { fontSize: typeScale.bodySm[0], color: '#FF8080' }, children: error }) })), _jsx("div", { style: { height: 32 } })] }, "preview")) }) })] }));
}
//# sourceMappingURL=PromptComposer.js.map