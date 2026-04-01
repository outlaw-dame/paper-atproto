import { beforeEach, describe, expect, it, vi } from 'vitest';

const { embedMock } = vi.hoisted(() => ({
  embedMock: vi.fn<(text: string) => Promise<number[]>>(),
}));

vi.mock('../workers/InferenceClient', () => ({
  inferenceClient: {
    embed: embedMock,
  },
}));

import { embeddingPipeline } from './embeddingPipeline';

describe('embeddingPipeline', () => {
  beforeEach(() => {
    embedMock.mockReset();
  });

  it('preserves case-sensitive sanitized text when batching embeddings', async () => {
    embedMock.mockImplementation(async (text: string) => {
      if (text === 'US election') return [1];
      if (text === 'us election') return [2];
      return [0];
    });

    const vectors = await embeddingPipeline.embedBatch(['US election', 'us election']);

    expect(embedMock).toHaveBeenCalledTimes(2);
    expect(embedMock.mock.calls.map(([text]) => text)).toEqual(['US election', 'us election']);
    expect(vectors).toEqual([[1], [2]]);
  });

  it('dedupes exact sanitized duplicates within a batch', async () => {
    embedMock.mockResolvedValue([7]);

    const vectors = await embeddingPipeline.embedBatch(['Apple   News', 'Apple News']);

    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(embedMock).toHaveBeenCalledWith('Apple News');
    expect(vectors).toEqual([[7], [7]]);
  });
});