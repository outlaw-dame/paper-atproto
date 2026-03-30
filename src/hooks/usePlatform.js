// ─── Platform Detection Hook ─────────────────────────────────────────────────
// Detects the runtime platform to enable Apple HIG–compliant adaptive UI.
// Signals:
//   isIOS       — iPhone/iPad (user-agent based)
//   isAndroid   — Android device
//   isMobile    — isIOS || isAndroid
//   isPWA       — running in standalone/PWA mode (home-screen launch)
//
// Usage:
//   const { isIOS, isMobile } = usePlatform();
import { useMemo } from 'react';
export function usePlatform() {
    return useMemo(() => {
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        const mm = typeof window !== 'undefined' ? window.matchMedia.bind(window) : null;
        const isIOS = /iphone|ipad|ipod/i.test(ua);
        const isAndroid = /android/i.test(ua);
        const isStandalone = (!!mm && (mm('(display-mode: standalone)').matches || mm('(display-mode: minimal-ui)').matches)) ||
            (isIOS && 'standalone' in navigator && navigator.standalone === true);
        const prefersCoarsePointer = !!mm && mm('(pointer: coarse)').matches;
        const hasAnyCoarsePointer = !!mm && mm('(any-pointer: coarse)').matches;
        const hasAnyFinePointer = !!mm && mm('(any-pointer: fine)').matches;
        const canHover = !!mm && (mm('(hover: hover)').matches || mm('(any-hover: hover)').matches);
        return {
            isIOS,
            isAndroid,
            isMobile: isIOS || isAndroid,
            isPWA: isStandalone,
            isStandalone,
            prefersCoarsePointer,
            hasAnyCoarsePointer,
            hasAnyFinePointer,
            canHover,
        };
    }, []);
}
export function getButtonTokens(platform) {
    const touchLike = platform.prefersCoarsePointer || platform.isMobile;
    if (platform.isIOS && touchLike) {
        return {
            height: 44,
            borderRadius: 22, // full pill
            fontSize: 15,
            fontWeight: 600,
            paddingH: 20,
            activeScale: 0.97,
        };
    }
    if (platform.isAndroid && touchLike) {
        return {
            height: 44,
            borderRadius: 12, // Material-style rounded rect
            fontSize: 15,
            fontWeight: 600,
            paddingH: 18,
            activeScale: 0.98,
        };
    }
    if (touchLike) {
        return {
            height: 44,
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 600,
            paddingH: 18,
            activeScale: 0.985,
        };
    }
    // Desktop
    return {
        height: 36,
        borderRadius: 10,
        fontSize: 14,
        fontWeight: 600,
        paddingH: 16,
        activeScale: 1,
    };
}
export function getIconBtnTokens(platform) {
    // Coarse pointers need 44px to meet touch target guidance.
    // Desktop can be compact.
    const touchLike = platform.prefersCoarsePointer || platform.isMobile;
    return {
        size: touchLike ? 44 : 34,
        borderRadius: touchLike ? 22 : 17,
    };
}
//# sourceMappingURL=usePlatform.js.map