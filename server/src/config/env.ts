import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // ── LLM / Ollama ─────────────────────────────────────────────────────────
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  QWEN_WRITER_MODEL: z.string().default('qwen3:4b-instruct-2507-q4_K_M'),
  QWEN_MULTIMODAL_MODEL: z.string().default('qwen3-vl:4b-instruct-q4_K_M'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  LLM_ENABLED: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z.string().optional().transform((v) => v !== 'false').default('true'),
  ),
  GOOGLE_FACT_CHECK_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_GROUNDING_MODEL: z.string().default('gemini-2.5-flash'),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  VERIFY_API_ENABLED: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z
      .string()
      .optional()
      .transform((v) => v !== 'false')
      .default('true'),
  ),
  VERIFY_MAX_TEXT_CHARS: z.coerce.number().int().positive().default(1500),
  VERIFY_MAX_URLS: z.coerce.number().int().positive().default(8),
  VERIFY_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  VERIFY_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(3),
  VERIFY_SHARED_SECRET: z.string().optional(),
  VERIFY_ENTITY_LINKING_PROVIDER: z.enum(['heuristic', 'rel', 'dbpedia']).default('dbpedia'),
  VERIFY_ENTITY_LINKING_ENDPOINT: z.string().url().default('https://api.dbpedia-spotlight.org/en/annotate'),
  VERIFY_ENTITY_LINKING_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  VERIFY_ENTITY_LINKING_API_KEY: z.string().optional(),
  VERIFY_ENTITY_LINKING_DEBUG: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z
      .string()
      .optional()
      .transform((v) => v === 'true')
      .default('false'),
  ),
  PORT: z.coerce.number().int().positive().default(3001),
});

export type AppEnv = z.infer<typeof EnvSchema>;
export const env: AppEnv = EnvSchema.parse(process.env);
