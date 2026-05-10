// ─── NativeSheet ──────────────────────────────────────────────────────────────
// Platform-adaptive bottom sheet with detents (snap points).
// Cupertino: spring transition, grabber handle, safe-area padding.
// Material:  same structure, adjusted radius/motion.
// Desktop:   centered modal panel.
//
// Accessibility: focus trap, aria-modal, aria-labelledby.
// Android back: dispatches 'paper:sheet-close' so AndroidEnhancementBridge
// can intercept the back gesture and call onDismiss instead of navigating.

import React, { useEffect, useRef, useId, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion';
import { useDrag } from '@use-gesture/react';
import { usePlatformRuntime, nativeRecipes } from '../../platform/PlatformRuntimeContext';
import { haptic } from '../../android/haptics';

export type SheetDetent = 'medium' | 'large' | 'full';

interface NativeSheetProps {
  open: boolean;
  onDismiss: () => void;
  detents?: SheetDetent[];
  dismissible?: boolean;
  label?: string;
  children: React.ReactNode;
}

const DETENT_MAX_HEIGHT: Record<SheetDetent, string> = {
  medium: '55vh',
  large:  '88vh',
  full:   '100vh',
};

export function NativeSheet({
  open,
  onDismiss,
  detents = ['large'],
  dismissible = true,
  label,
  children,
}: NativeSheetProps) {
  const runtime = usePlatformRuntime();
  const idiom = runtime.visualIdiom;
  const recipe = nativeRecipes[idiom === 'cupertino' ? 'cupertino' : idiom === 'material' ? 'material' : 'desktop'];
  const isDesktop = !runtime.isMobile && idiom === 'desktop';

  const labelId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const maxDetent = detents[detents.length - 1] ?? 'large';
  const maxHeight = DETENT_MAX_HEIGHT[maxDetent];
  const dragY = useMotionValue(0);
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);
  const canSwipeDismiss = dismissible && !isDesktop;

  // Focus trap: move focus into the sheet when it opens.
  useEffect(() => {
    if (!open) return;
    const el = contentRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();
  }, [open]);

  // Notify back-gesture bridge so Android back closes this sheet.
  useEffect(() => {
    if (open) {
      window.dispatchEvent(new CustomEvent('paper:sheet-open', { detail: { onDismiss } }));
    } else {
      window.dispatchEvent(new Event('paper:sheet-close'));
    }
  }, [open, onDismiss]);

  // Keyboard: Escape dismisses.
  useEffect(() => {
    if (!open || !dismissible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, dismissible, onDismiss]);

  useEffect(() => {
    if (!open) {
      dragY.set(0);
      setIsDraggingSheet(false);
    }
  }, [dragY, open]);

  const bindDismissDrag = useDrag(({ active, movement: [, my], velocity: [, vy], direction: [, dy] }) => {
    if (!canSwipeDismiss) return;

    if (my < 0) {
      dragY.set(0);
      if (!active) {
        setIsDraggingSheet(false);
      }
      return;
    }

    if (active) {
      if (!isDraggingSheet) {
        setIsDraggingSheet(true);
      }
      dragY.set(my);
      return;
    }

    const shouldDismiss = my > 100 || (vy > 0.5 && dy > 0);
    if (shouldDismiss) {
      dragY.set(0);
      setIsDraggingSheet(false);
      haptic('light');
      onDismiss();
      return;
    }

    animate(dragY, 0, {
      type: 'spring',
      stiffness: 420,
      damping: 38,
      mass: 0.85,
      onComplete: () => setIsDraggingSheet(false),
    });
  }, {
    axis: 'y',
    filterTaps: true,
    rubberband: true,
  });

  const motionProps = isDesktop
    ? {
        initial:    { opacity: 0, scale: 0.97 },
        animate:    { opacity: 1, scale: 1 },
        exit:       { opacity: 0, scale: 0.97 },
        transition: { duration: 0.18, ease: recipe.motion.push } as const,
      }
    : {
        initial:    { y: '100%' },
        animate:    { y: 0 },
        exit:       { y: '100%' },
        transition: { type: 'spring' as const, stiffness: 400, damping: 42, mass: 0.85 },
      };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Scrim */}
          <motion.div
            key="sheet-scrim"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={dismissible ? onDismiss : undefined}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 400,
              background: 'rgba(0,0,0,0.42)',
              cursor: dismissible ? 'default' : 'default',
            }}
          />

          {/* Sheet panel */}
          <motion.div
            key="sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            aria-labelledby={label ? undefined : labelId}
            ref={contentRef}
            {...motionProps}
            style={
              isDesktop
                ? {
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 401,
                    width: 'min(540px, 96vw)',
                    maxHeight: maxHeight,
                    borderRadius: recipe.radius.sheet,
                    background: 'var(--surface)',
                    border: recipe.chrome.border,
                    boxShadow: '0 24px 80px rgba(0,0,0,0.22)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }
                : {
                    position: 'fixed',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    zIndex: 401,
                    maxHeight: maxHeight,
                    borderTopLeftRadius: recipe.radius.sheet,
                    borderTopRightRadius: recipe.radius.sheet,
                    background: recipe.chrome.background,
                    backdropFilter: idiom === 'cupertino' ? recipe.chrome.blur : undefined,
                    WebkitBackdropFilter: idiom === 'cupertino' ? recipe.chrome.blur : undefined,
                    borderTop: recipe.chrome.border,
                    paddingBottom: 'var(--safe-bottom, 0px)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    ...(isDraggingSheet ? { y: dragY } : {}),
                  }
            }
          >
            {/* Grabber — Cupertino/Material only, not desktop */}
            {!isDesktop && (
              <div
                aria-hidden="true"
                {...(canSwipeDismiss ? (bindDismissDrag() as any) : {})}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  justifyContent: 'center',
                  paddingTop: 10,
                  paddingBottom: 4,
                  touchAction: 'none',
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 5,
                    borderRadius: 3,
                    background: 'var(--fill-2)',
                  }}
                />
              </div>
            )}

            {/* Content */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                minHeight: 0,
                WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
                overscrollBehaviorY: 'contain',
              }}
            >
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
