/**
 * Podcast transcript parser for Podcasting 2.0 transcript formats.
 * Supports: Podcast Index JSON, WebVTT, SRT, and plain text.
 *
 * Spec: https://github.com/Podcastindex-org/podcast-namespace/blob/main/transcripts/transcripts.md
 */

export interface TranscriptSegment {
  startTime: number;
  endTime: number | null;
  text: string;
  speaker?: string;
}

export type TranscriptFormat = 'json' | 'vtt' | 'srt' | 'text';

const MAX_RAW_SEGMENTS = 1_000;
const MAX_MERGED_SEGMENTS = 500;
const MIN_SEGMENT_TEXT_LENGTH = 10;
const MERGE_WINDOW_SECONDS = 30;

export function detectTranscriptFormat(
  contentType: string,
  url: string,
  content: string,
): TranscriptFormat {
  const ct = (contentType.toLowerCase().split(';')[0] ?? '').trim();
  if (ct === 'application/json' || ct.includes('json')) return 'json';
  if (ct === 'text/vtt') return 'vtt';
  if (ct === 'application/x-subrip' || ct.includes('srt')) return 'srt';

  const urlLower = url.toLowerCase().split('?')[0] ?? '';
  if (urlLower.endsWith('.json')) return 'json';
  if (urlLower.endsWith('.vtt')) return 'vtt';
  if (urlLower.endsWith('.srt')) return 'srt';

  const trimmed = content.trimStart().slice(0, 300);
  if (trimmed.startsWith('WEBVTT') || trimmed.toLowerCase().startsWith('webvtt')) return 'vtt';
  if (/^1\r?\n\d{2}:\d{2}:\d{2},\d{3}/.test(trimmed)) return 'srt';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';

  return 'text';
}

function parseTimeString(raw: string): number {
  // Handles: HH:MM:SS.mmm, MM:SS.mmm, HH:MM:SS,mmm (SRT uses comma)
  const normalized = raw.replace(',', '.');
  const parts = normalized.split(':');
  let seconds = 0;
  for (let i = 0; i < parts.length; i++) {
    seconds = seconds * 60 + parseFloat(parts[i] ?? '0');
  }
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
}

function mergeAdjacentSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length === 0) return segments;

  const merged: TranscriptSegment[] = [];
  let current: TranscriptSegment = { ...segments[0]! };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]!;
    const windowEnd = current.startTime + MERGE_WINDOW_SECONDS;
    const sameSpeaker = current.speaker === seg.speaker;

    // Merge short segments or consecutive same-speaker segments within the window
    if (
      current.text.length < MIN_SEGMENT_TEXT_LENGTH
      || (seg.startTime <= windowEnd && sameSpeaker)
    ) {
      const mergedSegment: TranscriptSegment = {
        startTime: current.startTime,
        endTime: seg.endTime,
        text: `${current.text} ${seg.text}`.trim(),
      };
      if (current.speaker) {
        mergedSegment.speaker = current.speaker;
      }
      current = mergedSegment;
    } else {
      if (current.text.trim().length >= MIN_SEGMENT_TEXT_LENGTH) {
        merged.push(current);
      }
      current = { ...seg };
    }
  }

  if (current.text.trim().length >= MIN_SEGMENT_TEXT_LENGTH) {
    merged.push(current);
  }

  return merged;
}

export function parseJsonTranscript(content: string): TranscriptSegment[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }

  const rawList: unknown[] = Array.isArray((data as any)?.segments)
    ? (data as any).segments
    : Array.isArray(data)
      ? (data as unknown[])
      : [];

  const segments: TranscriptSegment[] = [];

  for (const seg of rawList.slice(0, MAX_RAW_SEGMENTS)) {
    const raw = seg as Record<string, unknown>;
    const startTime = Number(raw?.startTime ?? raw?.start ?? 0);
    if (!Number.isFinite(startTime) || startTime < 0) continue;

    const rawEnd = raw?.endTime ?? raw?.end;
    const endTime = rawEnd != null && Number.isFinite(Number(rawEnd)) ? Number(rawEnd) : null;

    const text = String(raw?.body ?? raw?.text ?? raw?.transcript ?? '').trim();
    if (text.length < MIN_SEGMENT_TEXT_LENGTH) continue;

    const speaker =
      typeof raw?.speaker === 'string' && raw.speaker.trim()
        ? raw.speaker.trim()
        : undefined;

    const nextSegment: TranscriptSegment = { startTime, endTime, text };
    if (speaker) {
      nextSegment.speaker = speaker;
    }
    segments.push(nextSegment);
  }

  return mergeAdjacentSegments(segments).slice(0, MAX_MERGED_SEGMENTS);
}

export function parseVttTranscript(content: string): TranscriptSegment[] {
  const lines = content.split(/\r?\n/);
  const segments: TranscriptSegment[] = [];

  let startTime: number | null = null;
  let endTime: number | null = null;
  let speaker: string | undefined;
  const textLines: string[] = [];

  const timeArrowRe = /^(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{2}:\d{2}[.,]\d{1,3})\s+-->\s+(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{2}:\d{2}[.,]\d{1,3})/;

  const flushCue = () => {
    if (startTime !== null && textLines.length > 0) {
      let rawText = textLines.join(' ');
      // Extract <v Speaker> voice tag and strip all other VTT tags
      const voiceMatch = /<v\s+([^>]+)>/.exec(rawText);
      if (voiceMatch) {
        speaker = voiceMatch[1]!.trim();
      }
      rawText = rawText.replace(/<[^>]+>/g, '').trim();
      if (rawText.length >= MIN_SEGMENT_TEXT_LENGTH) {
        const nextSegment: TranscriptSegment = { startTime, endTime, text: rawText };
        if (speaker) {
          nextSegment.speaker = speaker;
        }
        segments.push(nextSegment);
      }
    }
    startTime = null;
    endTime = null;
    speaker = undefined;
    textLines.length = 0;
  };

  let rawCount = 0;
  for (const line of lines) {
    if (rawCount >= MAX_RAW_SEGMENTS) break;

    if (timeArrowRe.test(line)) {
      flushCue();
      rawCount++;
      const match = timeArrowRe.exec(line);
      if (match) {
        startTime = parseTimeString(match[1]!);
        endTime = parseTimeString(match[2]!);
      }
    } else if (startTime !== null && line.trim()) {
      textLines.push(line.trim());
    } else if (!line.trim() && startTime !== null) {
      flushCue();
    }
  }
  flushCue();

  return mergeAdjacentSegments(segments).slice(0, MAX_MERGED_SEGMENTS);
}

export function parseSrtTranscript(content: string): TranscriptSegment[] {
  const blocks = content.split(/\r?\n\r?\n/);
  const segments: TranscriptSegment[] = [];
  const timeArrowRe = /(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/;

  for (const block of blocks.slice(0, MAX_RAW_SEGMENTS)) {
    const lines = block.trim().split(/\r?\n/);
    let timeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (timeArrowRe.test(lines[i] ?? '')) {
        timeLineIdx = i;
        break;
      }
    }
    if (timeLineIdx < 0) continue;

    const match = timeArrowRe.exec(lines[timeLineIdx] ?? '');
    if (!match) continue;

    const startTime = parseTimeString(match[1]!);
    const endTime = parseTimeString(match[2]!);
    // Strip HTML tags from SRT text (some encoders include them)
    const text = lines
      .slice(timeLineIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();

    if (text.length >= MIN_SEGMENT_TEXT_LENGTH && Number.isFinite(startTime)) {
      segments.push({
        startTime,
        endTime: Number.isFinite(endTime) ? endTime : null,
        text,
      });
    }
  }

  return mergeAdjacentSegments(segments).slice(0, MAX_MERGED_SEGMENTS);
}

export function parsePlainTextTranscript(content: string): TranscriptSegment[] {
  // Split on blank lines into paragraphs; timestamps are unknown so startTime=0
  // These segments are still searchable by text, but can't be seeked
  const paragraphs = content
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter((p) => p.length >= MIN_SEGMENT_TEXT_LENGTH)
    .slice(0, MAX_MERGED_SEGMENTS);

  return paragraphs.map((text) => ({
    startTime: 0,
    endTime: null,
    text,
  }));
}

export function parseTranscript(
  content: string,
  format: TranscriptFormat,
): TranscriptSegment[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  switch (format) {
    case 'json': return parseJsonTranscript(trimmed);
    case 'vtt': return parseVttTranscript(trimmed);
    case 'srt': return parseSrtTranscript(trimmed);
    case 'text': return parsePlainTextTranscript(trimmed);
  }
}
