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
import type { TranslationMode } from '../lib/i18n/types.js';

// ─── Translate Icon ───────────────────────────────────────────────────────────

export function TranslateIcon({
  size = 13,
  color = 'currentColor',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 8l6 6" />
      <path d="M4 14l6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="M22 22l-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InlineTranslationProps {
  postId: string;
  sourceText: string;
  /** Pre-detected language code. 'und' = unknown/mixed. */
  sourceLang?: string;
  targetLang: string;
  /**
   * When true, translation is triggered automatically on mount without user
   * interaction (inline translate / auto-translate for short posts).
   */
  autoTranslate?: boolean;
  localOnlyMode?: boolean;
  /**
   * When false, the manual "Translate" button is hidden.
   * The attribution strip still appears if a translation is cached.
   * Defaults to true.
   */
  showTrigger?: boolean;
  /** Render function receives the (possibly translated) text. */
  renderText: (text: string) => React.ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InlineTranslation({
  postId,
  sourceText,
  sourceLang,
  targetLang,
  autoTranslate = false,
  localOnlyMode = false,
  showTrigger = true,
  renderText,
}: InlineTranslationProps) {
  const { byId, upsertTranslation, clearTranslation } = useTranslationStore();
  const translation = byId[postId];
  const hasRenderableTranslation =
    !!translation && hasMeaningfulTranslation(sourceText, translation.translatedText);

  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const autoAttemptedRef = useRef(false);

  const displayText =
    hasRenderableTranslation && !showOriginal ? translation.translatedText : sourceText;

  const mode: TranslationMode = localOnlyMode ? 'local_private' : 'server_default';

  const doTranslate = useCallback(async () => {
    if (!sourceText.trim()) return;
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
      } else {
        setTranslationError(true);
      }
    } catch (err) {
      console.warn('[InlineTranslation] translation failed', err);
      setTranslationError(true);
    } finally {
      setTranslating(false);
    }
  }, [postId, sourceText, targetLang, mode, sourceLang, upsertTranslation]);

  // Auto-translate on mount when requested.
  useEffect(() => {
    if (!autoTranslate) return;
    if (hasRenderableTranslation || translation || translating) return;
    if (autoAttemptedRef.current) return;
    autoAttemptedRef.current = true;
    doTranslate();
  }, [autoTranslate, hasRenderableTranslation, translation, translating, doTranslate]);

  // Reset auto-attempt flag when postId changes (virtualised list cell reuse).
  useEffect(() => {
    autoAttemptedRef.current = false;
  }, [postId]);

  const handleTranslateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasRenderableTranslation) {
      setShowOriginal((v) => !v);
      return;
    }
    doTranslate();
  };

  const handleClearClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearTranslation(postId);
    setShowOriginal(false);
    setTranslationError(false);
  };

  const showManualTrigger = showTrigger && !autoTranslate && !hasRenderableTranslation;
  const showAutoRetry = autoTranslate && translationError && !hasRenderableTranslation;

  return (
    <>
      {renderText(displayText)}

      <AnimatePresence>
        {/* ── Attribution strip (visible when a translation is cached) ────── */}
        {hasRenderableTranslation && (
          <motion.div
            key="attribution"
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 5,
              marginBottom: 2,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 'var(--type-meta-sm-size)',
                lineHeight: 'var(--type-meta-sm-line)',
                color: 'var(--label-3)',
                fontWeight: 500,
                userSelect: 'none',
              }}
            >
              <TranslateIcon size={11} color="var(--blue)" />
              {showOriginal
                ? 'Translation available'
                : `Translated from ${translation.sourceLang}`}
            </span>

            <button
              onClick={handleTranslateClick}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--blue)',
                fontSize: 'var(--type-meta-sm-size)',
                lineHeight: 'var(--type-meta-sm-line)',
                fontWeight: 700,
                padding: 0,
                cursor: 'pointer',
              }}
            >
              {showOriginal ? 'Show translation' : 'Show original'}
            </button>

            <button
              onClick={handleClearClick}
              aria-label="Clear translation"
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--label-3)',
                fontSize: 'var(--type-meta-sm-size)',
                lineHeight: 1,
                fontWeight: 500,
                padding: '0 1px',
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </motion.div>
        )}

        {/* ── Manual translate trigger ──────────────────────────────────────── */}
        {showManualTrigger && (
          <motion.div
            key="trigger"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              marginTop: 5,
              marginBottom: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <button
              onClick={handleTranslateClick}
              disabled={translating}
              style={{
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
              }}
            >
              <TranslateIcon size={13} color={translating ? 'var(--label-3)' : 'var(--blue)'} />
              {translating ? 'Translating…' : 'Translate'}
            </button>

            {translationError && (
              <span
                style={{
                  fontSize: 'var(--type-meta-sm-size)',
                  lineHeight: 'var(--type-meta-sm-line)',
                  color: 'var(--red)',
                }}
              >
                Failed
              </span>
            )}
          </motion.div>
        )}

        {/* ── Auto-translate error / retry ─────────────────────────────────── */}
        {showAutoRetry && (
          <motion.div
            key="auto-retry"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            onClick={(e) => e.stopPropagation()}
            style={{ marginTop: 5, marginBottom: 2 }}
          >
            <button
              onClick={handleTranslateClick}
              style={{
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
              }}
            >
              <TranslateIcon size={11} color="var(--label-3)" />
              Translation failed · Retry
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
