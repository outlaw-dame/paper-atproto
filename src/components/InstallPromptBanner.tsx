// ─── Install Prompt Banner ────────────────────────────────────────────────────
// Surfaces the "Add to Home Screen" guidance for two cases:
//   • iOS Safari — manual install (no beforeinstallprompt); shows step-by-step
//   • Chromium (Android / desktop) — native install prompt via deferred event
//
// Dismissal is persisted in localStorage for DISMISS_DURATION_MS (7 days).
// The banner never shows once the app is already running as standalone.
//
// Security: localStorage key holds only a timestamp — no user data stored.

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getInstallState, triggerInstallPrompt } from '../pwa/install';

// ─── Dismissal helpers ────────────────────────────────────────────────────────

const DISMISS_KEY = 'glimpse-install-banner-dismissed-v1';
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function readDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || !('at' in parsed)) return false;
    return typeof (parsed as { at: unknown }).at === 'number'
      && Date.now() - (parsed as { at: number }).at < DISMISS_DURATION_MS;
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify({ at: Date.now() }));
  } catch {
    // Ignore quota / private-browsing errors — banner re-shows next session
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InstallStep({
  n,
  text,
  icon,
}: {
  n: number;
  text: string;
  icon: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        aria-hidden="true"
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: 'color-mix(in srgb, var(--blue, #007AFF) 14%, transparent)',
          color: 'var(--blue, #007AFF)',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: 'var(--font-ui)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {n}
      </div>
      <span
        style={{
          flex: 1,
          fontSize: 13,
          fontFamily: 'var(--font-ui)',
          color: 'var(--label-2)',
          lineHeight: 1.4,
        }}
      >
        {text}
      </span>
      <span aria-hidden="true" style={{ flexShrink: 0, color: 'var(--label-3)' }}>
        {icon}
      </span>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function PlusSquareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" ry="3" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InstallPromptBanner() {
  const [visible, setVisible] = React.useState(false);
  const [type, setType] = React.useState<'ios' | 'chromium' | null>(null);
  const [installing, setInstalling] = React.useState(false);

  React.useEffect(() => {
    if (readDismissed()) return;
    const state = getInstallState();
    if (state.standalone) return; // already running as installed app
    if (state.isIosSafariInstallCandidate) {
      setType('ios');
      setVisible(true);
    } else if (state.deferredPromptAvailable) {
      setType('chromium');
      setVisible(true);
    }
  }, []);

  const handleDismiss = React.useCallback(() => {
    writeDismissed();
    setVisible(false);
  }, []);

  const handleInstall = React.useCallback(async () => {
    if (type !== 'chromium') return;
    setInstalling(true);
    try {
      await triggerInstallPrompt();
    } finally {
      setInstalling(false);
      writeDismissed();
      setVisible(false);
    }
  }, [type]);

  return (
    <AnimatePresence>
      {visible && type !== null && (
        <motion.div
          // Bottom sheet — slides up from below the tab bar
          role="complementary"
          aria-label="Install Glimpse to your home screen"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.30, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: 'fixed',
            // Sit just above the tab bar (approx 64px) + safe area bottom
            bottom: 'calc(var(--safe-bottom, 0px) + 72px)',
            left: 12,
            right: 12,
            zIndex: 9700,
            borderRadius: 20,
            background: 'var(--surface, #ffffff)',
            border: '0.5px solid var(--sep)',
            boxShadow: '0 8px 40px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.10)',
            overflow: 'hidden',
          }}
        >
          {/* Header row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 14px 0',
            }}
          >
            {/* App icon */}
            <div
              aria-hidden="true"
              style={{
                width: 48,
                height: 48,
                flexShrink: 0,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #00B3FF 0%, #0070E0 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0, 112, 224, 0.30)',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
                <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
              </svg>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-ui)',
                  fontSize: 15,
                  fontWeight: 700,
                  color: 'var(--label-1)',
                  letterSpacing: '-0.01em',
                  lineHeight: 1.25,
                }}
              >
                Add Glimpse to Home Screen
              </p>
              <p
                style={{
                  margin: '3px 0 0',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 12,
                  color: 'var(--label-3)',
                  lineHeight: 1.4,
                }}
              >
                {type === 'ios'
                  ? 'Browse offline and get the full app experience'
                  : 'Fast, offline-capable access from your home screen'}
              </p>
            </div>

            <button
              onClick={handleDismiss}
              aria-label="Dismiss install prompt"
              style={{
                flexShrink: 0,
                background: 'color-mix(in srgb, var(--label-1) 8%, transparent)',
                border: 'none',
                borderRadius: '50%',
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--label-2)',
                WebkitTapHighlightColor: 'transparent',
                padding: 0,
              }}
            >
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Instructions / CTA */}
          <div style={{ padding: '12px 14px 14px' }}>
            {type === 'ios' ? (
              <div
                role="list"
                aria-label="Steps to install"
                style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                <div role="listitem">
                  <InstallStep n={1} text="Tap the Share button in Safari" icon={<ShareIcon />} />
                </div>
                <div role="listitem">
                  <InstallStep n={2} text='Select "Add to Home Screen"' icon={<PlusSquareIcon />} />
                </div>
                <div role="listitem">
                  <InstallStep n={3} text='Tap "Add" to confirm' icon={<CheckIcon />} />
                </div>
              </div>
            ) : (
              <button
                onClick={handleInstall}
                disabled={installing}
                aria-label={installing ? 'Installing app…' : 'Install Glimpse app'}
                style={{
                  width: '100%',
                  appearance: 'none',
                  border: 'none',
                  borderRadius: 14,
                  minHeight: 44,
                  background: installing
                    ? 'color-mix(in srgb, var(--blue, #007AFF) 60%, transparent)'
                    : 'var(--blue, #007AFF)',
                  color: '#ffffff',
                  fontSize: 15,
                  fontWeight: 700,
                  fontFamily: 'var(--font-ui)',
                  cursor: installing ? 'default' : 'pointer',
                  transition: 'background 0.18s, opacity 0.15s',
                  WebkitTapHighlightColor: 'transparent',
                  letterSpacing: '-0.01em',
                }}
              >
                {installing ? 'Installing…' : 'Install App'}
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
