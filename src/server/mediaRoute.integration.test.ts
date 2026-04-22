import { describe, expect, it, vi, beforeEach } from 'vitest';

type ThreatEntry = {
  threatType: string;
  platformType: string;
  threatEntryType: string;
  url: string;
};

const NO_THREATS: ThreatEntry[] = [];

const {
  envMock,
  mockTranscribe,
  mockCheckUrlAgainstSafeBrowsing,
} = vi.hoisted(() => ({
  envMock: {
    TRANSCRIPTION_MAX_FILE_BYTES: 150_000_000,
    TRANSCRIPTION_REMOTE_FETCH_TIMEOUT_MS: 120_000,
    AI_SAFE_BROWSING_FAIL_CLOSED: false,
  },
  mockTranscribe: vi.fn(),
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

vi.mock('../../server/src/services/media/transcriptionWorkerBridge.js', () => ({
  transcriptionWorkerBridge: {
    transcribe: mockTranscribe,
  },
}));

import { mediaRouter } from '../../server/src/routes/media.js';

describe('mediaRouter /api/media/transcribe', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    envMock.AI_SAFE_BROWSING_FAIL_CLOSED = false;
    mockTranscribe.mockReset();
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

  it('returns route shape for successful multipart transcription', async () => {
    mockTranscribe.mockResolvedValue({
      text: 'hello world',
      vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhello world',
      language: 'en',
      languageProbability: 0.98,
      durationSeconds: 1,
      model: 'faster-whisper:small',
      segments: [{ start: 0, end: 1, text: 'hello world' }],
    });

    const form = new FormData();
    form.set('file', new File([new Uint8Array([1, 2, 3, 4])], 'clip.mp4', { type: 'video/mp4' }));
    form.set('language', 'en');

    const response = await mediaRouter.request('/transcribe', {
      method: 'POST',
      body: form,
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      ok: boolean;
      result?: {
        text: string;
        vtt: string;
        language: string;
        model: string;
        segments: Array<{ start: number; end: number; text: string }>;
      };
    };

    expect(payload.ok).toBe(true);
    expect(payload.result).toBeDefined();
    expect(payload.result?.text).toBe('hello world');
    expect(payload.result?.vtt).toContain('WEBVTT');
    expect(payload.result?.language).toBe('en');
    expect(payload.result?.model).toBe('faster-whisper:small');
    expect(Array.isArray(payload.result?.segments)).toBe(true);
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    expect(mockTranscribe).toHaveBeenCalledWith(expect.objectContaining({
      language: 'en',
      maxVttBytes: 20_000,
      filePath: expect.any(String),
    }));
  });

  it('returns validation route shape for invalid JSON body', async () => {
    const response = await mediaRouter.request('/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-valid-url' }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json() as {
      ok: boolean;
      error?: string;
      issues?: unknown[];
    };

    expect(payload.ok).toBe(false);
    expect(payload.error).toBe('Invalid transcription request');
    expect(Array.isArray(payload.issues)).toBe(true);
    expect(payload.issues?.length).toBeGreaterThan(0);
  });

  it('rejects remote media URLs blocked by Safe Browsing before download', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    mockCheckUrlAgainstSafeBrowsing.mockImplementationOnce(async (url: string) => ({
      url,
      checked: true,
      status: 'unsafe',
      safe: false,
      blocked: true,
      reason: 'Remote media URL blocked by Google Safe Browsing.',
      threats: [{
        threatType: 'MALWARE',
        platformType: 'ANY_PLATFORM',
        threatEntryType: 'URL',
        url,
      }],
    }));

    const response = await mediaRouter.request('/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://blocked.example/audio.mp3' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Remote media URL blocked by Google Safe Browsing.',
      code: 'VALIDATION_ERROR',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it('downloads safe remote media and forwards the file to the transcription worker', async () => {
    mockTranscribe.mockResolvedValueOnce({
      text: 'hello world',
      vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhello world',
      language: 'en',
      model: 'faster-whisper:small',
      segments: [{ start: 0, end: 1, text: 'hello world' }],
    });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          'content-type': 'audio/mpeg',
          'content-length': '4',
        },
      }));

    const response = await mediaRouter.request('/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://safe.example/audio.mp3', language: 'en' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: expect.objectContaining({
        text: 'hello world',
        language: 'en',
      }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockCheckUrlAgainstSafeBrowsing).toHaveBeenCalledWith('https://safe.example/audio.mp3');
    expect(mockTranscribe).toHaveBeenCalledWith(expect.objectContaining({
      language: 'en',
      maxVttBytes: 20_000,
      filePath: expect.any(String),
    }));
  });
});

describe('mediaRouter /api/media/proxy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    envMock.AI_SAFE_BROWSING_FAIL_CLOSED = false;
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

  it('returns 400 when URL is missing', async () => {
    const response = await mediaRouter.request('/proxy', { method: 'GET' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'Missing media URL.' });
  });

  it('rewrites HLS manifests to proxied segment URLs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      '#EXTM3U\n#EXT-X-VERSION:3\nsegment0.ts\nhttps://cdn.example.com/segment1.ts\n',
      {
        status: 200,
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
        },
      },
    ));

    const response = await mediaRouter.request('/proxy?url=https%3A%2F%2Fvideo.example%2Fwatch%2Fplaylist.m3u8', {
      method: 'GET',
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('/api/media/proxy?url=https%3A%2F%2Fvideo.example%2Fwatch%2Fsegment0.ts');
    expect(body).toContain('/api/media/proxy?url=https%3A%2F%2Fcdn.example.com%2Fsegment1.ts');
  });

  it('forwards range requests when proxying media bytes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      new Uint8Array([1, 2, 3]),
      {
        status: 206,
        headers: {
          'content-type': 'video/mp2t',
          'accept-ranges': 'bytes',
          'content-range': 'bytes 0-2/3',
        },
      },
    ));

    const response = await mediaRouter.request('/proxy?url=https%3A%2F%2Fvideo.example%2Fwatch%2Fsegment0.ts', {
      method: 'GET',
      headers: { range: 'bytes=0-2' },
    });

    expect(response.status).toBe(206);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          Range: 'bytes=0-2',
        }),
      }),
    );
  });
});
