// ─── Android Back-Gesture / Back-Button Interception ─────────────────────────
// When an overlay (sheet, modal, story) is open on Android, pressing the hardware
// back button or completing a predictive back swipe fires a `popstate` event.
// Without interception the browser navigates backward in history — usually out of
// the app or to a blank state.
//
// Strategy (same pattern used by Material Design dialogs and the Chromium PWA team):
//   1. On overlay open:       history.pushState({ [OVERLAY_KEY]: overlayId }, '')
//   2. On popstate:           if state owns our key → close the overlay (not the page)
//   3. On programmatic close: if history.state owns our key → history.back()
//
// Design guarantees:
//   - A single, shared `popstate` listener — never installed more than once.
//   - History-stack LIFO: the most recently pushed overlay is always the current
//     history entry, so back always closes the top overlay first.
//   - No dependency on React — safe to use from non-component code.
//   - Snapshot-safe: history.state comparisons use the value at push time.
//   - Private-browsing / sandboxed-frame safe: pushState errors are caught.
//   - SSR-safe: all history/window access is guarded.
//   - Suppress flag: when popOverlayEntry calls history.back() for cleanup, any
//     overlay-keyed popstate that fires immediately after is suppressed so we
//     don't accidentally close an underlying stacked overlay.
//
// React Integration:
//   useAndroidBackInterceptor(isOpen, onClose) — mounts/unmounts automatically.

import { useEffect, useRef } from 'react';

// ─── Private module state ─────────────────────────────────────────────────────

const OVERLAY_STATE_KEY = '__paper_overlay_id__';
let _idCounter = 0;
let _listenerInstalled = false;

/**
 * Set to true immediately before calling history.back() from popOverlayEntry.
 * The resulting popstate may land on an underlying overlay's history entry —
 * we must NOT close that overlay just because we navigated past it during cleanup.
 * Reset on every overlay-keyed popstate (whether suppressed or not).
 */
let _suppressNextOverlayPop = false;

/** ID → close-callback. Entries are present only while the overlay is open. */
const _registry = new Map<string, () => void>();

// ─── Internal helpers ─────────────────────────────────────────────────────────

function nextId(): string {
  // Counter + timestamp for uniqueness even across very fast open/close cycles.
  return `po_${++_idCounter}_${Date.now().toString(36)}`;
}

function installPopstateListener(): void {
  if (_listenerInstalled || typeof window === 'undefined') return;
  _listenerInstalled = true;

  window.addEventListener('popstate', (event: PopStateEvent) => {
    const state = event.state;

    // Ignore entries that don't carry our overlay marker.
    if (
      state === null ||
      typeof state !== 'object' ||
      typeof (state as Record<string, unknown>)[OVERLAY_STATE_KEY] !== 'string'
    ) {
      return;
    }

    const id = (state as Record<string, unknown>)[OVERLAY_STATE_KEY] as string;

    // Always reset the suppress flag when we land on any overlay-keyed entry.
    // This prevents the flag from leaking across multiple navigation events.
    if (_suppressNextOverlayPop) {
      _suppressNextOverlayPop = false;
      return; // programmatic cleanup nav — do not close the overlay we landed on
    }

    if (!_registry.has(id)) return;

    // Retrieve and remove before calling — prevents double-fire if the handler
    // itself triggers another popstate synchronously.
    const handler = _registry.get(id);
    _registry.delete(id);
    handler?.();
  });
}

// ─── Low-level API ────────────────────────────────────────────────────────────

/**
 * Push a synthetic history entry for an overlay so the Android back button
 * closes it instead of navigating backward.
 *
 * @param onClose  Called when the user presses back. Must close the overlay.
 * @returns        The overlay ID to pass to `popOverlayEntry` on close.
 *                 Returns '' if pushState is unavailable.
 */
export function pushOverlayEntry(onClose: () => void): string {
  if (typeof window === 'undefined' || typeof history === 'undefined') return '';
  installPopstateListener();

  const id = nextId();
  const state: Record<string, string> = { [OVERLAY_STATE_KEY]: id };

  try {
    history.pushState(state, '');
    _registry.set(id, onClose);
    return id;
  } catch {
    // SecurityError in sandboxed iframes or some private-browsing modes.
    return '';
  }
}

/**
 * Remove the history entry for an overlay that was closed programmatically
 * (i.e. not via the back button). Navigates backward only if our synthetic
 * entry is currently the active history state, preventing orphaned entries
 * that would otherwise require an extra dead back-press to exit the PWA.
 *
 * Sets _suppressNextOverlayPop before calling history.back() so that the
 * popstate handler does not accidentally close a stacked underlying overlay.
 *
 * @param id  The ID returned by `pushOverlayEntry`.
 */
export function popOverlayEntry(id: string): void {
  if (!id || typeof window === 'undefined' || typeof history === 'undefined') return;

  // Remove from registry first — the popstate handler checks this Map and
  // must not re-fire the handler for an entry we are cleaning up.
  _registry.delete(id);

  try {
    const currentState = history.state;
    if (
      currentState !== null &&
      typeof currentState === 'object' &&
      (currentState as Record<string, unknown>)[OVERLAY_STATE_KEY] === id
    ) {
      // Our entry is currently active — navigate back to remove it from the stack.
      // Set the suppress flag BEFORE history.back() so its popstate is swallowed.
      _suppressNextOverlayPop = true;
      history.back();
    }
    // If the current entry belongs to something else (user navigated forward after
    // opening the overlay), leave the stack alone to avoid unexpected navigation.
  } catch {
    // Restricted origins may block history access; suppress flag safe to leave false.
    _suppressNextOverlayPop = false;
  }
}

// ─── React hook ───────────────────────────────────────────────────────────────

/**
 * React hook that intercepts the Android back button for a single overlay.
 *
 * - When `isOpen` becomes `true`:  pushes a synthetic history entry.
 * - When `isOpen` becomes `false`: calls popOverlayEntry to remove the entry.
 * - When the user presses back while `isOpen`:  calls `onClose`.
 * - On unmount while open: removes the entry (calls popOverlayEntry).
 *
 * Implementation note on effect ordering:
 * React runs the *cleanup* of the previous effect before running the new effect
 * body. When isOpen transitions true → false:
 *   1. cleanup (from isOpen=true effect) runs — entryId.current is still set here
 *   2. effect body (for isOpen=false) runs — entryId.current would already be ''
 * Therefore all work must happen in the cleanup, not the effect body.
 *
 * @param isOpen   Whether the overlay is currently visible.
 * @param onClose  Callback to invoke when back is pressed. Should close the overlay.
 */
export function useAndroidBackInterceptor(
  isOpen: boolean,
  onClose: () => void,
): void {
  const entryId = useRef<string>('');

  // Stable ref so the popstate handler always calls the latest onClose without
  // requiring re-registration on every render.
  const onCloseRef = useRef<() => void>(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    // Nothing to register when the overlay is not open.
    if (!isOpen) return;

    // Overlay just opened — register back-gesture interceptor.
    entryId.current = pushOverlayEntry(() => {
      // Called by the popstate handler (user pressed back).
      // Clear entryId first so the cleanup below doesn't call popOverlayEntry
      // again when the component re-renders with isOpen=false.
      entryId.current = '';
      onCloseRef.current();
    });

    return () => {
      // Runs when isOpen changes to false OR when the component unmounts.
      // React guarantees this runs before the next effect body, so
      // entryId.current is still valid (non-empty) here.
      const id = entryId.current;
      entryId.current = '';
      if (id) {
        // popOverlayEntry deletes from registry and navigates back if needed,
        // setting _suppressNextOverlayPop to prevent spurious underlying-overlay closes.
        popOverlayEntry(id);
      }
    };
    // isOpen is the only real dependency — onClose is accessed via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
}
