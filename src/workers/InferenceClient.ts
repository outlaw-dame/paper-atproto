// ─── Inference Client ─────────────────────────────────────────────────────
// Manages the inference web worker and exposes a clean Promise-based API.
// All callers use this instead of importing from search.ts or linking.ts.
//
// Usage:
//   import { inferenceClient } from '../workers/InferenceClient';
//   const embedding = await inferenceClient.embed('hello world');
//   const batch     = await inferenceClient.embedBatch(['a', 'b', 'c']);

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
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

    // Vite's ?worker suffix tells it to bundle this as a worker module
    this.worker = new Worker(
      new URL('./inference.worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.addEventListener('message', (event) => {
      const { id, type, result, error } = event.data;

      // System messages from the worker
      if (id === '__system__') {
        if (type === 'ready') {
          this._status = 'ready';
          this.readyCallbacks.forEach(cb => cb());
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
      // Reject all pending requests
      for (const [, req] of this.pending) {
        req.reject(new Error('Worker crashed: ' + err.message));
      }
      this.pending.clear();
      this.worker = null;
    });

    return this.worker;
  }

  private send<T>(type: string, payload?: any): Promise<T> {
    const id = String(++this.idCounter);
    const worker = this.getWorker();

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, payload });
    });
  }

  /** Generate a single 384-d MiniLM embedding. Returns [] for empty text. */
  async embed(text: string): Promise<number[]> {
    const res = await this.send<{ embedding: number[] }>('embed', { text });
    return res.embedding;
  }

  /** Generate embeddings for multiple texts in one worker round-trip. */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const res = await this.send<{ embeddings: number[][] }>('embed_batch', { texts });
    return res.embeddings;
  }

  /** Returns the worker's current model status. */
  async getStatus(): Promise<{ status: string; error: string | null }> {
    return this.send('status');
  }

  /** Warm up the worker (pre-loads the model). Call once at app start. */
  warmup(): void {
    if (this._status !== 'idle') return;
    this._status = 'loading';
    this.getWorker(); // triggers worker construction and model load
    // Fire a dummy embed to trigger model download
    this.embed('warmup').catch(() => {});
  }

  /** Returns a promise that resolves when the model is ready. */
  onReady(): Promise<void> {
    if (this._status === 'ready') return Promise.resolve();
    return new Promise(resolve => this.readyCallbacks.push(resolve));
  }

  /** Terminate the worker (e.g. on app unmount). */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this._status = 'idle';
  }
}

// Singleton — one worker for the whole app
export const inferenceClient = new InferenceClient();
