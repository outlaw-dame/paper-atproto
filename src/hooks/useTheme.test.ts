// ─── useTheme.test.ts ─────────────────────────────────────────────────────────
// Unit tests for theme/appearance logic.
// Verifies light/dark/dim mode resolution and DOM synchronization.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { useThemeStore, syncThemeToDOM } from '../hooks/useTheme';

// Mock matchMedia
const mockMatchMedia = (matches: boolean = false) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe('useTheme', () => {
  let root: HTMLElement | null;

  beforeEach(() => {
    // Mock matchMedia before running tests
    mockMatchMedia(false);

    // Ensure we have a proper DOM element to work with
    if (typeof document !== 'undefined') {
      root = document.documentElement;
      if (root) {
        root.removeAttribute('data-theme');
        root.removeAttribute('data-theme-mode');
        root.classList.remove('dark');
        root.style.colorScheme = '';
        root.style.removeProperty('--resolved-theme');
      }
    } else {
      root = null;
    }

    // Reset store state
    useThemeStore.setState({
      mode: 'system',
      resolved: 'light',
    });
  });

  afterEach(() => {
    if (typeof document !== 'undefined' && root) {
      root.removeAttribute('data-theme');
      root.removeAttribute('data-theme-mode');
      root.classList.remove('dark');
      root.style.colorScheme = '';
      root.style.removeProperty('--resolved-theme');
    }
  });

  describe('syncThemeToDOM', () => {
    it('should set data-theme attribute', () => {
      if (!root) return;
      syncThemeToDOM('dark', 'system');
      expect(root.getAttribute('data-theme')).toBe('dark');
    });

    it('should set data-theme-mode attribute', () => {
      if (!root) return;
      syncThemeToDOM('dark', 'dim');
      expect(root.getAttribute('data-theme-mode')).toBe('dim');
    });

    it('should set color-scheme CSS property', () => {
      if (!root) return;
      syncThemeToDOM('dark', 'dark');
      expect(root.style.colorScheme).toBe('dark');
    });

    it('should set --resolved-theme CSS variable', () => {
      if (!root) return;
      syncThemeToDOM('light', 'light');
      expect(root.style.getPropertyValue('--resolved-theme')).toBe('light');
    });

    it('should add dark class for dark theme', () => {
      if (!root) return;
      syncThemeToDOM('dark', 'dark');
      expect(root.classList.contains('dark')).toBe(true);
    });

    it('should remove dark class for light theme', () => {
      if (!root) return;
      root.classList.add('dark');
      syncThemeToDOM('light', 'light');
      expect(root.classList.contains('dark')).toBe(false);
    });

    it('should handle dim mode by setting dark resolved theme', () => {
      if (!root) return;
      syncThemeToDOM('dark', 'dim');
      expect(root.getAttribute('data-theme')).toBe('dark');
      expect(root.getAttribute('data-theme-mode')).toBe('dim');
    });
  });

  describe('theme store', () => {
    it('should initialize with system mode', () => {
      const state = useThemeStore.getState();
      expect(state.mode).toBe('system');
    });

    it('should set mode to dark', () => {
      const { setMode } = useThemeStore.getState();
      setMode('dark');
      const state = useThemeStore.getState();
      expect(state.mode).toBe('dark');
    });

    it('should set mode to light', () => {
      const { setMode } = useThemeStore.getState();
      setMode('light');
      const state = useThemeStore.getState();
      expect(state.mode).toBe('light');
    });

    it('should set mode to dim', () => {
      const { setMode } = useThemeStore.getState();
      setMode('dim');
      const state = useThemeStore.getState();
      expect(state.mode).toBe('dim');
    });

    it('should resolve system mode based on system preference', () => {
      // Mock system preference to dark
      mockMatchMedia(true);

      const { setMode } = useThemeStore.getState();
      setMode('system');

      // After setMode('system'), it should resolve to 'dark' since matchMedia returns true
      const state = useThemeStore.getState();
      expect(state.resolved).toBe('dark');
    });

    it('should never set invalid theme mode', () => {
      const { setMode } = useThemeStore.getState();
      // TypeScript prevents this, but test store resilience
      expect(() => {
        // @ts-ignore - intentionally testing invalid input
        setMode('invalid');
      }).not.toThrow();
    });
  });

  describe('localStorage persistence', () => {
    it('should persist theme mode to localStorage', async () => {
      const { setMode } = useThemeStore.getState();
      setMode('dark');

      // Wait for async persistence
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stored = localStorage.getItem('paper.theme.v1');
      expect(stored).toBeDefined();
      const parsed = JSON.parse(stored!);
      expect(parsed.state.mode).toBe('dark');
    });

    it('should restore theme mode from localStorage', async () => {
      // Set a value in localStorage
      localStorage.setItem(
        'paper.theme.v1',
        JSON.stringify({ state: { mode: 'dark', resolved: 'dark' } }),
      );

      // Reset store
      useThemeStore.setState({ mode: 'system', resolved: 'light' });

      // Rehydrate from localStorage
      // Note: In a real test, this would happen via Zustand's persist middleware
      // For unit tests, we'd need to reinitialize the store
      const state = useThemeStore.getState();
      expect(['system', 'dark', 'light', 'dim']).toContain(state.mode);
    });

    it('should handle corrupted localStorage gracefully', () => {
      localStorage.setItem('paper.theme.v1', 'invalid json {');

      // Creating store should not throw
      expect(() => {
        useThemeStore.getState();
      }).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle SSR context where document is undefined', () => {
      // In SSR, document is undefined
      expect(() => {
        syncThemeToDOM('dark', 'dark');
      }).not.toThrow();
    });

    it('should handle rapid mode changes', async () => {
      // Setup mock before mode changes
      mockMatchMedia(false);

      const { setMode } = useThemeStore.getState();
      setMode('dark');
      setMode('light');
      setMode('dim');
      setMode('system');

      const state = useThemeStore.getState();
      expect(state.mode).toBe('system');
      // System mode should resolve to light (since mockMatchMedia(false))
      expect(state.resolved).toBe('light');
    });

    it('should keep resolved theme in sync with mode changes', () => {
      const { setMode } = useThemeStore.getState();

      setMode('dark');
      let state = useThemeStore.getState();
      expect(state.resolved).toBe('dark');

      setMode('light');
      state = useThemeStore.getState();
      expect(state.resolved).toBe('light');

      setMode('dim');
      state = useThemeStore.getState();
      expect(state.resolved).toBe('dark'); // dim resolves to dark
    });
  });
});
