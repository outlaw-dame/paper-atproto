import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
function lazyWithRetry(loader, label) {
    return React.lazy(async () => {
        try {
            return await loader();
        }
        catch (error) {
            console.warn(`[Lazy] ${label} failed to load on first attempt; retrying once.`, error);
            await new Promise((resolve) => setTimeout(resolve, 300));
            return loader();
        }
    });
}
class LazyModuleBoundary extends React.Component {
    state = { hasError: false };
    static getDerivedStateFromError() {
        return { hasError: true };
    }
    componentDidCatch(error) {
        console.error('[AppShell] Lazy module failed to render', error);
    }
    componentDidUpdate(prevProps) {
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
class AppRuntimeBoundary extends React.Component {
    state = { hasError: false };
    static getDerivedStateFromError() {
        return { hasError: true };
    }
    componentDidCatch(error) {
        console.error('[App] Runtime render failure', error);
    }
    render() {
        if (this.state.hasError) {
            return (_jsx(ShellModuleRecovery, { title: "Glimpse needs a clean restart", body: "The app hit an unexpected render failure. Reloading restores a clean state without exposing sensitive auth details.", buttonLabel: "Reload app", onReload: () => window.location.reload() }));
        }
        return this.props.children;
    }
}
function ShellModuleRecovery({ onReload, title = 'Glimpse hit a loading problem', body = 'This usually means the next screen could not finish loading. Reload the app to restore your session and continue.', buttonLabel = 'Reload app', }) {
    return (_jsx("div", { style: {
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: 'var(--bg)',
        }, children: _jsxs("div", { style: {
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
            }, children: [_jsx("div", { style: { width: 44, height: 44, borderRadius: 14, background: 'color-mix(in srgb, var(--blue) 16%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: _jsxs("svg", { width: "22", height: "22", viewBox: "0 0 24 24", fill: "none", stroke: "var(--blue)", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M12 9v4" }), _jsx("path", { d: "M12 17h.01" }), _jsx("path", { d: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" })] }) }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [_jsx("h2", { style: { margin: 0, fontFamily: 'var(--font-ui)', fontSize: 'var(--type-ui-title-md-size)', lineHeight: 'var(--type-ui-title-md-line)', letterSpacing: 'var(--type-ui-title-md-track)', color: 'var(--label-1)' }, children: title }), _jsx("p", { style: { margin: 0, fontFamily: 'var(--font-body)', fontSize: 'var(--type-body-md-size)', lineHeight: 'var(--type-body-md-line)', letterSpacing: 'var(--type-body-md-track)', color: 'var(--label-3)' }, children: body })] }), _jsx("button", { onClick: onReload, style: {
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
                    }, children: buttonLabel })] }) }));
}
const ExploreTab = lazyWithRetry(() => import('./tabs/ExploreTab.js'), 'ExploreTab');
const ActivityTab = lazyWithRetry(() => import('./tabs/ActivityTab.js'), 'ActivityTab');
const ProfileTab = lazyWithRetry(() => import('./tabs/ProfileTab.js'), 'ProfileTab');
// ─── Bootstrap error banner ────────────────────────────────────────────────
// Shown when IndexedDB is unavailable (e.g. iOS Private Browsing) or storage
// quota is exceeded. Dismissible — app still functions but won't persist data.
function BootstrapErrorBanner() {
    const [message, setMessage] = React.useState(null);
    React.useEffect(() => {
        const handler = (e) => {
            const detail = e.detail;
            setMessage(detail?.message ?? 'Local storage unavailable');
        };
        window.addEventListener('paper:bootstrap-error', handler);
        return () => window.removeEventListener('paper:bootstrap-error', handler);
    }, []);
    if (!message)
        return null;
    return (_jsxs("div", { role: "alert", style: {
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
        }, children: [_jsxs("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", style: { flexShrink: 0 }, children: [_jsx("path", { d: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" }), _jsx("line", { x1: "12", y1: "9", x2: "12", y2: "13" }), _jsx("line", { x1: "12", y1: "17", x2: "12.01", y2: "17" })] }), _jsxs("span", { style: { flex: 1 }, children: ["Local storage unavailable \u2014 data won't be saved. ", /private browsing/i.test(message) || /mutation/i.test(message) ? 'Try disabling Private Browsing.' : message] }), _jsx("button", { onClick: () => setMessage(null), "aria-label": "Dismiss", style: { background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'inherit', lineHeight: 1 }, children: _jsxs("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", children: [_jsx("line", { x1: "18", y1: "6", x2: "6", y2: "18" }), _jsx("line", { x1: "6", y1: "6", x2: "18", y2: "18" })] }) })] }));
}
// ─── Root wrapper ──────────────────────────────────────────────────────────
export default function App() {
    return (_jsxs(_Fragment, { children: [_jsx(BootstrapErrorBanner, {}), _jsx(PlatformBanners, {}), _jsx(AppRuntimeBoundary, { children: _jsx(AtpProvider, { children: _jsxs(_Fragment, { children: [_jsx(BadgeSyncBridge, {}), _jsx(PushLifecycleBridge, {}), _jsx(AppleEnhancementBridge, {}), _jsxs(MiniPlayerProvider, { children: [_jsx(AppShell, {}), _jsx(Suspense, { fallback: null, children: _jsx(MiniPlayer, {}) })] })] }) }) })] }));
}
// ─── Floating compose button ───────────────────────────────────────────────
// Small, unobtrusive pill button that floats above the tab bar.
// Single tap → new post. Long press (500ms) → Discussion/PromptComposer.
function FloatingComposeFab({ onCompose, onPromptComposer }) {
    const pressTimer = React.useRef(null);
    const didLongPress = React.useRef(false);
    const handlePointerDown = () => {
        didLongPress.current = false;
        pressTimer.current = setTimeout(() => {
            didLongPress.current = true;
            onPromptComposer();
        }, 500);
    };
    const handlePointerUp = () => {
        if (pressTimer.current) {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
        }
    };
    const handleClick = () => {
        if (didLongPress.current)
            return;
        onCompose();
    };
    return (_jsx("button", { onPointerDown: handlePointerDown, onPointerUp: handlePointerUp, onPointerLeave: handlePointerUp, onClick: handleClick, "aria-label": "Compose (hold for Discussion)", style: {
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
        }, children: _jsxs("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "var(--label-1)", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" }), _jsx("path", { d: "M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" })] }) }));
}
// ─── AppShell ──────────────────────────────────────────────────────────────
function AppShell() {
    const { session, isLoading } = useAtp();
    const { activeTab, prevTab, openStory, profileDid, openCompose, openPromptComposer } = useUiStore();
    const [isTabBarHidden, setIsTabBarHidden] = React.useState(false);
    const [shellRetryKey, setShellRetryKey] = React.useState(0);
    const [loadingTimedOut, setLoadingTimedOut] = React.useState(false);
    const scrollIdleTimerRef = React.useRef(null);
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
        if (!session)
            return;
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
    const tabLoadingFallback = (_jsx("div", { style: {
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg)',
        }, children: _jsx("svg", { width: "24", height: "24", viewBox: "0 0 24 24", fill: "none", stroke: "var(--blue)", strokeWidth: 2.5, strokeLinecap: "round", children: _jsx("path", { d: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83", children: _jsx("animateTransform", { attributeName: "transform", type: "rotate", from: "0 12 12", to: "360 12 12", dur: "0.8s", repeatCount: "indefinite" }) }) }) }));
    // Loading splash while restoring persisted session
    if (isLoading && !loadingTimedOut) {
        return (_jsxs("div", { style: {
                position: 'fixed', inset: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg)', gap: 16,
            }, children: [_jsx("div", { style: {
                        width: 64, height: 64, borderRadius: 20,
                        background: 'linear-gradient(135deg, var(--blue) 0%, var(--indigo) 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 8px 32px rgba(0,122,255,0.3)',
                    }, children: _jsxs("svg", { width: "32", height: "32", viewBox: "0 0 24 24", fill: "none", stroke: "white", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" }), _jsx("path", { d: "M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" })] }) }), _jsx("svg", { width: "28", height: "28", viewBox: "0 0 24 24", fill: "none", stroke: "var(--blue)", strokeWidth: 2.5, strokeLinecap: "round", children: _jsx("path", { d: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83", children: _jsx("animateTransform", { attributeName: "transform", type: "rotate", from: "0 12 12", to: "360 12 12", dur: "0.8s", repeatCount: "indefinite" }) }) })] }));
    }
    if (!session)
        return _jsx(LoginScreen, {});
    return (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'var(--bg)', overflow: 'hidden' }, children: [_jsx(LazyModuleBoundary, { resetKey: `watcher:${shellRetryKey}`, children: _jsx(Suspense, { fallback: null, children: _jsx(TimedMuteWatcherBridge, {}) }) }), _jsxs("div", { style: { flex: 1, overflow: 'hidden', position: 'relative' }, children: [_jsx(AnimatePresence, { initial: false, mode: "popLayout", children: _jsx(motion.div, { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }, initial: { opacity: 0, x: activeTab > prevTab ? 20 : -20 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: activeTab > prevTab ? -20 : 20 }, transition: { duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }, children: _jsx(LazyModuleBoundary, { resetKey: `${activeTab}:${shellRetryKey}`, fallback: _jsx(ShellModuleRecovery, { onReload: () => {
                                        setShellRetryKey((value) => value + 1);
                                        window.location.reload();
                                    } }), children: _jsxs(Suspense, { fallback: tabLoadingFallback, children: [activeTab === 'home' && _jsx(HomeTab, { onOpenStory: openStory }), activeTab === 'explore' && _jsx(ExploreTab, { onOpenStory: openStory }), activeTab === 'activity' && _jsx(ActivityTab, {}), activeTab === 'profile' && _jsx(ProfileTab, { onOpenStory: openStory, actorDid: profileDid ?? undefined })] }) }) }, activeTab) }), _jsx(FloatingComposeFab, { onCompose: openCompose, onPromptComposer: openPromptComposer })] }), _jsx(TabBar, { hidden: isTabBarHidden }), _jsx(LazyModuleBoundary, { resetKey: `overlay:${shellRetryKey}`, children: _jsx(Suspense, { fallback: null, children: _jsx(OverlayHost, {}) }) })] }));
}
//# sourceMappingURL=App.js.map
