// ─── Moderation Store ─────────────────────────────────────────────────────
// Tracks client-side state needed for ATProto block/mute features:
//
//  • timedMutes  — DID → expiry timestamp (ms). 0 = indefinite.
//                  ATProto doesn't natively support timed mutes; we store
//                  expiry locally and auto-unmute via useTimedMuteWatcher.
//                  Inspired by Mastodon's `duration` parameter on POST .../mute.
//
//  • blockRkeys  — DID → rkey of the app.bsky.graph.block record.
//                  ATProto blocks are records in the user's PDS repo; deleting
//                  (unblocking) requires the rkey. We cache it here to avoid
//                  an extra round-trip on unblock.
//
// Both maps are persisted to localStorage so they survive page reloads.

import { create } from 'zustand';

// ─── Mastodon-inspired timed mute durations ────────────────────────────────
export const MUTE_DURATIONS = [
  { label: 'Indefinite', valueMs: null },
  { label: '1 hour',     valueMs: 60 * 60 * 1_000 },
  { label: '8 hours',   valueMs: 8 * 60 * 60 * 1_000 },
  { label: '1 day',     valueMs: 24 * 60 * 60 * 1_000 },
  { label: '3 days',    valueMs: 3 * 24 * 60 * 60 * 1_000 },
  { label: '7 days',    valueMs: 7 * 24 * 60 * 60 * 1_000 },
  { label: '30 days',   valueMs: 30 * 24 * 60 * 60 * 1_000 },
] as const;

export type MuteDuration = typeof MUTE_DURATIONS[number]['valueMs'];

// ─── Store shape ─────────────────────────────────────────────────────────
interface ModerationState {
  /** DID → expiry timestamp ms (0 = indefinite/no-expiry) */
  timedMutes: Record<string, number>;
  /** DID → rkey of app.bsky.graph.block record */
  blockRkeys: Record<string, string>;

  // Actions
  addTimedMute: (did: string, durationMs: number | null) => void;
  removeTimedMute: (did: string) => void;
  /** Returns DIDs whose timed mute has expired */
  getExpiredMutes: () => string[];
  setBlockRkey: (did: string, rkey: string) => void;
  deleteBlockRkey: (did: string) => void;
}

// ─── Persistence ─────────────────────────────────────────────────────────
const STORAGE_KEY = 'glimpse-moderation-v1';

export function pruneExpiredTimedMutes(timedMutes: Record<string, number>, now = Date.now()): Record<string, number> {
  const pruned: Record<string, number> = {};
  for (const [did, expiry] of Object.entries(timedMutes)) {
    if (!Number.isFinite(expiry)) continue;
    if (expiry === 0 || expiry > now) {
      pruned[did] = expiry;
    }
  }
  return pruned;
}

function loadStorage(): Pick<ModerationState, 'timedMutes' | 'blockRkeys'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        timedMutes: pruneExpiredTimedMutes((parsed.timedMutes ?? {}) as Record<string, number>),
        blockRkeys: parsed.blockRkeys ?? {},
      };
    }
  } catch {
    // storage unavailable or corrupt — start fresh
  }
  return { timedMutes: {}, blockRkeys: {} };
}

function saveStorage(
  timedMutes: Record<string, number>,
  blockRkeys: Record<string, string>,
) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ timedMutes, blockRkeys }));
  } catch (err) {
    if ((err as DOMException).name === 'QuotaExceededError') {
      // Storage quota exceeded — clear old expired mutes and try again
      const now = Date.now();
      const recentMutes: Record<string, number> = {};
      for (const [did, expiry] of Object.entries(timedMutes)) {
        if (expiry === 0 || expiry > now) {
          // Keep indefinite (0) and non-expired mutes
          recentMutes[did] = expiry;
        }
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ timedMutes: recentMutes, blockRkeys }));
      } catch {
        // Still failed — give up
        console.warn('[Moderation] Storage quota exceeded and cleanup failed');
      }
    } else {
      // Private browsing or other error — ignore
    }
  }
}

// ─── Store ────────────────────────────────────────────────────────────────
export const useModerationStore = create<ModerationState>((set, get) => {
  const stored = loadStorage();

  return {
    timedMutes: stored.timedMutes,
    blockRkeys: stored.blockRkeys,

    addTimedMute: (did, durationMs) => {
      const expiresAt = durationMs ? Date.now() + durationMs : 0;
      set((s) => {
        const timedMutes = { ...s.timedMutes, [did]: expiresAt };
        saveStorage(timedMutes, s.blockRkeys);
        return { timedMutes };
      });
    },

    removeTimedMute: (did) => {
      set((s) => {
        const { [did]: _removed, ...rest } = s.timedMutes;
        saveStorage(rest, s.blockRkeys);
        return { timedMutes: rest };
      });
    },

    getExpiredMutes: () => {
      const now = Date.now();
      return Object.entries(get().timedMutes)
        .filter(([_did, exp]) => exp !== 0 && exp < now)
        .map(([did]) => did);
    },

    setBlockRkey: (did, rkey) => {
      set((s) => {
        const blockRkeys = { ...s.blockRkeys, [did]: rkey };
        saveStorage(s.timedMutes, blockRkeys);
        return { blockRkeys };
      });
    },

    deleteBlockRkey: (did) => {
      set((s) => {
        const { [did]: _removed, ...rest } = s.blockRkeys;
        saveStorage(s.timedMutes, rest);
        return { blockRkeys: rest };
      });
    },
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Format ms-until-expiry as a human-readable string. */
export function formatMuteExpiry(expiresAt: number): string {
  if (!expiresAt) return 'Indefinite';
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return 'Expired';
  const totalMin = Math.floor(remaining / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? `${d}d ${rh}h remaining` : `${d}d remaining`;
  }
  if (h > 0) return `${h}h ${m}m remaining`;
  return `${m}m remaining`;
}
