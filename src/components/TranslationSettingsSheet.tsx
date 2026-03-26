import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslationStore } from '../store/translationStore.js';
import ContentFilterSettingsSection from './ContentFilterSettingsSection.js';
import BlueskyPrefsSection from './BlueskyPrefsSection.js';
import ModerationSettingsPage from './ModerationSettingsPage.js';
import { usePlatform, getIconBtnTokens } from '../hooks/usePlatform.js';
import { getAltTextMetricsSnapshot } from '../perf/altTextTelemetry.js';

interface Props {
  open: boolean;
  onClose: () => void;
}

type LanguageOption = {
  code: string;
  label: string;
};

type SettingsPage = 'translation' | 'moderation' | 'debug';

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
          <span style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--label-3)' }}>{helper}</span>
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
  const platform = usePlatform();
  const iconTokens = getIconBtnTokens(platform);
  const [page, setPage] = useState<SettingsPage>('translation');
  const [altMetrics, setAltMetrics] = useState(() => getAltTextMetricsSnapshot());
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
    if (!open) return;

    const refresh = () => {
      setAltMetrics(getAltTextMetricsSnapshot());
      if (typeof window !== 'undefined') {
        const snapshot = (window as Window & { __PAPER_COMPOSE_DEBUG__?: unknown }).__PAPER_COMPOSE_DEBUG__;
        setComposeDebug((snapshot ?? null) as ComposeDebugSnapshot | null);
      }
    };
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [open]);

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
                <p style={{ fontSize: 12, color: 'var(--label-3)' }}>
                  {page === 'translation'
                    ? 'Phanpy-style inline + auto translation'
                    : page === 'moderation'
                      ? 'Sensitive media, filters, and moderation controls'
                      : 'Diagnostics and QA details for internal testing'}
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
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={() => setPage('translation')}
                  style={{
                    flex: 1,
                    height: 34,
                    borderRadius: 10,
                    border: 'none',
                    background: page === 'translation' ? 'var(--blue)' : 'var(--fill-2)',
                    color: page === 'translation' ? '#fff' : 'var(--label-2)',
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
                    color: page === 'moderation' ? '#fff' : 'var(--label-2)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Moderation
                </button>
                <button
                  type="button"
                  onClick={() => setPage('debug')}
                  style={{
                    flex: 1,
                    height: 34,
                    borderRadius: 10,
                    border: 'none',
                    background: page === 'debug' ? 'var(--blue)' : 'var(--fill-2)',
                    color: page === 'debug' ? '#fff' : 'var(--label-2)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Debug
                </button>
              </div>

              {page === 'translation' && (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--label-3)', marginBottom: 6 }}>
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
                    label="Auto translate Story threads"
                    helper="Pre-translate thread content used by Story Mode."
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

                  <p style={{ fontSize: 11, color: 'var(--label-4)', marginTop: 10, lineHeight: 1.35 }}>
                    Note: translation may use external services depending on the selected mode and language pair.
                  </p>

                  <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '14px 0 10px' }} />

                  <BlueskyPrefsSection />

                </>
              )}

              {page === 'moderation' && <ModerationSettingsPage />}

              {page === 'debug' && (
                <>
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
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
