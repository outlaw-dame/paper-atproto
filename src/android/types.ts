// ─── Android Enhancement Types ────────────────────────────────────────────────

export interface AndroidEnhancementAvailability {
  /** Web Share API (navigator.share) is present — Android Chrome 61+. */
  shareApiAvailable: boolean;
  /** Vibration API (navigator.vibrate) is present — Android Chrome; absent on iOS/Safari. */
  vibrationApiAvailable: boolean;
  /** Contact Picker API (navigator.contacts) — Android Chrome 80+ only. */
  contactPickerAvailable: boolean;
  /** Badging API (navigator.setAppBadge) is present. */
  badgingUsable: boolean;
  /** Web Push permission is granted and a Service Worker + PushManager are available. */
  notificationsUsable: boolean;
  /**
   * Back-gesture interception is possible via history.pushState + popstate.
   * Present in all modern browsers; absent only in extremely old WebViews.
   */
  backGestureSupported: boolean;
  /** File System Access API (window.showOpenFilePicker) — Chrome 86+. */
  filePickerAvailable: boolean;
  /** App is running as an installed Home Screen / TWA web app. */
  pwaInstalled: boolean;
  /**
   * Coarse signal that this is likely Android Chrome.
   * Capability-first: uses userAgentData.platform, Vibration API presence,
   * and window.chrome as primary signals. Falls back to UA string.
   */
  likelyAndroidChrome: boolean;
}
