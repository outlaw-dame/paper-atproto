// ─── App ───────────────────────────────────────────────────────────────────
// Root component. Composes the shell from purpose-built sub-components:
//   AtpProvider  — session bootstrap + login/logout actions
//   TabBar       — bottom nav, reads/writes uiStore
//   OverlayHost  — ComposeSheet + StoryMode, reads/writes uiStore
//   Tab panels   — each tab receives openStory from uiStore

import React, { Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AtpProvider, useAtp } from './atproto/AtpContext.js';
import { useUiStore } from './store/uiStore.js';
import TabBar from './shell/TabBar.js';
import LoginScreen from './components/LoginScreen.js';
import { MiniPlayerProvider } from './context/MiniPlayerContext.js';

const MiniPlayer = React.lazy(() => import('./components/MiniPlayer.js'));

const HomeTab = React.lazy(() => import('./tabs/HomeTab.js'));
const ExploreTab = React.lazy(() => import('./tabs/ExploreTab.js'));
const InboxTab = React.lazy(() => import('./tabs/InboxTab.js'));
const ProfileTab = React.lazy(() => import('./tabs/ProfileTab.js'));
const OverlayHost = React.lazy(() => import('./shell/OverlayHost.js'));
const TimedMuteWatcherBridge = React.lazy(() => import('./components/TimedMuteWatcherBridge.js'));

export type TabId = 'home' | 'explore' | 'compose' | 'inbox' | 'profile';
export interface StoryEntry { type: 'post' | 'topic'; id: string; title: string }
export interface EntityEntry { type: 'person' | 'topic' | 'feed'; id: string; name: string; reason: string }

// ─── Root wrapper ──────────────────────────────────────────────────────────
export default function App() {
  return (
    <AtpProvider>
      <MiniPlayerProvider>
        <AppShell />
        <Suspense fallback={null}>
          <MiniPlayer />
        </Suspense>
      </MiniPlayerProvider>
    </AtpProvider>
  );
}

// ─── Floating compose button ───────────────────────────────────────────────
// Small, unobtrusive pill button that floats above the tab bar.
// Single tap → new post. Long press (500ms) → Discussion/PromptComposer.
function FloatingComposeFab({ onCompose, onPromptComposer }: { onCompose: () => void; onPromptComposer: () => void }) {
  const pressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = React.useRef(false);

  const handlePointerDown = () => {
    didLongPress.current = false;
    pressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      onPromptComposer();
    }, 500);
  };
  const handlePointerUp = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };
  const handleClick = () => {
    if (didLongPress.current) return;
    onCompose();
  };

  return (
    <button
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onClick={handleClick}
      aria-label="Compose (hold for Discussion)"
      style={{
        position: 'absolute',
        bottom: 20,
        right: 16,
        zIndex: 50,
        // Pill shape with frosted surface — low visual weight
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 44, height: 44,
        borderRadius: '50%',
        background: 'var(--chrome-bg)',
        backdropFilter: 'blur(20px) saturate(160%)',
        WebkitBackdropFilter: 'blur(20px) saturate(160%)',
        border: '0.5px solid var(--sep)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.14), 0 1px 3px rgba(0,0,0,0.10)',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        transition: 'opacity 0.15s',
      }}
    >
      {/* Pencil / compose icon */}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--label-1)" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    </button>
  );
}

// ─── AppShell ──────────────────────────────────────────────────────────────
function AppShell() {
  const { session, isLoading } = useAtp();
  const { activeTab, prevTab, openStory, profileDid, openCompose, openPromptComposer } = useUiStore();

  const tabLoadingFallback = (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2.5} strokeLinecap="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
        </path>
      </svg>
    </div>
  );

  // Loading splash while restoring persisted session
  if (isLoading) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)', gap: 16,
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 20,
          background: 'linear-gradient(135deg, var(--blue) 0%, var(--indigo) 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 32px rgba(0,122,255,0.3)',
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
          </svg>
        </div>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2.5} strokeLinecap="round">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
          </path>
        </svg>
      </div>
    );
  }

  if (!session) return <LoginScreen />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* Lazily mount ATProto timed mute watcher only after authenticated app shell is visible */}
      <Suspense fallback={null}>
        <TimedMuteWatcherBridge />
      </Suspense>

      {/* Main content area */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={activeTab}
            style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}
            initial={{ opacity: 0, x: activeTab > prevTab ? 20 : -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: activeTab > prevTab ? -20 : 20 }}
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <Suspense fallback={tabLoadingFallback}>
              {activeTab === 'home'    && <HomeTab onOpenStory={openStory} />}
              {activeTab === 'explore' && <ExploreTab onOpenStory={openStory} />}
              {activeTab === 'inbox'   && <InboxTab />}
              {activeTab === 'profile' && <ProfileTab onOpenStory={openStory} actorDid={profileDid ?? undefined} />}
            </Suspense>
          </motion.div>
        </AnimatePresence>

        {/* Floating compose button — unobtrusive, above tab bar */}
        <FloatingComposeFab onCompose={openCompose} onPromptComposer={openPromptComposer} />
      </div>

      {/* Bottom tab bar */}
      <TabBar />

      {/* Overlays: ComposeSheet + StoryMode */}
      <Suspense fallback={null}>
        <OverlayHost />
      </Suspense>
    </div>
  );
}
