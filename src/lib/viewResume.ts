const STORAGE_KEY = 'glympse.view.resume.v1';
const MAX_ENTRIES = 60;
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

type ViewResumeEntry = {
  top: number;
  updatedAt: number;
};

type ViewResumeMap = Record<string, ViewResumeEntry>;

function readMap(): ViewResumeMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};

    const now = Date.now();
    const next: ViewResumeMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      const top = Number((value as { top?: unknown }).top ?? NaN);
      const updatedAt = Number((value as { updatedAt?: unknown }).updatedAt ?? NaN);
      if (!Number.isFinite(top) || top < 0) continue;
      if (!Number.isFinite(updatedAt) || updatedAt <= 0) continue;
      if (now - updatedAt > MAX_AGE_MS) continue;
      next[key] = { top, updatedAt };
    }
    return next;
  } catch {
    return {};
  }
}

function writeMap(map: ViewResumeMap): void {
  if (typeof window === 'undefined') return;
  try {
    const sorted = Object.entries(map)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_ENTRIES);
    const bounded = Object.fromEntries(sorted);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Ignore localStorage quota/private mode write failures.
  }
}

export function readViewScrollPosition(viewKey: string): number {
  if (!viewKey) return 0;
  const map = readMap();
  const entry = map[viewKey];
  return entry ? Math.max(0, Math.floor(entry.top)) : 0;
}

export function writeViewScrollPosition(viewKey: string, top: number): void {
  if (!viewKey || !Number.isFinite(top) || top < 0) return;
  const map = readMap();
  map[viewKey] = {
    top: Math.floor(top),
    updatedAt: Date.now(),
  };
  writeMap(map);
}
