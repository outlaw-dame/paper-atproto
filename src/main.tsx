import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles/globals.css';

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

const handleDarkModeChange = (event: MediaQueryListEvent | MediaQueryList) => {
  applyDark(event.matches);
};

if (typeof darkModeQuery.addEventListener === 'function') {
  darkModeQuery.addEventListener('change', handleDarkModeChange);
} else if (typeof darkModeQuery.addListener === 'function') {
  darkModeQuery.addListener(handleDarkModeChange);
}

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
