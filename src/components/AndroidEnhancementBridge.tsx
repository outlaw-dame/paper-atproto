// ─── Android Enhancement Bridge ───────────────────────────────────────────────
// Detects Android capabilities once on mount and wires Android-specific UX:
//
//   1. Capability detection → stored in androidEnhancementStore for consumers.
//   2. Body attribute         → sets data-platform="android" so CSS can apply
//                               Material Design-style touch feedback without
//                               JS-in-CSS hacks.
//   3. Back-gesture intercept → installs popstate interceptors for every overlay
//                               that is open, so the Android back button/gesture
//                               closes the topmost sheet instead of navigating away.
//
// This component renders null. Mount it once inside the authenticated shell,
// alongside AppleEnhancementBridge.

import React from 'react';
import { detectAndroidEnhancementAvailability } from '../android/availability';
import { useAndroidBackInterceptor } from '../android/backGesture';
import { useAndroidEnhancementStore } from '../store/androidEnhancementStore';
import { useUiStore } from '../store/uiStore';
import { getStaticPlatformInfo } from '../lib/platformDetect';

// Compute once — platform signals are stable for the lifetime of the page.
const IS_ANDROID = getStaticPlatformInfo().isAndroid;

// ─── Body attribute helpers ───────────────────────────────────────────────────
// Scoped to this module; no shared state needed.

function applyAndroidBodyAttribute(): void {
  try {
    document.body.setAttribute('data-platform', 'android');
  } catch {
    // Sandboxed iframe — ignore.
  }
}

function removeAndroidBodyAttribute(): void {
  try {
    if (document.body.getAttribute('data-platform') === 'android') {
      document.body.removeAttribute('data-platform');
    }
  } catch {
    // Sandboxed iframe — ignore.
  }
}

// ─── Overlay back-gesture interceptors ───────────────────────────────────────
// Each overlay gets its own interceptor. History-stack LIFO ordering ensures
// the most recently opened overlay is always the first to close.
// Must cover every overlay type that OverlayHost renders.

function AndroidBackInterceptors() {
  const showCompose        = useUiStore((s) => s.showCompose);
  const showPromptComposer = useUiStore((s) => s.showPromptComposer);
  const story              = useUiStore((s) => s.story);
  const searchStoryQuery   = useUiStore((s) => s.searchStoryQuery);
  const hashtagFeedQuery   = useUiStore((s) => s.hashtagFeedQuery);
  const peopleFeedQuery    = useUiStore((s) => s.peopleFeedQuery);

  const closeCompose        = useUiStore((s) => s.closeCompose);
  const closePromptComposer = useUiStore((s) => s.closePromptComposer);
  const closeStory          = useUiStore((s) => s.closeStory);
  const closeSearchStory    = useUiStore((s) => s.closeSearchStory);
  const closeHashtagFeed    = useUiStore((s) => s.closeHashtagFeed);
  const closePeopleFeed     = useUiStore((s) => s.closePeopleFeed);

  useAndroidBackInterceptor(IS_ANDROID && showCompose,              closeCompose);
  useAndroidBackInterceptor(IS_ANDROID && showPromptComposer,       closePromptComposer);
  useAndroidBackInterceptor(IS_ANDROID && story !== null,           closeStory);
  useAndroidBackInterceptor(IS_ANDROID && searchStoryQuery !== null, closeSearchStory);
  useAndroidBackInterceptor(IS_ANDROID && hashtagFeedQuery !== null, closeHashtagFeed);
  useAndroidBackInterceptor(IS_ANDROID && peopleFeedQuery !== null,  closePeopleFeed);

  return null;
}

// ─── Root bridge component ────────────────────────────────────────────────────

export default function AndroidEnhancementBridge() {
  const setAvailability = useAndroidEnhancementStore((s) => s.setAvailability);

  React.useEffect(() => {
    const avail = detectAndroidEnhancementAvailability();
    setAvailability(avail);

    if (avail.likelyAndroidChrome) {
      applyAndroidBodyAttribute();
    }

    // Only clean up the attribute if this effect set it. Never remove an
    // attribute we didn't place (avoids interfering with future data-platform
    // values if another module sets them).
    return () => {
      if (avail.likelyAndroidChrome) {
        removeAndroidBodyAttribute();
      }
    };
  }, [setAvailability]);

  // Only install back-gesture interceptors on Android to avoid polluting the
  // history stack on iOS and desktop where back-button expectations differ.
  if (!IS_ANDROID) return null;

  return <AndroidBackInterceptors />;
}
