import { sanitizeExternalUrl } from './safety/externalUrl';

export interface YouTubeReference {
  originalUrl: string;
  normalizedUrl: string;
  domain: string;
  kind: 'video' | 'short' | 'live' | 'playlist';
  videoId?: string;
  playlistId?: string;
  startSeconds?: number;
}

export interface YouTubeEmbedOptions {
  autoplay?: boolean;
}

const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;

function isYouTubeHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./, '').toLowerCase();
  return host === 'youtu.be'
    || host === 'youtube.com'
    || host.endsWith('.youtube.com')
    || host === 'youtube-nocookie.com'
    || host.endsWith('.youtube-nocookie.com');
}

function trimMatchedUrl(rawUrl: string): string {
  let value = rawUrl.trim();
  while (/[),.!?;:]$/.test(value)) {
    const tail = value[value.length - 1];
    if (tail === ')' && (value.match(/\(/g)?.length ?? 0) >= (value.match(/\)/g)?.length ?? 0)) {
      break;
    }
    value = value.slice(0, -1);
  }
  return value;
}

function parseStartSeconds(rawValue: string | null): number | undefined {
  if (!rawValue) return undefined;
  const value = rawValue.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);

  let total = 0;
  let matched = false;
  const pattern = /(\d+)(h|m|s)/gi;
  let result = pattern.exec(value);

  while (result) {
    const amount = Number(result[1]);
    const unit = result[2]?.toLowerCase();
    if (Number.isFinite(amount) && unit) {
      matched = true;
      if (unit === 'h') total += amount * 3600;
      else if (unit === 'm') total += amount * 60;
      else if (unit === 's') total += amount;
    }
    result = pattern.exec(value);
  }

  return matched ? total : undefined;
}

export function parseYouTubeUrl(rawUrl: string): YouTubeReference | null {
  const sanitized = sanitizeExternalUrl(rawUrl);
  if (!sanitized) return null;

  let parsed: URL;
  try {
    parsed = new URL(sanitized);
  } catch {
    return null;
  }

  if (!isYouTubeHost(parsed.hostname)) return null;

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const parts = parsed.pathname.split('/').filter(Boolean);
  const pathname = parts[0]?.toLowerCase() ?? '';
  const playlistId = parsed.searchParams.get('list') ?? undefined;
  const startSeconds = parseStartSeconds(parsed.searchParams.get('t') ?? parsed.searchParams.get('start'));

  let kind: YouTubeReference['kind'] = 'video';
  let videoId = parsed.searchParams.get('v') ?? parsed.searchParams.get('vi') ?? undefined;

  if (host === 'youtu.be') {
    videoId = parts[0] ?? undefined;
    kind = 'video';
  } else if (pathname === 'shorts') {
    videoId = parts[1] ?? undefined;
    kind = 'short';
  } else if (pathname === 'live') {
    videoId = parts[1] ?? undefined;
    kind = 'live';
  } else if (pathname === 'embed' || pathname === 'v') {
    videoId = parts[1] ?? undefined;
    kind = 'video';
  } else if (pathname === 'playlist') {
    kind = 'playlist';
  }

  if (!videoId && !playlistId) return null;

  const canonical = new URL(
    videoId
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
      : 'https://www.youtube.com/playlist',
  );

  if (playlistId) canonical.searchParams.set('list', playlistId);
  if (startSeconds !== undefined && startSeconds > 0) canonical.searchParams.set('t', `${startSeconds}s`);

  return {
    originalUrl: rawUrl,
    normalizedUrl: canonical.toString(),
    domain: host === 'youtu.be' ? 'youtube.com' : host.replace(/^m\./, ''),
    kind,
    ...(videoId ? { videoId } : {}),
    ...(playlistId ? { playlistId } : {}),
    ...(startSeconds !== undefined ? { startSeconds } : {}),
  };
}

export function buildYouTubeThumbnailUrl(videoId: string, quality: 'default' | 'mqdefault' | 'hqdefault' | 'sddefault' = 'hqdefault'): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${quality}.jpg`;
}

export function buildYouTubeEmbedUrl(
  reference: YouTubeReference,
  options: YouTubeEmbedOptions = {},
): string | null {
  const autoplay = options.autoplay === true ? '1' : '0';

  const embed = reference.videoId
    ? new URL(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(reference.videoId)}`)
    : new URL('https://www.youtube-nocookie.com/embed/videoseries');

  embed.searchParams.set('autoplay', autoplay);
  embed.searchParams.set('playsinline', '1');
  embed.searchParams.set('rel', '0');

  if (reference.playlistId) {
    embed.searchParams.set('list', reference.playlistId);
  }

  if (reference.startSeconds !== undefined && reference.startSeconds > 0) {
    embed.searchParams.set('start', String(reference.startSeconds));
  }

  return sanitizeExternalUrl(embed.toString(), {
    stripTracking: true,
    stripHash: true,
    rejectLocalHosts: true,
  });
}

export function extractUrlsFromText(text: string): string[] {
  if (!text.trim()) return [];

  const urls: string[] = [];
  const seen = new Set<string>();

  const pushUrl = (value: string) => {
    const normalized = trimMatchedUrl(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    urls.push(normalized);
  };

  let hrefMatch = HREF_RE.exec(text);
  while (hrefMatch) {
    const href = hrefMatch[1];
    if (href) pushUrl(href);
    hrefMatch = HREF_RE.exec(text);
  }

  let urlMatch = URL_RE.exec(text);
  while (urlMatch) {
    const candidate = urlMatch[0];
    if (candidate) pushUrl(candidate);
    urlMatch = URL_RE.exec(text);
  }

  return urls;
}

export function extractFirstYouTubeReference(params: {
  explicitUrls?: Array<string | null | undefined>;
  text?: string | null | undefined;
}): YouTubeReference | null {
  const candidates = [
    ...(params.explicitUrls ?? []).filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    ...(params.text ? extractUrlsFromText(params.text) : []),
  ];

  for (const candidate of candidates) {
    const parsed = parseYouTubeUrl(candidate);
    if (parsed) return parsed;
  }

  return null;
}
