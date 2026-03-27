function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

export function getConfiguredApiBaseUrl(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }
  return '';
}

export function resolveApiUrl(path: string, baseUrl = ''): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!baseUrl) return normalizedPath;
  return new URL(normalizedPath, `${baseUrl}/`).toString();
}
