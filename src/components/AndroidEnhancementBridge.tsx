// ─── Android Enhancement Bridge ───────────────────────────────────────────────
// Detects Android capabilities once on mount and wires Android-specific UX:
//
//   1. Capability detection → stored in androidEnhancementStore for consumers.
//   2. Back-gesture intercept → installs popstate interceptors for every overlay
//                               that is open, so the Android back button/gesture
//                               closes the topmost sheet instead of navigating away.
//
// This component renders null. Mount it once inside the authenticated shell,
// alongside AppleEnhancementBridge.

import React from 'react';
import { useAndroidBackInterceptor } from '../android/backGesture';
import {
  createPlatformCapabilitySnapshot,
  shouldEnableAndroidEnhancements,
} from '../platform/capabilities';
import { useAndroidEnhancementStore } from '../store/androidEnhancementStore';
import { useUiStore } from '../store/uiStore';

// Compute once — platform signals are stable for the lifetime of the page.
const SHOULD_ENABLE_ANDROID = shouldEnableAndroidEnhancements(createPlatformCapabilitySnapshot());

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

  useAndroidBackInterceptor(SHOULD_ENABLE_ANDROID && showCompose,              closeCompose);
  useAndroidBackInterceptor(SHOULD_ENABLE_ANDROID && showPromptComposer,       closePromptComposer);
  useAndroidBackInterceptor(SHOULD_ENABLE_ANDROID && story !== null,           closeStory);
  useAndroidBackInterceptor(SHOULD_ENABLE_ANDROID && searchStoryQuery !== null, closeSearchStory);
  useAndroidBackInterceptor(SHOULD_ENABLE_ANDROID && hashtagFeedQuery !== null, closeHashtagFeed);
  useAndroidBackInterceptor(SHOULD_ENABLE_ANDROID && peopleFeedQuery !== null,  closePeopleFeed);

  return null;
}

// ─── Root bridge component ────────────────────────────────────────────────────

export default function AndroidEnhancementBridge() {
  const setAvailability = useAndroidEnhancementStore((s) => s.setAvailability);

  React.useEffect(() => {
    setAvailability(createPlatformCapabilitySnapshot().android);
  }, [setAvailability]);

  // Only install back-gesture interceptors on Android to avoid polluting the
  // history stack on iOS and desktop where back-button expectations differ.
  if (!SHOULD_ENABLE_ANDROID) return null;

  return <AndroidBackInterceptors />;
}
