const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

function hasDangerousControlChars(value: string): boolean {
  return /[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/.test(value);
}

export function sanitizeExternalUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || hasDangerousControlChars(trimmed)) return null;

  try {
    const parsed = new URL(trimmed);
    if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    parsed.hash = parsed.hash;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function getSafeExternalHostname(rawUrl: string): string | null {
  const sanitized = sanitizeExternalUrl(rawUrl);
  if (!sanitized) return null;

  try {
    return new URL(sanitized).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function openExternalUrl(rawUrl: string): boolean {
  const sanitized = sanitizeExternalUrl(rawUrl);
  if (!sanitized || typeof window === 'undefined') return false;

  window.open(sanitized, '_blank', 'noopener,noreferrer');
  return true;
}
