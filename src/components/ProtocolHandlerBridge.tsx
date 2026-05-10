import { useEffect, useRef } from 'react';
import { useUiStore } from '../store/uiStore';
import {
  consumePendingProtocolPayload,
  type ProtocolPayload,
} from '../pwa/protocolHandler';

export default function ProtocolHandlerBridge() {
  const openProfile = useUiStore((state) => state.openProfile);
  const openStory = useUiStore((state) => state.openStory);
  const lastFingerprintRef = useRef<string>('');

  useEffect(() => {
    const processPayload = (payload: ProtocolPayload | null) => {
      if (!payload) return;

      const fingerprint = `${payload.type}\u241f${payload.canonicalUri}`;
      if (lastFingerprintRef.current === fingerprint) return;
      lastFingerprintRef.current = fingerprint;

      if (payload.type === 'profile' && payload.parsed.did) {
        openProfile(payload.parsed.did);
        return;
      }

      if (payload.type === 'handle' && payload.parsed.handle) {
        openProfile(payload.parsed.handle);
        return;
      }

      if (payload.type === 'post' && payload.parsed.atUri) {
        openStory({
          type: 'post',
          id: payload.parsed.atUri,
          title: 'Shared ATProto post',
        });
      }
    };

    processPayload(consumePendingProtocolPayload());

    const onProtocol = (event: Event) => {
      processPayload((event as CustomEvent<ProtocolPayload>).detail ?? null);
    };

    window.addEventListener('paper:protocol-handler', onProtocol);
    return () => {
      window.removeEventListener('paper:protocol-handler', onProtocol);
    };
  }, [openProfile, openStory]);

  return null;
}
