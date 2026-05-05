import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordMultimodalFallback,
  recordMultimodalRejection,
  recordMultimodalSuccess,
  resetMultimodalDiagnostics,
} from '../../server/src/llm/multimodalDiagnostics.js';

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
  mockRunGeminiMediaAnalyzer,
  mockCheckUrlAgainstSafeBrowsing,
  mockLogSafetyFlag,
} = vi.hoisted(() => ({
  envMock: {
    LLM_ENABLED: true,
    AI_SAFE_BROWSING_FAIL_CLOSED: false,
    GEMINI_API_KEY: 'test-gemini-key' as string | undefined,
  },
  mockRunMediaAnalyzer: vi.fn(),
  mockRunGeminiMediaAnalyzer: vi.fn(),
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

vi.mock('../../server/src/services/geminiMultimodal.js', () => ({
  runGeminiMediaAnalyzer: mockRunGeminiMediaAnalyzer,
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

async function readMultimodalDiagnostics() {
  const response = await llmRouter.request('/admin/diagnostics', {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });
  expect(response.status).toBe(200);
  const payload = await response.json() as {
    multimodal?: {
      invocations?: number;
      successes?: { total?: number };
      fallbacks?: { total?: number };
      rejections?: { total?: number };
    };
  };
  return payload.multimodal ?? {};
}

describe('llmRouter /api/llm/analyze/media Safe Browsing', () => {
  beforeEach(async () => {
    envMock.LLM_ENABLED = true;
    envMock.AI_SAFE_BROWSING_FAIL_CLOSED = false;
    envMock.GEMINI_API_KEY = 'test-gemini-key';
    mockRunMediaAnalyzer.mockReset();
    mockRunGeminiMediaAnalyzer.mockReset();
    mockCheckUrlAgainstSafeBrowsing.mockReset();
    mockLogSafetyFlag.mockReset();
    resetMultimodalDiagnostics();
    await llmRouter.request('/admin/diagnostics', { method: 'DELETE' });
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

    recordMultimodalRejection({
      stage: 'fetch',
      latencyMs: 10,
      reason: 'validation-error',
      message: 'Media URL blocked by Google Safe Browsing.',
    });
    const diagnostics = await readMultimodalDiagnostics();
    expect(diagnostics.rejections?.total).toBe(1);
    expect(diagnostics.fallbacks?.total ?? 0).toBe(0);
  });

  it('allows safe media URLs through to the analyzer', async () => {
    mockRunMediaAnalyzer.mockImplementationOnce(async () => {
      recordMultimodalSuccess({
        mediaType: 'document',
        moderationAction: 'none',
        confidence: 0.9,
        latencyMs: 180,
      });
      return {
      mediaCentrality: 0.8,
      mediaType: 'document',
      mediaSummary: 'A policy memo screenshot.',
      candidateEntities: ['Agency'],
      confidence: 0.9,
      cautionFlags: [],
      };
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

    const diagnostics = await readMultimodalDiagnostics();
    expect(diagnostics.successes?.total).toBe(1);
    expect(diagnostics.fallbacks?.total ?? 0).toBe(0);
    expect(diagnostics.rejections?.total ?? 0).toBe(0);
  });

  it('returns an explicit degraded media state when the analyzer throws', async () => {
    mockRunMediaAnalyzer.mockImplementationOnce(async () => {
      recordMultimodalFallback({
        stage: 'model-call',
        latencyMs: 320,
        reason: 'Error',
        message: 'ollama down',
      });
      throw new Error('ollama down');
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
      mediaCentrality: 0.3,
      mediaType: 'unknown',
      mediaSummary: 'Media present — analysis unavailable.',
      candidateEntities: [],
      confidence: 0.15,
      cautionFlags: [],
      analysisStatus: 'degraded',
      moderationStatus: 'unavailable',
    });

    const diagnostics = await readMultimodalDiagnostics();
    expect(diagnostics.fallbacks?.total).toBe(1);
    expect(diagnostics.successes?.total ?? 0).toBe(0);
    expect(diagnostics.rejections?.total ?? 0).toBe(0);
  });

  it('returns 503 for premium media route when GEMINI_API_KEY is missing', async () => {
    envMock.GEMINI_API_KEY = undefined;

    const response = await llmRouter.request('/analyze/media/premium', {
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

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Premium media analysis unavailable',
    });
    expect(mockRunGeminiMediaAnalyzer).not.toHaveBeenCalled();
  });

  it('uses Gemini analyzer on premium media route for safe URLs', async () => {
    mockRunGeminiMediaAnalyzer.mockResolvedValueOnce({
      mediaCentrality: 0.77,
      mediaType: 'screenshot',
      mediaSummary: 'A screenshot of a timeline with revised dates.',
      candidateEntities: ['Timeline'],
      confidence: 0.88,
      cautionFlags: [],
    });

    const response = await llmRouter.request('/analyze/media/premium', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        threadId: 'thread-1',
        mediaUrl: 'https://safe.example/image.png',
        nearbyText: 'caption text',
        candidateEntities: ['Timeline'],
        factualHints: [],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mediaCentrality: 0.77,
      mediaType: 'screenshot',
      mediaSummary: 'A screenshot of a timeline with revised dates.',
      candidateEntities: ['Timeline'],
      confidence: 0.88,
      cautionFlags: [],
    });
    expect(mockCheckUrlAgainstSafeBrowsing).toHaveBeenCalledWith('https://safe.example/image.png');
    expect(mockRunGeminiMediaAnalyzer).toHaveBeenCalledTimes(1);
  });
});
