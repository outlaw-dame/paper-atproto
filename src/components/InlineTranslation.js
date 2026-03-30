import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * InlineTranslation — shared inline translation component.
 *
 * Handles all translation UX for a single piece of text:
 *  - Manual translate trigger (when language differs)
 *  - Auto-translate on mount (when autoTranslate=true)
 *  - Animated attribution strip: "Translated from French · Show original · ×"
 *  - Auto-translate error retry
 *
 * Used by PostCard, StoryMode, and ExploreTab to avoid three separate implementations.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslationStore } from '../store/translationStore.js';
import { translationClient } from '../lib/i18n/client.js';
import { hasMeaningfulTranslation } from '../lib/i18n/normalize.js';
// ─── Translate Icon ───────────────────────────────────────────────────────────
export function TranslateIcon({ size = 13, color = 'currentColor', }) {
    return (_jsxs("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("path", { d: "M5 8l6 6" }), _jsx("path", { d: "M4 14l6-6 2-3" }), _jsx("path", { d: "M2 5h12" }), _jsx("path", { d: "M7 2h1" }), _jsx("path", { d: "M22 22l-5-10-5 10" }), _jsx("path", { d: "M14 18h6" })] }));
}
// ─── Component ────────────────────────────────────────────────────────────────
export default function InlineTranslation({ postId, sourceText, sourceLang, targetLang, autoTranslate = false, localOnlyMode = false, showTrigger = true, renderText, }) {
    const { byId, upsertTranslation, clearTranslation } = useTranslationStore();
    const translation = byId[postId];
    const hasRenderableTranslation = !!translation && hasMeaningfulTranslation(sourceText, translation.translatedText);
    const [translating, setTranslating] = useState(false);
    const [translationError, setTranslationError] = useState(false);
    const [showOriginal, setShowOriginal] = useState(false);
    const autoAttemptedRef = useRef(false);
    const displayText = hasRenderableTranslation && !showOriginal ? translation.translatedText : sourceText;
    const mode = localOnlyMode ? 'local_private' : 'server_default';
    const doTranslate = useCallback(async () => {
        if (!sourceText.trim())
            return;
        setTranslating(true);
        setTranslationError(false);
        try {
            const result = await translationClient.translateInline({
                id: postId,
                sourceText,
                targetLang,
                mode,
                ...(sourceLang && sourceLang !== 'und' ? { sourceLang } : {}),
            });
            if (hasMeaningfulTranslation(sourceText, result.translatedText)) {
                upsertTranslation(result);
                setShowOriginal(false);
            }
            else {
                setTranslationError(true);
            }
        }
        catch (err) {
            console.warn('[InlineTranslation] translation failed', err);
            setTranslationError(true);
        }
        finally {
            setTranslating(false);
        }
    }, [postId, sourceText, targetLang, mode, sourceLang, upsertTranslation]);
    // Auto-translate on mount when requested.
    useEffect(() => {
        if (!autoTranslate)
            return;
        if (hasRenderableTranslation || translation || translating)
            return;
        if (autoAttemptedRef.current)
            return;
        autoAttemptedRef.current = true;
        doTranslate();
    }, [autoTranslate, hasRenderableTranslation, translation, translating, doTranslate]);
    // Reset auto-attempt flag when postId changes (virtualised list cell reuse).
    useEffect(() => {
        autoAttemptedRef.current = false;
    }, [postId]);
    const handleTranslateClick = (e) => {
        e.stopPropagation();
        if (hasRenderableTranslation) {
            setShowOriginal((v) => !v);
            return;
        }
        doTranslate();
    };
    const handleClearClick = (e) => {
        e.stopPropagation();
        clearTranslation(postId);
        setShowOriginal(false);
        setTranslationError(false);
    };
    const showManualTrigger = showTrigger && !autoTranslate && !hasRenderableTranslation;
    const showAutoRetry = autoTranslate && translationError && !hasRenderableTranslation;
    return (_jsxs(_Fragment, { children: [renderText(displayText), _jsxs(AnimatePresence, { children: [hasRenderableTranslation && (_jsxs(motion.div, { initial: { opacity: 0, y: -3 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -3 }, transition: { duration: 0.16, ease: 'easeOut' }, onClick: (e) => e.stopPropagation(), style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            marginTop: 5,
                            marginBottom: 2,
                            flexWrap: 'wrap',
                        }, children: [_jsxs("span", { style: {
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 'var(--type-meta-sm-size)',
                                    lineHeight: 'var(--type-meta-sm-line)',
                                    color: 'var(--label-3)',
                                    fontWeight: 500,
                                    userSelect: 'none',
                                }, children: [_jsx(TranslateIcon, { size: 11, color: "var(--blue)" }), showOriginal
                                        ? 'Translation available'
                                        : `Translated from ${translation.sourceLang}`] }), _jsx("button", { onClick: handleTranslateClick, style: {
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'var(--blue)',
                                    fontSize: 'var(--type-meta-sm-size)',
                                    lineHeight: 'var(--type-meta-sm-line)',
                                    fontWeight: 700,
                                    padding: 0,
                                    cursor: 'pointer',
                                }, children: showOriginal ? 'Show translation' : 'Show original' }), _jsx("button", { onClick: handleClearClick, "aria-label": "Clear translation", style: {
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'var(--label-3)',
                                    fontSize: 'var(--type-meta-sm-size)',
                                    lineHeight: 1,
                                    fontWeight: 500,
                                    padding: '0 1px',
                                    cursor: 'pointer',
                                }, children: "\u00D7" })] }, "attribution")), showManualTrigger && (_jsxs(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.14 }, onClick: (e) => e.stopPropagation(), style: {
                            marginTop: 5,
                            marginBottom: 2,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                        }, children: [_jsxs("button", { onClick: handleTranslateClick, disabled: translating, style: {
                                    border: 'none',
                                    background: 'transparent',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    color: translating ? 'var(--label-3)' : 'var(--blue)',
                                    fontSize: 'var(--type-meta-md-size)',
                                    lineHeight: 'var(--type-meta-md-line)',
                                    fontWeight: 600,
                                    padding: 0,
                                    cursor: translating ? 'default' : 'pointer',
                                    opacity: translating ? 0.7 : 1,
                                }, children: [_jsx(TranslateIcon, { size: 13, color: translating ? 'var(--label-3)' : 'var(--blue)' }), translating ? 'Translating…' : 'Translate'] }), translationError && (_jsx("span", { style: {
                                    fontSize: 'var(--type-meta-sm-size)',
                                    lineHeight: 'var(--type-meta-sm-line)',
                                    color: 'var(--red)',
                                }, children: "Failed" }))] }, "trigger")), showAutoRetry && (_jsx(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.14 }, onClick: (e) => e.stopPropagation(), style: { marginTop: 5, marginBottom: 2 }, children: _jsxs("button", { onClick: handleTranslateClick, style: {
                                border: 'none',
                                background: 'transparent',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                color: 'var(--label-3)',
                                fontSize: 'var(--type-meta-sm-size)',
                                lineHeight: 'var(--type-meta-sm-line)',
                                fontWeight: 500,
                                padding: 0,
                                cursor: 'pointer',
                            }, children: [_jsx(TranslateIcon, { size: 11, color: "var(--label-3)" }), "Translation failed \u00B7 Retry"] }) }, "auto-retry"))] })] }));
}
//# sourceMappingURL=InlineTranslation.js.map