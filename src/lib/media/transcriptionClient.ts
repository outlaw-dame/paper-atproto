import { getConfiguredApiBaseUrl, resolveApiUrl } from '../apiBase';

export interface MediaTranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface MediaTranscriptionResult {
  text: string;
  vtt: string;
  language: string;
  languageProbability?: number;
  durationSeconds?: number;
  model: string;
  segments: MediaTranscriptionSegment[];
}

type MediaTranscriptionResponse = {
  ok: boolean;
  result: MediaTranscriptionResult;
  error?: string;
};

const DEFAULT_TIMEOUT_MS = Number((import.meta as any).env?.VITE_GLYMPSE_MEDIA_TIMEOUT_MS ?? 180_000);

export class MediaTranscriptionClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  private async fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async transcribeFile(file: File, language?: string): Promise<MediaTranscriptionResult> {
    const formData = new FormData();
    formData.set('file', file);
    if (language) formData.set('language', language);

    const response = await this.fetchWithTimeout(resolveApiUrl('/api/media/transcribe', this.baseUrl), {
      method: 'POST',
      body: formData,
    });

    const payload = await response.json().catch(() => null) as MediaTranscriptionResponse | null;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || 'Unable to transcribe media file.');
    }
    return payload.result;
  }

  async transcribeUrl(url: string, language?: string): Promise<MediaTranscriptionResult> {
    const response = await this.fetchWithTimeout(resolveApiUrl('/api/media/transcribe', this.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ...(language ? { language } : {}) }),
    });

    const payload = await response.json().catch(() => null) as MediaTranscriptionResponse | null;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || 'Unable to transcribe remote media.');
    }
    return payload.result;
  }
}

export const mediaTranscriptionClient = new MediaTranscriptionClient(
  getConfiguredApiBaseUrl((import.meta as any).env?.VITE_GLYMPSE_MEDIA_BASE_URL, (import.meta as any).env?.VITE_GLYMPSE_API_BASE_URL),
  DEFAULT_TIMEOUT_MS,
);