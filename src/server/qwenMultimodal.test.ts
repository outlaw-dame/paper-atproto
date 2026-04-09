import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ThreatEntry = {
  threatType: string;
  platformType: string;
  threatEntryType: string;
  url: string;
};

const NO_THREATS: ThreatEntry[] = [];

const { envMock, mockCheckUrlAgainstSafeBrowsing } = vi.hoisted(() => ({
  envMock: {
    OLLAMA_BASE_URL: 'http://localhost:11434',
    QWEN_MULTIMODAL_MODEL: 'qwen3-vl:4b-instruct-q4_K_M',
    LLM_TIMEOUT_MS: 30_000,
    LLM_MEDIA_FETCH_TIMEOUT_MS: 8_000,
    LLM_MEDIA_MAX_BYTES: 1024,
    LLM_MEDIA_MAX_REDIRECTS: 2,
    AI_SAFE_BROWSING_FAIL_CLOSED: false,
  },
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

vi.mock('../../server/src/services/safeBrowsing.js', () => ({
  checkUrlAgainstSafeBrowsing: mockCheckUrlAgainstSafeBrowsing,
  shouldBlockSafeBrowsingVerdict: (verdict: {
    blocked: boolean;
    status: 'safe' | 'unsafe' | 'unknown';
  }) => verdict.blocked || (envMock.AI_SAFE_BROWSING_FAIL_CLOSED && verdict.status === 'unknown'),
}));

import {
  runMediaAnalyzer,
  runMediaAnalyzerFromImageBase64,
} from '../../server/src/services/qwenMultimodal.js';

const baseRequest = {
  threadId: 'thread-1',
  mediaUrl: 'https://cdn.example.com/image.png',
  mediaAlt: 'policy screenshot',
  nearbyText: 'Nearby text about a document screenshot',
  candidateEntities: ['Agency'],
  factualHints: ['The screenshot is being discussed as a policy memo.'],
};

describe('runMediaAnalyzer hardening', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    mockCheckUrlAgainstSafeBrowsing.mockReset();
    envMock.AI_SAFE_BROWSING_FAIL_CLOSED = false;
    mockCheckUrlAgainstSafeBrowsing.mockImplementation(async (url: string) => ({
      url,
      checked: true,
      status: 'safe',
      safe: true,
      blocked: false,
      threats: NO_THREATS,
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects a media URL blocked by Safe Browsing before fetch', async () => {
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

    await expect(runMediaAnalyzer(baseRequest)).rejects.toMatchObject({
      message: 'URL matched one or more Safe Browsing threat lists.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unknown Safe Browsing verdicts when fail-closed is enabled', async () => {
    envMock.AI_SAFE_BROWSING_FAIL_CLOSED = true;
    mockCheckUrlAgainstSafeBrowsing.mockImplementationOnce(async (url: string) => ({
      url,
      checked: false,
      status: 'unknown',
      safe: true,
      blocked: false,
      reason: 'Safe Browsing request timed out.',
      threats: [],
    }));

    await expect(runMediaAnalyzer(baseRequest)).rejects.toMatchObject({
      message: 'Safe Browsing request timed out.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a redirect target blocked by Safe Browsing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: {
        location: 'https://blocked.example/private.png',
      },
    }));
    mockCheckUrlAgainstSafeBrowsing
      .mockImplementationOnce(async (url: string) => ({
        url,
        checked: true,
        status: 'safe',
        safe: true,
        blocked: false,
        threats: [],
      }))
      .mockImplementationOnce(async (url: string) => ({
        url,
        checked: true,
        status: 'unsafe',
        safe: false,
        blocked: true,
        reason: 'URL matched one or more Safe Browsing threat lists.',
        threats: [{
          threatType: 'SOCIAL_ENGINEERING',
          platformType: 'ANY_PLATFORM',
          threatEntryType: 'URL',
          url,
        }],
      }));

    await expect(runMediaAnalyzer(baseRequest)).rejects.toMatchObject({
      message: 'URL matched one or more Safe Browsing threat lists.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back when the fetched media is not an image payload', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>nope</html>', {
      status: 200,
      headers: {
        'content-type': 'text/html',
        'content-length': '17',
      },
    }));

    const result = await runMediaAnalyzer(baseRequest);

    expect(result.mediaSummary).toBe('Media present — analysis unavailable.');
    expect(result.confidence).toBe(0.15);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back when the fetched media exceeds the byte limit', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': '2048',
      },
    }));

    const result = await runMediaAnalyzer(baseRequest);

    expect(result.mediaSummary).toBe('Media present — analysis unavailable.');
    expect(result.confidence).toBe(0.15);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns validated model output for a safe image fetch', async () => {
    const imageResponse = {
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'image/png',
        'content-length': '4',
      }),
      body: null,
      arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
    } as unknown as Response;

    fetchMock
      .mockResolvedValueOnce(imageResponse)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: {
          role: 'assistant',
          content: JSON.stringify({
            mediaCentrality: 1.4,
            mediaType: 'document',
            extractedText: ' EFFECTIVE JANUARY 1 ',
            mediaSummary: 'A redlined policy memo screenshot.',
            candidateEntities: ['Agency'],
            confidence: 0.92,
            cautionFlags: ['partial-view'],
          }),
        },
        done: true,
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));

    const result = await runMediaAnalyzer(baseRequest);

    expect(result).toEqual({
      mediaCentrality: 1,
      mediaType: 'document',
      extractedText: 'EFFECTIVE JANUARY 1',
      mediaSummary: 'A redlined policy memo screenshot.',
      candidateEntities: ['Agency'],
      confidence: 0.92,
      cautionFlags: ['partial-view'],
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[0]).toBe('http://localhost:11434/api/chat');
  });

  it('can analyze a prepared image payload without refetching the media url', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      message: {
        role: 'assistant',
        content: JSON.stringify({
          mediaCentrality: 0.74,
          mediaType: 'screenshot',
          extractedText: 'SETTINGS',
          mediaSummary: 'A desktop settings screenshot with a notifications panel.',
          candidateEntities: ['Settings', 'Notifications'],
          confidence: 0.81,
          cautionFlags: [],
        }),
      },
      done: true,
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    }));

    const result = await runMediaAnalyzerFromImageBase64(baseRequest, Buffer.from([1, 2, 3, 4]).toString('base64'));

    expect(result).toEqual({
      mediaCentrality: 0.74,
      mediaType: 'screenshot',
      extractedText: 'SETTINGS',
      mediaSummary: 'A desktop settings screenshot with a notifications panel.',
      candidateEntities: ['Settings', 'Notifications'],
      confidence: 0.81,
      cautionFlags: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/api/chat');
    expect(mockCheckUrlAgainstSafeBrowsing).not.toHaveBeenCalled();
  });

  it('preserves severe multimodal moderation recommendations when category and confidence support them', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      message: {
        role: 'assistant',
        content: JSON.stringify({
          mediaCentrality: 0.88,
          mediaType: 'photo',
          mediaSummary: 'A close-up image with severe exploitative content.',
          candidateEntities: [],
          confidence: 0.9,
          cautionFlags: [],
          moderation: {
            action: 'drop',
            categories: ['child-safety'],
            confidence: 0.94,
            allowReveal: false,
            rationale: 'The image may depict exploitative content involving a child.',
          },
        }),
      },
      done: true,
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    }));

    const result = await runMediaAnalyzerFromImageBase64(baseRequest, Buffer.from([1, 2, 3, 4]).toString('base64'));

    expect(result.moderation).toEqual({
      action: 'drop',
      categories: ['child-safety'],
      confidence: 0.94,
      allowReveal: false,
      rationale: 'The image may depict exploitative content involving a child.',
    });
  });
});
