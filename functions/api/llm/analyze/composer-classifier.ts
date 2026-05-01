import type { PagesFunction } from '@cloudflare/workers-types';

interface Env {
  AI?: {
    run(model: string, input: unknown): Promise<unknown>;
  };
}

export const onRequest: PagesFunction<Env> = async (context): Promise<Response> => {
  if (!context.env.AI) {
    return Response.json({ error: 'Workers AI unavailable' }, { status: 503 });
  }
  const result = await context.env.AI.run('@cf/huggingface/distilbert-sst-2-int8', { text: 'health check' });
  return Response.json(result);
};
