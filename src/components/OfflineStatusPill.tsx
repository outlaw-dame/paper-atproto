// ─── Offline Status Pill ──────────────────────────────────────────────────────
// Fixed pill that floats near the top of the screen when the network is offline
// or degraded. Reads from offlineStatusStore — never blocks or delays the app.

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useOfflineStatusStore } from '../store/offlineStatusStore';

export default function OfflineStatusPill() {
  const network = useOfflineStatusStore((s) => s.network);
  const visible = network !== 'online';
  const isOffline = network === 'offline';
  const label = isOffline ? 'No internet connection' : 'Connection is unstable';
  const dotColor = isOffline ? 'var(--orange, #FF9500)' : 'var(--yellow, #FFD60A)';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={label}
          initial={{ opacity: 0, y: -16, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.92 }}
          transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
          style={{
            position: 'fixed',
            // Respect device safe area (notch / Dynamic Island)
            top: 'calc(var(--safe-top, 0px) + 12px)',
            left: '50%',
            zIndex: 9800,
            // translateX via transform rather than marginLeft so the motion
            // animation can still manipulate the transform without conflicts.
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            paddingLeft: 12,
            paddingRight: 14,
            paddingTop: 7,
            paddingBottom: 7,
            borderRadius: 999,
            // Frosted glass matches the shell chrome aesthetic
            background: 'rgba(0, 0, 0, 0.80)',
            backdropFilter: 'blur(14px) saturate(140%)',
            WebkitBackdropFilter: 'blur(14px) saturate(140%)',
            border: '0.5px solid rgba(255, 255, 255, 0.10)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.30)',
            color: '#ffffff',
            fontSize: 13,
            fontFamily: 'var(--font-ui)',
            fontWeight: 500,
            letterSpacing: '-0.01em',
            lineHeight: 1,
            // Pill is purely informational — never captures pointer events
            pointerEvents: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            // Prevent iOS tap highlight on parent traversal
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {/* Status dot — orange to match system "no service" affordance */}
          <span
            aria-hidden="true"
            style={{
              display: 'block',
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: dotColor,
              flexShrink: 0,
              boxShadow: isOffline
                ? '0 0 6px rgba(255, 149, 0, 0.60)'
                : '0 0 6px rgba(255, 214, 10, 0.55)',
            }}
          />
          {label}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
