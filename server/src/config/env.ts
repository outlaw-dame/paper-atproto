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
  GOOGLE_SAFE_BROWSING_API_KEY: z.string().min(1).optional(),
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
  TRANSLATION_PYTHON_BIN: z.string().default('python3'),
  TRANSLATION_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  TRANSLATION_MODELS_DIR: z.string().optional(),
  TRANSLATION_WORKER_PATH: z.string().optional(),
  PODCASTINDEX_API_KEY: z.string().min(1).optional(),
  PODCASTINDEX_API_SECRET: z.string().min(1).optional(),
  PODCASTINDEX_BASE_URL: z.string().url().default('https://api.podcastindex.org'),
  PODCASTINDEX_USER_AGENT: z.string().default('paper-atproto/1.0 (+https://github.com/damonoutlaw/paper-atproto)'),
  PORT: z.coerce.number().int().positive().default(3011),

  // ── Web Push ──────────────────────────────────────────────────────────────
  // VAPID keys are required when actually sending push notifications.
  // They are optional here because the subscription endpoint only stores
  // subscriptions — the fanout sender is a separate concern.
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  /** mailto: or https: contact URI required by the VAPID spec */
  VAPID_CONTACT: z.string().min(1).optional(),
  /** Maximum subscriptions held in memory (evicts oldest on overflow) */
  PUSH_MAX_SUBSCRIPTIONS: z.coerce.number().int().positive().default(10_000),
  /** Days before a stored subscription is considered stale and purged */
  PUSH_SUB_TTL_DAYS: z.coerce.number().int().positive().default(90),
});

export type AppEnv = z.infer<typeof EnvSchema>;
export const env: AppEnv = EnvSchema.parse(process.env);
