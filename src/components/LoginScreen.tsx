import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAtp } from '../atproto/AtpContext.js';
import { sanitizeAuthIdentifier } from '../atproto/oauthClient.js';
import { getRecentHandles, type RecentHandle } from '../store/sessionStore.js';

// ─── Recent-handle suggestion dropdown ───────────────────────────────────────
function RecentHandleDropdown({
  suggestions,
  selectedIndex,
  onSelect,
  onPointerEnterRow,
}: {
  suggestions: RecentHandle[];
  selectedIndex: number;
  onSelect: (s: RecentHandle) => void;
  onPointerEnterRow: (idx: number) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <motion.div
      key="rh-dropdown"
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{ duration: 0.14, ease: [0.25, 0.1, 0.25, 1] }}
      role="listbox"
      aria-label="Recent accounts"
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        right: 0,
        zIndex: 200,
        marginTop: 6,
        background: 'var(--surface)',
        border: '0.5px solid var(--sep)',
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.20)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '6px 12px',
          borderBottom: '0.5px solid var(--sep)',
          background: 'var(--fill-1)',
          fontSize: 11,
          fontWeight: 800,
          color: 'var(--label-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        Recent accounts
      </div>

      {suggestions.map((s, idx) => {
        const initials = (s.displayName?.[0] ?? s.handle[0] ?? '?').toUpperCase();
        const isSelected = idx === selectedIndex;
        return (
          <button
            key={s.handle}
            role="option"
            aria-selected={isSelected}
            onPointerEnter={() => onPointerEnterRow(idx)}
            onPointerDown={(e) => {
              e.preventDefault(); // prevent input blur before selection
              onSelect(s);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '9px 12px',
              background: isSelected ? 'rgba(10,132,255,0.10)' : 'none',
              border: 'none',
              borderBottom: idx < suggestions.length - 1 ? '0.5px solid var(--sep)' : 'none',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.1s ease',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {/* Avatar */}
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--blue) 0%, var(--indigo) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 14,
                fontWeight: 700,
                flexShrink: 0,
                overflow: 'hidden',
              }}
            >
              {s.avatar ? (
                <img
                  src={s.avatar}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                initials
              )}
            </div>

            {/* Text */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {s.displayName && (
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--label-1)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    lineHeight: 1.3,
                  }}
                >
                  {s.displayName}
                </div>
              )}
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--label-3)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.3,
                }}
              >
                @{s.handle}
              </div>
            </div>
          </button>
        );
      })}
    </motion.div>
  );
}

// ─── LoginScreen ──────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const {
    login,
    error,
    isHostedOAuthClientConfigured,
    oauthConfigWarning,
    oauthConfigBlockingError,
  } = useAtp();
  const [identifier, setIdentifier] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [focusedField, setFocusedField] = useState<'identifier' | null>(null);

  // ── Recent-handle autocomplete ─────────────────────────────────────────
  const [recentHandles] = useState<RecentHandle[]>(() => getRecentHandles());
  const [suggestions, setSuggestions] = useState<RecentHandle[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedRecent, setSelectedRecent] = useState<RecentHandle | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter recents whenever identifier changes.
  useEffect(() => {
    const q = identifier.trim().toLowerCase().replace(/^@/, '');
    if (!q) {
      setSuggestions(recentHandles);
      setSelectedIndex(0);
      return;
    }
    setSuggestions(
      recentHandles.filter(
        (r) =>
          r.handle.toLowerCase().startsWith(q) ||
          (r.displayName?.toLowerCase().startsWith(q) ?? false),
      ),
    );
    setSelectedIndex(0);
  }, [identifier, recentHandles]);

  // Surface avatar immediately when identifier exactly matches a stored recent.
  useEffect(() => {
    const q = identifier.trim().toLowerCase().replace(/^@/, '');
    const exact = recentHandles.find((r) => r.handle.toLowerCase() === q);
    setSelectedRecent(exact ?? null);
  }, [identifier, recentHandles]);

  const dismissSuggestions = useCallback(() => setSuggestions([]), []);

  const handleSelectRecent = useCallback((s: RecentHandle) => {
    setIdentifier(s.handle);
    setSelectedRecent(s);
    setSuggestions([]);
    inputRef.current?.focus();
  }, []);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (suggestions.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const s = suggestions[selectedIndex];
        if (s) {
          e.preventDefault();
          handleSelectRecent(s);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        dismissSuggestions();
      }
    },
    [suggestions, selectedIndex, handleSelectRecent, dismissSuggestions],
  );

  const canSubmit = identifier.trim().length > 0 && !isSubmitting;

  const getFieldStyle = (): React.CSSProperties => ({
    padding: selectedRecent?.avatar ? '13px 16px 13px 48px' : '13px 16px',
    minHeight: 52,
    borderRadius: 14,
    background: 'var(--surface)',
    border: `0.5px solid ${focusedField === 'identifier' ? 'var(--sep-opaque)' : 'var(--sep)'}`,
    boxShadow: focusedField === 'identifier' ? '0 0 0 3px rgba(10,132,255,0.10)' : 'none',
    fontFamily: 'var(--font-ui)',
    fontSize: 16,
    lineHeight: '22px',
    fontWeight: 400,
    letterSpacing: 'var(--type-body-md-track)',
    color: 'var(--label-1)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    appearance: 'none',
    WebkitAppearance: 'none',
    WebkitTextSizeAdjust: '100%',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease, padding 0.15s ease',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    dismissSuggestions();
    setIsSubmitting(true);
    try {
      await login(identifier.trim());
    } catch {
      // error is set in context
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset submit spinner on tab-back (OAuth redirect may restore page).
  useEffect(() => {
    const reset = () => setIsSubmitting(false);
    const onVisibility = () => { if (document.visibilityState === 'visible') reset(); };
    window.addEventListener('pageshow', reset);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pageshow', reset);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '0 24px',
      zIndex: 1000,
    }}>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        style={{ width: '100%', maxWidth: 380 }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 40 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 22,
            background: 'linear-gradient(135deg, var(--blue) 0%, var(--indigo) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(0,122,255,0.35)',
            marginBottom: 16,
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
            </svg>
          </div>
          <h1 style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-ui-headline-lg-size)', lineHeight: 'var(--type-ui-headline-lg-line)', fontWeight: 'var(--type-ui-headline-lg-weight)', letterSpacing: 'var(--type-ui-headline-lg-track)', color: 'var(--label-1)', marginBottom: 6 }}>Glimpse</h1>
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', fontWeight: 'var(--type-body-sm-weight)', letterSpacing: 'var(--type-body-sm-track)', color: 'var(--label-3)', textAlign: 'center' }}>
            Sign in with ATProto OAuth
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Handle field */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Label row — shows matched display name in accent color when a recent is selected */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 20 }}>
              <label
                htmlFor="login-identifier"
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--type-label-lg-size)',
                  lineHeight: 'var(--type-label-lg-line)',
                  fontWeight: 700,
                  color: 'var(--label-2)',
                  letterSpacing: 'var(--type-label-lg-track)',
                }}
              >
                Handle, DID, or provider URL
              </label>
              <AnimatePresence>
                {selectedRecent?.displayName && (
                  <motion.span
                    key="matched-name"
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 6 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--blue)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 160,
                    }}
                  >
                    {selectedRecent.displayName}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            {/* Input wrapper — relative so dropdown + inline avatar can be positioned */}
            <div style={{ position: 'relative' }}>
              {/* Inline avatar (shown when a recent account is matched/selected) */}
              <AnimatePresence>
                {selectedRecent?.avatar && (
                  <motion.div
                    key="inline-avatar"
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      position: 'absolute',
                      left: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      zIndex: 1,
                      pointerEvents: 'none',
                      boxShadow: '0 0 0 1.5px var(--sep)',
                    }}
                  >
                    <img
                      src={selectedRecent.avatar}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      loading="eager"
                      decoding="async"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              <input
                id="login-identifier"
                ref={inputRef}
                type="text"
                value={identifier}
                onChange={(e) => {
                  const sanitized = sanitizeAuthIdentifier(e.target.value);
                  setIdentifier(sanitized);
                  // Clear the pinned recent when the user edits freely.
                  if (selectedRecent && sanitized !== selectedRecent.handle) {
                    setSelectedRecent(null);
                  }
                }}
                onFocus={() => setFocusedField('identifier')}
                onBlur={() => {
                  setFocusedField((current) => (current === 'identifier' ? null : current));
                  // Delay so pointer events on dropdown rows fire before we clear.
                  setTimeout(dismissSuggestions, 150);
                }}
                onKeyDown={handleInputKeyDown}
                placeholder="you.bsky.social"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={512}
                aria-invalid={Boolean(error)}
                aria-autocomplete="list"
                aria-expanded={suggestions.length > 0}
                style={getFieldStyle()}
              />

              {/* Suggestions dropdown */}
              <AnimatePresence>
                {focusedField === 'identifier' && suggestions.length > 0 && (
                  <RecentHandleDropdown
                    suggestions={suggestions}
                    selectedIndex={selectedIndex}
                    onSelect={handleSelectRecent}
                    onPointerEnterRow={setSelectedIndex}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Help toggle */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-label-lg-size)', lineHeight: 'var(--type-label-lg-line)', fontWeight: 700, color: 'var(--label-2)', letterSpacing: 'var(--type-label-lg-track)' }}>
                OAuth flow
              </label>
              <button
                type="button"
                onClick={() => setShowHelp(v => !v)}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--type-label-md-size)',
                  lineHeight: 'var(--type-label-md-line)',
                  fontWeight: 600,
                  letterSpacing: 'var(--type-label-md-track)',
                  color: 'var(--blue)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px 0',
                  minHeight: 24,
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  WebkitTextSizeAdjust: '100%',
                }}
              >
                How it works
              </button>
            </div>
          </div>

          {/* Help text */}
          {showHelp && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{
                padding: '12px 14px', borderRadius: 12,
                background: 'rgba(0,122,255,0.08)',
                border: '1px solid rgba(0,122,255,0.15)',
              }}
            >
              <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', fontWeight: 'var(--type-body-sm-weight)', letterSpacing: 'var(--type-body-sm-track)', color: 'var(--label-2)', marginBottom: 6 }}>
                Glimpse uses OAuth redirects with your provider (PDS/entryway). Your main password is never entered into Glimpse.
              </p>
              {!isHostedOAuthClientConfigured && (
                <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', fontWeight: 'var(--type-body-sm-weight)', letterSpacing: 'var(--type-body-sm-track)', color: 'var(--label-2)' }}>
                  Development mode: no hosted OAuth client metadata is configured. Local sign-ins can work, but full Following permission may require a hosted `client_id`.
                </p>
              )}
            </motion.div>
          )}

          {oauthConfigWarning && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                padding: '12px 14px', borderRadius: 12,
                background: 'rgba(255,159,10,0.10)',
                border: '1px solid rgba(255,159,10,0.25)',
              }}
            >
              <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', fontWeight: 'var(--type-body-sm-weight)', letterSpacing: 'var(--type-body-sm-track)', color: 'var(--label-2)' }}>
                {oauthConfigWarning}
              </p>
            </motion.div>
          )}

          {oauthConfigBlockingError && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                padding: '12px 14px', borderRadius: 12,
                background: 'rgba(255,59,48,0.08)',
                border: '1px solid rgba(255,59,48,0.2)',
              }}
            >
              <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', fontWeight: 'var(--type-body-sm-weight)', letterSpacing: 'var(--type-body-sm-track)', color: 'var(--red)' }}>
                {oauthConfigBlockingError}
              </p>
            </motion.div>
          )}

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                padding: '12px 14px', borderRadius: 12,
                background: 'rgba(255,59,48,0.08)',
                border: '1px solid rgba(255,59,48,0.2)',
              }}
            >
              <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', fontWeight: 'var(--type-body-sm-weight)', letterSpacing: 'var(--type-body-sm-track)', color: 'var(--red)' }}>{error}</p>
            </motion.div>
          )}

          {/* Submit */}
          <motion.button
            type="submit"
            disabled={!canSubmit}
            whileTap={canSubmit ? { scale: 0.97 } : {}}
            style={{
              padding: '12px clamp(18px, 5vw, 26px)', borderRadius: 999, marginTop: 8,
              background: canSubmit ? 'var(--blue)' : 'var(--fill-3)',
              color: canSubmit ? '#fff' : 'var(--label-4)',
              fontFamily: 'var(--font-ui)', fontSize: 'var(--type-ui-title-sm-size)', lineHeight: 'var(--type-ui-title-sm-line)', fontWeight: 600, letterSpacing: 'var(--type-ui-title-sm-track)',
              border: 'none', cursor: canSubmit ? 'pointer' : 'default',
              transition: 'background 0.15s, color 0.15s',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              alignSelf: 'center',
              width: 'fit-content',
              minWidth: isSubmitting ? 124 : 104,
              maxWidth: '100%',
              minHeight: 44,
              whiteSpace: 'nowrap',
              appearance: 'none',
              WebkitAppearance: 'none',
              WebkitTextSizeAdjust: '100%',
            }}
          >
            {isSubmitting ? (
              <>
                <Spinner />
                Signing in…
              </>
            ) : 'Sign in'}
          </motion.button>
        </form>

        {/* Footer */}
        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', fontWeight: 'var(--type-meta-sm-weight)', letterSpacing: 'var(--type-meta-sm-track)', color: 'var(--label-4)', textAlign: 'center', marginTop: 24 }}>
          Glimpse connects to the open social network via OAuth. Your session stays bound to your device.
        </p>
      </motion.div>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
      </path>
    </svg>
  );
}
