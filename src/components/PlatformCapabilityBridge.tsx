import React from 'react';
import { createPlatformCapabilitySnapshot } from '../platform/capabilities';

const BODY_ATTRIBUTES = ['data-platform', 'data-standalone', 'data-native-bridge'] as const;

export default function PlatformCapabilityBridge() {
  React.useEffect(() => {
    const snapshot = createPlatformCapabilitySnapshot();

    try {
      document.body.setAttribute('data-platform', snapshot.family);
      document.body.setAttribute('data-standalone', snapshot.staticInfo.isStandalone ? 'true' : 'false');
      document.body.setAttribute('data-native-bridge', snapshot.nativeBridge.kind);
    } catch {
      return undefined;
    }

    return () => {
      try {
        for (const attribute of BODY_ATTRIBUTES) {
          document.body.removeAttribute(attribute);
        }
      } catch {
        // Sandboxed iframe or torn-down document; nothing to repair.
      }
    };
  }, []);

  return null;
}
