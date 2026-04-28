import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  envMock,
  mockRunComposerGuidanceWriter,
  mockFilterComposerGuidanceResponse,
  mockLogSafetyFlag,
} = vi.hoisted(() => ({
  envMock: {
    LLM_ENABLED: true,
  },
  mockRunComposerGuidanceWriter: vi.fn(),
  mockFilterComposerGuidanceResponse: vi.fn((response: unknown) => ({
    filtered: response,
    safetyMetadata: {
      passed: true,
      flagged: false,
      categories: [] as string[],
      severity: 'none',
      filtered: '',
    },
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
  runMediaAnalyzer: vi.fn(),
}));

vi.mock('../../server/src/services/qwenComposerGuidanceWriter.js', () => ({
  runComposerGuidanceWriter: mockRunComposerGuidanceWriter,
}));

vi.mock('../../server/src/services/safeBrowsing.js', () => ({
  checkUrlAgainstSafeBrowsing: vi.fn(),
  shouldBlockSafeBrowsingVerdict: vi.fn(() => false),
}));

vi.mock('../../server/src/services/safetyFilters.js', () => ({
  filterWriterResponse: vi.fn(),
  filterMediaAnalyzerResponse: vi.fn(),
  filterComposerGuidanceResponse: mockFilterComposerGuidanceResponse,
  logSafetyFlag: mockLogSafetyFlag,
}));

import { llmRouter } from '../../server/src/routes/llm.js';

describe('llmRouter /api/llm/write/composer-guidance', () => {
  beforeEach(() => {
    envMock.LLM_ENABLED = true;
    mockRunComposerGuidanceWriter.mockReset();
    mockFilterComposerGuidanceResponse.mockReset();
    mockLogSafetyFlag.mockReset();
    mockFilterComposerGuidanceResponse.mockImplementation((response: unknown) => ({
      filtered: response,
      safetyMetadata: {
        passed: true,
        flagged: false,
        categories: [] as string[],
        severity: 'none',
        filtered: '',
      },
    }));
  });

  it('returns the filtered composer-guidance payload', async () => {
    mockRunComposerGuidanceWriter.mockResolvedValueOnce({
      message: 'Original guidance',
      suggestion: 'Original suggestion',
      badges: ['Clarity'],
    });
    mockFilterComposerGuidanceResponse.mockReturnValueOnce({
      filtered: {
        message: 'Filtered guidance',
        suggestion: 'Filtered suggestion',
        badges: ['Clarity'],
      },
      safetyMetadata: {
        passed: true,
        flagged: true,
        categories: ['sexual_content'],
        severity: 'medium',
        filtered: 'Filtered guidance',
      },
    });

    const response = await llmRouter.request('/write/composer-guidance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'reply',
        draftText: 'Draft text',
        uiState: 'caution',
        scores: {
          positiveSignal: 0.1,
          negativeSignal: 0.8,
          supportiveness: 0.2,
          constructiveness: 0.5,
          clarifying: 0.2,
          hostility: 0.4,
          dismissiveness: 0.3,
          escalation: 0.3,
          sentimentPositive: 0.1,
          sentimentNegative: 0.8,
          anger: 0.4,
          trust: 0.2,
          optimism: 0.1,
          targetedNegativity: 0.2,
          toxicity: 0.1,
        },
        constructiveSignals: ['Add context'],
        supportiveSignals: [],
        parentSignals: [],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: 'Filtered guidance',
      suggestion: 'Filtered suggestion',
      badges: ['Clarity'],
    });
    expect(mockFilterComposerGuidanceResponse).toHaveBeenCalledTimes(1);
    expect(mockLogSafetyFlag).toHaveBeenCalledWith(
      '[llm/write/composer-guidance]',
      expect.objectContaining({
        passed: true,
        flagged: true,
      }),
    );
  });

  it('fails closed when the filtered guidance is unsafe', async () => {
    mockRunComposerGuidanceWriter.mockResolvedValueOnce({
      message: 'Unsafe guidance',
      badges: [],
    });
    mockFilterComposerGuidanceResponse.mockReturnValueOnce({
      filtered: {
        message: '',
        badges: [],
      },
      safetyMetadata: {
        passed: false,
        flagged: true,
        categories: ['hate_speech'],
        severity: 'high',
        filtered: '',
      },
    });

    const response = await llmRouter.request('/write/composer-guidance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'post',
        draftText: 'Draft text',
        uiState: 'warning',
        scores: {
          positiveSignal: 0.1,
          negativeSignal: 0.8,
          supportiveness: 0.2,
          constructiveness: 0.5,
          clarifying: 0.2,
          hostility: 0.4,
          dismissiveness: 0.3,
          escalation: 0.3,
          sentimentPositive: 0.1,
          sentimentNegative: 0.8,
          anger: 0.4,
          trust: 0.2,
          optimism: 0.1,
          targetedNegativity: 0.2,
          toxicity: 0.1,
        },
        constructiveSignals: ['Add context'],
        supportiveSignals: [],
        parentSignals: [],
      }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Composer guidance writer failed',
    });
  });
});
