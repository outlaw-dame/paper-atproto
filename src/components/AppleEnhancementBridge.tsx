import React from 'react';
import { detectAppleEnhancementAvailability } from '../apple/availability';
import { initializeCloudKit } from '../apple/cloudkit/auth';
import { hydrateMirroredPreferences } from '../apple/cloudkit/mirror/preferenceMirror';
import { useAppleEnhancementStore } from '../store/appleEnhancementStore';
import { useSessionStore } from '../store/sessionStore';

export default function AppleEnhancementBridge() {
  const sessionDid = useSessionStore((state) => state.session?.did ?? null);
  const availability = useAppleEnhancementStore((state) => state.availability);
  const cloudKitEnabled = useAppleEnhancementStore((state) => state.cloudKitEnabled);
  const setAvailability = useAppleEnhancementStore((state) => state.setAvailability);
  const setCloudKitSyncState = useAppleEnhancementStore((state) => state.setCloudKitSyncState);
  const recordCloudKitSync = useAppleEnhancementStore((state) => state.recordCloudKitSync);

  React.useEffect(() => {
    setAvailability(detectAppleEnhancementAvailability());
  }, [setAvailability]);

  const hydrateCloudKit = React.useEffectEvent(async () => {
    if (!availability) {
      return;
    }

    if (!cloudKitEnabled) {
      return;
    }

    if (!availability.cloudKitJsAvailable || !sessionDid) {
      setCloudKitSyncState('unavailable');
      return;
    }

    setCloudKitSyncState('syncing');

    try {
      const authState = await initializeCloudKit();
      if (!authState.ready || !authState.signedIn) {
        setCloudKitSyncState('unavailable', authState.errorCode ?? 'not-signed-in');
        return;
      }

      await hydrateMirroredPreferences(sessionDid);
      recordCloudKitSync();
    } catch (error) {
      setCloudKitSyncState(
        'error',
        getCloudKitFailureCode(error),
      );
    }
  });

  React.useEffect(() => {
    void hydrateCloudKit();
  }, [availability, cloudKitEnabled, sessionDid, hydrateCloudKit]);

  return null;
}

function getCloudKitFailureCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'cloudkit-unknown';
}
