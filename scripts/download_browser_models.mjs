import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = process.cwd();
const OUTPUT_ROOT = path.join(ROOT_DIR, 'public', 'models');
const SCRIPT_PATH = fileURLToPath(import.meta.url);

const ROOT_FILE_NAMES = new Set([
  'chat_template.jinja',
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'processor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'quantize_config.json',
  'vocab.json',
  'vocab.txt',
  'merges.txt',
  'added_tokens.json',
  'sentencepiece.bpe.model',
  'spiece.model',
]);

const MODEL_CATALOG = {
  embeddings: {
    key: 'embeddings',
    id: 'Xenova/all-MiniLM-L6-v2',
    purpose: 'Embeddings',
    variant: 'quantized',
  },
  image_captioning: {
    key: 'image_captioning',
    id: 'Xenova/vit-gpt2-image-captioning',
    purpose: 'Image captions',
    variant: 'quantized',
  },
  tone: {
    key: 'tone',
    id: 'Xenova/nli-deberta-v3-xsmall',
    purpose: 'Zero-shot tone classification',
    variant: 'quantized',
  },
  toxicity: {
    key: 'toxicity',
    id: 'Xenova/toxic-bert',
    purpose: 'Abuse scoring',
    variant: 'quantized',
  },
  sentiment: {
    key: 'sentiment',
    id: 'Xenova/twitter-roberta-base-sentiment-latest',
    purpose: 'Composer sentiment polarity',
    variant: 'quantized',
  },
  smollm3_3b: {
    key: 'smollm3_3b',
    id: 'HuggingFaceTB/SmolLM3-3B-ONNX',
    purpose: 'Local text generation fallback',
    variant: 'q4f16',
  },
  qwen35_2b_mm: {
    key: 'qwen35_2b_mm',
    id: 'onnx-community/Qwen3.5-2B-ONNX',
    purpose: 'On-demand local multimodal staging',
    variant: 'q4f16',
  },
};

const MODEL_PROFILES = {
  core: ['embeddings', 'image_captioning', 'tone', 'toxicity', 'sentiment'],
  balanced: ['embeddings', 'image_captioning', 'tone', 'toxicity', 'sentiment', 'smollm3_3b'],
  multimodal: ['qwen35_2b_mm'],
  premium: ['embeddings', 'image_captioning', 'tone', 'toxicity', 'sentiment', 'smollm3_3b', 'qwen35_2b_mm'],
};

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_FETCH_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 400;
const MAX_RETRY_DELAY_MS = 6_000;

export function parseArgs(argv) {
  const options = {
    profiles: [],
    include: [],
    list: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--list') {
      options.list = true;
      continue;
    }

    if (arg === '--profile' || arg === '--profiles') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a comma-separated value.`);
      }
      options.profiles.push(...splitCsv(value));
      index += 1;
      continue;
    }

    if (arg.startsWith('--profile=')) {
      options.profiles.push(...splitCsv(arg.slice('--profile='.length)));
      continue;
    }

    if (arg === '--include') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a comma-separated value.`);
      }
      options.include.push(...splitCsv(value));
      index += 1;
      continue;
    }

    if (arg.startsWith('--include=')) {
      options.include.push(...splitCsv(arg.slice('--include='.length)));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function resolveModels(options) {
  const selectedKeys = [];
  const profiles = options.profiles.length > 0 ? options.profiles : ['core'];

  for (const profile of profiles) {
    const modelKeys = MODEL_PROFILES[profile];
    if (!modelKeys) {
      throw new Error(`Unknown profile: ${profile}`);
    }
    selectedKeys.push(...modelKeys);
  }

  for (const key of options.include) {
    if (!MODEL_CATALOG[key]) {
      throw new Error(`Unknown model key: ${key}`);
    }
    selectedKeys.push(key);
  }

  return dedupe(selectedKeys).map((key) => MODEL_CATALOG[key]);
}

export function selectModelFiles(model, siblings) {
  const rootFiles = siblings.filter((filename) => ROOT_FILE_NAMES.has(path.basename(filename)));
  const onnxFiles = siblings.filter((filename) => filename.startsWith('onnx/'));
  const variantFiles = selectVariantFiles(model.variant, onnxFiles);

  const selected = dedupe([...rootFiles, ...variantFiles]).sort((left, right) => left.localeCompare(right));
  if (selected.length === 0) {
    throw new Error(`No browser-ready model assets found for ${model.id}`);
  }

  return selected;
}

function splitCsv(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function dedupe(values) {
  return [...new Set(values)];
}

function selectVariantFiles(variant, siblings) {
  const candidates = siblings.filter((filename) => isOnnxAsset(filename));
  const matching = candidates.filter((filename) => matchesVariant(filename, variant));
  if (matching.length > 0) {
    return matching;
  }

  const fallback = candidates.filter((filename) => isDefaultOnnxFallback(filename));
  return fallback;
}

function isOnnxAsset(filename) {
  return /\.onnx(?:_data(?:_\d+)?)?$/.test(path.basename(filename));
}

function matchesVariant(filename, variant) {
  const base = path.basename(filename);
  switch (variant) {
    case 'q4f16':
      return base.includes('q4f16');
    case 'quantized':
      return base.includes('quantized');
    case 'q4':
      return base.includes('q4');
    default:
      return false;
  }
}

function isDefaultOnnxFallback(filename) {
  const base = path.basename(filename);
  return base === 'model.onnx' || base === 'model.onnx_data';
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function fetchWithRetry(url, init = {}, expectedAction = 'fetch') {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        return response;
      }

      if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === MAX_FETCH_ATTEMPTS) {
        throw new Error(`Failed to ${expectedAction} ${url}: ${response.status} ${response.statusText}`);
      }

      lastError = new Error(`Retryable ${response.status} while attempting to ${expectedAction} ${url}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === MAX_FETCH_ATTEMPTS) {
        break;
      }
    }

    await sleep(withJitter(backoffDelay(attempt)));
  }

  throw lastError ?? new Error(`Failed to ${expectedAction} ${url}`);
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url, {}, 'fetch JSON from');
  return response.json();
}

async function downloadFile(url, targetPath) {
  const response = await fetchWithRetry(url, {}, 'download');
  await ensureDir(path.dirname(targetPath));
  const bytes = new Uint8Array(await response.arrayBuffer());
  await fs.writeFile(targetPath, bytes);
}

async function listModelFiles(modelId) {
  const modelUrl = `https://huggingface.co/api/models/${modelId}`;
  const data = await fetchJson(modelUrl);
  return Array.isArray(data?.siblings)
    ? data.siblings.map((entry) => entry?.rfilename).filter((value) => typeof value === 'string')
    : [];
}

async function installModel(model) {
  const siblings = await listModelFiles(model.id);
  const selected = selectModelFiles(model, siblings);

  const modelRoot = path.join(OUTPUT_ROOT, model.id);
  await ensureDir(modelRoot);

  let downloaded = 0;
  let skipped = 0;

  for (const filename of selected) {
    const targetPath = path.join(modelRoot, filename);
    if (await fileExists(targetPath)) {
      skipped += 1;
      continue;
    }

    const fileUrl = `https://huggingface.co/${model.id}/resolve/main/${filename}`;
    await downloadFile(fileUrl, targetPath);
    downloaded += 1;
  }

  return {
    selectedCount: selected.length,
    downloaded,
    skipped,
    modelRoot,
  };
}

function listAvailableOptions() {
  process.stdout.write('Available browser model profiles:\n');
  for (const [profile, keys] of Object.entries(MODEL_PROFILES)) {
    process.stdout.write(`- ${profile}: ${keys.join(', ')}\n`);
  }

  process.stdout.write('\nAvailable model keys:\n');
  for (const model of Object.values(MODEL_CATALOG)) {
    process.stdout.write(`- ${model.key}: ${model.id} (${model.purpose}, variant=${model.variant})\n`);
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.list) {
    listAvailableOptions();
    return;
  }

  const models = resolveModels(options);
  await ensureDir(OUTPUT_ROOT);
  const summary = [];

  for (const model of models) {
    process.stdout.write(`Installing ${model.id} (${model.purpose})...\n`);
    const result = await installModel(model);
    summary.push({ ...model, ...result });
    process.stdout.write(`  done: ${result.downloaded} downloaded, ${result.skipped} cached\n`);
  }

  process.stdout.write('\nInstalled browser models:\n');
  for (const item of summary) {
    process.stdout.write(`- ${item.id}: ${item.selectedCount} files in ${item.modelRoot}\n`);
  }
}

function backoffDelay(attempt) {
  const exponential = BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempt - 1));
  return Math.min(MAX_RETRY_DELAY_MS, exponential);
}

function withJitter(delayMs) {
  const jitter = Math.floor(delayMs * 0.2 * Math.random());
  return delayMs + jitter;
}

function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
