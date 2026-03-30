const STORAGE_KEY = 'paper-atproto.mediaPlayback.v1';
function readPlaybackMap() {
    if (typeof window === 'undefined')
        return {};
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object')
            return {};
        return parsed;
    }
    catch {
        return {};
    }
}
function writePlaybackMap(map) {
    if (typeof window === 'undefined')
        return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    }
    catch {
        // Ignore storage write failures (private mode / quota / policy)
    }
}
export function getMediaPlaybackPrefs(mediaKey) {
    const map = readPlaybackMap();
    return map[mediaKey] ?? null;
}
export function saveMediaPlaybackPrefs(mediaKey, update) {
    const map = readPlaybackMap();
    const existing = map[mediaKey] ?? { updatedAt: Date.now() };
    const next = {
        ...existing,
        ...update,
        updatedAt: Date.now(),
    };
    map[mediaKey] = next;
    writePlaybackMap(map);
}
//# sourceMappingURL=mediaPlayback.js.map