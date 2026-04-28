import { vector } from '@electric-sql/pglite/vector';

export const paperDbExtensions = {
  vector,
} as const;

export type PaperDbExtensions = typeof paperDbExtensions;
