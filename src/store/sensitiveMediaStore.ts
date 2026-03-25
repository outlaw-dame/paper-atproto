import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface SensitiveMediaPolicy {
  blurSensitiveMedia: boolean;
  allowReveal: boolean;
  telemetryOptIn: boolean;
}

interface SensitiveMediaState {
  policy: SensitiveMediaPolicy;
  revealedPostIds: Record<string, true>;
  setPolicy: (patch: Partial<SensitiveMediaPolicy>) => void;
  revealPost: (postId: string) => void;
  hidePost: (postId: string) => void;
  clearReveals: () => void;
}

const DEFAULT_POLICY: SensitiveMediaPolicy = {
  blurSensitiveMedia: true,
  allowReveal: true,
  telemetryOptIn: false,
};

function sanitizePostId(raw: string): string {
  return raw.trim().slice(0, 256);
}

export const useSensitiveMediaStore = create<SensitiveMediaState>()(
  persist(
    (set) => ({
      policy: DEFAULT_POLICY,
      revealedPostIds: {},
      setPolicy: (patch) => set((state) => ({ policy: { ...state.policy, ...patch } })),
      revealPost: (postId) => {
        const key = sanitizePostId(postId);
        if (!key) return;
        set((state) => ({
          revealedPostIds: {
            ...state.revealedPostIds,
            [key]: true,
          },
        }));
      },
      hidePost: (postId) => {
        const key = sanitizePostId(postId);
        if (!key) return;
        set((state) => {
          const next = { ...state.revealedPostIds };
          delete next[key];
          return { revealedPostIds: next };
        });
      },
      clearReveals: () => set({ revealedPostIds: {} }),
    }),
    {
      name: 'glympse.sensitive-media.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        policy: state.policy,
        revealedPostIds: state.revealedPostIds,
      }),
    },
  ),
);
