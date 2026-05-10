// ─── useTheme ───────────────────────────────────────────────────────────────────
// Unified appearance state: light/dark/dim modes with system preference fallback.
// This is the single source of truth for theme selection across the app.
//
// Storage: localStorage via Zustand persistence
// Reactivity: updates CSS variables, document.documentElement attributes on every change
// Self-healing: gracefully falls back to system preference if storage is unavailable

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useEffect, useMemo } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark' | 'dim';
export type ResolvedTheme = 'light' | 'dark';

// ─── Zustand store ────────────────────────────────────────────────────────────

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  resolveSystemPreference: () => void;
}

/**
 * Resolve system preference to light/dark.
 * Gracefully handles missing matchMedia (SSR, test environments).
 */
function getSystemPreference(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  try {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    return query?.matches ? 'dark' : 'light';
  } catch {
    // matchMedia not available or threw error; assume light
    return 'light';
  }
}

/**
 * Compute resolved theme from mode and system preference.
 */
function computeResolved(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return getSystemPreference();
  if (mode === 'dim') return 'dark';
  return mode;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'system' as ThemeMode,
      resolved: 'light' as ResolvedTheme,

      setMode: (mode: ThemeMode) => {
        set((state) => ({
          ...state,
          mode,
          resolved: computeResolved(mode),
        }));
      },

      resolveSystemPreference: () => {
        const { mode } = get();
        if (mode === 'system') {
          set((state) => ({
            ...state,
            resolved: computeResolved(mode),
          }));
        }
      },
    }),
    {
      name: 'paper.theme.v1',
      storage: createJSONStorage(() => localStorage, {
        reviver: (key: string, value: unknown) => {
          if (key === 'mode' && typeof value === 'string') {
            const isValid = ['system', 'light', 'dark', 'dim'].includes(value);
            return isValid ? value : 'system';
          }
          return value;
        },
      }),
      partialize: (state) => ({
        mode: state.mode,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[Theme] Rehydration error:', error);
        }
      },
      migrate: (state: unknown, version: number): ThemeState => {
        // Migration path for future versions
        if (version === 0) {
          return {
            mode: 'system',
            resolved: getSystemPreference(),
            setMode: () => {},
            resolveSystemPreference: () => {},
          };
        }
        return state as ThemeState;
      },
      version: 0,
    },
  ),
);

// ─── DOM synchronization ──────────────────────────────────────────────────────
// After theme state changes, update CSS variables and attributes.

/**
 * Sync theme to DOM: update CSS variables and document attributes.
 * Safe to call repeatedly and from SSR contexts.
 */
export function syncThemeToDOM(resolved: ResolvedTheme, mode: ThemeMode): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  // Update data-theme for CSS selectors
  root.setAttribute('data-theme', resolved);

  // Update color-scheme for native controls
  root.style.colorScheme = resolved;

  // Update CSS variable for JS-based theming
  root.style.setProperty('--resolved-theme', resolved);

  // Data attribute for mode (including 'dim')
  root.setAttribute('data-theme-mode', mode);

  // Class for Tailwind dark: support
  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/**
 * Listen for system theme changes and update if in 'system' mode.
 */
function useSystemThemeListener() {
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      useThemeStore.getState().resolveSystemPreference();
    };

    // Modern API
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }

    // Legacy API fallback
    mediaQuery.addListener(handler);
    return () => mediaQuery.removeListener(handler);
  }, []);
}

// ─── React hook ───────────────────────────────────────────────────────────────

export interface UseThemeReturn {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  setDark: () => void;
  setLight: () => void;
  setDim: () => void;
  setSystem: () => void;
}

/**
 * Hook: get and set theme mode.
 * Automatically syncs to DOM and listens for system preference changes.
 */
export function useTheme(): UseThemeReturn {
  const { mode, resolved, setMode } = useThemeStore();

  // Sync to DOM whenever theme changes
  useEffect(() => {
    syncThemeToDOM(resolved, mode);
  }, [resolved, mode]);

  // Listen for system theme changes
  useSystemThemeListener();

  // Convenience setters
  const isDark = resolved === 'dark';

  return useMemo(
    () => ({
      mode,
      resolved,
      isDark,
      setMode,
      setDark: () => setMode('dark'),
      setLight: () => setMode('light'),
      setDim: () => setMode('dim'),
      setSystem: () => setMode('system'),
    }),
    [mode, resolved, isDark, setMode],
  );
}

// ─── Boot synchronization ──────────────────────────────────────────────────────
// Call this once at app boot to ensure DOM is in sync with stored preference.

export function initializeThemeSync(): void {
  if (typeof document === 'undefined') return;

  const state = useThemeStore.getState();
  syncThemeToDOM(state.resolved, state.mode);
}
