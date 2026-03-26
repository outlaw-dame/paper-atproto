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

// Single-threaded WASM backend — sufficient for embedding + image captioning.
// The dev server sends COOP/COEP headers so SharedArrayBuffer is available,
// letting onnxruntime-web v1.14.0 register all backends cleanly at init time.
env.backends.onnx.wasm.numThreads = 1;
// We are already inside a worker; prevent ONNX from spawning a nested proxy worker.
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.proxy = false;

type WorkerMsg = {
  id: string;
  type: 'embed' | 'embed_batch' | 'caption_image' | 'status';
  payload?: any;
};

type WorkerReply = {
  id: string;
  type: string;
  result?: any;
  error?: string;
};

let extractor: any = null;
let captioner: any = null;
let modelStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let modelError: string | null = null;
let captionStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let captionError: string | null = null;

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

async function ensureCaptionModel(): Promise<void> {
  if (captioner) return;
  if (captionStatus === 'loading') {
    await new Promise<void>((resolve, reject) => {
      const check = setInterval(() => {
        if (captionStatus === 'ready') {
          clearInterval(check);
          resolve();
        }
        if (captionStatus === 'error') {
          clearInterval(check);
          reject(new Error(captionError ?? 'Caption model load failed'));
        }
      }, 100);
    });
    return;
  }

  captionStatus = 'loading';
  try {
    captioner = await pipeline('image-to-text', 'Xenova/vit-gpt2-image-captioning', {
      quantized: true,
    });
    captionStatus = 'ready';
  } catch (err: any) {
    captionStatus = 'error';
    captionError = err?.message ?? 'Unknown caption model error';
    throw err;
  }
}

function normalizeCaptionText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

async function generateCaption(imageUrl: string): Promise<string> {
  await ensureCaptionModel();
  const output = await captioner(imageUrl, {
    max_new_tokens: 48,
  });

  const raw = Array.isArray(output)
    ? String(output[0]?.generated_text ?? '')
    : String(output?.generated_text ?? '');

  return normalizeCaptionText(raw);
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
      reply.result = {
        status: modelStatus,
        error: modelError,
        captionStatus,
        captionError,
      };
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

    if (type === 'caption_image') {
      const imageUrl: string = payload?.imageUrl ?? '';
      if (!imageUrl.trim()) {
        reply.error = 'Missing imageUrl payload';
      } else {
        const caption = await generateCaption(imageUrl);
        reply.result = { caption };
      }
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
