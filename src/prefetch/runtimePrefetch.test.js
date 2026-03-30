import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldSkipPrefetch } from './runtimePrefetch.js';
function setNavigator(value) {
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value,
    });
}
function setDocumentVisibility(state) {
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { visibilityState: state },
    });
}
function setWindowMatchMedia(prefersReducedData = false) {
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            matchMedia: (query) => ({
                matches: query === '(prefers-reduced-data: reduce)' ? prefersReducedData : false,
            }),
        },
    });
}
describe('shouldSkipPrefetch', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });
    it('skips prefetch when the page is hidden', () => {
        setWindowMatchMedia(false);
        setDocumentVisibility('hidden');
        setNavigator({ onLine: true, userAgent: 'Macintosh', connection: {} });
        expect(shouldSkipPrefetch()).toBe(true);
    });
    it('skips prefetch when save-data is enabled or network is slow', () => {
        setWindowMatchMedia(false);
        setDocumentVisibility('visible');
        setNavigator({ onLine: true, userAgent: 'Macintosh', connection: { saveData: true, effectiveType: '4g' } });
        expect(shouldSkipPrefetch()).toBe(true);
        setNavigator({ onLine: true, userAgent: 'Macintosh', connection: { saveData: false, effectiveType: '3g' } });
        expect(shouldSkipPrefetch()).toBe(true);
    });
    it('allows prefetch on visible desktop-class devices with healthy connectivity', () => {
        setWindowMatchMedia(false);
        setDocumentVisibility('visible');
        setNavigator({
            onLine: true,
            userAgent: 'Macintosh',
            deviceMemory: 8,
            hardwareConcurrency: 8,
            connection: { saveData: false, effectiveType: '4g' },
        });
        expect(shouldSkipPrefetch()).toBe(false);
    });
});
//# sourceMappingURL=runtimePrefetch.test.js.map