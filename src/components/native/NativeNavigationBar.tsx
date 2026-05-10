// ─── NativeNavigationBar ─────────────────────────────────────────────────────
// Scroll-aware top navigation bar.
// Cupertino: large-title collapses to compact title on scroll.
// Material:  top app bar with consistent height.
// Desktop:   compact bar with hover states.
//
// Usage:
//   <NativeNavigationBar
//     title="Home"
//     largeTitleEnabled
//     scrollRef={feedScrollRef}
//     leading={<NativeIconButton>...</NativeIconButton>}
//     trailing={<NativeIconButton>...</NativeIconButton>}
//   />

import React, { useEffect, useRef, useState } from 'react';
import { usePlatformRuntime } from '../../platform/PlatformRuntimeContext';

interface NativeNavigationBarProps {
  title: string;
  largeTitleEnabled?: boolean;
  scrollRef?: React.RefObject<HTMLElement | null>;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  transparent?: boolean;
}

const COMPACT_THRESHOLD_PX = 60;
const COMPACT_HEIGHT = 52;
const LARGE_HEIGHT = 96;

export function NativeNavigationBar({
  title,
  largeTitleEnabled = false,
  scrollRef,
  leading,
  trailing,
  transparent = false,
}: NativeNavigationBarProps) {
  const runtime = usePlatformRuntime();
  const isCupertino = runtime.visualIdiom === 'cupertino';
  const showLarge = isCupertino && largeTitleEnabled;

  const [collapsed, setCollapsed] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!showLarge || !scrollRef?.current) return;
    const el = scrollRef.current;

    const handleScroll = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setCollapsed(el.scrollTop > COMPACT_THRESHOLD_PX);
      });
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [showLarge, scrollRef]);

  const barHeight = showLarge && !collapsed ? LARGE_HEIGHT : COMPACT_HEIGHT;

  const containerStyle: React.CSSProperties = {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    width: '100%',
    height: barHeight,
    paddingTop: 'var(--safe-top, 0px)',
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: 0,
    background: transparent ? 'transparent' : (collapsed ? 'var(--chrome-bg)' : 'var(--bg)'),
    backdropFilter: collapsed && isCupertino ? 'blur(24px) saturate(1.8)' : undefined,
    WebkitBackdropFilter: collapsed && isCupertino ? 'blur(24px) saturate(1.8)' : undefined,
    borderBottom: collapsed
      ? '0.33px solid var(--sep-chrome)'
      : transparent ? 'none' : '0.33px solid transparent',
    transition: 'height 0.22s cubic-bezier(0.25,0.1,0.25,1), background 0.18s, border-color 0.18s',
    position: 'relative',
    zIndex: 10,
    userSelect: 'none',
    WebkitUserSelect: 'none',
  };

  const compactRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    height: COMPACT_HEIGHT,
    gap: 4,
  };

  return (
    <header style={containerStyle} role="banner">
      {/* Compact title row — always rendered; large title fades in below when expanded */}
      <div style={compactRow}>
        {leading && (
          <div style={{ flexShrink: 0 }}>{leading}</div>
        )}

        <h1
          style={{
            flex: 1,
            margin: 0,
            fontSize: showLarge && !collapsed ? 0 : 17,
            fontFamily: 'var(--font-ui)',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: 'var(--label-1)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'center',
            opacity: showLarge && !collapsed ? 0 : 1,
            transition: 'opacity 0.18s, font-size 0.22s',
          }}
        >
          {title}
        </h1>

        {trailing && (
          <div style={{ flexShrink: 0 }}>{trailing}</div>
        )}
      </div>

      {/* Large title — only in Cupertino + large mode when not collapsed */}
      {showLarge && !collapsed && (
        <div
          style={{
            paddingBottom: 10,
            paddingLeft: 4,
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 34,
              fontFamily: 'var(--font-ui)',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              color: 'var(--label-1)',
            }}
          >
            {title}
          </h1>
        </div>
      )}
    </header>
  );
}
