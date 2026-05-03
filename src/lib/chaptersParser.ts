/**
 * Podcast Index JSON chapters parser.
 * Spec: https://github.com/Podcastindex-org/podcast-namespace/blob/main/chapters/jsonChapters.md
 */

export interface PodcastChapter {
  startTime: number;
  endTime: number | null;
  title: string | null;
  img: string | null;
  url: string | null;
  isHidden: boolean;
}

const MAX_CHAPTERS = 200;

export function parsePodcastChapters(content: string): PodcastChapter[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }

  const rawChapters: unknown[] = Array.isArray((data as any)?.chapters)
    ? (data as any).chapters
    : [];

  const chapters: PodcastChapter[] = [];

  for (const ch of rawChapters.slice(0, MAX_CHAPTERS)) {
    const raw = ch as Record<string, unknown>;
    const startTime = Number(raw?.startTime ?? raw?.start ?? 0);
    if (!Number.isFinite(startTime) || startTime < 0) continue;

    const rawEnd = raw?.endTime ?? raw?.end;
    const endTime =
      rawEnd != null && Number.isFinite(Number(rawEnd)) ? Number(rawEnd) : null;

    const title =
      typeof raw?.title === 'string' && raw.title.trim()
        ? raw.title.trim()
        : null;

    const img =
      typeof raw?.img === 'string' && raw.img.trim()
        ? raw.img.trim()
        : null;

    const url =
      typeof raw?.url === 'string' && raw.url.trim()
        ? raw.url.trim()
        : null;

    const isHidden = raw?.hidden === true || raw?.isHidden === true;

    chapters.push({ startTime, endTime, title, img, url, isHidden });
  }

  // Stable ordering by start time
  chapters.sort((a, b) => a.startTime - b.startTime);

  return chapters;
}
