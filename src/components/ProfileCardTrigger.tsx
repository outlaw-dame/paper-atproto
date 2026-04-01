import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import ProfileCard from './ProfileCard';
import type { ProfileCardData } from '../types/profileCard';
import { useSessionStore } from '../store/sessionStore';
import { atpCall } from '../lib/atproto/client';
import { buildProfileCardDataFromFullProfile } from '../lib/profileCardData';

/**
 * Wraps any element (avatar, handle link) and shows a ProfileCard on:
 *  - Desktop: hover with a short delay
 *  - Mobile:  long-press (500ms) or double-tap
 *
 * Renders the card via a portal so it's never clipped by overflow:hidden parents.
 */

const CARD_WIDTH   = 308;
const HOVER_DELAY  = 320;   // ms before card appears on hover
const LONG_PRESS_MS = 480;  // ms for long-press trigger on touch

interface ProfileCardTriggerProps {
  data: ProfileCardData | null | undefined;
  /** ATProto DID — when provided, the full profile is lazily fetched on hover/press */
  did?: string | undefined;
  /** Called lazily when the card is about to open — lets you fetch full data */
  onWillOpen?: (() => void) | undefined;
  onFollow?: (() => void) | undefined;
  onBlock?: (() => void) | undefined;
  children: React.ReactNode;
  /** Disable the trigger entirely (e.g. if this is the viewer's own profile) */
  disabled?: boolean | undefined;
}

function computeCardPos(
  anchor: HTMLElement,
): { top: number; left: number; flip: boolean } {
  const rect     = anchor.getBoundingClientRect();
  const CARD_H   = 380; // rough estimate
  const GAP      = 10;
  const spaceBelow = window.innerHeight - rect.bottom;
  const flip     = spaceBelow < CARD_H + GAP && rect.top > CARD_H + GAP;

  const rawLeft = rect.left + rect.width / 2 - CARD_WIDTH / 2;
  const left    = Math.max(8, Math.min(rawLeft, window.innerWidth - CARD_WIDTH - 8));
  const top     = flip
    ? rect.top  + window.scrollY - GAP  // card above: translateY(-100%) handles actual offset
    : rect.bottom + window.scrollY + GAP;

  return { top, left, flip };
}

export default function ProfileCardTrigger({
  data,
  did,
  onWillOpen,
  onFollow,
  onBlock,
  children,
  disabled = false,
}: ProfileCardTriggerProps) {
  const agent          = useSessionStore((s) => s.agent);
  const anchorRef      = useRef<HTMLSpanElement>(null);
  const hoverTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart     = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTap        = useRef<number>(0);
  const cardRef        = useRef<HTMLDivElement>(null);
  const fetchedDid     = useRef<string | null>(null);

  const [displayData, setDisplayData] = useState<ProfileCardData | null | undefined>(data);

  // Keep displayData in sync when the incoming data prop changes (e.g. new post loaded)
  useEffect(() => {
    setDisplayData(data);
    fetchedDid.current = null;
  }, [data]);

  const maybeLoadFullProfile = useCallback(() => {
    if (!did || !agent) return;
    if (fetchedDid.current === did) return; // already fetched or in-flight
    if (displayData && !displayData.social.isPartial) return; // already have real data
    fetchedDid.current = did;
    atpCall(() => agent.getProfile({ actor: did }))
      .then((res) => {
        setDisplayData((prev) =>
          buildProfileCardDataFromFullProfile(res.data, prev),
        );
      })
      .catch(() => {
        fetchedDid.current = null; // allow retry on next open
      });
  }, [did, agent, displayData]);

  const [cardPos, setCardPos] = useState<{ top: number; left: number; flip: boolean } | null>(null);

  const open = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || disabled) return;
    onWillOpen?.();
    setCardPos(computeCardPos(anchor));
  }, [disabled, onWillOpen]);

  const close = useCallback(() => {
    setCardPos(null);
  }, []);

  // ── Desktop hover ────────────────────────────────────────────────────────
  const handleMouseEnter = useCallback(() => {
    if (disabled) return;
    onWillOpen?.();
    maybeLoadFullProfile();
    hoverTimer.current = setTimeout(open, HOVER_DELAY);
  }, [disabled, onWillOpen, maybeLoadFullProfile, open]);

  const handleMouseLeave = useCallback((e: React.MouseEvent) => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    // Only close if the mouse isn't moving into the card
    const related = e.relatedTarget as Node | null;
    if (cardRef.current && related && cardRef.current.contains(related)) return;
    setCardPos(null);
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    setCardPos(null);
  }, []);

  // ── Mobile touch ─────────────────────────────────────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled) return;
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    maybeLoadFullProfile();

    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      open();
      // Prevent the click from firing after a long press
      touchStart.current = null;
    }, LONG_PRESS_MS);
  }, [disabled, open, maybeLoadFullProfile]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (!touchStart.current) return;

    const now = Date.now();
    const dt  = now - touchStart.current.t;
    touchStart.current = null;

    // Double-tap to open
    const dtTap = now - lastTap.current;
    if (dtTap < 350 && dt < 300) {
      e.preventDefault();
      open();
    }
    lastTap.current = now;
  }, [open]);

  const handleTouchMove = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!cardPos) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cardPos, close]);

  // Close on outside click
  useEffect(() => {
    if (!cardPos) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (cardRef.current && cardRef.current.contains(target)) return;
      if (anchorRef.current && anchorRef.current.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [cardPos, close]);

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        style={{ display: 'contents' }}
      >
        {children}
      </span>

      {cardPos && displayData && createPortal(
        <div
          ref={cardRef}
          onMouseEnter={() => {
            if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
          }}
          onMouseLeave={handleCardMouseLeave}
          style={{
            position: 'absolute',
            top: cardPos.top,
            left: cardPos.left,
            width: CARD_WIDTH,
            transform: cardPos.flip ? 'translateY(-100%)' : 'none',
            zIndex: 9000,
            pointerEvents: 'auto',
          }}
        >
          <ProfileCard
            data={displayData}
            onFollow={onFollow}
            onBlock={onBlock}
            onClose={close}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
