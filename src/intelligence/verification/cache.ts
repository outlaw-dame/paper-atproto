import type { VerificationOutcome } from './types';

export interface VerificationCache {
  get(key: string): Promise<VerificationOutcome | null>;
  set(key: string, value: VerificationOutcome, ttlMs?: number): Promise<void>;
}

export class InMemoryVerificationCache implements VerificationCache {
  private readonly map = new Map<string, { value: VerificationOutcome; expiresAt?: number }>();

  async get(key: string): Promise<VerificationOutcome | null> {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (hit.expiresAt && Date.now() > hit.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: VerificationOutcome, ttlMs = 5 * 60_000): Promise<void> {
    this.map.set(key, {
      value,
      ...(ttlMs > 0 ? { expiresAt: Date.now() + ttlMs } : {}),
    });
  }
}

export function verificationCacheKey(postUri: string, text: string): string {
  const normalizedText = text.trim().replace(/\s+/g, ' ').slice(0, 512);
  return `${postUri}::${normalizedText}`;
}
