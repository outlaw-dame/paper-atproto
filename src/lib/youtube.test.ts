import { describe, expect, it } from 'vitest';
import {
  buildYouTubeThumbnailUrl,
  extractFirstYouTubeReference,
  extractUrlsFromText,
  parseYouTubeUrl,
} from './youtube';

describe('parseYouTubeUrl', () => {
  it('parses standard watch URLs', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({
      kind: 'video',
      videoId: 'dQw4w9WgXcQ',
      normalizedUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
  });

  it('parses short links and start times', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=43')).toMatchObject({
      kind: 'video',
      videoId: 'dQw4w9WgXcQ',
      startSeconds: 43,
      normalizedUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43s',
    });
  });

  it('parses shorts URLs', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/shorts/abc123XYZ09')).toMatchObject({
      kind: 'short',
      videoId: 'abc123XYZ09',
    });
  });

  it('parses playlist URLs without a direct video id', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/playlist?list=PL1234567890')).toMatchObject({
      kind: 'playlist',
      playlistId: 'PL1234567890',
      normalizedUrl: 'https://www.youtube.com/playlist?list=PL1234567890',
    });
  });

  it('rejects non-youtube URLs', () => {
    expect(parseYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
});

describe('extractUrlsFromText', () => {
  it('extracts hrefs and plain urls without trailing punctuation', () => {
    expect(extractUrlsFromText(
      '<p><a href="https://youtu.be/dQw4w9WgXcQ">watch</a> https://www.youtube.com/watch?v=abc123XYZ09.</p>',
    )).toEqual([
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=abc123XYZ09',
    ]);
  });
});

describe('extractFirstYouTubeReference', () => {
  it('prefers explicit urls and falls back to text extraction', () => {
    expect(extractFirstYouTubeReference({
      explicitUrls: ['https://example.com/post', 'https://youtu.be/dQw4w9WgXcQ'],
      text: 'Also mirrored at https://www.youtube.com/watch?v=abc123XYZ09',
    })?.videoId).toBe('dQw4w9WgXcQ');

    expect(extractFirstYouTubeReference({
      text: 'Watch this: https://www.youtube.com/watch?v=abc123XYZ09',
    })?.videoId).toBe('abc123XYZ09');
  });
});

describe('buildYouTubeThumbnailUrl', () => {
  it('builds a predictable thumbnail path', () => {
    expect(buildYouTubeThumbnailUrl('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });
});
