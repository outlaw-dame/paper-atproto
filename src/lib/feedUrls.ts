const DEFAULT_FEED_URL_MAX_CHARS = 2_048;

export function normalizeExternalFeedUrl(
  rawUrl: string,
  maxChars = DEFAULT_FEED_URL_MAX_CHARS,
): string | null {
  const sanitized = rawUrl
    .replace(/[\u0000-\u001F\u007F]+/g, '')
    .trim();

  if (!sanitized) {
    return null;
  }

  if (sanitized.length > Math.max(1, maxChars)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(sanitized);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  if (!parsed.hostname) {
    return null;
  }

  if (parsed.username || parsed.password) {
    return null;
  }

  parsed.hash = '';
  return parsed.toString();
}
