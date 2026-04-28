// ─── Update Available Banner ──────────────────────────────────────────────────
// Shown when the service worker has a new version waiting to activate.
// Tapping "Update" posts SKIP_WAITING and then reloads so the new SW takes over.
// Dismissible within the session — user can defer once. Does not persist dismissal
// across sessions; the banner re-appears after the next reload if still pending.

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppCapabilityStore } from '../store/appCapabilityStore';

export default function UpdateAvailableBanner() {
  const swState = useAppCapabilityStore((s) => s.swState);
  const [dismissed, setDismissed] = React.useState(false);
  const updateAvailable = swState?.updateAvailable === true && !dismissed;

  const handleUpdate = React.useCallback(async () => {
    try {
      const { activatePendingUpdate } = await import('../pwa/registerServiceWorker');
      activatePendingUpdate();
      // Brief pause to allow the SW to activate before reload
      await new Promise<void>((r) => setTimeout(r, 300));
      window.location.reload();
    } catch {
      // If activation fails, a plain reload will still pick up the new SW
      // on the next controlled navigation.
      window.location.reload();
    }
  }, []);

  return (
    <AnimatePresence>
      {updateAvailable && (
        <motion.div
          role="alert"
          aria-live="polite"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9900,
            // Pad top by the safe area so it clears the notch / status bar
            paddingTop: 'calc(var(--safe-top, 0px) + 8px)',
            paddingBottom: 10,
            paddingLeft: 14,
            paddingRight: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--blue, #007AFF)',
            color: '#ffffff',
            fontSize: 13,
            fontFamily: 'var(--font-ui)',
            fontWeight: 500,
            lineHeight: 1.4,
          }}
        >
          {/* Arrow-up-circle icon */}
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="16 12 12 8 8 12" />
            <line x1="12" y1="16" x2="12" y2="8" />
          </svg>

          <span style={{ flex: 1 }}>A new version of Glimpse is ready</span>

          <button
            onClick={handleUpdate}
            style={{
              flexShrink: 0,
              appearance: 'none',
              border: '1px solid rgba(255, 255, 255, 0.35)',
              borderRadius: 10,
              background: 'rgba(255, 255, 255, 0.18)',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: 'pointer',
              padding: '5px 10px',
              whiteSpace: 'nowrap',
              WebkitTapHighlightColor: 'transparent',
              transition: 'opacity 0.15s',
            }}
          >
            Update
          </button>

          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss update notification"
            style={{
              flexShrink: 0,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 6,
              color: 'inherit',
              lineHeight: 1,
              WebkitTapHighlightColor: 'transparent',
              opacity: 0.75,
            }}
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
