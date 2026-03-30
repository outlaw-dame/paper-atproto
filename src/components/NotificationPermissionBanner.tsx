// ─── Notification Permission Banner ──────────────────────────────────────────
// Compact top-of-screen banner asking the user to enable push notifications.
//
// Visibility rules:
//   - Push is supported in this browser
//   - Permission is 'default' (not yet decided)
//   - Not iOS Safari in non-standalone mode (push requires installed app on iOS)
//   - User has not dismissed this session (persisted in localStorage)
//
// On "Enable":
//   1. Request Notification.permission
//   2. If granted → ensurePushSubscription() → update pushPreferencesStore
//   3. Any error is shown inline — user can retry or dismiss
//
// Security: localStorage key holds only a boolean — no user data stored.

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getPushCapability } from '../pwa/push/pushCapability.js';
import { ensurePushSubscription } from '../pwa/push/pushSubscription.js';
import { usePushPreferencesStore } from '../pwa/push/pushPreferencesStore.js';

const DISMISS_KEY = 'glimpse-notif-prompt-dismissed-v1';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Ignore storage errors
  }
}

type RequestState = 'idle' | 'requesting' | 'error';

export default function NotificationPermissionBanner() {
  const [visible, setVisible] = React.useState(false);
  const [requestState, setRequestState] = React.useState<RequestState>('idle');
  const [errorMsg, setErrorMsg] = React.useState('');
  const setEnabled = usePushPreferencesStore((s) => s.setEnabled);

  React.useEffect(() => {
    if (readDismissed()) return;
    const cap = getPushCapability();
    // Bail out if push is unsupported, already decided, or requires standalone (iOS)
    if (!cap.supported) return;
    if (cap.permission !== 'default') return;
    if (cap.installedContextPreferred) return;
    setVisible(true);
  }, []);

  const handleDismiss = React.useCallback(() => {
    writeDismissed();
    setVisible(false);
  }, []);

  const handleEnable = React.useCallback(async () => {
    setRequestState('requesting');
    setErrorMsg('');
    try {
      const permission = await Notification.requestPermission();

      if (permission === 'denied') {
        // User explicitly denied — persist and hide
        writeDismissed();
        setVisible(false);
        return;
      }

      if (permission !== 'granted') {
        // Dismissed without deciding — hide but don't persist so we can ask again
        setVisible(false);
        return;
      }

      const result = await ensurePushSubscription();
      if (result.ok) {
        setEnabled(true);
        setVisible(false);
      } else if (result.errorCode === 'auth-required') {
        setRequestState('error');
        setErrorMsg('Sign in to enable notifications.');
      } else if (result.errorCode === 'validation-failed') {
        setRequestState('error');
        setErrorMsg('Subscription setup failed. Try again later.');
      } else {
        setRequestState('error');
        setErrorMsg('Could not register. Check your connection and try again.');
      }
    } catch {
      setRequestState('error');
      setErrorMsg('An unexpected error occurred. Try again.');
    }
  }, [setEnabled]);

  const handleRetry = React.useCallback(() => {
    setRequestState('idle');
    setErrorMsg('');
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="complementary"
          aria-label="Enable push notifications"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9850,
            // Safe area ensures the banner clears the notch / status bar
            paddingTop: 'var(--safe-top, 0px)',
            background: 'var(--surface, #ffffff)',
            borderBottom: '0.5px solid var(--sep)',
            boxShadow: '0 2px 16px rgba(0, 0, 0, 0.09)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
            }}
          >
            {/* Bell icon container */}
            <div
              aria-hidden="true"
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                flexShrink: 0,
                background: 'color-mix(in srgb, var(--blue, #007AFF) 12%, transparent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--blue, #007AFF)',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 01-3.46 0" />
              </svg>
            </div>

            {/* Copy */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-ui)',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--label-1)',
                  lineHeight: 1.3,
                }}
              >
                Stay up to date
              </p>
              <p
                style={{
                  margin: '2px 0 0',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 12,
                  color: requestState === 'error' ? 'var(--red, #FF3B30)' : 'var(--label-3)',
                  lineHeight: 1.4,
                  transition: 'color 0.15s',
                }}
              >
                {requestState === 'error'
                  ? errorMsg
                  : 'Get notified about mentions, replies, and messages.'}
              </p>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {requestState === 'requesting' ? (
                // Spinner
                <svg
                  aria-label="Registering…"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--blue, #007AFF)"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                >
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from="0 12 12"
                      to="360 12 12"
                      dur="0.8s"
                      repeatCount="indefinite"
                    />
                  </path>
                </svg>
              ) : requestState === 'error' ? (
                // Retry + dismiss
                <>
                  <button
                    onClick={handleRetry}
                    style={{
                      appearance: 'none',
                      border: '1px solid var(--sep)',
                      borderRadius: 10,
                      height: 32,
                      paddingLeft: 10,
                      paddingRight: 10,
                      background: 'transparent',
                      color: 'var(--label-1)',
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: 'var(--font-ui)',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    Retry
                  </button>
                  <button
                    onClick={handleDismiss}
                    aria-label="Dismiss notification prompt"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 6,
                      color: 'var(--label-3)',
                      lineHeight: 1,
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </>
              ) : (
                // Enable + dismiss
                <>
                  <button
                    onClick={handleEnable}
                    style={{
                      appearance: 'none',
                      border: 'none',
                      borderRadius: 10,
                      height: 32,
                      paddingLeft: 12,
                      paddingRight: 12,
                      background: 'var(--blue, #007AFF)',
                      color: '#ffffff',
                      fontSize: 13,
                      fontWeight: 700,
                      fontFamily: 'var(--font-ui)',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    Enable
                  </button>
                  <button
                    onClick={handleDismiss}
                    aria-label="Dismiss notification prompt"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 6,
                      color: 'var(--label-3)',
                      lineHeight: 1,
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
