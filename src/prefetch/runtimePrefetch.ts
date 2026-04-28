import { markPrefetchStart, markPrefetchEnd } from '../perf/prefetchTelemetry';
import { getStaticPlatformInfo } from '../lib/platformDetect';

let scheduled = false;

export function shouldSkipPrefetch(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true;
  if (typeof navigator === 'undefined') return true;
  if (document.visibilityState === 'hidden') return true;
  if (navigator.onLine === false) return true;

  const {
    isIOS,
    isAndroid,
    isStandalone,
    deviceMemory,
    hardwareConcurrency,
    saveData,
    connectionEffectiveType,
  } = getStaticPlatformInfo();

  if (isIOS || isAndroid || isStandalone) return true;
  if (deviceMemory > 0 && deviceMemory <= 4) return true;
  if (hardwareConcurrency > 0 && hardwareConcurrency <= 4) return true;
  if (saveData) return true;

  try {
    if (window.matchMedia('(prefers-reduced-data: reduce)').matches) return true;
  } catch {
    // matchMedia unavailable — skip the check.
  }

  return (
    connectionEffectiveType.includes('2g') ||
    connectionEffectiveType.includes('3g')
  );
}

type PrefetchTask = {
  key:
    | 'tab-explore'
    | 'tab-profile'
    | 'overlay-host'
    | 'compose-sheet'
    | 'prompt-composer'
    | 'story-mode'
    | 'search-story';
  load: () => Promise<unknown>;
};

function runPrefetchBatch(tasks: PrefetchTask[]): void {
  void Promise.allSettled(
    tasks.map(async (task) => {
      const startedAt = markPrefetchStart(task.key);
      try {
        await task.load();
        markPrefetchEnd(task.key, startedAt, true);
      } catch {
        markPrefetchEnd(task.key, startedAt, false);
      }
    }),
  );
}

export function scheduleRuntimePrefetches(): void {
  if (scheduled || typeof window === 'undefined') return;
  scheduled = true;

  if (shouldSkipPrefetch()) return;

  const phase1: PrefetchTask[] = [
    { key: 'tab-explore', load: () => import('../tabs/ExploreTab') },
    { key: 'tab-profile', load: () => import('../tabs/ProfileTab') },
    { key: 'overlay-host', load: () => import('../shell/OverlayHost') },
  ];

  const phase2: PrefetchTask[] = [
    { key: 'compose-sheet', load: () => import('../components/ComposeSheet') },
    { key: 'prompt-composer', load: () => import('../components/PromptComposer') },
    { key: 'story-mode', load: () => import('../components/StoryMode') },
    { key: 'search-story', load: () => import('../components/SearchStoryScreen') },
  ];

  const schedule = (cb: () => void, timeout: number) => {
    if ('requestIdleCallback' in window) {
      (window as Window & { requestIdleCallback: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number }).requestIdleCallback(
        () => cb(),
        { timeout },
      );
    } else {
      globalThis.setTimeout(cb, Math.min(timeout, 2500));
    }
  };

  schedule(() => runPrefetchBatch(phase1), 2500);
  schedule(() => runPrefetchBatch(phase2), 6000);
}
