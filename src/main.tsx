import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { initApp } from './bootstrap';
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

// Initialize the app (DB, etc.) before rendering
initApp().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>
  );
});
