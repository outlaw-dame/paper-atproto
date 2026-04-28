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

import { verificationRouter } from '../../server/src/routes/verification.js';

describe('verificationRouter /api/verify/evidence', () => {
  beforeEach(() => {
    mockVerifyEvidence.mockReset();
    mockCheckUrlAgainstSafeBrowsing.mockReset();
    mockCheckUrlAgainstSafeBrowsing.mockImplementation(async (url: string) => ({
      url,
      checked: true,
      status: 'safe',
      safe: true,
      blocked: false,
      threats: NO_THREATS,
    }));
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
});
