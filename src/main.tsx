import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { scheduleRuntimePrefetches } from './prefetch/runtimePrefetch.js';
import './styles/globals.css';

// ─── TanStack Query client ─────────────────────────────────────────────────
// Global defaults: retry only once (individual queries can override),
// stale data is shown while revalidating, errors don't crash the tree.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      staleTime: 1000 * 60,     // 1 minute default
    },
    mutations: {
      retry: 0,
    },
  },
});

// ─── Dark mode ────────────────────────────────────────────────────────────
const applyDark = (dark: boolean) => document.documentElement.classList.toggle('dark', dark);
applyDark(window.matchMedia('(prefers-color-scheme: dark)').matches);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => applyDark(e.matches));

// Render immediately, then initialize DB/bootstrap in the background.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);

scheduleRuntimePrefetches();

void import('./bootstrap.js')
  .then(({ initApp }) => initApp())
  .catch((error) => {
    console.error('[Bootstrap] Failed to initialize background services', error);
  });
