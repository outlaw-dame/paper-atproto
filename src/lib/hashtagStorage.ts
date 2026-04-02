export const MAX_RECENT_HASHTAGS = 30;
export const MAX_FAVORITE_HASHTAGS = 100;
export const MAX_STORED_HASHTAG_LENGTH = 64;

export function normalizeStoredHashtag(value: string): string {
  return value.replace(/^#/, '').trim().toLowerCase();
}

export function sanitizeStoredHashtags(value: unknown, maxEntries: number): string[] {
  if (!Array.isArray(value)) return [];
  const next: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeStoredHashtag(item);
    if (!normalized || normalized.length > MAX_STORED_HASHTAG_LENGTH) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
    if (next.length >= maxEntries) break;
  }
  return next;
}

export function readStoredHashtags(key: string, maxEntries: number): string[] {
  try {
    return sanitizeStoredHashtags(JSON.parse(localStorage.getItem(key) ?? '[]'), maxEntries);
  } catch {
    return [];
  }
}