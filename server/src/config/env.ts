import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // ── LLM / Ollama ─────────────────────────────────────────────────────────
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  QWEN_WRITER_MODEL: z.string().default('qwen3:4b-instruct-2507-q4_K_M'),
  QWEN_MULTIMODAL_MODEL: z.string().default('qwen3-vl:4b-instruct-q4_K_M'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  LLM_MEDIA_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  LLM_MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(8_000_000),
  LLM_MEDIA_MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(3),
  LLM_MEDIA_DIAGNOSTICS: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z.string().optional().transform((v) => v === 'true').default('false'),
  ),
  LLM_LOCAL_ONLY: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z.string().optional().transform((v) => v !== 'false').default('true'),
  ),
  LLM_STARTUP_CHECK: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z.string().optional().transform((v) => v !== 'false').default('true'),
  ),
  LLM_STARTUP_FAIL_CLOSED: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z.string().optional().transform((v) => v === 'true').default('false'),
  ),
  LLM_STARTUP_TIMEOUT_MS: z.coerce.number().int().positive().default(6_000),
  QWEN_WRITER_MODEL_DIGEST: z.string().optional(),
  QWEN_MULTIMODAL_MODEL_DIGEST: z.string().optional(),
  LLM_ENABLED: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z.string().optional().transform((v) => v !== 'false').default('true'),
  ),
  GOOGLE_FACT_CHECK_API_KEY: z.string().min(1).optional(),
  GOOGLE_SAFE_BROWSING_API_KEY: z.string().min(1).optional(),
  SAFE_BROWSING_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(2000),
  GEMINI_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  GEMINI_GROUNDING_MODEL: z.string().default('gemini-3-flash-preview'),
  VERIFY_GEMINI_GROUNDING_ENABLED: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z.string().optional().transform((v) => v === 'true').default('false'),
  ),
  GEMINI_DEEP_INTERPOLATOR_MODEL: z.string().default('gemini-3-flash-preview'),
  GEMINI_DEEP_INTERPOLATOR_FALLBACK_MODELS: z.string().default('gemini-2.5-flash'),
  OPENAI_DEEP_INTERPOLATOR_MODEL: z.string().default('gpt-5.4'),
  GEMINI_COMPOSER_MODEL: z.string().default('gemini-3-flash-preview'),
  GEMINI_INTERPOLATOR_ENHANCER_MODEL: z.string().default('gemini-3-flash-preview'),
  GEMINI_INTERPOLATOR_ENHANCER_FALLBACK_MODELS: z.string().default('gemini-2.5-flash'),
  OPENAI_INTERPOLATOR_ENHANCER_MODEL: z.string().default('gpt-5.4'),
  GEMINI_COMPOSER_ENABLED: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z.string().optional().transform((v) => v === 'true').default('false'),
  ),
  GEMINI_INTERPOLATOR_ENHANCER_ENABLED: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z.string().optional().transform((v) => v !== 'false').default('true'),
  ),
  OPENAI_INTERPOLATOR_ENHANCER_ENABLED: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z.string().optional().transform((v) => v !== 'false').default('true'),
  ),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  PREMIUM_AI_ENABLED: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z.string().optional().transform((v) => v === 'true').default('false'),
  ),
  PREMIUM_AI_PROVIDER: z.enum(['gemini', 'openai']).default('gemini'),
  PREMIUM_AI_DEFAULT_TIER: z.enum(['free', 'plus', 'pro']).default('free'),
  PREMIUM_AI_ALLOWLIST_DIDS: z.string().optional().default(''),
  PREMIUM_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
  PREMIUM_AI_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(2),
  AI_DURABLE_EVENTS_READ_BASE_URL: z.string().url().optional(),
  AI_DURABLE_STATE_READ_BASE_URL: z.string().url().optional(),
  AI_DURABLE_PRESENCE_READ_BASE_URL: z.string().url().optional(),
  AI_DURABLE_EVENTS_WRITE_BASE_URL: z.string().url().optional(),
  AI_DURABLE_STATE_WRITE_BASE_URL: z.string().url().optional(),
  AI_DURABLE_PRESENCE_WRITE_BASE_URL: z.string().url().optional(),
  AI_DURABLE_READ_BEARER_TOKEN: z.string().min(1).optional(),
  AI_DURABLE_WRITE_BEARER_TOKEN: z.string().min(1).optional(),
  AI_DURABLE_READ_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  AI_DURABLE_WRITE_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  AI_DURABLE_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(3),
  AI_DURABLE_FAIL_OPEN: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z.string().optional().transform((v) => v === 'true').default('false'),
  ),
  AI_SESSION_TELEMETRY_ADMIN_SECRET: z.string().min(1).optional(),
  RATE_LIMIT_REDIS_URL: z.string().url().optional(),
  RATE_LIMIT_REDIS_PREFIX: z.string().default('paper:ratelimit'),
    RATE_LIMIT_REDIS_FAIL_CLOSED: z.preprocess(
      (v) => (typeof v === 'boolean' ? String(v) : v),
      z.string().optional().transform((v) => v === 'true').default('false'),
    ),
    RATE_LIMIT_TRUST_PROXY: z.preprocess(
      (v) => (typeof v === 'boolean' ? String(v) : v),
      z.string().optional().transform((v) => v === 'true').default('false'),
    ),
    RATE_LIMIT_TRUSTED_IP_HEADER: z.string().default('cf-connecting-ip'),
  CORS_ALLOWED_ORIGINS: z.string().optional().default(''),
  CORS_ALLOW_PRIVATE_NETWORK_IN_DEV: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z.string().optional().transform((v) => v !== 'false').default('true'),
  ),
  AI_SAFE_BROWSING_FAIL_CLOSED: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z.string().optional().transform((v) => v === 'true').default('false'),
  ),
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
  VERIFY_ENTITY_LINKING_PROVIDER: z.enum(['heuristic', 'rel', 'dbpedia', 'wikidata', 'hybrid']).default('dbpedia'),
  VERIFY_ENTITY_LINKING_ENDPOINT: z.string().url().default('https://api.dbpedia-spotlight.org/en/annotate'),
  VERIFY_WIKIDATA_ENDPOINT: z.string().url().default('https://www.wikidata.org/w/api.php'),
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
  TRANSCRIPTION_PYTHON_BIN: z.string().default('python3'),
  TRANSCRIPTION_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  TRANSCRIPTION_MODEL_SIZE: z.string().default('small'),
  TRANSCRIPTION_DEVICE: z.enum(['auto', 'cpu', 'cuda']).default('cpu'),
  TRANSCRIPTION_COMPUTE_TYPE: z.string().default('int8'),
  TRANSCRIPTION_MAX_FILE_BYTES: z.coerce.number().int().positive().default(150_000_000),
  TRANSCRIPTION_REMOTE_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  TRANSCRIPTION_WORKER_PATH: z.string().optional(),
  PODCASTINDEX_API_KEY: z.string().min(1).optional(),
  PODCASTINDEX_API_SECRET: z.string().min(1).optional(),
  PODCASTINDEX_BASE_URL: z.string().url().default('https://api.podcastindex.org'),
  PODCASTINDEX_USER_AGENT: z.string().default('paper-atproto/1.0 (+https://github.com/damonoutlaw/paper-atproto)'),
  PORT: z.coerce.number().int().positive().default(3011),

  // ── HTTP Compression ─────────────────────────────────────────────────────
  COMPRESSION_ENABLED: z.preprocess(
    (v) => (typeof v === 'boolean' ? String(v) : v),
    z
      .string()
      .optional()
      .transform((v) => v !== 'false')
      .default('true'),
  ),
  COMPRESSION_MIN_BYTES: z.coerce.number().int().min(0).default(1024),
  COMPRESSION_MAX_BYTES: z.coerce.number().int().positive().default(1_500_000),
  COMPRESSION_GZIP_LEVEL: z.coerce.number().int().min(1).max(9).default(6),
  COMPRESSION_ZSTD_LEVEL: z.coerce.number().int().min(1).max(22).default(3),

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
