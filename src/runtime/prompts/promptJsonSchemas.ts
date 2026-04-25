import { z } from 'zod';
import {
  coordinatorPromptOutputSchema,
  routerPromptOutputSchema,
} from './promptSchemas';

/**
 * Portable JSON Schema boundary for model/runtime structured-output calls.
 *
 * Zod remains the TypeScript source of truth for local parsing and inferred
 * types. These JSON Schemas are the serializable wire-format contracts used at
 * model/tool boundaries. Any accepted model output must still pass the Zod
 * parser and the deterministic coordination-contract validator before it can
 * affect execution.
 */
export const routerPromptOutputJsonSchema = z.toJSONSchema(routerPromptOutputSchema);

export const coordinatorPromptOutputJsonSchema = z.toJSONSchema(coordinatorPromptOutputSchema);
