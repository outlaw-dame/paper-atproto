import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionStore } from '../../store/sessionStore';
import { useModerationStore } from '../../store/moderationStore';

const MUTES_QUERY_KEY = ['mutes'] as const;

// Mount once at app-shell level to auto-unmute locally expired timed mutes.
export function useTimedMuteWatcher() {
  const { session, agent } = useSessionStore();
  const qc = useQueryClient();
  const getExpiredMutes = useModerationStore((s) => s.getExpiredMutes);
  const removeTimedMute = useModerationStore((s) => s.removeTimedMute);

  useEffect(() => {
    if (!session) return;

    async function sweep() {
      const expired = getExpiredMutes();
      if (!expired.length) return;

      await Promise.allSettled(
        expired.map(async (did) => {
          try {
            await agent.unmute(did);
          } finally {
            removeTimedMute(did);
          }
        }),
      );

      void qc.invalidateQueries({ queryKey: MUTES_QUERY_KEY });
    }

    void sweep();
    const id = setInterval(sweep, 60_000);
    return () => clearInterval(id);
  }, [session, agent, getExpiredMutes, removeTimedMute, qc]);
}
