// ─── TabBar ────────────────────────────────────────────────────────────────
// Persistent bottom navigation bar. Reads active tab from uiStore and writes
// back via setTab / openCompose. Renders the compose FAB in the centre slot.

import React from 'react';
import { useUiStore } from '../store/uiStore';
import type { TabId } from '../App';

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
  { id: 'compose', label: '', icon: () => null },
  {
    id: 'inbox', label: 'Inbox',
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

const tabBarStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex', flexDirection: 'row', alignItems: 'stretch',
  background: 'var(--chrome-bg)',
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
  borderTop: '0.5px solid var(--sep)',
  paddingBottom: 'var(--safe-bottom)',
};

const tabBtnStyle: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  paddingTop: 10, paddingBottom: 6,
  gap: 3, minHeight: 50, cursor: 'pointer',
  border: 'none', background: 'none',
  WebkitTapHighlightColor: 'transparent',
};

const fabStyle: React.CSSProperties = {
  width: 52, height: 52, borderRadius: '50%',
  background: 'var(--blue)', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 4px 16px rgba(0,122,255,0.4)',
  marginTop: -8,
};

export default function TabBar() {
  const { activeTab, unreadCount, setTab, openCompose, openPromptComposer } = useUiStore();
  const pressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFabPointerDown = () => {
    pressTimer.current = setTimeout(() => { openPromptComposer(); }, 500);
  };
  const handleFabPointerUp = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };
  const handleFabClick = () => {
    // Only fires if not a long-press (timer already cleared)
    if (!pressTimer.current) return;
    clearTimeout(pressTimer.current);
    pressTimer.current = null;
    openCompose();
  };

  return (
    <nav style={tabBarStyle} role="tablist" aria-label="Main navigation">
      {TABS.map(({ id, label, icon }) => {
        const active = id === activeTab;
        if (id === 'compose') {
          return (
            <button
              key="compose"
              style={tabBtnStyle}
              onPointerDown={handleFabPointerDown}
              onPointerUp={handleFabPointerUp}
              onPointerLeave={handleFabPointerUp}
              onClick={handleFabClick}
              aria-label="Compose (hold for Discussion)"
            >
              <div style={fabStyle}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </div>
            </button>
          );
        }
        return (
          <button
            key={id}
            style={tabBtnStyle}
            onClick={() => setTab(id)}
            role="tab"
            aria-selected={active}
            aria-label={label}
          >
            <div style={{ position: 'relative' }}>
              {icon(active)}
              {/* Unread badge on Inbox */}
              {id === 'inbox' && unreadCount > 0 && (
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
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', fontWeight: 600, letterSpacing: 'var(--type-meta-sm-track)', color: active ? 'var(--blue)' : 'var(--label-2)' }}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
