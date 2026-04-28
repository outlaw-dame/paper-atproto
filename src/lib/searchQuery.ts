export function normalizeAtprotoSearchQuery(input: string): string {
  const raw = input.trim();
  if (!raw) return '';

  // `searchPosts` and `searchActors` generally expect plain terms.
  // We still preserve the raw input if normalization would empty it.
  const normalized = raw.replace(/^#/, '').trim();
  return normalized || raw;
}
