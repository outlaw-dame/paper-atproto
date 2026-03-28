export type SupportLevel = '' | 'maybe' | 'probably';

export interface VideoFormatSupport {
  key: string;
  label: string;
  mimeType: string;
  level: SupportLevel;
  supported: boolean;
}

export interface VideoPlaybackCapabilities {
  hls: VideoFormatSupport;
  mp4: VideoFormatSupport;
  mp4H264Aac: VideoFormatSupport;
  mp4HevcAac: VideoFormatSupport;
  mp4Av1Aac: VideoFormatSupport;
  webm: VideoFormatSupport;
  webmVp9Opus: VideoFormatSupport;
  webmVp8Vorbis: VideoFormatSupport;
}

export type VideoSourceKind = 'hls' | 'mp4' | 'webm' | 'unknown';

const SUPPORT_ORDER: Record<SupportLevel, number> = {
  '': 0,
  maybe: 1,
  probably: 2,
};

function strongestSupport(levels: SupportLevel[]): SupportLevel {
  return levels.reduce<SupportLevel>((best, current) => (
    SUPPORT_ORDER[current] > SUPPORT_ORDER[best] ? current : best
  ), '');
}

function buildSupportProbe(
  video: HTMLVideoElement,
  key: string,
  label: string,
  mimeTypes: string[],
): VideoFormatSupport {
  const level = strongestSupport(mimeTypes.map((mimeType) => {
    const value = video.canPlayType(mimeType);
    return value === 'probably' || value === 'maybe' ? value : '';
  }));

  return {
    key,
    label,
    mimeType: mimeTypes.join(' | '),
    level,
    supported: level !== '',
  };
}

function emptySupport(key: string, label: string, mimeType: string): VideoFormatSupport {
  return {
    key,
    label,
    mimeType,
    level: '',
    supported: false,
  };
}

export function getVideoPlaybackCapabilities(): VideoPlaybackCapabilities {
  if (typeof document === 'undefined') {
    return {
      hls: emptySupport('hls', 'HLS stream', 'application/vnd.apple.mpegurl'),
      mp4: emptySupport('mp4', 'MP4 container', 'video/mp4'),
      mp4H264Aac: emptySupport('mp4-h264-aac', 'MP4 H.264 + AAC', 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
      mp4HevcAac: emptySupport('mp4-hevc-aac', 'MP4 HEVC + AAC', 'video/mp4; codecs="hvc1.1.6.L93.B0, mp4a.40.2"'),
      mp4Av1Aac: emptySupport('mp4-av1-aac', 'MP4 AV1 + AAC', 'video/mp4; codecs="av01.0.05M.08, mp4a.40.2"'),
      webm: emptySupport('webm', 'WebM container', 'video/webm'),
      webmVp9Opus: emptySupport('webm-vp9-opus', 'WebM VP9 + Opus', 'video/webm; codecs="vp9, opus"'),
      webmVp8Vorbis: emptySupport('webm-vp8-vorbis', 'WebM VP8 + Vorbis', 'video/webm; codecs="vp8, vorbis"'),
    };
  }

  const video = document.createElement('video');

  return {
    hls: buildSupportProbe(video, 'hls', 'HLS stream', [
      'application/vnd.apple.mpegurl',
      'application/x-mpegURL',
    ]),
    mp4: buildSupportProbe(video, 'mp4', 'MP4 container', ['video/mp4']),
    mp4H264Aac: buildSupportProbe(video, 'mp4-h264-aac', 'MP4 H.264 + AAC', ['video/mp4; codecs="avc1.42E01E, mp4a.40.2"']),
    mp4HevcAac: buildSupportProbe(video, 'mp4-hevc-aac', 'MP4 HEVC + AAC', ['video/mp4; codecs="hvc1.1.6.L93.B0, mp4a.40.2"']),
    mp4Av1Aac: buildSupportProbe(video, 'mp4-av1-aac', 'MP4 AV1 + AAC', ['video/mp4; codecs="av01.0.05M.08, mp4a.40.2"']),
    webm: buildSupportProbe(video, 'webm', 'WebM container', ['video/webm']),
    webmVp9Opus: buildSupportProbe(video, 'webm-vp9-opus', 'WebM VP9 + Opus', ['video/webm; codecs="vp9, opus"']),
    webmVp8Vorbis: buildSupportProbe(video, 'webm-vp8-vorbis', 'WebM VP8 + Vorbis', ['video/webm; codecs="vp8, vorbis"']),
  };
}

export function detectVideoSourceKind(url: string): VideoSourceKind {
  const normalized = url.trim().toLowerCase();
  if (!normalized) return 'unknown';

  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.endsWith('.m3u8') || pathname.includes('/playlist')) return 'hls';
    if (pathname.endsWith('.mp4') || pathname.endsWith('.m4v') || pathname.endsWith('.mov')) return 'mp4';
    if (pathname.endsWith('.webm')) return 'webm';
  } catch {
    if (normalized.includes('.m3u8')) return 'hls';
    if (normalized.includes('.mp4') || normalized.includes('.m4v') || normalized.includes('.mov')) return 'mp4';
    if (normalized.includes('.webm')) return 'webm';
  }

  if (normalized.includes('video.bsky.app')) return 'hls';
  return 'unknown';
}

export function getLikelySourceSupport(
  capabilities: VideoPlaybackCapabilities,
  sourceKind: VideoSourceKind,
): boolean | null {
  if (sourceKind === 'hls') return capabilities.hls.supported;
  if (sourceKind === 'mp4') return capabilities.mp4.supported;
  if (sourceKind === 'webm') return capabilities.webm.supported;
  return null;
}

export function describeSupportLevel(level: SupportLevel): string {
  if (level === 'probably') return 'Yes';
  if (level === 'maybe') return 'Maybe';
  return 'No';
}

export function describeSourceKind(sourceKind: VideoSourceKind): string {
  if (sourceKind === 'hls') return 'HLS stream';
  if (sourceKind === 'mp4') return 'MP4 file';
  if (sourceKind === 'webm') return 'WebM file';
  return 'Unknown source';
}

export function getLikelyUnsupportedReason(
  capabilities: VideoPlaybackCapabilities,
  sourceKind: VideoSourceKind,
): string | null {
  if (sourceKind === 'hls' && !capabilities.hls.supported) {
    return 'This browser reports no native HLS support for the current video source.';
  }
  if (sourceKind === 'mp4' && !capabilities.mp4.supported) {
    return 'This browser reports no MP4 container support for the current video source.';
  }
  if (sourceKind === 'webm' && !capabilities.webm.supported) {
    return 'This browser reports no WebM container support for the current video source.';
  }
  return null;
}

