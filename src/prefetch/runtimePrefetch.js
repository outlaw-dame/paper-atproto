import { markPrefetchStart, markPrefetchEnd } from '../perf/prefetchTelemetry.js';
let scheduled = false;
export function shouldSkipPrefetch() {
    if (typeof window === 'undefined' || typeof document === 'undefined')
        return true;
    if (typeof navigator === 'undefined')
        return true;
    if (document.visibilityState === 'hidden')
        return true;
    if (navigator.onLine === false)
        return true;
    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isAndroid = /android/i.test(ua);
    const matchMedia = window.matchMedia?.bind(window);
    const isStandalone = (!!matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: minimal-ui)').matches)) ||
        (isIOS && 'standalone' in navigator && navigator.standalone === true);
    const deviceMemory = Number(navigator.deviceMemory ?? 0);
    const hardwareConcurrency = Number(navigator.hardwareConcurrency ?? 0);
    const isLowMemoryDevice = Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4;
    const isLowCpuDevice = Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 && hardwareConcurrency <= 4;
    if (isIOS || isAndroid || isStandalone || isLowMemoryDevice || isLowCpuDevice)
        return true;
    const connection = navigator.connection;
    if (!!matchMedia && matchMedia('(prefers-reduced-data: reduce)').matches)
        return true;
    if (!connection)
        return false;
    if (connection.saveData)
        return true;
    const effectiveType = connection.effectiveType ?? '';
    return effectiveType.includes('2g') || effectiveType.includes('3g');
}
function runPrefetchBatch(tasks) {
    void Promise.allSettled(tasks.map(async (task) => {
        const startedAt = markPrefetchStart(task.key);
        try {
            await task.load();
            markPrefetchEnd(task.key, startedAt, true);
        }
        catch {
            markPrefetchEnd(task.key, startedAt, false);
        }
    }));
}
export function scheduleRuntimePrefetches() {
    if (scheduled || typeof window === 'undefined')
        return;
    scheduled = true;
    if (shouldSkipPrefetch())
        return;
    const phase1 = [
        { key: 'tab-explore', load: () => import('../tabs/ExploreTab.js') },
        { key: 'tab-profile', load: () => import('../tabs/ProfileTab.js') },
        { key: 'overlay-host', load: () => import('../shell/OverlayHost.js') },
    ];
    const phase2 = [
        { key: 'compose-sheet', load: () => import('../components/ComposeSheet.js') },
        { key: 'prompt-composer', load: () => import('../components/PromptComposer.js') },
        { key: 'story-mode', load: () => import('../components/StoryMode.js') },
        { key: 'search-story', load: () => import('../components/SearchStoryScreen.js') },
        { key: 'atproto-queries', load: () => import('../lib/atproto/queries.js') },
    ];
    const schedule = (cb, timeout) => {
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(() => cb(), { timeout });
        }
        else {
            globalThis.setTimeout(cb, Math.min(timeout, 2500));
        }
    };
    schedule(() => runPrefetchBatch(phase1), 2500);
    schedule(() => runPrefetchBatch(phase2), 6000);
}
//# sourceMappingURL=runtimePrefetch.js.map