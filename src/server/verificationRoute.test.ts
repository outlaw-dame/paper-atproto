import { beforeEach, describe, expect, it, vi } from 'vitest';

type ThreatEntry = {
  threatType: string;
  platformType: string;
  threatEntryType: string;
  url: string;
};

const NO_THREATS: ThreatEntry[] = [];

const {
  envMock,
  mockVerifyEvidence,
  mockCheckUrlAgainstSafeBrowsing,
  mockFactCheckSearchClaims,
  mockFactCheckImageSearch,
  mockGroundClaim,
  mockVerifyImage,
} = vi.hoisted(() => ({
  envMock: {
    VERIFY_SHARED_SECRET: undefined,
    VERIFY_API_ENABLED: true,
    VERIFY_ENTITY_LINKING_PROVIDER: 'heuristic',
    VERIFY_ENTITY_LINKING_ENDPOINT: 'https://example.com/entity-linking',
    VERIFY_WIKIDATA_ENDPOINT: 'https://example.com/wikidata',
    VERIFY_ENTITY_LINKING_TIMEOUT_MS: 5000,
    VERIFY_ENTITY_LINKING_DEBUG: false,
    VERIFY_GEMINI_GROUNDING_ENABLED: false,
    VERIFY_MAX_TEXT_CHARS: 1500,
    VERIFY_MAX_URLS: 8,
    VERIFY_TIMEOUT_MS: 12000,
    VERIFY_RETRY_ATTEMPTS: 3,
    AI_SAFE_BROWSING_FAIL_CLOSED: false,
    GOOGLE_FACT_CHECK_API_KEY: 'fact-check-key',
    GOOGLE_SAFE_BROWSING_API_KEY: 'safe-browsing-key',
  },
  mockVerifyEvidence: vi.fn(),
  mockCheckUrlAgainstSafeBrowsing: vi.fn(async (url: string) => ({
    url,
    checked: true,
    status: 'safe',
    safe: true,
    blocked: false,
    threats: NO_THREATS,
  })),
  mockFactCheckSearchClaims: vi.fn(),
  mockFactCheckImageSearch: vi.fn(),
  mockGroundClaim: vi.fn(),
  mockVerifyImage: vi.fn(),
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: envMock,
}));

vi.mock('../../server/src/verification/verify-evidence.js', () => ({
  verifyEvidence: mockVerifyEvidence,
}));

vi.mock('../../server/src/verification/entity-linking.provider.js', () => ({
  getEntityLinkingTelemetry: vi.fn(() => ({})),
  resetEntityLinkingTelemetry: vi.fn(),
}));

vi.mock('../../server/src/services/safeBrowsing.js', () => ({
  checkUrlAgainstSafeBrowsing: mockCheckUrlAgainstSafeBrowsing,
  shouldBlockSafeBrowsingVerdict: (verdict: {
    blocked: boolean;
    status: 'safe' | 'unsafe' | 'unknown';
  }) => verdict.blocked || (envMock.AI_SAFE_BROWSING_FAIL_CLOSED && verdict.status === 'unknown'),
}));

vi.mock('../../server/src/verification/google-fact-check.provider.js', () => ({
  GoogleFactCheckProvider: vi.fn(function () {
    return {
      searchClaims: mockFactCheckSearchClaims,
      imageSearch: mockFactCheckImageSearch,
    };
  }),
}));

vi.mock('../../server/src/verification/gemini-grounding.provider.js', () => ({
  GeminiGroundingProvider: vi.fn(function () {
    return {
      groundClaim: mockGroundClaim,
    };
  }),
}));

vi.mock('../../server/src/verification/google-vision-media.provider.js', () => ({
  GoogleVisionMediaProvider: vi.fn(function () {
    return {
      verifyImage: mockVerifyImage,
    };
  }),
}));

import { verificationRouter } from '../../server/src/routes/verification.js';

describe('verificationRouter /api/verify/evidence', () => {
  beforeEach(() => {
    mockVerifyEvidence.mockReset();
    mockCheckUrlAgainstSafeBrowsing.mockReset();
    mockFactCheckSearchClaims.mockReset();
    mockFactCheckImageSearch.mockReset();
    mockGroundClaim.mockReset();
    mockVerifyImage.mockReset();
    mockCheckUrlAgainstSafeBrowsing.mockImplementation(async (url: string) => ({
      url,
      checked: true,
      status: 'safe',
      safe: true,
      blocked: false,
      threats: NO_THREATS,
    }));
    mockFactCheckSearchClaims.mockResolvedValue([]);
    mockFactCheckImageSearch.mockResolvedValue([]);
    mockGroundClaim.mockResolvedValue({
      summary: null,
      sources: [],
      corroborationLevel: 0,
      contradictionLevel: 0,
      quoteFidelity: 0,
      contextValue: 0,
      correctionValue: 0,
    });
    mockVerifyImage.mockResolvedValue({
      bestGuessLabels: [],
      webEntities: [],
      pagesWithMatchingImages: [],
      fullMatchingImages: [],
      mediaContextConfidence: 0,
      mismatchRisk: 0,
    });
  });

  it('sanitizes evidence URLs and drops blocked image URLs before verification', async () => {
    mockCheckUrlAgainstSafeBrowsing.mockImplementation(async (url: string) => {
      if (url.includes('blocked.example')) {
        return {
          url,
          checked: true,
          status: 'unsafe' as const,
          safe: false,
          blocked: true,
          threats: [{
            threatType: 'SOCIAL_ENGINEERING',
            platformType: 'ANY_PLATFORM',
            threatEntryType: 'URL',
            url,
          }],
        };
      }

      return {
        url,
        checked: true,
        status: 'safe' as const,
        safe: true,
        blocked: false,
        threats: NO_THREATS,
      };
    });
    mockVerifyEvidence.mockResolvedValueOnce({
      claimType: 'factual_assertion',
      extractedClaim: 'Claim text',
      knownFactCheckMatch: false,
      factCheckMatches: [],
      sourcePresence: 0,
      sourceType: 'none',
      citedUrls: [],
      quoteFidelity: 0,
      corroborationLevel: 0,
      contradictionLevel: 0,
      mediaContextConfidence: 0,
      entityGrounding: 0,
      contextValue: 0,
      correctionValue: 0,
      checkability: 0,
      specificity: 0,
      factualContributionScore: 0,
      factualConfidence: 0,
      factualState: 'unsupported_so_far',
      reasons: [],
    });

    const response = await verificationRouter.request('/evidence', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Claim text',
        urls: ['https://example.com/story?utm_source=test#section'],
        imageUrls: [
          'https://safe.example/image.png?utm_campaign=x',
          'https://blocked.example/malware.png',
          'http://127.0.0.1/private.png',
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(mockVerifyEvidence).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Claim text',
      urls: ['https://example.com/story'],
      imageUrls: ['https://safe.example/image.png'],
    }));
  });

  it('routes text claims to Google Fact Check without using Safe Browsing as factual evidence', async () => {
    mockFactCheckSearchClaims.mockResolvedValueOnce([{
      claimText: 'A test claim was checked.',
      reviewUrl: 'https://factcheck.example/review',
      reviewTitle: 'Review of the test claim',
      publisherName: 'Example Fact Check',
      textualRating: 'False',
      languageCode: 'en',
      matchConfidence: 0.93,
    }]);

    const response = await verificationRouter.request('/fact-check', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        request: {
          postUri: 'at://did:example:alice/app.bsky.feed.post/1',
          text: 'A test claim was checked.',
          locale: 'en-US',
        },
        claims: [{
          text: 'A test claim was checked.',
          claimType: 'factual_assertion',
          checkability: 0.85,
        }],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      matched: boolean;
      hits: Array<{ url: string; publisher?: string; textualRating?: string; matchConfidence: number }>;
    };

    expect(body.matched).toBe(true);
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0]).toMatchObject({
      url: 'https://factcheck.example/review',
      publisher: 'Example Fact Check',
      textualRating: 'False',
      matchConfidence: 0.93,
    });
    expect(mockFactCheckSearchClaims).toHaveBeenCalledWith('A test claim was checked.', 'en-US', 10);
    expect(mockFactCheckImageSearch).not.toHaveBeenCalled();
    expect(mockCheckUrlAgainstSafeBrowsing).not.toHaveBeenCalled();
  });

  it('uses Safe Browsing only to preflight media URLs before image fact-check search', async () => {
    mockCheckUrlAgainstSafeBrowsing.mockImplementation(async (url: string) => {
      if (url.includes('blocked.example')) {
        return {
          url,
          checked: true,
          status: 'unsafe' as const,
          safe: false,
          blocked: true,
          threats: [{
            threatType: 'SOCIAL_ENGINEERING',
            platformType: 'ANY_PLATFORM',
            threatEntryType: 'URL',
            url,
          }],
        };
      }

      return {
        url,
        checked: true,
        status: 'safe' as const,
        safe: true,
        blocked: false,
        threats: NO_THREATS,
      };
    });
    mockFactCheckImageSearch.mockResolvedValueOnce([{
      claimText: 'A reused image claim.',
      reviewUrl: 'https://factcheck.example/image-review',
      publisherName: 'Image Fact Check',
      matchConfidence: 0.85,
    }]);

    const response = await verificationRouter.request('/fact-check', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        request: {
          text: 'This image shows a current event.',
          media: [
            { url: 'https://safe.example/image.png?utm_source=test' },
            { url: 'https://blocked.example/image.png' },
          ],
        },
        claims: [],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      matched: boolean;
      hits: Array<{ url: string; publisher?: string; matchConfidence: number }>;
    };

    expect(body.matched).toBe(true);
    expect(body.hits[0]).toEqual({
      url: 'https://factcheck.example/image-review',
      publisher: 'Image Fact Check',
      matchConfidence: 0.85,
    });
    expect(mockCheckUrlAgainstSafeBrowsing).toHaveBeenCalledTimes(2);
    expect(mockFactCheckImageSearch).toHaveBeenCalledWith('https://safe.example/image.png', 'en', 10);
    expect(mockFactCheckImageSearch).toHaveBeenCalledTimes(1);
  });
});
