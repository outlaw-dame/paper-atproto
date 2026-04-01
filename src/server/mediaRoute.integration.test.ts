import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockTranscribe } = vi.hoisted(() => ({
  mockTranscribe: vi.fn(),
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: {
    TRANSCRIPTION_MAX_FILE_BYTES: 150_000_000,
    TRANSCRIPTION_REMOTE_FETCH_TIMEOUT_MS: 120_000,
  },
}));

vi.mock('../../server/src/services/media/transcriptionWorkerBridge.js', () => ({
  transcriptionWorkerBridge: {
    transcribe: mockTranscribe,
  },
}));

import { mediaRouter } from '../../server/src/routes/media.js';

describe('mediaRouter /api/media/transcribe', () => {
  beforeEach(() => {
    mockTranscribe.mockReset();
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
});
