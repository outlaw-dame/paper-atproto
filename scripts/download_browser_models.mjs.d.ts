export type DownloadBrowserModelVariant = 'quantized' | 'q4f16' | 'q4';

export interface DownloadBrowserModelDefinition {
  key: string;
  id: string;
  purpose: string;
  variant: DownloadBrowserModelVariant;
}

export interface DownloadBrowserModelsArgs {
  profiles: string[];
  include: string[];
  list: boolean;
}

export function parseArgs(argv: string[]): DownloadBrowserModelsArgs;
export function resolveModels(options: DownloadBrowserModelsArgs): DownloadBrowserModelDefinition[];
export function selectModelFiles(model: DownloadBrowserModelDefinition, siblings: string[]): string[];
