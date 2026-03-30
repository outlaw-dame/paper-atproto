// ─── Push Preferences Store ───────────────────────────────────────────────────
// Notification preferences — persisted locally, cross-platform source of truth.
// May later be optionally mirrored to CloudKit as Apple-only convenience.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export const usePushPreferencesStore = create()(persist((set) => ({
    enabled: false,
    mentions: true,
    replies: true,
    follows: true,
    dms: true,
    moderation: true,
    digest: false,
    setEnabled: (value) => set({ enabled: value }),
    setMentions: (value) => set({ mentions: value }),
    setReplies: (value) => set({ replies: value }),
    setFollows: (value) => set({ follows: value }),
    setDms: (value) => set({ dms: value }),
    setModeration: (value) => set({ moderation: value }),
    setDigest: (value) => set({ digest: value }),
}), {
    name: 'glimpse-push-preferences-v1',
    version: 1,
}));
//# sourceMappingURL=pushPreferencesStore.js.map