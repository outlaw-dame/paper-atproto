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
  mockRunMediaAnalyzer,
  mockCheckUrlAgainstSafeBrowsing,
  mockLogSafetyFlag,
} = vi.hoisted(() => ({
  envMock: {
    LLM_ENABLED: true,
    AI_SAFE_BROWSING_FAIL_CLOSED: false,
  },
  mockRunMediaAnalyzer: vi.fn(),
  mockCheckUrlAgainstSafeBrowsing: vi.fn(async (url: string) => ({
    url,
    checked: true,
    status: 'safe',
    safe: true,
    blocked: false,
    threats: NO_THREATS,
  })),
  mockLogSafetyFlag: vi.fn(),
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: envMock,
}));

vi.mock('../../server/src/services/qwenWriter.js', () => ({
  runInterpolatorWriter: vi.fn(),
}));

vi.mock('../../server/src/services/qwenMultimodal.js', () => ({
  runMediaAnalyzer: mockRunMediaAnalyzer,
}));

vi.mock('../../server/src/services/qwenComposerGuidanceWriter.js', () => ({
  runComposerGuidanceWriter: vi.fn(),
}));

vi.mock('../../server/src/services/safeBrowsing.js', () => ({
  checkUrlAgainstSafeBrowsing: mockCheckUrlAgainstSafeBrowsing,
  shouldBlockSafeBrowsingVerdict: (verdict: {
    blocked: boolean;
    status: 'safe' | 'unsafe' | 'unknown';
  }) => verdict.blocked || (envMock.AI_SAFE_BROWSING_FAIL_CLOSED && verdict.status === 'unknown'),
}));

vi.mock('../../server/src/services/safetyFilters.js', () => ({
  filterWriterResponse: (response: unknown) => ({
    filtered: response,
    safetyMetadata: {
      passed: true,
      flagged: false,
      categories: [],
      severity: 'none',
      filtered: '',
    },
  }),
  filterMediaAnalyzerResponse: (response: unknown) => ({
    filtered: response,
    safetyMetadata: {
      passed: true,
      flagged: false,
      categories: [],
      severity: 'none',
      filtered: '',
    },
  }),
  filterComposerGuidanceResponse: (response: unknown) => ({
    filtered: response,
    safetyMetadata: {
      passed: true,
      flagged: false,
      categories: [],
      severity: 'none',
      filtered: '',
    },
  }),
  logSafetyFlag: mockLogSafetyFlag,
}));

import { llmRouter } from '../../server/src/routes/llm.js';

describe('llmRouter /api/llm/analyze/media Safe Browsing', () => {
  beforeEach(() => {
    envMock.LLM_ENABLED = true;
    envMock.AI_SAFE_BROWSING_FAIL_CLOSED = false;
    mockRunMediaAnalyzer.mockReset();
    mockCheckUrlAgainstSafeBrowsing.mockReset();
    mockLogSafetyFlag.mockReset();
    mockCheckUrlAgainstSafeBrowsing.mockImplementation(async (url: string) => ({
      url,
      checked: true,
      status: 'safe',
      safe: true,
      blocked: false,
      threats: NO_THREATS,
    }));
  });

  it('rejects media URLs blocked by Safe Browsing before analyzer execution', async () => {
    mockCheckUrlAgainstSafeBrowsing.mockImplementationOnce(async (url: string) => ({
      url,
      checked: true,
      status: 'unsafe',
      safe: false,
      blocked: true,
      reason: 'URL matched one or more Safe Browsing threat lists.',
      threats: [{
        threatType: 'MALWARE',
        platformType: 'ANY_PLATFORM',
        threatEntryType: 'URL',
        url,
      }],
    }));

    const response = await llmRouter.request('/analyze/media', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        threadId: 'thread-1',
        mediaUrl: 'https://blocked.example/image.png',
        nearbyText: 'caption text',
        candidateEntities: ['Agency'],
        factualHints: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'URL matched one or more Safe Browsing threat lists.',
    });
    expect(mockRunMediaAnalyzer).not.toHaveBeenCalled();
  });

  it('allows safe media URLs through to the analyzer', async () => {
    mockRunMediaAnalyzer.mockResolvedValueOnce({
      mediaCentrality: 0.8,
      mediaType: 'document',
      mediaSummary: 'A policy memo screenshot.',
      candidateEntities: ['Agency'],
      confidence: 0.9,
      cautionFlags: [],
    });

    const response = await llmRouter.request('/analyze/media', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        threadId: 'thread-1',
        mediaUrl: 'https://safe.example/image.png',
        nearbyText: 'caption text',
        candidateEntities: ['Agency'],
        factualHints: [],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mediaCentrality: 0.8,
      mediaType: 'document',
      mediaSummary: 'A policy memo screenshot.',
      candidateEntities: ['Agency'],
      confidence: 0.9,
      cautionFlags: [],
    });
    expect(mockCheckUrlAgainstSafeBrowsing).toHaveBeenCalledWith('https://safe.example/image.png');
    expect(mockRunMediaAnalyzer).toHaveBeenCalledTimes(1);
  });
});
