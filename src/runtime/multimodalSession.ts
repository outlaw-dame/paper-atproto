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

export class LocalMultimodalSession {
  constructor(private readonly config: LocalMultimodalConfig) {}

  async load(): Promise<void> {
    const note = this.config.runtimeNote ?? 'Current browser runtime support for this multimodal model is not available yet.';
    throw new Error(`${this.config.label} cannot be loaded locally. ${note}`);
  }

  async analyzeMedia(_request: AnalyzeMediaRequest): Promise<AnalyzeMediaResult> {
    throw new Error(`${this.config.label} is unavailable in the current browser runtime.`);
  }

  async dispose(): Promise<void> {
    // No-op for the current staged multimodal runtime.
  }
}
