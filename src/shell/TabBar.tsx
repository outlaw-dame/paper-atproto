// ─── TabBar ────────────────────────────────────────────────────────────────
// Persistent bottom navigation bar. Reads active tab from uiStore and writes
// back via setTab / openCompose. Renders the compose FAB in the centre slot.

import React from 'react';
import { useUiStore } from '../store/uiStore';
import type { TabId } from '../App';
import { usePlatform, getIconBtnTokens } from '../hooks/usePlatform';

const TABS: { id: TabId; label: string; icon: (active: boolean) => React.ReactNode }[] = [
  {
    id: 'home', label: 'Home',
    icon: (a) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill={a ? 'var(--blue)' : 'none'} stroke={a ? 'var(--blue)' : 'var(--label-2)'} strokeWidth={a ? 2.5 : 1.75} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/>
        <path d="M9 21V12h6v9"/>
      </svg>
    ),
  },
  {
    id: 'explore', label: 'Explore',
    icon: (a) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={a ? 'var(--blue)' : 'var(--label-2)'} strokeWidth={a ? 2.5 : 1.75} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    ),
  },
  {
    id: 'activity', label: 'Activity',
    icon: (a) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={a ? 'var(--blue)' : 'var(--label-2)'} strokeWidth={a ? 2.5 : 1.75} strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 01-3.46 0"/>
      </svg>
    ),
  },
  {
    id: 'profile', label: 'Profile',
    icon: (a) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill={a ? 'var(--blue)' : 'none'} stroke={a ? 'var(--blue)' : 'var(--label-2)'} strokeWidth={a ? 2.2 : 1.75} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  },
];

// Tab bar chrome style — stable object (no platform dependence) memoized at module level.
const tabBarBaseStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex', flexDirection: 'row', alignItems: 'stretch',
  background: 'var(--chrome-bg)',
  // Apple HIG: blur(24px) + saturate(1.8) — the saturate is the vibrancy layer
  backdropFilter: 'blur(24px) saturate(1.8)',
  WebkitBackdropFilter: 'blur(24px) saturate(1.8)',
  // Hairline separator at 0.33px (= 1px at 3× Retina) per Apple HIG
  borderTop: '0.33px solid var(--sep-chrome)',
  boxShadow: 'var(--chrome-shadow)',
  paddingBottom: 'var(--safe-bottom)',
  // Landscape safe areas: iPhone notch appears on left/right in landscape
  paddingLeft: 'var(--safe-left, 0px)',
  paddingRight: 'var(--safe-right, 0px)',
  // Prevent text selection on the entire nav chrome
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

interface TabBarProps {
  hidden?: boolean;
}

export default function TabBar({ hidden = false }: TabBarProps) {
  const { activeTab, unreadCount, setTab } = useUiStore();
  const platform = usePlatform();
  const iconTokens = getIconBtnTokens(platform);

  const tabBtnStyle = React.useMemo<React.CSSProperties>(() => ({
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    paddingTop: platform.prefersCoarsePointer ? 11 : 9,
    paddingBottom: platform.prefersCoarsePointer ? 9 : 7,
    gap: 3,
    minHeight: platform.prefersCoarsePointer ? 62 : 54,
    cursor: 'pointer',
    border: 'none', background: 'none',
    WebkitTapHighlightColor: 'transparent',
    // Prevent text selection on tab labels
    userSelect: 'none',
    WebkitUserSelect: 'none',
  }), [platform.prefersCoarsePointer]);

  return (
    <nav
      style={{
        ...tabBarBaseStyle,
        maxHeight: hidden ? 0 : 120,
        opacity: hidden ? 0 : 1,
        transform: hidden ? 'translateY(12px)' : 'translateY(0)',
        pointerEvents: hidden ? 'none' : 'auto',
        overflow: 'hidden',
        transition: 'max-height 0.22s ease, opacity 0.18s ease, transform 0.18s ease',
        willChange: hidden ? 'transform, opacity' : 'auto',
      }}
      role="tablist"
      aria-label="Main navigation"
      aria-hidden={hidden}
    >
      {TABS.map(({ id, label, icon }) => {
        const active = id === activeTab;
        return (
          <button
            key={id}
            style={tabBtnStyle}
            onClick={() => setTab(id)}
            role="tab"
            aria-selected={active}
            aria-label={label}
          >
            {/* Active indicator — tinted capsule behind icon+label (iOS 16+ pattern) */}
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              {/* Capsule background */}
              {active && (
                <div style={{
                  position: 'absolute',
                  inset: '-5px -12px',
                  background: 'color-mix(in srgb, var(--blue) 14%, transparent)',
                  border: '0.33px solid color-mix(in srgb, var(--blue) 18%, transparent)',
                  borderRadius: 18,
                  pointerEvents: 'none',
                }} />
              )}
              <div style={{ position: 'relative' }}>
                <div
                  style={{
                    width: iconTokens.size,
                    height: iconTokens.size,
                    borderRadius: iconTokens.borderRadius,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {icon(active)}
                </div>
                {/* Unread badge on Activity */}
                {id === 'activity' && unreadCount > 0 && (
                  <span style={{
                    position: 'absolute', top: -3, right: -6,
                    minWidth: 16, height: 16, borderRadius: 8,
                    background: 'var(--red)', color: '#fff',
                    fontFamily: 'var(--font-ui)', fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', fontWeight: 700, letterSpacing: 'var(--type-meta-sm-track)', fontVariantNumeric: 'tabular-nums',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 4px',
                  }}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
              <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11, lineHeight: '14px', fontWeight: active ? 650 : 500, letterSpacing: 0, color: active ? 'var(--blue)' : 'var(--label-2)', userSelect: 'none', WebkitUserSelect: 'none', position: 'relative' }}>
                {label}
              </span>
            </div>
          </button>
        );
      })}
    </nav>
  );
}
