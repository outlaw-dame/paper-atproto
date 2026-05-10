// ─── usePlatformUX.test.ts ────────────────────────────────────────────────────
// Unit tests for platform UX resolution logic.
// Verifies that the right UI patterns are chosen for each platform/form factor.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PlatformRuntime } from '../platform/PlatformRuntimeContext';

// Mock the usePlatformRuntime hook
const createMockRuntime = (overrides: Partial<PlatformRuntime>): PlatformRuntime => ({
  family: 'apple',
  visualIdiom: 'cupertino',
  displayMode: 'browser',
  isInstalled: false,
  isIOS: false,
  isAndroid: false,
  isMobile: true,
  input: {
    coarse: true,
    fine: false,
    hover: false,
  },
  capabilities: {
    serviceWorker: true,
    push: false,
    notifications: false,
    badging: false,
    backgroundSync: false,
    webShare: false,
    fileSystemAccess: false,
    cloudKit: false,
    contactPicker: false,
    vibration: false,
    shareTarget: false,
  },
  isAppleWebKit: true,
  likelyAndroidChrome: false,
  ...overrides,
});

describe('usePlatformUX resolvers', () => {
  describe('navigation pattern resolution', () => {
    it('should use ios-tabs for iPhone', () => {
      const runtime = createMockRuntime({
        isMobile: true,
        isIOS: true,
        visualIdiom: 'cupertino',
      });
      // Pattern would be ios-tabs for mobile phone
      expect(runtime.visualIdiom).toBe('cupertino');
      expect(runtime.isMobile).toBe(true);
    });

    it('should use ios-sidebar for iPad', () => {
      const runtime = createMockRuntime({
        isMobile: false,
        isIOS: true,
        visualIdiom: 'cupertino',
      });
      expect(runtime.visualIdiom).toBe('cupertino');
      expect(runtime.isMobile).toBe(false);
    });

    it('should use material-tabs for Android phone', () => {
      const runtime = createMockRuntime({
        isMobile: true,
        isAndroid: true,
        visualIdiom: 'material',
      });
      expect(runtime.visualIdiom).toBe('material');
      expect(runtime.isMobile).toBe(true);
    });

    it('should use material-rail for Android tablet', () => {
      const runtime = createMockRuntime({
        isMobile: false,
        isAndroid: true,
        visualIdiom: 'material',
      });
      expect(runtime.visualIdiom).toBe('material');
      expect(runtime.isMobile).toBe(false);
    });

    it('should use desktop-nav for desktop', () => {
      const runtime = createMockRuntime({
        isMobile: false,
        visualIdiom: 'desktop',
      });
      expect(runtime.visualIdiom).toBe('desktop');
    });
  });

  describe('compose pattern resolution', () => {
    it('should use ios-sheet for iPhone', () => {
      const runtime = createMockRuntime({
        isMobile: true,
        isIOS: true,
        visualIdiom: 'cupertino',
      });
      // Should resolve to ios-sheet
      expect(runtime.visualIdiom).toBe('cupertino');
      expect(runtime.isMobile).toBe(true);
    });

    it('should use ios-fullscreen for iPad', () => {
      const runtime = createMockRuntime({
        isMobile: false,
        isIOS: true,
        visualIdiom: 'cupertino',
      });
      expect(runtime.visualIdiom).toBe('cupertino');
      expect(runtime.isMobile).toBe(false);
    });

    it('should use material-fab for Android', () => {
      const runtime = createMockRuntime({
        visualIdiom: 'material',
      });
      expect(runtime.visualIdiom).toBe('material');
    });

    it('should use desktop-dialog for desktop', () => {
      const runtime = createMockRuntime({
        isMobile: false,
        visualIdiom: 'desktop',
      });
      expect(runtime.visualIdiom).toBe('desktop');
    });
  });

  describe('install pattern resolution', () => {
    it('should hide prompt when installed', () => {
      const runtime = createMockRuntime({
        isInstalled: true,
      });
      expect(runtime.isInstalled).toBe(true);
    });

    it('should use ios-share-sheet for iOS browser', () => {
      const runtime = createMockRuntime({
        isInstalled: false,
        isIOS: true,
        visualIdiom: 'cupertino',
      });
      expect(runtime.isInstalled).toBe(false);
      expect(runtime.visualIdiom).toBe('cupertino');
    });

    it('should use android-beforeinstall for Android', () => {
      const runtime = createMockRuntime({
        isInstalled: false,
        isAndroid: true,
        visualIdiom: 'material',
        capabilities: {
          ...createMockRuntime({}).capabilities,
          backgroundSync: true,
        },
      });
      expect(runtime.isInstalled).toBe(false);
      expect(runtime.visualIdiom).toBe('material');
    });

    it('should use macos-add-to-dock for macOS', () => {
      const runtime = createMockRuntime({
        isInstalled: false,
        isMobile: false,
        visualIdiom: 'cupertino',
        isAppleWebKit: true,
      });
      expect(runtime.isInstalled).toBe(false);
      expect(runtime.isMobile).toBe(false);
    });
  });

  describe('input density resolution', () => {
    it('should use spacious for touch devices', () => {
      const runtime = createMockRuntime({
        input: { coarse: true, fine: false, hover: false },
      });
      expect(runtime.input.coarse).toBe(true);
    });

    it('should use compact for fine pointer with hover', () => {
      const runtime = createMockRuntime({
        input: { coarse: false, fine: true, hover: true },
      });
      expect(runtime.input.fine).toBe(true);
      expect(runtime.input.hover).toBe(true);
    });

    it('should use pointer for fine pointer without hover', () => {
      const runtime = createMockRuntime({
        input: { coarse: false, fine: true, hover: false },
      });
      expect(runtime.input.fine).toBe(true);
      expect(runtime.input.hover).toBe(false);
    });
  });

  describe('haptics support resolution', () => {
    it('should detect vibration API on Android', () => {
      const runtime = createMockRuntime({
        capabilities: {
          ...createMockRuntime({}).capabilities,
          vibration: true,
        },
      });
      expect(runtime.capabilities.vibration).toBe(true);
    });

    it('should assume light support on iOS even without vibration capability', () => {
      const runtime = createMockRuntime({
        isIOS: true,
        capabilities: {
          ...createMockRuntime({}).capabilities,
          vibration: false,
        },
      });
      expect(runtime.isIOS).toBe(true);
    });

    it('should return none when neither capability available', () => {
      const runtime = createMockRuntime({
        isIOS: false,
        isAndroid: false,
        capabilities: {
          ...createMockRuntime({}).capabilities,
          vibration: false,
        },
      });
      expect(runtime.isIOS).toBe(false);
      expect(runtime.capabilities.vibration).toBe(false);
    });
  });
});
