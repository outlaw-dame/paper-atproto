import { describe, expect, it } from 'vitest';
import { atpCall } from './client.js';

describe('atpCall', () => {
  it('aborts requests when the timeout is exceeded', async () => {
    await expect(
      atpCall(
        async (signal) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')), { once: true });
        }),
        { timeoutMs: 10, maxAttempts: 1 },
      ),
    ).rejects.toMatchObject({ kind: 'cancelled', message: 'Request cancelled' });
  });
});