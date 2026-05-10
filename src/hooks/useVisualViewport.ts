// ─── useVisualViewport ───────────────────────────────────────────────────────
// Tracks the VisualViewport API to detect software keyboard appearance on mobile.
// Returns the keyboard height (0 when keyboard is hidden) and a CSS offset value
// to use for positioning sheets/composers above the keyboard.
//
// Composing patterns:
//   const { keyboardHeight, viewportHeight } = useVisualViewport();
//   style={{ paddingBottom: keyboardHeight }}
//
// Why VisualViewport and not window.innerHeight?
// On iOS Safari, window.innerHeight is fixed; only VisualViewport.height shrinks
// when the keyboard appears. On Android Chrome both change, but VisualViewport is
// more reliable and fires before layout reflow.
//
// Self-healing: if VisualViewport is unavailable (older WebViews, SSR), the hook
// returns zeros and is a no-op — all callsites degrade gracefully.

import { useState, useEffect } from 'react';

interface VisualViewportState {
  /** Current visual viewport height in CSS pixels. */
  viewportHeight: number;
  /** Estimated keyboard height. 0 when keyboard is hidden or unavailable. */
  keyboardHeight: number;
  /** True when the software keyboard is likely open. */
  keyboardOpen: boolean;
}

function readViewport(): VisualViewportState {
  if (typeof window === 'undefined' || !window.visualViewport) {
    return { viewportHeight: 0, keyboardHeight: 0, keyboardOpen: false };
  }
  const vv = window.visualViewport;
  const windowH = window.innerHeight;
  const viewportH = vv.height;
  // Keyboard height is the difference between full window height and the
  // visible region. A small threshold avoids false positives from browser UI.
  const kh = Math.max(0, windowH - viewportH - 20);
  return {
    viewportHeight: viewportH,
    keyboardHeight: kh,
    keyboardOpen: kh > 40,
  };
}

export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(readViewport);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const vv = window.visualViewport;
    let rafHandle: number | null = null;

    const schedule = () => {
      if (rafHandle !== null) return;
      rafHandle = requestAnimationFrame(() => {
        rafHandle = null;
        setState(readViewport());
      });
    };

    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);

    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    };
  }, []);

  return state;
}
