import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// ─── Offline Status Pill ──────────────────────────────────────────────────────
// Fixed pill that floats near the top of the screen when the network is offline.
// Reads from offlineStatusStore — never blocks or delays the app.
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useOfflineStatusStore } from '../store/offlineStatusStore.js';
export default function OfflineStatusPill() {
    const network = useOfflineStatusStore((s) => s.network);
    const isOffline = network === 'offline';
    return (_jsx(AnimatePresence, { children: isOffline && (_jsxs(motion.div, { role: "status", "aria-live": "polite", "aria-atomic": "true", "aria-label": "No internet connection", initial: { opacity: 0, y: -16, scale: 0.92 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: -16, scale: 0.92 }, transition: { duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }, style: {
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
            }, children: [_jsx("span", { "aria-hidden": "true", style: {
                        display: 'block',
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: 'var(--orange, #FF9500)',
                        flexShrink: 0,
                        boxShadow: '0 0 6px rgba(255, 149, 0, 0.60)',
                    } }), "No internet connection"] })) }));
}
//# sourceMappingURL=OfflineStatusPill.js.map