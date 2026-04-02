// ─── Inference Client ─────────────────────────────────────────────────────
// Manages the inference web worker and exposes a clean Promise-based API.

import type { AbuseModelResult } from '../lib/abuseModel';
import type {
  ComposerEmotionResult,
  ComposerQualityResult,
  ComposerSentimentResult,
  ComposerTargetedToneResult,
} from '../lib/composerMl';
import type { ToneModelResult } from '../lib/toneModel';

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
};

type SmokeCheckResult = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  crossOriginIsolated: boolean;
  allowLocalModels: boolean;
  allowRemoteModels: boolean;
  assetIntegrityOk: boolean;
  assetError: string | null;
};

class InferenceClient {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();
  private idCounter = 0;
  private readyCallbacks: (() => void)[] = [];
  private _status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';

  get status() { return this._status; }

  private getWorker(): Worker {
    if (this.worker) return this.worker;

    // SharedArrayBuffer requires Cross-Origin-Opener-Policy: same-origin and
    // Cross-Origin-Embedder-Policy: credentialless/require-corp headers.
    // GitHub Pages and most static hosts don't send these, so SAB is unavailable
    // in production. The inference worker already sets numThreads=1 to avoid
    // needing SAB, but guard here so any future code that tries to pass a SAB
    // across the worker boundary fails loudly at the call site instead of with
    // a cryptic DataCloneError at runtime.
    if (typeof SharedArrayBuffer !== 'undefined' && !self.crossOriginIsolated) {
      // SAB exists in the global scope but the page isn't isolated — using it
      // would throw. Warn once so it's visible in dev tools.
      console.warn(
        '[InferenceClient] SharedArrayBuffer is available but crossOriginIsolated is false. ' +
        'Do not pass SharedArrayBuffer to the inference worker — it will throw a DataCloneError. ' +
        'Set VITE_ENABLE_ISOLATION_HEADERS=1 in dev or configure COOP/COEP headers in production.',
      );
    }

    this.worker = new Worker(
      new URL('./inference.worker.ts', import.meta.url),
      { type: 'module' },
    );

    this.worker.addEventListener('message', (event) => {
      const { id, type, result, error } = event.data;

      if (id === '__system__') {
        if (type === 'ready') {
          this._status = 'ready';
          this.readyCallbacks.forEach((callback) => callback());
          this.readyCallbacks = [];
        } else if (type === 'error') {
          this._status = 'error';
        }
        return;
      }

      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);

      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    });

    this.worker.addEventListener('error', (err) => {
      this._status = 'error';
      for (const [, req] of this.pending) {
        req.reject(new Error(`Worker crashed: ${err.message}`));
      }
      this.pending.clear();
      this.worker = null;
    });

    return this.worker;
  }

  private send<T>(type: string, payload?: any, options: { timeoutMs?: number } = {}): Promise<T> {
    const id = String(++this.idCounter);
    const worker = this.getWorker();

    return new Promise<T>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const settle = (callback: () => void) => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        callback();
      };

      this.pending.set(id, {
        resolve: (value) => {
          settle(() => resolve(value));
        },
        reject: (reason) => {
          settle(() => reject(reason));
        },
      });

      const timeoutMs = Number(options.timeoutMs ?? 0);
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          const pending = this.pending.get(id);
          if (!pending) return;
          this.pending.delete(id);
          reject(new Error(`Worker request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      worker.postMessage({ id, type, payload });
    });
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.send<{ embedding: number[] }>('embed', { text });
    return res.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const res = await this.send<{ embeddings: number[][] }>('embed_batch', { texts });
    return res.embeddings;
  }

  async classifyTone(text: string): Promise<ToneModelResult> {
    const res = await this.send<{ tone: ToneModelResult }>('classify_tone', { text });
    return res.tone;
  }

  async scoreAbuse(text: string): Promise<AbuseModelResult> {
    const res = await this.send<{ abuse: AbuseModelResult }>('score_abuse', { text });
    return res.abuse;
  }

  async classifySentiment(text: string): Promise<ComposerSentimentResult> {
    const res = await this.send<{ sentiment: ComposerSentimentResult }>('classify_sentiment', { text });
    return res.sentiment;
  }

  async classifyEmotion(text: string): Promise<ComposerEmotionResult> {
    const res = await this.send<{ emotion: ComposerEmotionResult }>('classify_emotion', { text });
    return res.emotion;
  }

  async classifyTargetedTone(text: string, target: string): Promise<ComposerTargetedToneResult> {
    const res = await this.send<{ targetedTone: ComposerTargetedToneResult }>('classify_targeted_tone', {
      text,
      target,
    });
    return res.targetedTone;
  }

  async classifyComposerQuality(text: string): Promise<ComposerQualityResult> {
    const res = await this.send<{ quality: ComposerQualityResult }>('classify_quality', { text });
    return res.quality;
  }

  async getStatus(): Promise<{
    status: string;
    error: string | null;
    captionStatus?: string;
    captionError?: string | null;
    toneStatus?: string;
    toneError?: string | null;
    abuseStatus?: string;
    abuseError?: string | null;
    sentimentStatus?: string;
    sentimentError?: string | null;
    emotionStatus?: string;
    emotionError?: string | null;
    targetedToneStatus?: string;
    targetedToneError?: string | null;
    qualityStatus?: string;
    qualityError?: string | null;
  }> {
    return this.send('status');
  }

  async runSmokeCheck(timeoutMs = 6000): Promise<SmokeCheckResult> {
    return this.send<SmokeCheckResult>('smoke', undefined, { timeoutMs });
  }

  async captionImage(imageUrl: string): Promise<string> {
    const res = await this.send<{ caption: string }>('caption_image', { imageUrl });
    return res.caption;
  }

  warmup(): void {
    if (this._status !== 'idle') return;
    this._status = 'loading';
    this.getWorker();
    this.embed('warmup').catch(() => {});
  }

  onReady(): Promise<void> {
    if (this._status === 'ready') return Promise.resolve();
    return new Promise((resolve) => this.readyCallbacks.push(resolve));
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this._status = 'idle';
  }
}

export const inferenceClient = new InferenceClient();
