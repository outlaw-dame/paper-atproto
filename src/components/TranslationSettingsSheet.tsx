import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslationStore } from '../store/translationStore';
import { useMediaSettingsStore } from '../store/mediaSettingsStore';
import AccountPrefsSection from './AccountPrefsSection';
import LazyModuleBoundary from './LazyModuleBoundary';
import { SettingsPageFallback } from './TranslationSettingsSheetFallback';
import AppleSettingsSection from './AppleSettingsSection';
import InterpolatorSettingsSection from './InterpolatorSettingsSection';
import { usePlatform, getIconBtnTokens } from '../hooks/usePlatform';
import { getAltTextMetricsSnapshot } from '../perf/altTextTelemetry';
import {
  getBootstrapTelemetrySnapshot,
  type BootstrapTelemetrySnapshot,
} from '../perf/bootstrapTelemetry';
import {
  getRecommendationTelemetrySnapshot,
  type RecommendationTelemetrySnapshot,
} from '../perf/recommendationTelemetry';
import { getLocalizedCrisisResources } from '../lib/mentalHealthResources';
import { useAppearanceStore } from '../store/appearanceStore';
import { lazyWithRetry } from '../lib/lazyWithRetry';

interface Props {
  open: boolean;
  onClose: () => void;
}

type LanguageOption = {
  code: string;
  label: string;
};

type SettingsPage = 'translation' | 'moderation' | 'feeds' | 'appearance' | 'debug' | 'location';
const ModerationSettingsPage = lazyWithRetry(
  () => import('./ModerationSettingsPage'),
  'ModerationSettingsPage',
);
const FeedsSettingsPage = lazyWithRetry(
  () => import('./FeedsSettingsPage'),
  'FeedsSettingsPage',
);
const LocalAiRuntimeSection = lazyWithRetry(
  () => import('./LocalAiRuntimeSettingsPanel'),
  'LocalAiRuntimeSettingsPanel',
);

interface ComposeDebugSnapshot {
  draftText: string;
  replyParentText: string;
  sentimentDismissedAt: number | null;
  sentimentResult: {
    level: string;
    isReplyContext?: boolean;
    signals?: string[];
    supportiveReplySignals?: string[];
    constructiveSignals?: string[];
    parentSignals?: string[];
  };
}

const BASE_LANG_OPTIONS = [
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'it',
  'nl',
  'sv',
  'pl',
  'uk',
  'ru',
  'tr',
  'ar',
  'he',
  'hi',
  'ja',
  'ko',
  'zh',
  'zh-CN',
  'zh-TW',
] as const;

function buildLanguageOptions(systemLang: string): LanguageOption[] {
  const display = typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames([systemLang], { type: 'language' })
    : null;

  const seen = new Set<string>();
  const list: LanguageOption[] = [];

  [systemLang, ...BASE_LANG_OPTIONS].forEach((rawCode) => {
    const code = rawCode.toLowerCase();
    if (seen.has(code)) return;
    seen.add(code);

    const englishCode = rawCode.split('-')[0] ?? rawCode;
    const label = display?.of(englishCode) ?? rawCode;
    const prettyCode = rawCode.toLowerCase();

    list.push({ code: prettyCode, label: `${label} (${prettyCode})` });
  });

  return list;
}

function ToggleRow({
  label,
  helper,
  checked,
  onChange,
  touchLike,
}: {
  label: string;
  helper?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  touchLike: boolean;
}) {
  const trackWidth = touchLike ? 50 : 42;
  const trackHeight = touchLike ? 30 : 26;
  const thumbSize = touchLike ? 24 : 20;
  const thumbTop = touchLike ? 2 : 2;
  const thumbLeft = checked ? trackWidth - thumbSize - 2 : 2;

  return (
    <label style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      padding: '10px 0',
      cursor: 'pointer',
    }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-1)' }}>{label}</span>
        {helper && (
          <span style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--label-2)' }}>{helper}</span>
        )}
      </span>

      <span style={{
        width: trackWidth,
        height: trackHeight,
        borderRadius: 999,
        background: checked ? 'var(--blue)' : 'var(--fill-3)',
        border: `1px solid ${checked ? 'color-mix(in srgb, var(--blue) 70%, #000 30%)' : 'var(--sep)'}`,
        position: 'relative',
        transition: 'all 0.16s ease',
        flexShrink: 0,
      }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
          aria-label={label}
        />
        <span style={{
          position: 'absolute',
          top: thumbTop,
          left: thumbLeft,
          width: thumbSize,
          height: thumbSize,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.22)',
          transition: 'left 0.16s ease',
        }} />
      </span>
    </label>
  );
}

export default function TranslationSettingsSheet({ open, onClose }: Props) {
  const { policy, setPolicy } = useTranslationStore();
  const { preferredCaptionLanguage, setPreferredCaptionLanguage } = useMediaSettingsStore();
  const {
    showFeaturedHashtags,
    setShowFeaturedHashtags,
    useMlFeaturedHashtagRanking,
    setUseMlFeaturedHashtagRanking,
    showProvenanceChips,
    setShowProvenanceChips,
    showAtprotoLabelChips,
    setShowAtprotoLabelChips,
  } = useAppearanceStore();
  const platform = usePlatform();
  const iconTokens = getIconBtnTokens(platform);
  const [page, setPage] = useState<SettingsPage>('translation');
  const [altMetrics, setAltMetrics] = useState(() => getAltTextMetricsSnapshot());
  const [recommendationMetrics, setRecommendationMetrics] = useState<RecommendationTelemetrySnapshot>(
    () => getRecommendationTelemetrySnapshot(),
  );
  const [bootstrapMetrics, setBootstrapMetrics] = useState<BootstrapTelemetrySnapshot>(
    () => getBootstrapTelemetrySnapshot(),
  );
  const [composeDebug, setComposeDebug] = useState<ComposeDebugSnapshot | null>(null);

  const systemLang = useMemo(() => {
    try {
      return (navigator.language || 'en').toLowerCase();
    } catch {
      return 'en';
    }
  }, []);

  const languageOptions = useMemo(() => buildLanguageOptions(systemLang), [systemLang]);

  useEffect(() => {
    if (!open || page !== 'debug') return;

    const refresh = () => {
      setAltMetrics(getAltTextMetricsSnapshot());
      setRecommendationMetrics(getRecommendationTelemetrySnapshot());
      setBootstrapMetrics(getBootstrapTelemetrySnapshot());
      if (typeof window !== 'undefined') {
        const snapshot = (window as Window & { __PAPER_COMPOSE_DEBUG__?: unknown }).__PAPER_COMPOSE_DEBUG__;
        setComposeDebug((snapshot ?? null) as ComposeDebugSnapshot | null);
      }
    };
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [open, page]);

  useEffect(() => {
    if (!open) return;
    setPage('translation');
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close translation settings"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.42)',
              border: 'none',
              zIndex: 500,
              cursor: 'pointer',
            }}
          />

          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            style={{
              position: 'fixed',
              left: 12,
              right: 12,
              bottom: 'calc(var(--safe-bottom) + 10px)',
              background: 'var(--surface)',
              border: '1px solid var(--sep)',
              borderRadius: 20,
              boxShadow: '0 14px 36px rgba(0,0,0,0.28)',
              zIndex: 501,
              overflow: 'hidden',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px 12px',
              borderBottom: '1px solid var(--sep)',
            }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-1)' }}>Settings</h3>
                <p style={{ fontSize: 12, color: 'var(--label-1)' }}>
                  {page === 'translation'
                    ? 'Inline + automatic translation'
                    : page === 'moderation'
                      ? 'Sensitive media, filters, and moderation controls'
                      : page === 'appearance'
                        ? 'Visual display preferences for profile and timeline surfaces'
                      : page === 'feeds'
                        ? 'Manage News, Podcasts, Videos, and other feed subscriptions'
                      : 'Debug diagnostics, AI runtime controls, and QA details for internal testing'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                style={{
                  width: iconTokens.size,
                  height: iconTokens.size,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'var(--fill-2)',
                  color: 'var(--label-2)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div style={{ padding: '12px 16px 16px', maxHeight: '64vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setPage('translation')}
                  style={{
                    flex: 1,
                    height: 34,
                    borderRadius: 10,
                    border: 'none',
                    background: page === 'translation' ? 'var(--blue)' : 'var(--fill-2)',
                    color: page === 'translation' ? '#fff' : 'var(--label-1)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Translation
                </button>
                <button
                  type="button"
                  onClick={() => setPage('moderation')}
                  style={{
                    flex: 1,
                    height: 34,
                    borderRadius: 10,
                    border: 'none',
                    background: page === 'moderation' ? 'var(--blue)' : 'var(--fill-2)',
                    color: page === 'moderation' ? '#fff' : 'var(--label-1)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Moderation
                </button>
                <button
                  type="button"
                  onClick={() => setPage('appearance')}
                  style={{
                    flex: 1,
                    minWidth: 108,
                    height: 34,
                    borderRadius: 10,
                    border: 'none',
                    background: page === 'appearance' ? 'var(--blue)' : 'var(--fill-2)',
                    color: page === 'appearance' ? '#fff' : 'var(--label-1)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Appearance
                </button>
                <button
                  type="button"
                  onClick={() => setPage('debug')}
                  style={{
                    flex: 1,
                    minWidth: 88,
                    height: 34,
                    borderRadius: 10,
                    border: 'none',
                    background: page === 'debug' ? 'var(--blue)' : 'var(--fill-2)',
                    color: page === 'debug' ? '#fff' : 'var(--label-1)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Debug
                </button>
                <button
                  type="button"
                  onClick={() => setPage('feeds')}
                  style={{
                    flex: 1,
                    minWidth: 88,
                    height: 34,
                    borderRadius: 10,
                    border: 'none',
                    background: page === 'feeds' ? 'var(--blue)' : 'var(--fill-2)',
                    color: page === 'feeds' ? '#fff' : 'var(--label-1)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Feeds
                </button>
                <button
                  type="button"
                  onClick={() => setPage('location')}
                  style={{
                    flex: 1,
                    minWidth: 88,
                    height: 34,
                    borderRadius: 10,
                    border: 'none',
                    background: page === 'location' ? 'var(--blue)' : 'var(--fill-2)',
                    color: page === 'location' ? '#fff' : 'var(--label-1)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Location
                </button>
              </div>

              {page === 'translation' && (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--label-1)', marginBottom: 6 }}>
                      Translate to
                    </label>
                    <select
                      value={policy.userLanguage}
                      onChange={(e) => setPolicy({ userLanguage: e.target.value })}
                      style={{
                        width: '100%',
                        height: platform.prefersCoarsePointer ? 44 : 40,
                        borderRadius: 12,
                        border: '1px solid var(--sep)',
                        background: 'var(--fill-1)',
                        color: 'var(--label-1)',
                        padding: '0 12px',
                        fontSize: 14,
                        fontWeight: 500,
                      }}
                    >
                      {languageOptions.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--label-1)', marginBottom: 6 }}>
                      Caption / transcription language
                    </label>
                    <select
                      value={preferredCaptionLanguage ?? ''}
                      onChange={(e) => setPreferredCaptionLanguage(e.target.value || null)}
                      style={{
                        width: '100%',
                        height: platform.prefersCoarsePointer ? 44 : 40,
                        borderRadius: 12,
                        border: '1px solid var(--sep)',
                        background: 'var(--fill-1)',
                        color: 'var(--label-1)',
                        padding: '0 12px',
                        fontSize: 14,
                        fontWeight: 500,
                      }}
                    >
                      <option value="">Auto-detect</option>
                      {languageOptions.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                    <p style={{ marginTop: 6, fontSize: 11, color: 'var(--label-2)', lineHeight: 1.35 }}>
                      Used for both composer video captions and on-demand podcast/video transcript generation.
                    </p>
                  </div>

                  <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '12px 0' }} />

                  <ToggleRow
                    label="Auto inline translation"
                    helper="Automatically translate short timeline posts without media or embeds."
                    checked={policy.autoTranslateFeed}
                    onChange={(checked) => setPolicy({ autoTranslateFeed: checked })}
                    touchLike={platform.prefersCoarsePointer || platform.isMobile}
                  />
                  <ToggleRow
                    label="Auto translate Explore"
                    helper="Translate discovery snippets in Explore cards."
                    checked={policy.autoTranslateExplore}
                    onChange={(checked) => setPolicy({ autoTranslateExplore: checked })}
                    touchLike={platform.prefersCoarsePointer || platform.isMobile}
                  />
                  <ToggleRow
                    label="Auto translate Story view"
                    helper="Pre-translate content used by Story Mode."
                    checked={policy.autoTranslateThreads}
                    onChange={(checked) => setPolicy({ autoTranslateThreads: checked })}
                    touchLike={platform.prefersCoarsePointer || platform.isMobile}
                  />
                  <ToggleRow
                    label="Local/private mode"
                    helper="Prefer local translation path when available."
                    checked={policy.localOnlyMode}
                    onChange={(checked) => setPolicy({ localOnlyMode: checked })}
                    touchLike={platform.prefersCoarsePointer || platform.isMobile}
                  />

                  <p style={{ fontSize: 11, color: 'var(--label-2)', marginTop: 10, lineHeight: 1.35 }}>
                    Note: translation may use external services depending on the selected mode and language pair.
                  </p>

                  <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '14px 0 10px' }} />

                  <AccountPrefsSection />
                  <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '14px 0 10px' }} />
                  <AppleSettingsSection />

                </>
              )}

              {page === 'moderation' && (
                <LazyModuleBoundary
                  resetKey={page}
                  fallback={<SettingsPageFallback label="Moderation settings failed to load." />}
                >
                  <React.Suspense fallback={<SettingsPageFallback label="Loading moderation settings…" />}>
                    <ModerationSettingsPage />
                  </React.Suspense>
                </LazyModuleBoundary>
              )}

              {page === 'feeds' && (
                <LazyModuleBoundary
                  resetKey={page}
                  fallback={<SettingsPageFallback label="Feed settings failed to load." />}
                >
                  <React.Suspense fallback={<SettingsPageFallback label="Loading feed settings…" />}>
                    <FeedsSettingsPage />
                  </React.Suspense>
                </LazyModuleBoundary>
              )}

              {page === 'appearance' && (
                <>
                  <div style={{ border: '1px solid var(--sep)', borderRadius: 12, padding: '10px 12px', background: 'var(--surface)' }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-1)', marginBottom: 2 }}>Profile</h4>
                    <p style={{ fontSize: 12, color: 'var(--label-3)', lineHeight: 1.35, marginBottom: 4 }}>
                      Control visual elements in profile headers.
                    </p>
                    <ToggleRow
                      label="Show featured hashtags"
                      helper="Display hashtag highlights on profile headers, inspired by Mastodon featured tags."
                      checked={showFeaturedHashtags}
                      onChange={setShowFeaturedHashtags}
                      touchLike={platform.prefersCoarsePointer || platform.isMobile}
                    />
                    <ToggleRow
                      label="Use ML ranking for featured hashtags"
                      helper="Rerank featured hashtags using local embedding similarity to profile context."
                      checked={useMlFeaturedHashtagRanking}
                      onChange={setUseMlFeaturedHashtagRanking}
                      touchLike={platform.prefersCoarsePointer || platform.isMobile}
                    />
                  </div>

                  <div style={{ border: '1px solid var(--sep)', borderRadius: 12, padding: '10px 12px', background: 'var(--surface)', marginTop: 10 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-1)', marginBottom: 2 }}>ATProto Labels</h4>
                    <p style={{ fontSize: 12, color: 'var(--label-3)', lineHeight: 1.35, marginBottom: 4 }}>
                      Control relevance provenance and ATProto label/labeller chips in people search surfaces.
                    </p>
                    <ToggleRow
                      label="Show provenance chips"
                      helper="Display semantic/keyword match reason chips in Explore and People results."
                      checked={showProvenanceChips}
                      onChange={setShowProvenanceChips}
                      touchLike={platform.prefersCoarsePointer || platform.isMobile}
                    />
                    <ToggleRow
                      label="Show ATProto label chips"
                      helper="Display actor labels and whether labels are self-applied or from external labellers."
                      checked={showAtprotoLabelChips}
                      onChange={setShowAtprotoLabelChips}
                      touchLike={platform.prefersCoarsePointer || platform.isMobile}
                    />
                  </div>
                </>
              )}

              {page === 'location' && (() => {
                const localized = getLocalizedCrisisResources();
                const browserLocale = typeof navigator !== 'undefined' ? navigator.language : '—';
                const browserLocales = typeof navigator !== 'undefined' ? Array.from(navigator.languages ?? [navigator.language]).join(', ') : '—';
                const timezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '—';
                return (
                  <div>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-1)', marginBottom: 4 }}>Location / Region (debug)</h4>
                    <p style={{ fontSize: 11, color: 'var(--label-4)', marginTop: 0, marginBottom: 10, lineHeight: 1.35 }}>
                      Shows how the browser's locale and timezone are resolved into a crisis-resource region. Used to verify localized crisis hotlines.
                    </p>

                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: '8px 10px', background: 'var(--fill-1)' }}>
                        <div style={{ fontSize: 11, color: 'var(--label-3)', marginBottom: 2 }}>Browser locale (primary)</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-1)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{browserLocale}</div>
                      </div>
                      <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: '8px 10px', background: 'var(--fill-1)' }}>
                        <div style={{ fontSize: 11, color: 'var(--label-3)', marginBottom: 2 }}>Browser locales (all)</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-1)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{browserLocales}</div>
                      </div>
                      <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: '8px 10px', background: 'var(--fill-1)' }}>
                        <div style={{ fontSize: 11, color: 'var(--label-3)', marginBottom: 2 }}>IANA timezone</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-1)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{timezone}</div>
                      </div>
                    </div>

                    <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '12px 0' }} />

                    <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: '8px 10px', background: 'var(--fill-1)', marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: 'var(--label-3)', marginBottom: 2 }}>Detected region</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--blue)' }}>{localized.regionLabel}</div>
                      <div style={{ fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'var(--label-3)', marginTop: 2 }}>id={localized.region}</div>
                    </div>
                    <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: '8px 10px', background: 'var(--fill-1)', marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: 'var(--label-3)', marginBottom: 2 }}>Emergency number</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--label-1)' }}>{localized.emergencyNumber}</div>
                    </div>

                    <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '12px 0' }} />

                    <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-2)', marginBottom: 6 }}>Resolved crisis resources ({localized.resources.length})</h4>
                    <div style={{ display: 'grid', gap: 5 }}>
                      {localized.resources.map((r, i) => (
                        <div key={i} style={{ border: '1px solid var(--sep)', borderRadius: 8, padding: '6px 10px', background: 'var(--fill-1)' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>{r.name}</div>
                          <div style={{ fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'var(--label-3)' }}>
                            {r.contact}
                          </div>
                        </div>
                      ))}
                    </div>

                    {localized.globalDirectories.length > 0 && (
                      <>
                        <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '12px 0' }} />
                        <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-2)', marginBottom: 6 }}>Global directories ({localized.globalDirectories.length})</h4>
                        <div style={{ display: 'grid', gap: 5 }}>
                          {localized.globalDirectories.map((r, i) => (
                            <div key={i} style={{ border: '1px solid var(--sep)', borderRadius: 8, padding: '6px 10px', background: 'var(--fill-1)' }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>{r.name}</div>
                              <div style={{ fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'var(--label-3)' }}>
                                {r.contact}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {page === 'debug' && (
                <>
                  <InterpolatorSettingsSection />

                  <LazyModuleBoundary
                    resetKey="settings-debug-local-ai-runtime"
                    fallback={<SettingsPageFallback label="Local AI runtime controls failed to load." />}
                  >
                    <React.Suspense fallback={<SettingsPageFallback label="Loading local AI runtime controls…" />}>
                      <LocalAiRuntimeSection />
                    </React.Suspense>
                  </LazyModuleBoundary>

                  <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '14px 0 10px' }} />

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }}>Compose sentiment (debug)</h4>
                      <button
                        type="button"
                        onClick={() => {
                          const snapshot = (window as Window & { __PAPER_COMPOSE_DEBUG__?: unknown }).__PAPER_COMPOSE_DEBUG__;
                          setComposeDebug((snapshot ?? null) as ComposeDebugSnapshot | null);
                        }}
                        style={{
                          border: '1px solid var(--sep)',
                          borderRadius: 8,
                          background: 'var(--fill-1)',
                          color: 'var(--label-2)',
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '4px 8px',
                          cursor: 'pointer',
                        }}
                      >
                        Refresh
                      </button>
                    </div>

                    <p style={{ fontSize: 11, color: 'var(--label-4)', marginTop: 4, lineHeight: 1.35 }}>
                      Mirrors window.__PAPER_COMPOSE_DEBUG__ and keeps debug output out of the composer UI.
                    </p>

                    {!composeDebug && (
                      <div style={{ marginTop: 8, border: '1px solid var(--sep)', borderRadius: 10, padding: 10, background: 'var(--fill-1)' }}>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--label-3)' }}>
                          No compose debug snapshot found yet. Open the composer and type to generate one.
                        </p>
                      </div>
                    )}

                    {composeDebug && (
                      <div style={{ marginTop: 8, border: '1px dashed var(--sep)', borderRadius: 10, padding: 10, background: 'var(--fill-1)', display: 'grid', gap: 6 }}>
                        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                          level={composeDebug.sentimentResult?.level ?? 'ok'} | draftLength={composeDebug.draftText?.trim().length ?? 0} | replyContext={String(!!composeDebug.sentimentResult?.isReplyContext)} | dismissed={composeDebug.sentimentDismissedAt === null ? 'false' : 'true'}
                        </p>
                        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                          draft="{composeDebug.draftText?.trim() || '(empty)'}"
                        </p>
                        {composeDebug.replyParentText && (
                          <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                            parent="{composeDebug.replyParentText.length > 120 ? `${composeDebug.replyParentText.slice(0, 117)}...` : composeDebug.replyParentText}"
                          </p>
                        )}
                        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                          signals={composeDebug.sentimentResult?.signals?.length ? composeDebug.sentimentResult.signals.join(' | ') : '(none)'}
                        </p>
                        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                          supportiveReplySignals={composeDebug.sentimentResult?.supportiveReplySignals?.length ? composeDebug.sentimentResult.supportiveReplySignals.join(' | ') : '(none)'}
                        </p>
                        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                          constructiveSignals={composeDebug.sentimentResult?.constructiveSignals?.length ? composeDebug.sentimentResult.constructiveSignals.join(' | ') : '(none)'}
                        </p>
                        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                          parentSignals={composeDebug.sentimentResult?.parentSignals?.length ? composeDebug.sentimentResult.parentSignals.join(' | ') : '(none)'}
                        </p>
                      </div>
                    )}
                  </div>

                  <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '14px 0 10px' }} />

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }}>Bootstrap telemetry (debug)</h4>
                      <button
                        type="button"
                        onClick={() => setBootstrapMetrics(getBootstrapTelemetrySnapshot())}
                        style={{
                          border: '1px solid var(--sep)',
                          borderRadius: 8,
                          background: 'var(--fill-1)',
                          color: 'var(--label-2)',
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '4px 8px',
                          cursor: 'pointer',
                        }}
                      >
                        Refresh
                      </button>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--label-4)', marginTop: 4, lineHeight: 1.35 }}>
                      Tracks local bootstrap stages in memory only so DB and runtime startup can be profiled without persisting user state.
                    </p>
                    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                      {(Object.entries(bootstrapMetrics) as Array<[keyof BootstrapTelemetrySnapshot, BootstrapTelemetrySnapshot[keyof BootstrapTelemetrySnapshot]]>).map(([key, value]) => (
                        <div key={key} style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                            <span>{key}</span>
                            <span>{value.status}</span>
                          </div>
                          <div style={{ marginTop: 4, fontSize: 13, fontWeight: 800, color: 'var(--label-1)' }}>
                            {value.durationMs === null ? '—' : `${value.durationMs}ms`}
                          </div>
                          {value.message && (
                            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--label-3)', lineHeight: 1.35 }}>
                              {value.message}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '14px 0 10px' }} />

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }}>ALT telemetry (debug)</h4>
                      <button
                        type="button"
                        onClick={() => setAltMetrics(getAltTextMetricsSnapshot())}
                        style={{
                          border: '1px solid var(--sep)',
                          borderRadius: 8,
                          background: 'var(--fill-1)',
                          color: 'var(--label-2)',
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '4px 8px',
                          cursor: 'pointer',
                        }}
                      >
                        Refresh
                      </button>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--label-4)', marginTop: 4, lineHeight: 1.35 }}>
                      Mirrors window.__GLYMPSE_ALT_METRICS__ for quick QA checks.
                    </p>

                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
                        <div style={{ fontSize: 11, color: 'var(--label-3)' }}>Completion Rate</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }}>{(altMetrics.completionRate * 100).toFixed(0)}%</div>
                      </div>
                      <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
                        <div style={{ fontSize: 11, color: 'var(--label-3)' }}>Bulk Success Rate</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }}>{(altMetrics.bulkSuccessRate * 100).toFixed(0)}%</div>
                      </div>
                      <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
                        <div style={{ fontSize: 11, color: 'var(--label-3)' }}>Posts With Full ALT</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }}>{altMetrics.postsWithFullAlt}</div>
                      </div>
                      <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
                        <div style={{ fontSize: 11, color: 'var(--label-3)' }}>Posts Missing ALT</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }}>{altMetrics.postsWithMissingAlt}</div>
                      </div>
                      <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
                        <div style={{ fontSize: 11, color: 'var(--label-3)' }}>Bulk Runs</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }}>{altMetrics.bulkRuns}</div>
                      </div>
                      <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
                        <div style={{ fontSize: 11, color: 'var(--label-3)' }}>Bulk Generated / Requested</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }}>
                          {altMetrics.bulkGeneratedItems}/{altMetrics.bulkRequestedItems}
                        </div>
                      </div>
                    </div>
                  </div>

                  <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '14px 0 10px' }} />

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }}>Recommendation telemetry (debug)</h4>
                      <button
                        type="button"
                        onClick={() => setRecommendationMetrics(getRecommendationTelemetrySnapshot())}
                        style={{
                          border: '1px solid var(--sep)',
                          borderRadius: 8,
                          background: 'var(--fill-1)',
                          color: 'var(--label-2)',
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '4px 8px',
                          cursor: 'pointer',
                        }}
                      >
                        Refresh
                      </button>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--label-4)', marginTop: 4, lineHeight: 1.35 }}>
                      Tracks Explore suggestion conversion, reason-chip outcomes, and confidence calibration.
                    </p>

                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
                        <div style={{ fontSize: 11, color: 'var(--label-3)' }}>Impressions</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }}>{recommendationMetrics.impressionCount}</div>
                      </div>
                      <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
                        <div style={{ fontSize: 11, color: 'var(--label-3)' }}>Follow Conversion</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }}>{(recommendationMetrics.followConversionRate * 100).toFixed(1)}%</div>
                      </div>
                      <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
                        <div style={{ fontSize: 11, color: 'var(--label-3)' }}>Dismiss Rate</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }}>{(recommendationMetrics.dismissRate * 100).toFixed(1)}%</div>
                      </div>
                      <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
                        <div style={{ fontSize: 11, color: 'var(--label-3)' }}>Follows / Dismisses</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }}>
                          {recommendationMetrics.followCount}/{recommendationMetrics.dismissCount}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: 8, border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
                      <div style={{ fontSize: 11, color: 'var(--label-3)', marginBottom: 4 }}>Reason chip outcomes</div>
                      {Object.keys(recommendationMetrics.reasonImpressions).length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--label-3)' }}>No recommendation reason telemetry yet.</div>
                      ) : (
                        <div style={{ display: 'grid', gap: 4 }}>
                          {Object.entries(recommendationMetrics.reasonImpressions).slice(0, 6).map(([reason, impressions]) => {
                            const follows = recommendationMetrics.reasonFollows[reason] ?? 0;
                            const dismisses = recommendationMetrics.reasonDismisses[reason] ?? 0;
                            return (
                              <div key={reason} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'var(--label-2)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reason}</span>
                                <span>I:{impressions} F:{follows} D:{dismisses}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 8, border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
                      <div style={{ fontSize: 11, color: 'var(--label-3)', marginBottom: 4 }}>Confidence calibration</div>
                      <div style={{ display: 'grid', gap: 4 }}>
                        {recommendationMetrics.confidenceBuckets.map((bucket) => (
                          <div key={bucket.bucket} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'var(--label-2)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                            <span>{bucket.bucket}%</span>
                            <span>I:{bucket.impressions} F:{(bucket.followRate * 100).toFixed(0)}% D:{(bucket.dismissRate * 100).toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
