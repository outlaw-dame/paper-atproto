import { describe, expect, it, vi } from 'vitest';
import {
  extractMediaSignals,
  extractMediaSignalsFromJson,
  getMediaBoostFactor,
} from './extractMediaSignals';

describe('extractMediaSignals', () => {
  it('captures nested record-with-media images, video, and linked targets', () => {
    const signals = extractMediaSignals({
      $type: 'app.bsky.embed.recordWithMedia',
      record: {
        uri: 'at://did:plc:quoted/app.bsky.feed.post/123',
      },
      media: {
        images: [
          { alt: 'Dashboard screenshot' },
          { alt: 'Engagement chart' },
        ],
        video: {
          video: { mimeType: 'video/mp4' },
        },
        external: {
          uri: 'https://example.com/report',
        },
      },
    });

    expect(signals).toEqual({
      hasImages: true,
      hasVideo: true,
      hasLink: true,
      imageAltText: 'Dashboard screenshot | Engagement chart',
      imageCount: 2,
    });
  });

  it('returns safe defaults when embed JSON is malformed', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(extractMediaSignalsFromJson('{not-json')).toEqual({
      hasImages: false,
      hasVideo: false,
      hasLink: false,
      imageAltText: '',
      imageCount: 0,
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('applies a bounded visual boost when media matches query intent', () => {
    const boost = getMediaBoostFactor({
      hasImages: true,
      hasVideo: true,
      hasLink: true,
      imageAltText: 'Annotated screenshot',
      imageCount: 3,
    }, true);

    expect(boost).toBeGreaterThan(1);
    expect(boost).toBeLessThanOrEqual(1.28);
  });
});
