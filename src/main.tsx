import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles/globals.css';

const PRELOAD_RETRY_KEY = 'paper:preload-retry';
const PRELOAD_RETRY_WINDOW_MS = 30_000;
const PRELOAD_ERROR_LISTENER_KEY = '__paperPreloadErrorListener__';

function readPreloadRetryState(): { count: number; firstAt: number } {
  try {
    const raw = window.sessionStorage.getItem(PRELOAD_RETRY_KEY);
    if (!raw) return { count: 0, firstAt: Date.now() };
    const parsed = JSON.parse(raw) as { count?: unknown; firstAt?: unknown };
    const count = typeof parsed.count === 'number' && Number.isFinite(parsed.count) ? parsed.count : 0;
    const firstAt = typeof parsed.firstAt === 'number' && Number.isFinite(parsed.firstAt)
      ? parsed.firstAt
      : Date.now();
    return { count: Math.max(0, Math.floor(count)), firstAt };
  } catch {
    return { count: 0, firstAt: Date.now() };
  }
}

function writePreloadRetryState(state: { count: number; firstAt: number }): void {
  try {
    window.sessionStorage.setItem(PRELOAD_RETRY_KEY, JSON.stringify(state));
  } catch {
    // Best-effort only; Safari private mode can throw here.
  }
}

if (import.meta.env.PROD) {
  const globalScope = globalThis as Record<string, unknown>;
  const previousListener = globalScope[PRELOAD_ERROR_LISTENER_KEY];
  if (typeof previousListener === 'function') {
    window.removeEventListener('vite:preloadError', previousListener as EventListener);
  }

  // Recover from stale dynamic-import chunks after a new deployment without
  // entering an infinite reload loop when WebKit serves persistently stale chunks.
  const onPreloadError = (event: Event) => {
    event.preventDefault();

    const now = Date.now();
    const current = readPreloadRetryState();
    const withinWindow = now - current.firstAt <= PRELOAD_RETRY_WINDOW_MS;
    const retryState = withinWindow
      ? { count: current.count + 1, firstAt: current.firstAt }
      : { count: 1, firstAt: now };

    writePreloadRetryState(retryState);

    if (retryState.count <= 1) {
      window.location.reload();
      return;
    }

    console.error('[Bootstrap] Repeated preload failure; blocking auto-reload loop.', event);
    window.dispatchEvent(
      new CustomEvent('paper:bootstrap-error', {
        detail: {
          message: 'App update failed to load cleanly. Close and reopen Safari, then retry.',
        },
      }),
    );
  };

  window.addEventListener('vite:preloadError', onPreloadError as EventListener);
  globalScope[PRELOAD_ERROR_LISTENER_KEY] = onPreloadError;
}

// ─── TanStack Query client ─────────────────────────────────────────────────
// Global defaults: retry only once (individual queries can override),
// stale data is shown while revalidating, errors don't crash the tree.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 1000 * 60,     // 1 minute default
    },
    mutations: {
      retry: 0,
    },
  },
});

// ─── Dark mode ────────────────────────────────────────────────────────────
const applyDark = (dark: boolean) => document.documentElement.classList.toggle('dark', dark);
const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
applyDark(darkModeQuery.matches);
const DARK_MODE_LISTENER_KEY = '__paperDarkModeChangeListener__';

const handleDarkModeChange = (event: MediaQueryListEvent | MediaQueryList) => {
  applyDark(event.matches);
};

const globalScope = globalThis as Record<string, unknown>;
const previousDarkModeListener = globalScope[DARK_MODE_LISTENER_KEY];
if (typeof previousDarkModeListener === 'function') {
  if (typeof darkModeQuery.removeEventListener === 'function') {
    darkModeQuery.removeEventListener('change', previousDarkModeListener as EventListener);
  } else if (typeof darkModeQuery.removeListener === 'function') {
    darkModeQuery.removeListener(previousDarkModeListener as (event: MediaQueryListEvent) => void);
  }
}

if (typeof darkModeQuery.addEventListener === 'function') {
  darkModeQuery.addEventListener('change', handleDarkModeChange);
} else if (typeof darkModeQuery.addListener === 'function') {
  darkModeQuery.addListener(handleDarkModeChange);
}
globalScope[DARK_MODE_LISTENER_KEY] = handleDarkModeChange;

// Render immediately, then initialize DB/bootstrap in the background.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);

void import('./bootstrap')
  .then(({ initApp }) => initApp())
  .catch((error) => {
    console.error('[Bootstrap] Failed to initialize background services', error);
    // Notify the UI so the user isn't left with a silently broken experience.
    // Common on iOS Safari Private Browsing (IndexedDB disabled) and when
    // storage quota is exceeded.
    window.dispatchEvent(
      new CustomEvent('paper:bootstrap-error', {
        detail: { message: error?.message ?? 'Storage unavailable' },
      }),
    );
  });
