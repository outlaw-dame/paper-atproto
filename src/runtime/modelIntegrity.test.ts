import { beforeEach, describe, expect, it } from 'vitest';
import { assertLocalModelIntegrity, resetModelIntegrityCacheForTests } from './modelIntegrity';

describe('model integrity', () => {
  beforeEach(() => {
    resetModelIntegrityCacheForTests();
  });

  it('checks manifest required files and throws when any are missing', async () => {
    const existing = new Set([
      '/models/model-manifest.json',
      '/models/Xenova/all-MiniLM-L6-v2/config.json',
      '/models/Xenova/all-MiniLM-L6-v2/tokenizer.json',
    ]);

    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/models/model-manifest.json')) {
        return new Response(JSON.stringify({
          schemaVersion: 1,
          models: [
            {
              id: 'Xenova/all-MiniLM-L6-v2',
              revision: 'test',
              requiredFiles: ['config.json', 'tokenizer.json', 'onnx/model_quantized.onnx'],
            },
          ],
        }), { status: 200 });
      }

      if (existing.has(url)) {
        return new Response(null, { status: 200 });
      }

      if (init?.method === 'HEAD') {
        return new Response(null, { status: 404 });
      }
      return new Response(null, { status: 404 });
    };

    await expect(assertLocalModelIntegrity('Xenova/all-MiniLM-L6-v2', {
      basePath: '/models',
      fetcher: fetcher as typeof fetch,
    })).rejects.toThrow('Missing required local model asset');
  });

  it('passes when all required files exist', async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/models/model-manifest.json')) {
        return new Response(JSON.stringify({
          schemaVersion: 1,
          models: [
            {
              id: 'local/composer-quality-setfit-head',
              revision: 'test',
              requiredFiles: ['model.json'],
            },
          ],
        }), { status: 200 });
      }
      return new Response(null, { status: 200 });
    };

    await expect(assertLocalModelIntegrity('local/composer-quality-setfit-head', {
      basePath: '/models',
      fetcher: fetcher as typeof fetch,
    })).resolves.toBeUndefined();
  });
});
