import { useCallback } from 'react';
import { atpCall } from '../lib/atproto/client.js';
import { useSessionStore } from '../store/sessionStore.js';
import { useUiStore } from '../store/uiStore.js';

const resolvedActorCache = new Map<string, string>();

function normalizeActor(actor: string): string {
  return actor.trim().replace(/^@/, '');
}

export function useProfileNavigation() {
  const agent = useSessionStore((state) => state.agent);
  const openProfile = useUiStore((state) => state.openProfile);

  return useCallback(async (actor: string) => {
    const normalizedActor = normalizeActor(actor);
    if (!normalizedActor) return;

    if (normalizedActor.startsWith('did:')) {
      openProfile(normalizedActor);
      return;
    }

    const cacheKey = normalizedActor.toLowerCase();
    const cachedDid = resolvedActorCache.get(cacheKey);
    if (cachedDid) {
      openProfile(cachedDid);
      return;
    }

    if (!agent) {
      openProfile(normalizedActor);
      return;
    }

    try {
      const response = await atpCall((signal) => agent.getProfile({ actor: normalizedActor }, { signal }), { maxAttempts: 1, timeoutMs: 6000 });
      const resolvedDid = response.data.did;
      resolvedActorCache.set(cacheKey, resolvedDid);
      openProfile(resolvedDid);
    } catch {
      openProfile(normalizedActor);
    }
  }, [agent, openProfile]);
}

export default useProfileNavigation;