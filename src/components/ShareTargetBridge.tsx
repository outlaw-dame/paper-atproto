import { useEffect, useRef } from 'react';
import { useUiStore } from '../store/uiStore';
import {
  consumePendingSharedPayload,
  type SharedPayload,
} from '../pwa/shareTarget';

const MAX_COMPOSE_TEXT = 2000;

function sanitizeLine(value: string): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildShareDraft(payload: SharedPayload): string {
  const title = sanitizeLine(payload.title);
  const text = sanitizeLine(payload.text);
  const url = sanitizeLine(payload.url);

  const chunks = [title, text, url].filter((chunk, idx, arr) => {
    if (!chunk) return false;
    return arr.indexOf(chunk) === idx;
  });

  return chunks.join('\n\n').slice(0, MAX_COMPOSE_TEXT);
}

export default function ShareTargetBridge() {
  const openCompose = useUiStore((state) => state.openCompose);
  const setComposeDraft = useUiStore((state) => state.setComposeDraft);
  const lastFingerprintRef = useRef<string>('');

  useEffect(() => {
    const processPayload = (payload: SharedPayload | null) => {
      if (!payload) return;
      const draft = buildShareDraft(payload);
      if (!draft) return;

      const fingerprint = `${payload.title}\u241f${payload.text}\u241f${payload.url}`;
      if (lastFingerprintRef.current === fingerprint) return;
      lastFingerprintRef.current = fingerprint;

      setComposeDraft(draft);
      openCompose();
    };

    processPayload(consumePendingSharedPayload());

    const onShareTarget = (event: Event) => {
      processPayload((event as CustomEvent<SharedPayload>).detail ?? null);
    };

    window.addEventListener('paper:share-target', onShareTarget);
    return () => {
      window.removeEventListener('paper:share-target', onShareTarget);
    };
  }, [openCompose, setComposeDraft]);

  return null;
}
