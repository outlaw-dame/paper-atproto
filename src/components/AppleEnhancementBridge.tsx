import React from 'react';
import { detectAppleEnhancementAvailability } from '../apple/availability';
import { initializeCloudKit } from '../apple/cloudkit/auth';
import { hydrateMirroredPreferences } from '../apple/cloudkit/mirror/preferenceMirror';
import { useAppleEnhancementStore } from '../store/appleEnhancementStore';
import { useSessionStore } from '../store/sessionStore';

const CLOUDKIT_SYNC_MAX_RETRIES = 3;
const CLOUDKIT_SYNC_BASE_DELAY_MS = 1200;
const CLOUDKIT_SYNC_MAX_DELAY_MS = 12_000;

function isRetryableCloudKitFailure(error: unknown): boolean {
  if (error && typeof error === 'object' && 'retryable' in error && error.retryable === true) {
    return true;
  }
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code === 'cloudkit-transport';
  }
  return false;
}

function computeRetryDelayMs(attempt: number): number {
  const cap = Math.min(
    CLOUDKIT_SYNC_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1)),
    CLOUDKIT_SYNC_MAX_DELAY_MS,
  );
  const jitter = Math.floor(Math.random() * Math.max(150, Math.floor(cap * 0.2)));
  return cap + jitter;
}

export default function AppleEnhancementBridge() {
  const sessionDid = useSessionStore((state) => state.session?.did ?? null);
  const availability = useAppleEnhancementStore((state) => state.availability);
  const cloudKitEnabled = useAppleEnhancementStore((state) => state.cloudKitEnabled);
  const setAvailability = useAppleEnhancementStore((state) => state.setAvailability);
  const setCloudKitSyncState = useAppleEnhancementStore((state) => state.setCloudKitSyncState);
  const setCloudKitRetryAttempt = useAppleEnhancementStore((state) => state.setCloudKitRetryAttempt);
  const recordCloudKitSync = useAppleEnhancementStore((state) => state.recordCloudKitSync);
  const runIdRef = React.useRef(0);
  const retryAttemptRef = React.useRef(0);
  const retryTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    setAvailability(detectAppleEnhancementAvailability());
  }, [setAvailability]);

  React.useEffect(() => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (!availability || !cloudKitEnabled) {
      retryAttemptRef.current = 0;
      setCloudKitRetryAttempt(0);
      return;
    }

    if (!availability.cloudKitJsAvailable || !sessionDid) {
      retryAttemptRef.current = 0;
      setCloudKitRetryAttempt(0);
      setCloudKitSyncState('unavailable');
      return;
    }

    const runSync = async () => {
      if (runId !== runIdRef.current) return;
      setCloudKitSyncState('syncing');

      try {
        const authState = await initializeCloudKit();
        if (runId !== runIdRef.current) return;

        if (!authState.ready || !authState.signedIn) {
          retryAttemptRef.current = 0;
          setCloudKitRetryAttempt(0);
          setCloudKitSyncState('unavailable', authState.errorCode ?? 'not-signed-in');
          return;
        }

        await hydrateMirroredPreferences(sessionDid);
        if (runId !== runIdRef.current) return;

        retryAttemptRef.current = 0;
        setCloudKitRetryAttempt(0);
        recordCloudKitSync();
      } catch (error) {
        if (runId !== runIdRef.current) return;

        const failureCode = getCloudKitFailureCode(error);
        setCloudKitSyncState('error', failureCode);

        if (!isRetryableCloudKitFailure(error)) {
          retryAttemptRef.current = 0;
          setCloudKitRetryAttempt(0);
          return;
        }

        if (retryAttemptRef.current >= CLOUDKIT_SYNC_MAX_RETRIES) {
          retryAttemptRef.current = 0;
          setCloudKitRetryAttempt(0);
          return;
        }

        retryAttemptRef.current += 1;
        const attempt = retryAttemptRef.current;
        setCloudKitRetryAttempt(attempt);
        const delayMs = computeRetryDelayMs(attempt);
        retryTimerRef.current = window.setTimeout(() => {
          if (runId === runIdRef.current) {
            void runSync();
          }
        }, delayMs);
      }
    };

    void runSync();

    return () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [availability, cloudKitEnabled, sessionDid, setCloudKitSyncState, setCloudKitRetryAttempt, recordCloudKitSync]);

  return null;
}

function getCloudKitFailureCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'cloudkit-unknown';
}
