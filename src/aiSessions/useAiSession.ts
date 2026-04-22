import { useEffect, useMemo, useRef, useState } from 'react';
import { sleepWithAbort } from '../lib/abortSignals';
import {
  bootstrapAiSession,
  readEventLane,
  readPresenceLane,
  readStateLane,
  resolveThreadSummarySession,
  sendSessionMessage,
} from './sessionClient';
import type { AiSessionId } from './sessionSchemas';
import { getSessionEntry, useAiSessionStore } from './sessionStore';

type UseAiSessionOptions = {
  rootUri: string;
  actorDid: string;
  enabled?: boolean;
};

function makeClientActionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '_');
  }
  return `ca_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function withJitter(baseMs: number, jitterFraction = 0.25): number {
  const spread = Math.max(1, Math.floor(baseMs * jitterFraction));
  return baseMs - spread + Math.floor(Math.random() * (spread * 2 + 1));
}

function isFatalPollingError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number') {
    return status >= 400
      && status < 500
      && status !== 408
      && status !== 409
      && status !== 425
      && status !== 429;
  }

  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('invalid did format')
    || message.includes('invalid session id format')
    || message.includes('invalid clientactionid format')
    || message.includes('rooturi is required')
    || message.includes('content is required');
}

export function useAiSession(options: UseAiSessionOptions) {
  const enabled = options.enabled ?? true;
  const [sessionId, setSessionId] = useState<AiSessionId | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const initializeRef = useRef(false);
  const stopPollingRef = useRef(false);
  const setStatus = useAiSessionStore((state) => state.setStatus);
  const setBootstrap = useAiSessionStore((state) => state.setBootstrap);
  const appendEvents = useAiSessionStore((state) => state.appendEvents);
  const appendStateEvents = useAiSessionStore((state) => state.appendStateEvents);
  const appendPresenceEvents = useAiSessionStore((state) => state.appendPresenceEvents);
  const setActiveGeneration = useAiSessionStore((state) => state.setActiveGeneration);
  const setCacheOwnerDid = useAiSessionStore((state) => state.setCacheOwnerDid);

  useEffect(() => {
    if (!enabled) {
      setCacheOwnerDid(null);
      setSessionId(null);
      setPollingError(null);
      initializeRef.current = false;
      stopPollingRef.current = true;
      return;
    }

    setCacheOwnerDid(options.actorDid);
    setSessionId(null);
    setPollingError(null);
    initializeRef.current = false;
    stopPollingRef.current = true;
  }, [enabled, options.actorDid, options.rootUri, setCacheOwnerDid]);

  useEffect(() => {
    if (!enabled || !options.rootUri || !options.actorDid || initializeRef.current) {
      return;
    }

    initializeRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const { sessionId: resolvedSessionId } = await resolveThreadSummarySession(options.rootUri, options.actorDid);
        if (cancelled) return;
        setSessionId(resolvedSessionId);
        setStatus(resolvedSessionId, 'loading');

        const bootstrap = await bootstrapAiSession(resolvedSessionId, options.actorDid);
        if (cancelled) return;

        setBootstrap(resolvedSessionId, {
          session: bootstrap.session,
          members: bootstrap.members,
          capabilities: bootstrap.capabilities,
          messageHistory: bootstrap.messageHistory,
          stateSnapshot: {
            artifacts: bootstrap.stateSnapshot.artifacts,
            activeGeneration: bootstrap.stateSnapshot.activeGeneration,
          },
          eventOffset: bootstrap.eventOffset,
          stateOffset: bootstrap.stateOffset,
          presenceOffset: bootstrap.presenceOffset,
          activeGenerationInProgress: bootstrap.activeGenerationInProgress,
        });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to initialize AI session';
        setPollingError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, options.actorDid, options.rootUri, setBootstrap, setStatus]);

  useEffect(() => {
    if (!enabled || !sessionId || !options.actorDid) return;

    let cancelled = false;
    stopPollingRef.current = false;
    const abortController = new AbortController();

    const run = async () => {
      let backoffMs = 1000;
      while (!cancelled && !stopPollingRef.current) {
        try {
          const entry = getSessionEntry(sessionId);
          const eventOffset = entry?.offsets.event ?? 0;
          const stateOffset = entry?.offsets.state ?? 0;
          const presenceOffset = entry?.offsets.presence ?? 0;

          const [events, state, presence] = await Promise.all([
            readEventLane(sessionId, options.actorDid, eventOffset),
            readStateLane(sessionId, options.actorDid, stateOffset),
            readPresenceLane(sessionId, options.actorDid, presenceOffset),
          ]);

          appendEvents(sessionId, events.items.map((item) => item.payload), events.nextOffset);
          appendStateEvents(sessionId, state.items.map((item) => item.payload), state.nextOffset);
          appendPresenceEvents(sessionId, presence.items.map((item) => item.payload), presence.nextOffset);

          const hasRunningGeneration = events.items.some(
            (item) => item.payload.kind === 'generation.status' && item.payload.status === 'running',
          );
          const hasCompletedGeneration = events.items.some(
            (item) => item.payload.kind === 'generation.status' && item.payload.status !== 'running',
          );
          if (hasRunningGeneration) setActiveGeneration(sessionId, true);
          if (hasCompletedGeneration) setActiveGeneration(sessionId, false);

          setPollingError(null);
          setStatus(sessionId, 'ready');
          backoffMs = 1000;
          await sleepWithAbort(withJitter(1500, 0.2), abortController.signal);
        } catch (error) {
          if ((error as { name?: string }).name === 'AbortError') {
            return;
          }
          const message = error instanceof Error ? error.message : 'Session sync failed';
          setPollingError(message);
          setStatus(sessionId, 'error', message);

          if (isFatalPollingError(error)) {
            stopPollingRef.current = true;
            return;
          }

          await sleepWithAbort(withJitter(backoffMs), abortController.signal).catch(() => undefined);
          backoffMs = Math.min(backoffMs * 2, 30_000);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      stopPollingRef.current = true;
      abortController.abort();
    };
  }, [enabled, sessionId, options.actorDid, appendEvents, appendPresenceEvents, appendStateEvents, setActiveGeneration, setStatus]);

  const entry = useAiSessionStore((state) => (sessionId ? state.byId[sessionId] : undefined));

  const sendMessage = useMemo(() => {
    return async (content: string, kind: 'message' | 'regenerate' | 'ask_followup' | 'revise_summary' | 'critique' | 'tool_action' = 'message') => {
      if (!sessionId) throw new Error('AI session not initialized');
      await sendSessionMessage(sessionId, options.actorDid, {
        clientActionId: makeClientActionId(),
        kind,
        content,
      });
      setActiveGeneration(sessionId, true);
    };
  }, [options.actorDid, sessionId, setActiveGeneration]);

  return {
    sessionId,
    session: entry?.session,
    members: entry?.members ?? [],
    capabilities: entry?.capabilities,
    messages: entry?.messageHistory ?? [],
    stateEvents: entry?.recentStateEvents ?? [],
    presenceEvents: entry?.recentPresenceEvents ?? [],
    status: entry?.status ?? 'idle',
    error: pollingError ?? entry?.error ?? null,
    activeGenerationInProgress: entry?.activeGenerationInProgress ?? false,
    sendMessage,
  };
}
