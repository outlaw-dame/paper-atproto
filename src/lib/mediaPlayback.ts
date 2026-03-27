export interface MediaPlaybackPrefs {
  positionSeconds?: number;
  playbackRate?: number;
  updatedAt: number;
}

const STORAGE_KEY = 'paper-atproto.mediaPlayback.v1';

type PlaybackMap = Record<string, MediaPlaybackPrefs>;

function readPlaybackMap(): PlaybackMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PlaybackMap;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function writePlaybackMap(map: PlaybackMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage write failures (private mode / quota / policy)
  }
}

export function getMediaPlaybackPrefs(mediaKey: string): MediaPlaybackPrefs | null {
  const map = readPlaybackMap();
  return map[mediaKey] ?? null;
}

export function saveMediaPlaybackPrefs(
  mediaKey: string,
  update: { positionSeconds?: number; playbackRate?: number },
): void {
  const map = readPlaybackMap();
  const existing = map[mediaKey] ?? { updatedAt: Date.now() };
  const next: MediaPlaybackPrefs = {
    ...existing,
    ...update,
    updatedAt: Date.now(),
  };
  map[mediaKey] = next;
  writePlaybackMap(map);
}
