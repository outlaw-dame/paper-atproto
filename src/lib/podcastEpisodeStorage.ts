export interface PodcastEpisodeEntry {
  id: string;
  title: string;
  showTitle: string;
  link: string;
  pubDate?: string | undefined;
}

export const MAX_PERSISTED_EPISODE_ENTRIES = 400;
const MAX_EPISODE_TEXT_LENGTH = 300;
const MAX_EPISODE_URL_LENGTH = 2048;

export function normalizeEpisodeEntry(value: unknown): PodcastEpisodeEntry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<PodcastEpisodeEntry>;

  const id = typeof record.id === 'string' ? record.id.trim().slice(0, MAX_EPISODE_TEXT_LENGTH) : '';
  const title = typeof record.title === 'string' ? record.title.trim().slice(0, MAX_EPISODE_TEXT_LENGTH) : '';
  const showTitle = typeof record.showTitle === 'string' ? record.showTitle.trim().slice(0, MAX_EPISODE_TEXT_LENGTH) : '';
  const link = typeof record.link === 'string' ? record.link.trim().slice(0, MAX_EPISODE_URL_LENGTH) : '';
  const pubDate = typeof record.pubDate === 'string' ? record.pubDate.trim().slice(0, MAX_EPISODE_TEXT_LENGTH) : undefined;

  if (!id || !title || !showTitle || !link) return null;
  if (!/^https?:\/\//i.test(link)) return null;

  return { id, title, showTitle, link, pubDate };
}

export function sanitizeEpisodeEntries(value: unknown): PodcastEpisodeEntry[] {
  if (!Array.isArray(value)) return [];
  const deduped: PodcastEpisodeEntry[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    const normalized = normalizeEpisodeEntry(candidate);
    if (!normalized) continue;
    const dedupeKey = `${normalized.id}|${normalized.link}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push(normalized);
    if (deduped.length >= MAX_PERSISTED_EPISODE_ENTRIES) break;
  }

  return deduped;
}

export function readEpisodeEntries(key: string): PodcastEpisodeEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    return sanitizeEpisodeEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeEpisodeEntries(key: string, entries: PodcastEpisodeEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(sanitizeEpisodeEntries(entries)));
  } catch {
    // ignore storage write errors
  }
}