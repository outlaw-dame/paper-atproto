import { afterEach, describe, expect, it, vi } from 'vitest';

import { GoogleFactCheckProvider } from './google-fact-check.provider.js';

describe('GoogleFactCheckProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls claims:search with the text query, language, page size, and API key', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe('https://factchecktools.googleapis.com/v1alpha1/claims:search');
      expect(parsed.searchParams.get('query')).toBe('A checked text claim');
      expect(parsed.searchParams.get('languageCode')).toBe('en-US');
      expect(parsed.searchParams.get('pageSize')).toBe('5');
      expect(parsed.searchParams.get('key')).toBe('test-key');

      return {
        ok: true,
        json: vi.fn(async () => ({
          claims: [{
            text: 'A checked text claim',
            claimant: 'Claimant',
            claimReview: [{
              url: 'https://factcheck.example/review',
              title: 'Review title',
              publisher: { name: 'Example Fact Check', site: 'factcheck.example' },
              textualRating: 'False',
              languageCode: 'en',
              reviewDate: '2026-04-20',
            }],
          }],
        })),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleFactCheckProvider('test-key');
    const result = await provider.searchClaims('A checked text claim', 'en-US', 5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{
      claimText: 'A checked text claim',
      claimant: 'Claimant',
      reviewUrl: 'https://factcheck.example/review',
      reviewTitle: 'Review title',
      publisherName: 'Example Fact Check',
      publisherSite: 'factcheck.example',
      textualRating: 'False',
      languageCode: 'en',
      reviewDate: '2026-04-20',
      matchConfidence: 0.98,
    }]);
  });

  it('calls claims:imageSearch with a public image URL after caller-side safety preflight', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe('https://factchecktools.googleapis.com/v1alpha1/claims:imageSearch');
      expect(parsed.searchParams.get('imageUri')).toBe('https://images.example/photo.png');
      expect(parsed.searchParams.get('languageCode')).toBe('en');
      expect(parsed.searchParams.get('pageSize')).toBe('10');
      expect(parsed.searchParams.get('key')).toBe('test-key');

      return {
        ok: true,
        json: vi.fn(async () => ({
          results: [{
            claim: {
              text: 'A reused image claim',
              claimReview: [{
                url: 'https://factcheck.example/image-review',
                publisher: { name: 'Image Fact Check' },
              }],
            },
          }],
        })),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleFactCheckProvider('test-key');
    const result = await provider.imageSearch('https://images.example/photo.png');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{
      claimText: 'A reused image claim',
      reviewUrl: 'https://factcheck.example/image-review',
      publisherName: 'Image Fact Check',
      matchConfidence: 0.85,
    }]);
  });
});
