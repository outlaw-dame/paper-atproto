import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  GOOGLE_FACT_CHECK_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_GROUNDING_MODEL: z.string().default('gemini-2.5-flash'),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  VERIFY_API_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false')
    .default(true as any),
  VERIFY_MAX_TEXT_CHARS: z.coerce.number().int().positive().default(1500),
  VERIFY_MAX_URLS: z.coerce.number().int().positive().default(8),
  VERIFY_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  VERIFY_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(3),
  VERIFY_SHARED_SECRET: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3001),
});

export type AppEnv = z.infer<typeof EnvSchema>;
export const env: AppEnv = EnvSchema.parse(process.env);
