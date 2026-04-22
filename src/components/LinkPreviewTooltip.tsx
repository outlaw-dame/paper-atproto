import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { fetchOGData, type OGMetadata } from '../og';
import { checkUrlSafety, type UrlSafetyVerdict } from '../lib/safety/urlSafety';
import { getSafeExternalHostname, openExternalUrl, sanitizeExternalUrl } from '../lib/safety/externalUrl';

/**
 * Wraps an inline link and shows a rich OG preview card on hover.
 * Uses a Portal so the card is never clipped by overflow:hidden parents.
 * No-op on touch devices (no hover events).
 */

// Inject keyframes once
let keyframesInjected = false;
function ensureKeyframes() {
  if (keyframesInjected) return;
  keyframesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes linkPreviewIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

const CARD_WIDTH = 280;
const HOVER_DELAY_MS = 450;

interface Props {
  url: string;
  children: React.ReactNode;
  linkStyle?: React.CSSProperties;
}

export default function LinkPreviewTooltip({ url, children, linkStyle }: Props) {
  const safeUrl = sanitizeExternalUrl(url);
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetched = useRef(false);
  const [meta, setMeta] = useState<OGMetadata | null>(null);
  const [safety, setSafety] = useState<UrlSafetyVerdict | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number; flip: boolean } | null>(null);

  const isUnsafe = safety?.status === 'unsafe';
  const hasPreview = !!(meta?.title || meta?.description);
  const hasCard = hasPreview || isUnsafe;

  const prefetch = useCallback(() => {
    if (!safeUrl) return;
    if (prefetched.current) return;
    prefetched.current = true;
    void checkUrlSafety(safeUrl)
      .then((verdict) => {
        setSafety(verdict);
        if (verdict.status === 'unsafe') return null;
        return fetchOGData(safeUrl);
      })
      .then((m) => {
        if (m) setMeta(m);
      })
      .catch(() => {});
  }, [safeUrl]);

  const showCard = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const CARD_APPROX_H = 180; // estimate before render
    const GAP = 8;

    // Decide whether to show above or below
    const spaceAbove = rect.top;
    const flip = spaceAbove < CARD_APPROX_H + GAP;

    // Center card on anchor, clamped to viewport edges
    const rawLeft = rect.left + rect.width / 2 - CARD_WIDTH / 2;
    const left = Math.max(8, Math.min(rawLeft, window.innerWidth - CARD_WIDTH - 8));
    const top = flip
      ? rect.bottom + window.scrollY + GAP
      : rect.top + window.scrollY - GAP;

    ensureKeyframes();
    setCardPos({ top, left, flip });
  }, []);

  const handleMouseEnter = useCallback(() => {
    prefetch();
    hoverTimer.current = setTimeout(showCard, HOVER_DELAY_MS);
  }, [prefetch, showCard]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setCardPos(null);
  }, []);

  // Keep card open when mouse moves from link onto card
  const handleCardMouseLeave = useCallback(() => {
    setCardPos(null);
  }, []);

  const hostname = getSafeExternalHostname(safeUrl ?? '') ?? safeUrl ?? url;

  const handleLinkClick = useCallback(async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!safeUrl) {
      setSafety({
        url,
        checked: false,
        status: 'unsafe',
        safe: false,
        blocked: true,
        reason: 'This link uses an unsupported or invalid URL scheme.',
        threats: [],
      });
      showCard();
      return;
    }

    const verdict = safety ?? await checkUrlSafety(safeUrl);
    setSafety(verdict);

    if (verdict.status !== 'safe') {
      showCard();
      return;
    }

    openExternalUrl(safeUrl);
  }, [safeUrl, safety, showCard, url]);

  return (
    <>
      <a
        ref={anchorRef}
        href={safeUrl ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleLinkClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={linkStyle}
      >
        {children}
      </a>

      {cardPos && hasCard && createPortal(
        <div
          onMouseEnter={() => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; } }}
          onMouseLeave={handleCardMouseLeave}
          style={{
            position: 'absolute',
            top: cardPos.top,
            left: cardPos.left,
            width: CARD_WIDTH,
            // Anchor card bottom edge to the gap above link (or top edge below)
            transform: cardPos.flip ? 'none' : 'translateY(-100%)',
            zIndex: 9999,
            borderRadius: 12,
            overflow: 'hidden',
            background: 'var(--chrome-bg)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            border: '0.5px solid var(--sep)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.1)',
            animation: 'linkPreviewIn 0.18s ease-out',
            pointerEvents: 'auto',
          }}
        >
          {/* OG image */}
          {meta?.image && !isUnsafe && (
            <div style={{ width: '100%', aspectRatio: '1.91 / 1', overflow: 'hidden', background: 'var(--fill-2)' }}>
              <img
                src={meta.image}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', display: 'block' }}
                referrerPolicy="no-referrer"
                decoding="async"
              />
            </div>
          )}

          <div style={{ padding: '9px 12px 11px' }}>
            {isUnsafe ? (
              <>
                <div style={{
                  fontSize: 11,
                  color: 'var(--red)',
                  marginBottom: 3,
                  letterSpacing: 0.1,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}>
                  Unsafe Link Warning
                </div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--label-1)',
                  lineHeight: 1.35,
                  marginBottom: 4,
                }}>
                  This URL was flagged by Google Safe Browsing.
                </div>
                <div style={{
                  fontSize: 12,
                  color: 'var(--label-2)',
                  lineHeight: 1.4,
                }}>
                  {safety?.threats.length
                    ? `Threats: ${Array.from(new Set(safety.threats.map((t) => t.threatType))).join(', ')}`
                    : (safety?.reason ?? 'Open only if you trust the source.')}
                </div>
              </>
            ) : (
              <>
                {/* Site name / hostname */}
                <div style={{
                  fontSize: 11,
                  color: 'var(--label-3)',
                  marginBottom: 3,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  letterSpacing: 0.1,
                }}>
                  {meta?.siteName ?? hostname}
                </div>

                {/* Title */}
                {meta?.title && (
                  <div style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--label-1)',
                    lineHeight: 1.35,
                    marginBottom: meta.description ? 4 : 0,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {meta.title}
                  </div>
                )}

                {/* Description */}
                {meta?.description && (
                  <div style={{
                    fontSize: 12,
                    color: 'var(--label-2)',
                    lineHeight: 1.4,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {meta.description}
                  </div>
                )}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
