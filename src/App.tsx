import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import HomeTab from './tabs/HomeTab';
import ExploreTab from './tabs/ExploreTab';
import InboxTab from './tabs/InboxTab';
import LibraryTab from './tabs/LibraryTab';
import ComposeSheet from './components/ComposeSheet';
import StoryMode from './components/StoryMode';
import { MOCK_NOTIFICATIONS } from './data/mockData';

export type TabId = 'home' | 'explore' | 'compose' | 'inbox' | 'library';
export interface StoryEntry { type: 'post' | 'topic'; id: string; title: string }
export interface EntityEntry { type: 'person' | 'topic' | 'feed'; id: string; name: string; reason: string }

const S = {
  root: {
    display: 'flex', flexDirection: 'column' as const,
    width: '100%', height: '100%', background: 'var(--bg)',
    overflow: 'hidden',
  },
  main: {
    flex: 1, overflow: 'hidden', position: 'relative' as const,
  },
  tabContent: {
    position: 'absolute' as const, inset: 0,
    display: 'flex', flexDirection: 'column' as const,
  },
  tabBar: {
    flexShrink: 0,
    display: 'flex', flexDirection: 'row' as const,
    alignItems: 'stretch',
    background: 'var(--chrome-bg)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    borderTop: '0.5px solid var(--sep)',
    paddingBottom: 'var(--safe-bottom)',
  },
  tabBtn: {
    flex: 1, display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', justifyContent: 'center',
    paddingTop: 10, paddingBottom: 6,
    gap: 3, minHeight: 50, cursor: 'pointer',
    border: 'none', background: 'none',
    WebkitTapHighlightColor: 'transparent',
  },
  tabLabel: {
    fontSize: 10, fontWeight: 500, letterSpacing: 0.1,
  },
  composeFab: {
    width: 52, height: 52, borderRadius: '50%',
    background: 'var(--blue)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 4px 16px rgba(0,122,255,0.4)',
    marginTop: -8,
  },
};

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
    id: 'compose', label: '',
    icon: () => null,
  },
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
    id: 'library', label: 'Library',
    icon: (a) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={a ? 'var(--blue)' : 'var(--label-2)'} strokeWidth={a ? 2.5 : 1.75} strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
      </svg>
    ),
  },
];

export default function App() {
  const [tab, setTab] = useState<TabId>('home');
  const [prevTab, setPrevTab] = useState<TabId>('home');
  const [showCompose, setShowCompose] = useState(false);
  const [story, setStory] = useState<StoryEntry | null>(null);

  const unread = MOCK_NOTIFICATIONS.filter(n => !n.read).length;

  const handleTabPress = (id: TabId) => {
    if (id === 'compose') { setShowCompose(true); return; }
    setPrevTab(tab);
    setTab(id);
  };

  const activeTab = tab;

  return (
    <div style={S.root}>
      {/* Main content area */}
      <div style={S.main}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={activeTab}
            style={S.tabContent}
            initial={{ opacity: 0, x: activeTab > prevTab ? 20 : -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: activeTab > prevTab ? -20 : 20 }}
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
          >
            {activeTab === 'home'    && <HomeTab onOpenStory={setStory} />}
            {activeTab === 'explore' && <ExploreTab onOpenStory={setStory} />}
            {activeTab === 'inbox'   && <InboxTab />}
            {activeTab === 'library' && <LibraryTab onOpenStory={setStory} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Tab bar */}
      <nav style={S.tabBar} role="tablist" aria-label="Main navigation">
        {TABS.map(({ id, label, icon }) => {
          const active = id === activeTab;
          if (id === 'compose') {
            return (
              <button
                key="compose"
                style={S.tabBtn}
                onClick={() => handleTabPress('compose')}
                aria-label="Compose"
              >
                <div style={S.composeFab}>
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
              style={S.tabBtn}
              onClick={() => handleTabPress(id)}
              role="tab"
              aria-selected={active}
              aria-label={label}
            >
              <div style={{ position: 'relative' }}>
                {icon(active)}
                {id === 'inbox' && unread > 0 && (
                  <div style={{
                    position: 'absolute', top: -2, right: -2,
                    width: 8, height: 8, borderRadius: '50%',
                    background: 'var(--red)',
                    border: '1.5px solid var(--chrome-bg)',
                  }} />
                )}
              </div>
              <span style={{ ...S.tabLabel, color: active ? 'var(--blue)' : 'var(--label-2)' }}>
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Compose sheet */}
      <AnimatePresence>
        {showCompose && <ComposeSheet onClose={() => setShowCompose(false)} />}
      </AnimatePresence>

      {/* Story mode */}
      <AnimatePresence>
        {story && <StoryMode entry={story} onClose={() => setStory(null)} />}
      </AnimatePresence>
    </div>
  );
}
