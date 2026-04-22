import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiSessionId } from './sessionSchemas';
import { sendTypingPresence } from './sessionClient';

type UsePresenceOptions = {
  sessionId: AiSessionId | null;
  actorDid: string;
  enabled?: boolean;
  debounceMs?: number;
  refreshMs?: number;
  expiresInMs?: number;
};

export function usePresence(options: UsePresenceOptions) {
  const enabled = options.enabled ?? true;
  const debounceMs = options.debounceMs ?? 500;
  const refreshMs = options.refreshMs ?? 2500;
  const expiresInMs = options.expiresInMs ?? 6000;

  const typingRef = useRef(false);
  const [isTypingLocal, setIsTypingLocal] = useState(false);
  const debounceTimerRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const reportPresenceError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown-error';
    console.warn('[ai/presence] presence update failed', message.slice(0, 200));
  }, []);

  const clearTimers = useCallback(() => {
    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (refreshTimerRef.current != null) {
      window.clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const emitPresence = useCallback(async (isTyping: boolean) => {
    if (!enabled || !options.sessionId || !options.actorDid) return;
    await sendTypingPresence(options.sessionId, options.actorDid, isTyping, expiresInMs);
  }, [enabled, options.actorDid, options.sessionId, expiresInMs]);

  const emitPresenceSafe = useCallback(async (isTyping: boolean) => {
    try {
      await emitPresence(isTyping);
    } catch (error) {
      reportPresenceError(error);
    }
  }, [emitPresence, reportPresenceError]);

  const stopTyping = useCallback(async () => {
    typingRef.current = false;
    setIsTypingLocal(false);
    clearTimers();
    await emitPresenceSafe(false);
  }, [clearTimers, emitPresenceSafe]);

  const startTyping = useCallback(async () => {
    typingRef.current = true;
    setIsTypingLocal(true);
    clearTimers();
    await emitPresenceSafe(true);
    refreshTimerRef.current = window.setInterval(() => {
      void emitPresenceSafe(true);
    }, refreshMs);
  }, [clearTimers, emitPresenceSafe, refreshMs]);

  const reportInputActivity = useCallback(() => {
    if (!enabled || !options.sessionId || !options.actorDid) return;
    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      void startTyping();
    }, debounceMs);
  }, [debounceMs, enabled, options.actorDid, options.sessionId, startTyping]);

  useEffect(() => {
    return () => {
      const wasTyping = typingRef.current;
      clearTimers();
      typingRef.current = false;
      setIsTypingLocal(false);
      if (wasTyping) {
        void emitPresenceSafe(false);
      }
    };
  }, [clearTimers, emitPresenceSafe]);

  return {
    isTypingLocal,
    reportInputActivity,
    startTyping,
    stopTyping,
  };
}
