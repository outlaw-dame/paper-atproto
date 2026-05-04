import { beforeEach, describe, expect, it, vi } from 'vitest';

const { envMock } = vi.hoisted(() => ({
  envMock: {
    QWEN_MULTIMODAL_MODEL: 'qwen-vision-test',
    OLLAMA_BASE_URL: 'http://localhost:11434',
    LLM_LOCAL_ONLY: true,
    LLM_TIMEOUT_MS: 5_000,
    LLM_MEDIA_FETCH_TIMEOUT_MS: 5_000,
    LLM_MEDIA_MAX_BYTES: 1024 * 1024,
    LLM_MEDIA_MAX_REDIRECTS: 2,
  },
}));

vi.mock('../config/env.js', () => ({
  env: envMock,
}));

vi.mock('./safeBrowsing.js', () => ({
  checkUrlAgainstSafeBrowsing: vi.fn(async () => ({
    status: 'safe',
    blocked: false,
    reason: undefined,
  })),
  shouldBlockSafeBrowsingVerdict: vi.fn(() => false),
}));

vi.mock('../lib/safeguards.js', () => ({
  ensureSafetyInstructions: (text: string) => text,
  detectHarmfulContent: (text: string) => ({
    isHarmful: /harmful/i.test(text),
  }),
}));

describe('qwenMultimodal', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('extracts fenced JSON and redacts harmful model text', async () => {
    const imageResponse = new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': '3',
      },
    });

    const modelResponse = {
      message: {
        role: 'assistant',
        content: '```json\n{"mediaCentrality":0.8,"mediaType":"photo","extractedText":"harmful extracted","mediaSummary":"harmful summary","candidateEntities":["Entity 1"],"confidence":0.9,"cautionFlags":["partial-view","unexpected-flag"]}\n```',
      },
      done: true,
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(imageResponse)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn(async () => modelResponse),
      });

    vi.stubGlobal('fetch', fetchMock);

    const { runMediaAnalyzer } = await import(`./qwenMultimodal.js?test=${Date.now()}`);

    const result = await runMediaAnalyzer({
      threadId: 'thread-1',
      mediaUrl: 'https://example.com/image.png',
      mediaAlt: 'Alt\u0000 text',
      nearbyText: 'Nearby\u0000 text',
      candidateEntities: ['Entity\u0000 One'],
      factualHints: ['Hint\u0000 One'],
    });

    expect(result.mediaSummary).toBe('Media present — sensitive details omitted.');
    expect(result.extractedText).toBeUndefined();
    expect(result.cautionFlags).toContain('harmful-content-detected');
    expect(result.cautionFlags).toContain('partial-view');
    expect(result.cautionFlags).not.toContain('unexpected-flag');
    expect(result.analysisStatus).toBe('complete');
    expect(result.moderationStatus).toBe('authoritative');

    const ollamaRequestInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const ollamaBody = JSON.parse(String(ollamaRequestInit.body)) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(ollamaBody.messages[1]?.content).not.toContain('\u0000');
  });

  it('downgrades unsupported low-confidence drop recommendations to blur', async () => {
    const imageResponse = new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': '3',
      },
    });

    const modelResponse = {
      message: {
        role: 'assistant',
        content: JSON.stringify({
          mediaCentrality: 0.75,
          mediaType: 'photo',
          mediaSummary: 'A violent photo with blood visible.',
          candidateEntities: [],
          confidence: 0.82,
          cautionFlags: [],
          moderation: {
            action: 'drop',
            categories: ['graphic-violence'],
            confidence: 0.58,
            allowReveal: false,
            rationale: 'Visible violent injury in frame.',
          },
        }),
      },
      done: true,
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(imageResponse)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn(async () => modelResponse),
      });

    vi.stubGlobal('fetch', fetchMock);

    const { runMediaAnalyzer } = await import(`./qwenMultimodal.js?test=${Date.now()}`);

    const result = await runMediaAnalyzer({
      threadId: 'thread-1',
      mediaUrl: 'https://example.com/image.png',
      nearbyText: 'Nearby text',
      candidateEntities: [],
      factualHints: [],
    });

    expect(result.moderation).toEqual({
      action: 'blur',
      categories: ['graphic-violence'],
      confidence: 0.58,
      allowReveal: true,
      rationale: 'Visible violent injury in frame.',
    });
    expect(result.analysisStatus).toBe('complete');
    expect(result.moderationStatus).toBe('authoritative');
  });
});
