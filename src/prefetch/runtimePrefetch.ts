import { markPrefetchStart, markPrefetchEnd } from '../perf/prefetchTelemetry.js';

let scheduled = false;

type MaybeConnection = {
  saveData?: boolean;
  effectiveType?: string;
};

function shouldSkipPrefetch(): boolean {
  if (typeof navigator === 'undefined') return true;
  const connection = (navigator as Navigator & { connection?: MaybeConnection }).connection;
  if (!connection) return false;
  if (connection.saveData) return true;
  const effectiveType = connection.effectiveType ?? '';
  return effectiveType.includes('2g');
}

type PrefetchTask = {
  key:
    | 'tab-explore'
    | 'tab-profile'
    | 'overlay-host'
    | 'compose-sheet'
    | 'prompt-composer'
    | 'story-mode'
    | 'search-story'
    | 'atproto-queries';
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
    { key: 'tab-explore', load: () => import('../tabs/ExploreTab.js') },
    { key: 'tab-profile', load: () => import('../tabs/ProfileTab.js') },
    { key: 'overlay-host', load: () => import('../shell/OverlayHost.js') },
  ];

  const phase2: PrefetchTask[] = [
    { key: 'compose-sheet', load: () => import('../components/ComposeSheet.js') },
    { key: 'prompt-composer', load: () => import('../components/PromptComposer.js') },
    { key: 'story-mode', load: () => import('../components/StoryMode.js') },
    { key: 'search-story', load: () => import('../components/SearchStoryScreen.js') },
    { key: 'atproto-queries', load: () => import('../lib/atproto/queries.js') },
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
