// ─── Platform Banners ─────────────────────────────────────────────────────────
// Aggregates all platform-layer UI overlays into one lazy-loaded host.
// Rendered at the root of App alongside BootstrapErrorBanner so they can
// overlay the entire screen regardless of which tab/overlay is active.
//
// All four children are lazy-imported — none affect the initial bundle or
// block first paint. Suspense fallback is null in every case.

import React, { Suspense } from 'react';

const UpdateAvailableBanner = React.lazy(
  () => import('../components/UpdateAvailableBanner'),
);
const NotificationPermissionBanner = React.lazy(
  () => import('../components/NotificationPermissionBanner'),
);
const OfflineStatusPill = React.lazy(
  () => import('../components/OfflineStatusPill'),
);
const InstallPromptBanner = React.lazy(
  () => import('../components/InstallPromptBanner'),
);

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
  return (
    <>
      <Suspense fallback={null}>
        <UpdateAvailableBanner />
      </Suspense>
      <Suspense fallback={null}>
        <NotificationPermissionBanner />
      </Suspense>
      <Suspense fallback={null}>
        <OfflineStatusPill />
      </Suspense>
      <Suspense fallback={null}>
        <InstallPromptBanner />
      </Suspense>
    </>
  );
}
