import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// ─── Platform Banners ─────────────────────────────────────────────────────────
// Aggregates all platform-layer UI overlays into one lazy-loaded host.
// Rendered at the root of App alongside BootstrapErrorBanner so they can
// overlay the entire screen regardless of which tab/overlay is active.
//
// All four children are lazy-imported — none affect the initial bundle or
// block first paint. Suspense fallback is null in every case.
import React, { Suspense } from 'react';
const UpdateAvailableBanner = React.lazy(() => import('../components/UpdateAvailableBanner.js'));
const NotificationPermissionBanner = React.lazy(() => import('../components/NotificationPermissionBanner.js'));
const OfflineStatusPill = React.lazy(() => import('../components/OfflineStatusPill.js'));
const InstallPromptBanner = React.lazy(() => import('../components/InstallPromptBanner.js'));
/**
 * Platform-layer banners and status indicators.
 *
 * Stacking order (highest z-index first):
 *   9900 — UpdateAvailableBanner   (top of screen, must-act)
 *   9850 — NotificationPermissionBanner (top, opt-in prompt)
 *   9800 — OfflineStatusPill       (centred floating pill)
 *   9700 — InstallPromptBanner     (bottom sheet)
 */
export default function PlatformBanners() {
    return (_jsxs(_Fragment, { children: [_jsx(Suspense, { fallback: null, children: _jsx(UpdateAvailableBanner, {}) }), _jsx(Suspense, { fallback: null, children: _jsx(NotificationPermissionBanner, {}) }), _jsx(Suspense, { fallback: null, children: _jsx(OfflineStatusPill, {}) }), _jsx(Suspense, { fallback: null, children: _jsx(InstallPromptBanner, {}) })] }));
}
//# sourceMappingURL=PlatformBanners.js.map