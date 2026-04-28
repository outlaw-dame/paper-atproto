export interface MediaPlaybackPrefs {
  positionSeconds?: number;
  playbackRate?: number;
  updatedAt: number;
}

const STORAGE_KEY = 'paper-atproto.mediaPlayback.v1';
const MAX_MEDIA_KEY_LENGTH = 512;
const MAX_MEDIA_PREF_ENTRIES = 500;
const MEDIA_PREF_TTL_MS = 1000 * 60 * 60 * 24 * 30;

type PlaybackMap = Record<string, MediaPlaybackPrefs>;

function sanitizeMediaKey(mediaKey: string): string {
  return mediaKey
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .trim()
    .slice(0, MAX_MEDIA_KEY_LENGTH);
}

function normalizePlaybackMap(input: unknown, now = Date.now()): PlaybackMap {
  if (!input || typeof input !== 'object') return {};

  const out: PlaybackMap = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = sanitizeMediaKey(rawKey);
    if (!key) continue;

    if (!rawValue || typeof rawValue !== 'object') continue;
    const value = rawValue as Partial<MediaPlaybackPrefs>;
    const updatedAt = Number(value.updatedAt);
    if (!Number.isFinite(updatedAt)) continue;
    if (updatedAt <= 0 || now - updatedAt > MEDIA_PREF_TTL_MS) continue;

    const positionSeconds = Number(value.positionSeconds);
    const playbackRate = Number(value.playbackRate);

    out[key] = {
      updatedAt,
      ...(Number.isFinite(positionSeconds) && positionSeconds >= 0 ? { positionSeconds } : {}),
      ...(Number.isFinite(playbackRate) && playbackRate >= 0.25 && playbackRate <= 4 ? { playbackRate } : {}),
    };
  }

  return out;
}

function readPlaybackMap(): PlaybackMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return normalizePlaybackMap(parsed);
  } catch {
    return {};
  }
}

function writePlaybackMap(map: PlaybackMap): void {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    const bounded = Object.entries(normalizePlaybackMap(map, now))
      .sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0))
      .slice(0, MAX_MEDIA_PREF_ENTRIES)
      .reduce<PlaybackMap>((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Ignore storage write failures (private mode / quota / policy)
  }
}

export function getMediaPlaybackPrefs(mediaKey: string): MediaPlaybackPrefs | null {
  const key = sanitizeMediaKey(mediaKey);
  if (!key) return null;
  const map = readPlaybackMap();
  return map[key] ?? null;
}

export function saveMediaPlaybackPrefs(
  mediaKey: string,
  update: { positionSeconds?: number; playbackRate?: number },
): void {
  const key = sanitizeMediaKey(mediaKey);
  if (!key) return;

  const map = readPlaybackMap();
  const existing = map[key] ?? { updatedAt: Date.now() };
  const next: MediaPlaybackPrefs = {
    ...existing,
    ...update,
    updatedAt: Date.now(),
  };
  map[key] = next;
  writePlaybackMap(map);
}
