// ─── App ───────────────────────────────────────────────────────────────────
// Root component. Composes the shell from purpose-built sub-components:
//   AtpProvider  — session bootstrap + login/logout actions
//   TabBar       — bottom nav, reads/writes uiStore
//   OverlayHost  — ComposeSheet + StoryMode, reads/writes uiStore
//   Tab panels   — each tab receives openStory from uiStore

import React, { Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AtpProvider, useAtp } from './atproto/AtpContext.js';
import { scheduleRuntimePrefetches } from './prefetch/runtimePrefetch.js';
import { useUiStore } from './store/uiStore.js';
import TabBar from './shell/TabBar.js';
import LoginScreen from './components/LoginScreen.js';
import { MiniPlayerProvider } from './context/MiniPlayerContext.js';
import MiniPlayer from './components/MiniPlayer.js';
import HomeTab from './tabs/HomeTab.js';
import OverlayHost from './shell/OverlayHost.js';
import TimedMuteWatcherBridge from './components/TimedMuteWatcherBridge.js';
import PlatformBanners from './shell/PlatformBanners.js';
import BadgeSyncBridge from './components/BadgeSyncBridge.js';
import PushLifecycleBridge from './components/PushLifecycleBridge.js';
import AppleEnhancementBridge from './components/AppleEnhancementBridge.js';

function lazyWithRetry<T extends React.ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
  label: string,
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      return await loader();
    } catch (error) {
      console.warn(`[Lazy] ${label} failed to load on first attempt; retrying once.`, error);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return loader();
    }
  });
}

type LazyModuleBoundaryProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  resetKey?: string | number;
};

type LazyModuleBoundaryState = {
  hasError: boolean;
};

type RuntimeBoundaryProps = {
  children: React.ReactNode;
};

type RuntimeBoundaryState = {
  hasError: boolean;
};

class LazyModuleBoundary extends React.Component<LazyModuleBoundaryProps, LazyModuleBoundaryState> {
  state: LazyModuleBoundaryState = { hasError: false };

  static getDerivedStateFromError(): LazyModuleBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[AppShell] Lazy module failed to render', error);
  }

  componentDidUpdate(prevProps: LazyModuleBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

class AppRuntimeBoundary extends React.Component<RuntimeBoundaryProps, RuntimeBoundaryState> {
  state: RuntimeBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RuntimeBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[App] Runtime render failure', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <ShellModuleRecovery
          title="Glimpse needs a clean restart"
          body="The app hit an unexpected render failure. Reloading restores a clean state without exposing sensitive auth details."
          buttonLabel="Reload app"
          onReload={() => window.location.reload()}
        />
      );
    }

    return this.props.children;
  }
}

function ShellModuleRecovery({
  onReload,
  title = 'Glimpse hit a loading problem',
  body = 'This usually means the next screen could not finish loading. Reload the app to restore your session and continue.',
  buttonLabel = 'Reload app',
}: {
  onReload: () => void;
  title?: string;
  body?: string;
  buttonLabel?: string;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          borderRadius: 24,
          border: '1px solid var(--sep)',
          background: 'var(--card)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.18)',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        <div style={{ width: 44, height: 44, borderRadius: 14, background: 'color-mix(in srgb, var(--blue) 16%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 'var(--type-ui-title-md-size)', lineHeight: 'var(--type-ui-title-md-line)', letterSpacing: 'var(--type-ui-title-md-track)', color: 'var(--label-1)' }}>
            {title}
          </h2>
          <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 'var(--type-body-md-size)', lineHeight: 'var(--type-body-md-line)', letterSpacing: 'var(--type-body-md-track)', color: 'var(--label-3)' }}>
            {body}
          </p>
        </div>
        <button
          onClick={onReload}
          style={{
            appearance: 'none',
            border: '1px solid color-mix(in srgb, var(--blue) 24%, var(--sep))',
            background: 'var(--blue)',
            color: '#fff',
            borderRadius: 14,
            minHeight: 44,
            padding: '10px 16px',
            font: 'inherit',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

const ExploreTab = lazyWithRetry(() => import('./tabs/ExploreTab.js'), 'ExploreTab');
const ActivityTab = lazyWithRetry(() => import('./tabs/ActivityTab.js'), 'ActivityTab');
const ProfileTab = lazyWithRetry(() => import('./tabs/ProfileTab.js'), 'ProfileTab');

export type TabId = 'home' | 'explore' | 'compose' | 'activity' | 'profile';
export interface StoryEntry { type: 'post' | 'topic'; id: string; title: string }
export interface EntityEntry { type: 'person' | 'topic' | 'feed'; id: string; name: string; reason: string }

// ─── Bootstrap error banner ────────────────────────────────────────────────
// Shown when IndexedDB is unavailable (e.g. iOS Private Browsing) or storage
// quota is exceeded. Dismissible — app still functions but won't persist data.
function BootstrapErrorBanner() {
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string }>).detail;
      setMessage(detail?.message ?? 'Local storage unavailable');
    };
    window.addEventListener('paper:bootstrap-error', handler);
    return () => window.removeEventListener('paper:bootstrap-error', handler);
  }, []);

  if (!message) return null;

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        background: 'var(--yellow, #ff9f0a)',
        color: '#000',
        fontSize: 13,
        fontWeight: 500,
        lineHeight: 1.4,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span style={{ flex: 1 }}>
        Local storage unavailable — data won't be saved. {/private browsing/i.test(message) || /mutation/i.test(message) ? 'Try disabling Private Browsing.' : message}
      </span>
      <button
        onClick={() => setMessage(null)}
        aria-label="Dismiss"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'inherit', lineHeight: 1 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}

// ─── Root wrapper ──────────────────────────────────────────────────────────
export default function App() {
  return (
    <>
      <BootstrapErrorBanner />
      <PlatformBanners />
      <AppRuntimeBoundary>
        <AtpProvider>
          <BadgeSyncBridge />
          <PushLifecycleBridge />
          <AppleEnhancementBridge />
          <MiniPlayerProvider>
            <AppShell />
            <Suspense fallback={null}>
              <MiniPlayer />
            </Suspense>
          </MiniPlayerProvider>
        </AtpProvider>
      </AppRuntimeBoundary>
    </>
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
  const [isTabBarHidden, setIsTabBarHidden] = React.useState(false);
  const [shellRetryKey, setShellRetryKey] = React.useState(0);
  const [loadingTimedOut, setLoadingTimedOut] = React.useState(false);
  const scrollIdleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (!isLoading) {
      setLoadingTimedOut(false);
      return;
    }

    const timer = setTimeout(() => {
      setLoadingTimedOut(true);
    }, 12_000);

    return () => clearTimeout(timer);
  }, [isLoading]);

  React.useEffect(() => {
    if (!session) return;
    scheduleRuntimePrefetches();
  }, [session]);

  React.useEffect(() => {
    const markScrolling = () => {
      setIsTabBarHidden(true);

      if (scrollIdleTimerRef.current) {
        clearTimeout(scrollIdleTimerRef.current);
      }

      // Show the bar again shortly after scrolling stops.
      scrollIdleTimerRef.current = setTimeout(() => {
        setIsTabBarHidden(false);
        scrollIdleTimerRef.current = null;
      }, 180);
    };

    window.addEventListener('wheel', markScrolling, { passive: true });
    window.addEventListener('touchmove', markScrolling, { passive: true });
    window.addEventListener('scroll', markScrolling, { capture: true, passive: true });

    return () => {
      window.removeEventListener('wheel', markScrolling);
      window.removeEventListener('touchmove', markScrolling);
      window.removeEventListener('scroll', markScrolling, { capture: true });
      if (scrollIdleTimerRef.current) {
        clearTimeout(scrollIdleTimerRef.current);
      }
    };
  }, []);

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
  if (isLoading && !loadingTimedOut) {
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
      <LazyModuleBoundary resetKey={`watcher:${shellRetryKey}`}>
        <Suspense fallback={null}>
          <TimedMuteWatcherBridge />
        </Suspense>
      </LazyModuleBoundary>

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
            <LazyModuleBoundary
              resetKey={`${activeTab}:${shellRetryKey}`}
              fallback={<ShellModuleRecovery onReload={() => {
                setShellRetryKey((value) => value + 1);
                window.location.reload();
              }} />}
            >
              <Suspense fallback={tabLoadingFallback}>
                {activeTab === 'home'    && <HomeTab onOpenStory={openStory} />}
                {activeTab === 'explore' && <ExploreTab onOpenStory={openStory} />}
                {activeTab === 'activity' && <ActivityTab />}
                {activeTab === 'profile' && (
                  <ProfileTab
                    onOpenStory={openStory}
                    {...(profileDid ? { actorDid: profileDid } : {})}
                  />
                )}
              </Suspense>
            </LazyModuleBoundary>
          </motion.div>
        </AnimatePresence>

        {/* Floating compose button — unobtrusive, above tab bar */}
        <FloatingComposeFab onCompose={openCompose} onPromptComposer={openPromptComposer} />
      </div>

      {/* Bottom tab bar */}
      <TabBar hidden={isTabBarHidden} />

      {/* Overlays: ComposeSheet + StoryMode */}
      <LazyModuleBoundary resetKey={`overlay:${shellRetryKey}`}>
        <Suspense fallback={null}>
          <OverlayHost />
        </Suspense>
      </LazyModuleBoundary>
    </div>
  );
}
