type ModelManifestEntry = {
  id: string;
  revision: string;
  requiredFiles: string[];
};

type ModelManifest = {
  schemaVersion: number;
  models: ModelManifestEntry[];
};

const MANIFEST_URL = '/models/model-manifest.json';
const verifiedModelSet = new Set<string>();
let manifestPromise: Promise<ModelManifest | null> | null = null;

function normalizePath(value: string): string {
  return value.replace(/^\/+/, '').replace(/\\/g, '/');
}

async function loadManifest(fetcher: typeof fetch): Promise<ModelManifest | null> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        const response = await fetcher(MANIFEST_URL, { cache: 'no-store' });
        if (!response.ok) return null;
        const payload = await response.json() as Partial<ModelManifest>;
        if (!Array.isArray(payload.models)) return null;
        return {
          schemaVersion: Number(payload.schemaVersion ?? 1),
          models: payload.models
            .filter((entry): entry is ModelManifestEntry => (
              !!entry
              && typeof entry.id === 'string'
              && typeof entry.revision === 'string'
              && Array.isArray(entry.requiredFiles)
            ))
            .map((entry) => ({
              id: normalizePath(entry.id),
              revision: entry.revision.trim(),
              requiredFiles: entry.requiredFiles
                .filter((file): file is string => typeof file === 'string')
                .map((file) => normalizePath(file)),
            })),
        };
      } catch {
        return null;
      }
    })();
  }

  return manifestPromise;
}

async function fileExists(fetcher: typeof fetch, path: string): Promise<boolean> {
  try {
    const response = await fetcher(path, {
      method: 'HEAD',
      cache: 'no-store',
    });
    if (response.ok) return true;
    if (response.status !== 405) return false;

    const fallback = await fetcher(path, {
      method: 'GET',
      cache: 'no-store',
      headers: { Range: 'bytes=0-0' },
    });
    return fallback.ok;
  } catch {
    return false;
  }
}

export async function assertLocalModelIntegrity(
  modelId: string,
  options: {
    basePath?: string;
    fetcher?: typeof fetch;
  } = {},
): Promise<void> {
  const normalizedModelId = normalizePath(modelId);
  if (verifiedModelSet.has(normalizedModelId)) return;

  const basePath = (options.basePath ?? '/models').replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;
  const manifest = await loadManifest(fetcher);

  const requiredFiles = manifest?.models
    .find((entry) => entry.id === normalizedModelId)
    ?.requiredFiles;

  const checks = requiredFiles && requiredFiles.length > 0
    ? requiredFiles
    : ['config.json'];

  for (const file of checks) {
    const resolved = `${basePath}/${normalizedModelId}/${normalizePath(file)}`;
    const ok = await fileExists(fetcher, resolved);
    if (!ok) {
      throw new Error(`Missing required local model asset: ${resolved}`);
    }
  }

  verifiedModelSet.add(normalizedModelId);
}

export function resetModelIntegrityCacheForTests(): void {
  verifiedModelSet.clear();
  manifestPromise = null;
}
