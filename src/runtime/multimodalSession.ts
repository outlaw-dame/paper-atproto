import { inferenceClient } from '../workers/InferenceClient';

export interface AnalyzeMediaRequest {
  mediaUrl: string;
  prompt: string;
}

export interface AnalyzeMediaResult {
  summary: string;
}

export interface LocalMultimodalConfig {
  modelId: string;
  label: string;
  runtimeNote?: string;
}

function sanitizeSummary(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1_200);
}

export class LocalMultimodalSession {
  constructor(private readonly config: LocalMultimodalConfig) {}

  async load(): Promise<void> {
    // Captioning stays lazy inside the worker, so there is no heavy eager load step here.
  }

  async analyzeMedia(request: AnalyzeMediaRequest): Promise<AnalyzeMediaResult> {
    const caption = sanitizeSummary(await inferenceClient.captionImage(request.mediaUrl));
    if (!caption) {
      const note = this.config.runtimeNote ?? 'The local browser multimodal runtime did not return a usable caption.';
      throw new Error(`${this.config.label} is unavailable in the current browser runtime. ${note}`);
    }

    return {
      summary: /[.!?]$/.test(caption) ? caption : `${caption}.`,
    };
  }

  async dispose(): Promise<void> {
    // The shared inference worker is intentionally kept alive for other local tasks.
  }
}
