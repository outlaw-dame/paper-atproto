import fs from 'node:fs/promises';
import path from 'node:path';

const MODELS = [
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    purpose: 'Embeddings',
  },
  {
    id: 'Xenova/vit-gpt2-image-captioning',
    purpose: 'Image captions',
  },
  {
    id: 'Xenova/nli-deberta-v3-xsmall',
    purpose: 'Zero-shot tone classification',
  },
  {
    id: 'Xenova/toxic-bert',
    purpose: 'Abuse scoring',
  },
  {
    id: 'Xenova/twitter-roberta-base-sentiment-latest',
    purpose: 'Composer sentiment polarity',
  },
];

const ROOT_DIR = process.cwd();
const OUTPUT_ROOT = path.join(ROOT_DIR, 'public', 'models');

const ROOT_FILE_NAMES = new Set([
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

function shouldDownloadSibling(filename, siblings) {
  const base = path.basename(filename);

  if (filename.startsWith('onnx/')) {
    if (base.endsWith('.onnx') && base.includes('quantized')) return true;
    if (base.endsWith('.onnx_data') && base.includes('quantized')) return true;

    if (base === 'model.onnx') {
      return !siblings.some((name) => name.startsWith('onnx/') && name.endsWith('.onnx') && path.basename(name).includes('quantized'));
    }

    if (base === 'model.onnx_data') {
      return !siblings.some((name) => name.startsWith('onnx/') && name.endsWith('.onnx_data') && path.basename(name).includes('quantized'));
    }

    return false;
  }

  return ROOT_FILE_NAMES.has(base);
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

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

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
  const selected = siblings.filter((filename) => shouldDownloadSibling(filename, siblings));

  if (selected.length === 0) {
    throw new Error(`No browser-ready model assets found for ${model.id}`);
  }

  const modelRoot = path.join(OUTPUT_ROOT, model.id);
  await ensureDir(modelRoot);

  let downloaded = 0;
  let skipped = 0;

  for (const filename of selected) {
    const targetPath = path.join(OUTPUT_ROOT, model.id, filename);
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

async function main() {
  await ensureDir(OUTPUT_ROOT);
  const summary = [];

  for (const model of MODELS) {
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
