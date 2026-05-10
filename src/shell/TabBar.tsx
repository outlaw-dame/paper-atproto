// ─── TabBar ────────────────────────────────────────────────────────────────────
// Persistent bottom navigation bar. Reads active tab from uiStore and writes
// back via setTab. Renders platform-appropriate active indicator:
//
//   Cupertino — tinted capsule behind icon+label (iOS 16+ pattern)
//   Material  — pill active indicator above icon (M3 Navigation Bar)
//   Desktop   — simple tint highlight

import React from 'react';
import { useUiStore } from '../store/uiStore';
import type { TabId } from '../App';
import { usePlatformRuntime } from '../platform/PlatformRuntimeContext';

const TABS: { id: TabId; label: string; icon: (active: boolean, idiom: string) => React.ReactNode }[] = [
  {
    id: 'home', label: 'Home',
    icon: (a, idiom) => {
      const col = a ? 'var(--blue)' : 'var(--label-2)';
      const sw = idiom === 'cupertino' ? (a ? 2.5 : 1.75) : 2;
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill={a && idiom === 'cupertino' ? 'var(--blue)' : 'none'} stroke={col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/>
          <path d="M9 21V12h6v9"/>
        </svg>
      );
    },
  },
  {
    id: 'explore', label: 'Explore',
    icon: (a, idiom) => {
      const col = a ? 'var(--blue)' : 'var(--label-2)';
      const sw = idiom === 'cupertino' ? (a ? 2.5 : 1.75) : 2;
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      );
    },
  },
  {
    id: 'activity', label: 'Activity',
    icon: (a, idiom) => {
      const col = a ? 'var(--blue)' : 'var(--label-2)';
      const sw = idiom === 'cupertino' ? (a ? 2.5 : 1.75) : 2;
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
      );
    },
  },
  {
    id: 'profile', label: 'Profile',
    icon: (a, idiom) => {
      const col = a ? 'var(--blue)' : 'var(--label-2)';
      const sw = idiom === 'cupertino' ? (a ? 2.2 : 1.75) : 2;
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill={a && idiom === 'cupertino' ? 'var(--blue)' : 'none'} stroke={col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      );
    },
  },
];

const tabBarBaseStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'stretch',
  background: 'var(--chrome-bg)',
  backdropFilter: 'blur(24px) saturate(1.8)',
  WebkitBackdropFilter: 'blur(24px) saturate(1.8)',
  borderTop: '0.33px solid var(--sep-chrome)',
  boxShadow: 'var(--chrome-shadow)',
  paddingBottom: 'var(--safe-bottom)',
  paddingLeft: 'var(--safe-left, 0px)',
  paddingRight: 'var(--safe-right, 0px)',
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

interface TabBarProps {
  hidden?: boolean;
}

export default function TabBar({ hidden = false }: TabBarProps) {
  const { activeTab, unreadCount, setTab } = useUiStore();
  const runtime = usePlatformRuntime();
  const idiom = runtime.visualIdiom;
  const touchTarget = runtime.input.coarse || runtime.isMobile;

  // M3 Navigation Bar needs extra height for the active pill indicator.
  const barMinH = idiom === 'material' ? 80 : (touchTarget ? 62 : 54);

  const tabBtnStyle = React.useMemo<React.CSSProperties>(() => ({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: idiom === 'material' ? 12 : (touchTarget ? 11 : 9),
    paddingBottom: idiom === 'material' ? 16 : (touchTarget ? 9 : 7),
    gap: idiom === 'material' ? 4 : 3,
    minHeight: barMinH,
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  }), [idiom, touchTarget, barMinH]);

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
            <div
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: idiom === 'material' ? 4 : 3,
              }}
            >
              {/* ── Cupertino: tinted capsule behind icon+label ── */}
              {idiom !== 'material' && active && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: '-5px -12px',
                    background: 'color-mix(in srgb, var(--blue) 14%, transparent)',
                    border: '0.33px solid color-mix(in srgb, var(--blue) 18%, transparent)',
                    borderRadius: 18,
                    pointerEvents: 'none',
                  }}
                />
              )}

              {/* ── Material 3: pill indicator above icon ── */}
              {idiom === 'material' && (
                <div
                  aria-hidden="true"
                  style={{
                    width: 64,
                    height: 32,
                    borderRadius: 16,
                    background: active
                      ? 'color-mix(in srgb, var(--blue) 16%, transparent)'
                      : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background 0.2s cubic-bezier(0.2,0,0,1)',
                    marginBottom: 2,
                    position: 'relative',
                  }}
                >
                  <div style={{ position: 'relative' }}>
                    {icon(active, idiom)}
                    {id === 'activity' && unreadCount > 0 && (
                      <BadgeDot count={unreadCount} />
                    )}
                  </div>
                </div>
              )}

              {/* ── Cupertino / Desktop icon row ── */}
              {idiom !== 'material' && (
                <div style={{ position: 'relative' }}>
                  <div
                    style={{
                      width: touchTarget ? 44 : 34,
                      height: touchTarget ? 44 : 34,
                      borderRadius: touchTarget ? 22 : 17,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {icon(active, idiom)}
                  </div>
                  {id === 'activity' && unreadCount > 0 && (
                    <BadgeDot count={unreadCount} />
                  )}
                </div>
              )}

              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: idiom === 'material' ? 12 : 11,
                  lineHeight: idiom === 'material' ? '16px' : '14px',
                  fontWeight: active ? (idiom === 'material' ? 700 : 650) : 500,
                  letterSpacing: idiom === 'material' ? '0.005em' : 0,
                  color: active ? 'var(--blue)' : 'var(--label-2)',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  position: 'relative',
                }}
              >
                {label}
              </span>
            </div>
          </button>
        );
      })}
    </nav>
  );
}

function BadgeDot({ count }: { count: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: -3,
        right: -6,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        background: 'var(--red)',
        color: '#fff',
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--type-meta-sm-size)',
        lineHeight: 'var(--type-meta-sm-line)',
        fontWeight: 700,
        letterSpacing: 'var(--type-meta-sm-track)',
        fontVariantNumeric: 'tabular-nums',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 4px',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
