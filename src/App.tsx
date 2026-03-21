import React, { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Home, Compass, PlusCircle, Bell, BookMarked, Search, SlidersHorizontal, ChevronDown } from 'lucide-react';
import HomeTab from './tabs/HomeTab';
import ExploreTab from './tabs/ExploreTab';
import InboxTab from './tabs/InboxTab';
import LibraryTab from './tabs/LibraryTab';
import ComposeSheet from './components/ComposeSheet';
import StoryMode from './components/StoryMode';
import EntitySheet from './components/EntitySheet';

export type TabId = 'home' | 'explore' | 'inbox' | 'library';

export interface StoryEntry {
  type: 'post' | 'topic' | 'feed' | 'person' | 'domain';
  id: string;
  title?: string;
  data?: Record<string, unknown>;
}

export interface EntityEntry {
  type: 'person' | 'topic' | 'feed' | 'pack' | 'domain';
  id: string;
  name: string;
  reason?: string;
}

const TABS: { id: TabId; label: string; Icon: React.FC<{ size?: number; strokeWidth?: number }> }[] = [
  { id: 'home',    label: 'Home',    Icon: Home },
  { id: 'explore', label: 'Explore', Icon: Compass },
  { id: 'inbox',   label: 'Inbox',   Icon: Bell },
  { id: 'library', label: 'Library', Icon: BookMarked },
];

const FEED_NAMES: Record<TabId, string> = {
  home:    'Following',
  explore: 'Explore',
  inbox:   'Inbox',
  library: 'Library',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [composeOpen, setComposeOpen] = useState(false);
  const [story, setStory] = useState<StoryEntry | null>(null);
  const [entity, setEntity] = useState<EntityEntry | null>(null);
  const [feedName, setFeedName] = useState('Following');

  const openStory = useCallback((entry: StoryEntry) => setStory(entry), []);
  const closeStory = useCallback(() => setStory(null), []);
  const openEntity = useCallback((entry: EntityEntry) => setEntity(entry), []);
  const closeEntity = useCallback(() => setEntity(null), []);

  const handleTabChange = (id: TabId) => {
    if (id === activeTab) return;
    setActiveTab(id);
    setFeedName(FEED_NAMES[id]);
  };

  return (
    <div className="relative flex flex-col h-full overflow-hidden" style={{ background: 'var(--surface-secondary)' }}>
      {/* Top Navigation Bar */}
      <header
        className="chrome-blur fixed top-0 left-0 right-0 z-30 flex items-center justify-between border-b"
        style={{
          height: 'calc(var(--nav-bar-height) + var(--safe-top))',
          paddingTop: 'var(--safe-top)',
          paddingLeft: 'max(16px, var(--safe-left))',
          paddingRight: 'max(16px, var(--safe-right))',
          borderColor: 'var(--separator)',
        }}
      >
        <button className="touch-target rounded-full" aria-label="Profile" style={{ width: 32, height: 32 }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold" style={{ background: 'var(--glimpse-indigo)' }}>
            G
          </div>
        </button>

        <button className="flex items-center gap-1 touch-target" aria-label="Change feed" style={{ color: 'var(--label-primary)' }}>
          <span style={{ fontSize: '17px', fontWeight: 600, letterSpacing: '-0.4px' }}>{feedName}</span>
          {activeTab === 'home' && <ChevronDown size={14} strokeWidth={2.5} style={{ color: 'var(--label-secondary)' }} />}
        </button>

        <div className="flex items-center">
          {activeTab === 'explore'
            ? <button className="touch-target" aria-label="Filter" style={{ color: 'var(--glimpse-blue)' }}><SlidersHorizontal size={20} strokeWidth={2} /></button>
            : <button className="touch-target" aria-label="Search" style={{ color: 'var(--glimpse-blue)' }}><Search size={20} strokeWidth={2} /></button>
          }
        </div>
      </header>

      {/* Main Content */}
      <main
        className="flex-1 overflow-hidden"
        style={{
          paddingTop: 'calc(var(--nav-bar-height) + var(--safe-top))',
          paddingBottom: 'calc(var(--tab-bar-height) + var(--safe-bottom))',
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {activeTab === 'home' && (
            <motion.div key="home" className="h-full overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <HomeTab onOpenStory={openStory} onOpenEntity={openEntity} />
            </motion.div>
          )}
          {activeTab === 'explore' && (
            <motion.div key="explore" className="h-full overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <ExploreTab onOpenStory={openStory} onOpenEntity={openEntity} />
            </motion.div>
          )}
          {activeTab === 'inbox' && (
            <motion.div key="inbox" className="h-full overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <InboxTab />
            </motion.div>
          )}
          {activeTab === 'library' && (
            <motion.div key="library" className="h-full overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <LibraryTab onOpenStory={openStory} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Tab Bar */}
      <nav
        className="chrome-blur fixed bottom-0 left-0 right-0 z-30 flex items-start justify-around border-t"
        style={{
          height: 'calc(var(--tab-bar-height) + var(--safe-bottom))',
          paddingBottom: 'var(--safe-bottom)',
          paddingLeft: 'var(--safe-left)',
          paddingRight: 'var(--safe-right)',
          borderColor: 'var(--separator)',
        }}
        aria-label="Main navigation"
      >
        {TABS.map(({ id, label, Icon }, i) => {
          const isActive = activeTab === id;
          const items: React.ReactNode[] = [];

          if (i === 2) {
            items.push(
              <button key="compose" className="flex flex-col items-center justify-start pt-2" aria-label="Compose" onClick={() => setComposeOpen(true)} style={{ flex: 1 }}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--glimpse-blue)' }}>
                  <PlusCircle size={22} strokeWidth={2} color="white" />
                </div>
              </button>
            );
          }

          items.push(
            <button
              key={id}
              className="flex flex-col items-center justify-start gap-0.5 pt-2"
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => handleTabChange(id)}
              style={{ flex: 1, color: isActive ? 'var(--glimpse-blue)' : 'var(--label-tertiary)', minHeight: 44 }}
            >
              <Icon size={24} strokeWidth={isActive ? 2 : 1.75} />
              <span style={{ fontSize: '10px', fontWeight: 500, letterSpacing: '0.1px' }}>{label}</span>
            </button>
          );

          return items;
        })}
      </nav>

      {/* Overlays */}
      <AnimatePresence>
        {composeOpen && <ComposeSheet key="compose" onClose={() => setComposeOpen(false)} />}
        {story && <StoryMode key="story" entry={story} onClose={closeStory} onOpenEntity={openEntity} />}
        {entity && <EntitySheet key="entity" entry={entity} onClose={closeEntity} onOpenStory={openStory} />}
      </AnimatePresence>
    </div>
  );
}
