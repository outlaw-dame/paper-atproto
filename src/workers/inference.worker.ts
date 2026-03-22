// ─── Inference Worker ─────────────────────────────────────────────────────
// All Transformers.js model calls run here, completely off the main UI thread.
// The worker uses a simple message-passing protocol:
//
//   Main → Worker:  { id, type, payload }
//   Worker → Main:  { id, type, result?, error? }
//
// Supported message types:
//   'embed'        — generate a 384-d MiniLM embedding for a text string
//   'embed_batch'  — generate embeddings for an array of strings
//   'status'       — returns current model load status
//
// The worker lazy-loads the model on the first 'embed' request and caches it.
// It posts a 'ready' message when the model is loaded.

import { pipeline, env } from '@xenova/transformers';

// Use WASM backend by default; WebGPU is opted in opportunistically
env.backends.onnx.wasm.numThreads = 2;

type WorkerMsg = {
  id: string;
  type: 'embed' | 'embed_batch' | 'status';
  payload?: any;
};

type WorkerReply = {
  id: string;
  type: string;
  result?: any;
  error?: string;
};

let extractor: any = null;
let modelStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let modelError: string | null = null;

async function ensureModel(): Promise<void> {
  if (extractor) return;
  if (modelStatus === 'loading') {
    // Wait for the in-flight load
    await new Promise<void>((resolve, reject) => {
      const check = setInterval(() => {
        if (modelStatus === 'ready') { clearInterval(check); resolve(); }
        if (modelStatus === 'error') { clearInterval(check); reject(new Error(modelError ?? 'Model load failed')); }
      }, 100);
    });
    return;
  }

  modelStatus = 'loading';
  try {
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,  // use quantized ONNX model for smaller download + faster inference
    });
    modelStatus = 'ready';
    self.postMessage({ id: '__system__', type: 'ready', result: { model: 'all-MiniLM-L6-v2' } });
  } catch (err: any) {
    modelStatus = 'error';
    modelError = err?.message ?? 'Unknown error';
    self.postMessage({ id: '__system__', type: 'error', error: modelError });
    throw err;
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  await ensureModel();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

self.addEventListener('message', async (event: MessageEvent<WorkerMsg>) => {
  const { id, type, payload } = event.data;
  const reply: WorkerReply = { id, type };

  try {
    if (type === 'status') {
      reply.result = { status: modelStatus, error: modelError };
      self.postMessage(reply);
      return;
    }

    if (type === 'embed') {
      const text: string = payload?.text ?? '';
      if (!text.trim()) {
        reply.result = { embedding: [] };
      } else {
        const embedding = await generateEmbedding(text);
        reply.result = { embedding };
      }
      self.postMessage(reply);
      return;
    }

    if (type === 'embed_batch') {
      const texts: string[] = payload?.texts ?? [];
      const embeddings = await Promise.all(
        texts.map(t => t.trim() ? generateEmbedding(t) : Promise.resolve([]))
      );
      reply.result = { embeddings };
      self.postMessage(reply);
      return;
    }

    reply.error = `Unknown message type: ${type}`;
    self.postMessage(reply);
  } catch (err: any) {
    reply.error = err?.message ?? 'Worker error';
    self.postMessage(reply);
  }
});
