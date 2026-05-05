#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { env } from '../server/src/config/env.ts';
import {
  buildInterpolatorWriterMessages,
  normalizeInterpolatorWriterResponse,
  runInterpolatorWriter,
} from '../server/src/services/qwenWriter.ts';
import {
  FIXTURES,
  evaluateTargetOutput,
  normalizeLocalResult,
  toLocalWriterRequest,
} from './eval_premium_providers.mjs';

const DEFAULT_BASE_URL = process.env.OLLAMA_BASE_URL?.trim() || env.OLLAMA_BASE_URL;
const DEFAULT_TIMEOUT_MS = Number(process.env.LOCAL_WRITER_EVAL_TIMEOUT_MS ?? 6_000);
const WORKERS_AI_API_BASE = 'https://api.cloudflare.com/client/v4/accounts';
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_WORKERS_AI_TIMEOUT_MS = Number(process.env.WORKERS_AI_WRITER_EVAL_TIMEOUT_MS ?? 15_000);
const DEFAULT_OPENROUTER_TIMEOUT_MS = Number(process.env.OPENROUTER_WRITER_EVAL_TIMEOUT_MS ?? 30_000);
const DEFAULT_WORKERS_AI_MODELS = [
  {
    id: '@cf/meta/llama-3.1-8b-instruct',
    target: 'workers_ai_llama31_8b',
    reason: 'strongest general-purpose Workers AI instruct baseline in this set; closest edge-hosted quality comparator to local Qwen3-4B',
  },
  {
    id: '@cf/meta/llama-3.2-1b-instruct',
    target: 'workers_ai_llama32_1b',
    reason: 'smallest latency-oriented Workers AI Llama writer in this set, useful as the edge-speed lower bound against Qwen3 and larger Workers AI models',
  },
  {
    id: '@cf/meta/llama-3.2-3b-instruct',
    target: 'workers_ai_llama32_3b',
    reason: 'smaller latency-oriented edge writer to measure the quality tradeoff against Qwen3 and larger Workers AI models',
  },
];
const LARGE_WORKERS_AI_MODELS = [
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    target: 'workers_ai_llama33_70b_fast',
    reason: 'larger Workers AI Llama family candidate intended to test whether 70B edge inference improves writer quality over Llama 3.2 3B',
  },
  {
    id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    target: 'workers_ai_deepseek_r1_qwen_32b',
    reason: 'larger reasoning-oriented distilled Qwen model, useful for evidence-gap and counterpoint handling',
  },
  {
    id: '@cf/qwen/qwq-32b',
    target: 'workers_ai_qwen_qwq_32b',
    reason: 'larger Qwen-family reasoning model to compare against the local Qwen3 writer baseline',
  },
];
const DEFAULT_OPENROUTER_MODELS = [
  {
    id: 'openai/gpt-4o-mini',
    target: 'openrouter_gpt4o_mini',
    reason: 'fast high-quality hosted baseline with reliable instruction following and JSON output support',
  },
  {
    id: 'google/gemini-2.0-flash-001',
    target: 'openrouter_gemini20_flash',
    reason: 'low-latency Google model to compare concise summarization quality against Qwen and Workers AI',
  },
  {
    id: 'anthropic/claude-3.5-haiku',
    target: 'openrouter_claude35_haiku',
    reason: 'Anthropic small-model writer baseline, useful for grounded summary and safety-sensitive phrasing comparison',
  },
];
const FREE_OPENROUTER_MODELS = [
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    target: 'openrouter_llama33_70b_free',
    reason: 'large free OpenRouter Llama baseline for checking whether hosted 70B improves Interpolator writing quality',
  },
  {
    id: 'qwen/qwen3-next-80b-a3b-instruct:free',
    target: 'openrouter_qwen3_next_80b_free',
    reason: 'large free Qwen-family model to compare directly with the local Qwen3 writer baseline',
  },
  {
    id: 'google/gemma-4-31b-it:free',
    target: 'openrouter_gemma4_31b_free',
    reason: 'large free Gemma-family writer candidate to test the Gemma route through OpenRouter while local Gemma is absent',
  },
];
const WORKERS_AI_ACCOUNT_ID_KEYS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CF_ACCOUNT_ID',
  'CLOUDFLARE_WORKERS_AI_ACCOUNT_ID',
  'WORKERS_AI_ACCOUNT_ID',
  'CLOUDFLARE_AI_ACCOUNT_ID',
  'CLOUDFLARE_ACCOUNTID',
  'CF_ACCOUNTID',
];
const WORKERS_AI_TOKEN_KEYS = [
  'CLOUDFLARE_API_TOKEN',
  'CF_API_TOKEN',
  'CLOUDFLARE_WORKERS_AI_API_TOKEN',
  'WORKERS_AI_API_TOKEN',
  'CLOUDFLARE_AI_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'CF_API_KEY',
  'WORKERS_AI_API_KEY',
];
const OPENROUTER_API_KEY_KEYS = [
  'OPENROUTER_API_KEY',
  'OPENROUTER_TOKEN',
];
const LOCAL_ENV_FILES = ['.env', '.env.local', 'server/.env'];
const WORKERS_AI_WRITER_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    collapsedSummary: { type: 'string' },
    expandedSummary: { type: 'string' },
    whatChanged: { type: 'array', items: { type: 'string' } },
    contributorBlurbs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          handle: { type: 'string' },
          blurb: { type: 'string' },
        },
        required: ['handle', 'blurb'],
      },
    },
    abstained: { type: 'boolean' },
    mode: { type: 'string', enum: ['normal', 'descriptive_fallback', 'minimal_fallback'] },
  },
  required: ['collapsedSummary', 'whatChanged', 'contributorBlurbs', 'abstained', 'mode'],
};

function loadLocalEnvFiles(files = LOCAL_ENV_FILES) {
  for (const file of files) {
    if (!existsSync(file)) continue;
    const contents = readFileSync(file, 'utf8');
    for (const line of contents.split(/\r?\n/u)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/u);
      if (!match) continue;
      const key = match[1];
      if (process.env[key] !== undefined) continue;
      process.env[key] = parseEnvValue(match[2] ?? '');
    }
  }
}

function parseEnvValue(raw) {
  const trimmed = String(raw ?? '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  const hashIndex = trimmed.indexOf(' #');
  return hashIndex >= 0 ? trimmed.slice(0, hashIndex).trim() : trimmed;
}

function firstEnvValue(keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return { key, value };
  }
  return { key: null, value: '' };
}

loadLocalEnvFiles();

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    workersAi: false,
    workersAiOnly: false,
    workersAiModels: DEFAULT_WORKERS_AI_MODELS.map((model) => model.id),
    openrouter: false,
    openrouterOnly: false,
    openrouterModels: DEFAULT_OPENROUTER_MODELS.map((model) => model.id),
    json: false,
    models: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--workers-ai') {
      args.workersAi = true;
      continue;
    }
    if (arg === '--workers-ai-only') {
      args.workersAi = true;
      args.workersAiOnly = true;
      continue;
    }
    if (arg === '--workers-ai-large') {
      args.workersAi = true;
      args.workersAiModels = LARGE_WORKERS_AI_MODELS.map((model) => model.id);
      continue;
    }
    if (arg === '--workers-ai-models' && argv[index + 1]) {
      args.workersAi = true;
      args.workersAiModels = parseList(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--workers-ai-models=')) {
      args.workersAi = true;
      args.workersAiModels = parseList(arg.slice('--workers-ai-models='.length));
      continue;
    }
    if (arg === '--openrouter') {
      args.openrouter = true;
      continue;
    }
    if (arg === '--openrouter-only') {
      args.openrouter = true;
      args.openrouterOnly = true;
      continue;
    }
    if (arg === '--openrouter-free') {
      args.openrouter = true;
      args.openrouterModels = FREE_OPENROUTER_MODELS.map((model) => model.id);
      continue;
    }
    if (arg === '--openrouter-models' && argv[index + 1]) {
      args.openrouter = true;
      args.openrouterModels = parseList(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--openrouter-models=')) {
      args.openrouter = true;
      args.openrouterModels = parseList(arg.slice('--openrouter-models='.length));
      continue;
    }
    if (arg === '--base-url' && argv[index + 1]) {
      args.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      args.baseUrl = arg.slice('--base-url='.length);
      continue;
    }
    if (arg === '--models' && argv[index + 1]) {
      args.models = parseList(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--models=')) {
      args.models = parseList(arg.slice('--models='.length));
    }
  }

  return args;
}

function parseList(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'local_writer';
}

function providerForModel(model) {
  const normalized = model.toLowerCase();
  if (normalized.includes('phi4-mini') || normalized.includes('phi4_mini')) return 'phi4_mini_ollama';
  if (normalized.includes('qwen')) return 'qwen3_4b_ollama';
  if (normalized.includes('gemma')) return 'gemma_writer_local_or_litert';
  return `ollama_${normalizeKey(model)}`;
}

function workersAiModelMetadata(model) {
  const selected = [...DEFAULT_WORKERS_AI_MODELS, ...LARGE_WORKERS_AI_MODELS].find((candidate) => candidate.id === model);
  return selected ?? {
    id: model,
    target: `workers_ai_${normalizeKey(model)}`,
    reason: 'explicitly requested Workers AI writer model',
  };
}

function openrouterModelMetadata(model) {
  const selected = [...DEFAULT_OPENROUTER_MODELS, ...FREE_OPENROUTER_MODELS].find((candidate) => candidate.id === model);
  return selected ?? {
    id: model,
    target: `openrouter_${normalizeKey(model)}`,
    reason: 'explicitly requested OpenRouter writer model',
  };
}

function isLikelyTextWriterModel(model) {
  const normalized = model.toLowerCase();
  if (!/qwen|gemma|phi/.test(normalized)) return false;
  if (/vl|vision|multimodal|mm|embed|embedding|rerank|clip/.test(normalized)) return false;
  return true;
}

async function discoverOllamaModels(baseUrl) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload?.models)
      ? payload.models
          .map((entry) => String(entry?.name ?? entry?.model ?? '').trim())
          .filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

async function resolveCandidateModels(args) {
  const configured = [
    env.QWEN_WRITER_MODEL,
    ...parseList(env.GEMMA_WRITER_MODELS),
    ...args.models,
  ];
  const discovered = await discoverOllamaModels(args.baseUrl);
  const discoveredWriterModels = discovered.filter(isLikelyTextWriterModel);
  const candidates = Array.from(new Set([...configured, ...discoveredWriterModels].filter(Boolean)));
  return {
    discovered,
    discoveredWriterModels,
    configured,
    candidates,
    gemmaConfigured: configured.filter((model) => /gemma/i.test(model)),
    gemmaDiscovered: discoveredWriterModels.filter((model) => /gemma/i.test(model)),
  };
}

function compareResults(left, right) {
  if ((right.passed ?? 0) !== (left.passed ?? 0)) return (right.passed ?? 0) - (left.passed ?? 0);
  return (right.total ?? 0) - (left.total ?? 0);
}

async function evaluateModel(model) {
  const target = providerForModel(model);
  const modelReport = {
    target,
    model,
    fixtures: [],
    passed: 0,
    total: 0,
    errors: 0,
  };

  for (const fixture of FIXTURES) {
    const startedAt = Date.now();
    try {
      const payload = await runInterpolatorWriter(toLocalWriterRequest(fixture.request), {
        localModel: { id: model, label: target },
        enhancer: { enabled: false },
      });
      const normalized = normalizeLocalResult(target, payload);
      const evaluation = evaluateTargetOutput(fixture, target, normalized);
      evaluation.latencyMs = Date.now() - startedAt;
      modelReport.passed += evaluation.passed;
      modelReport.total += evaluation.total;
      modelReport.fixtures.push(evaluation);
    } catch (error) {
      modelReport.errors += 1;
      modelReport.fixtures.push({
        target,
        fixtureId: fixture.id,
        error: String(error?.message || error),
        latencyMs: Date.now() - startedAt,
      });
    }
  }

  return modelReport;
}

function logProgress(args, message) {
  if (!args.json) console.error(message);
}

function getWorkersAiCredentials() {
  const accountId = firstEnvValue(WORKERS_AI_ACCOUNT_ID_KEYS);
  const apiToken = firstEnvValue(WORKERS_AI_TOKEN_KEYS);
  return {
    accountId: accountId.value,
    apiToken: apiToken.value,
    accountIdKey: accountId.key,
    apiTokenKey: apiToken.key,
    available: Boolean(accountId.value && apiToken.value),
  };
}

function getOpenRouterCredentials() {
  const apiKey = firstEnvValue(OPENROUTER_API_KEY_KEYS);
  return {
    apiKey: apiKey.value,
    apiKeyKey: apiKey.key,
    available: Boolean(apiKey.value),
  };
}

function extractWorkersAiText(payload) {
  const result = payload?.result ?? payload;
  if (typeof result === 'string') return result;
  if (typeof result?.response === 'string') return result.response;
  if (typeof result?.text === 'string') return result.text;
  if (typeof result?.output_text === 'string') return result.output_text;
  if (Array.isArray(result?.choices) && typeof result.choices[0]?.message?.content === 'string') {
    return result.choices[0].message.content;
  }
  if (typeof result?.message?.content === 'string') return result.message.content;
  return JSON.stringify(result ?? payload);
}

function extractJsonCandidate(raw) {
  const trimmed = String(raw ?? '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return trimmed;
}

function workersAiResponseFormats(model) {
  return model.includes('llama-3.1')
    ? ['json_schema', 'json_object']
    : ['json_object', 'json_schema'];
}

function buildWorkersAiResponseFormat(format) {
  if (format === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: WORKERS_AI_WRITER_RESPONSE_SCHEMA,
    };
  }
  return { type: 'json_object' };
}

function isWorkersAiResponseFormatRejection(error) {
  if (error?.workersAiCode === 9015 || error?.workersAiCode === 5025) return true;
  return error instanceof SyntaxError;
}

function buildOpenRouterResponseFormat(format) {
  if (format === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name: 'interpolator_writer_response',
        strict: true,
        schema: WORKERS_AI_WRITER_RESPONSE_SCHEMA,
      },
    };
  }
  if (format === 'json_object') return { type: 'json_object' };
  return undefined;
}

function isOpenRouterResponseFormatRejection(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return /response_format|json_schema|json_object|schema/.test(message)
    && /unsupported|invalid|not support|not supported|unknown|bad request|400/.test(message);
}

async function callOpenRouterWriter(model, request, credentials) {
  let lastError = null;
  for (const format of ['json_schema', 'json_object', 'none']) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_OPENROUTER_TIMEOUT_MS);
    const responseFormat = buildOpenRouterResponseFormat(format);
    try {
      const response = await fetch(OPENROUTER_API_BASE, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credentials.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'http-referer': 'https://github.com/outlaw-dame/paper-atproto',
          'x-title': 'paper-atproto writer evaluation',
        },
        body: JSON.stringify({
          model,
          messages: buildInterpolatorWriterMessages(request),
          ...(responseFormat ? { response_format: responseFormat } : {}),
          temperature: 0.35,
          top_p: 0.9,
          max_tokens: 700,
        }),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.error) {
        const errorPayload = payload?.error ?? payload;
        const errorMessage = typeof errorPayload?.message === 'string'
          ? errorPayload.message
          : `OpenRouter responded ${response.status}`;
        const error = new Error(`${errorMessage} status=${response.status}`);
        error.openRouterStatus = response.status;
        throw error;
      }

      const text = typeof payload?.choices?.[0]?.message?.content === 'string'
        ? payload.choices[0].message.content
        : extractWorkersAiText(payload);
      return normalizeInterpolatorWriterResponse(JSON.parse(extractJsonCandidate(text)), request);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`OpenRouter request timed out after ${DEFAULT_OPENROUTER_TIMEOUT_MS}ms`);
      }
      lastError = error;
      if (format === 'none' || !isOpenRouterResponseFormatRejection(error)) throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError;
}

async function callWorkersAiWriter(model, request, credentials) {
  const endpoint = `${WORKERS_AI_API_BASE}/${credentials.accountId}/ai/run/${model}`;
  let lastError = null;
  for (const format of workersAiResponseFormats(model)) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_WORKERS_AI_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credentials.apiToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          messages: buildInterpolatorWriterMessages(request),
          response_format: buildWorkersAiResponseFormat(format),
          temperature: 0.35,
          top_p: 0.9,
          max_tokens: 700,
        }),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) {
        const apiMessage = Array.isArray(payload?.errors) && payload.errors[0]?.message
          ? payload.errors[0].message
          : `Workers AI responded ${response.status}`;
        const apiCode = Array.isArray(payload?.errors) && payload.errors[0]?.code
          ? Number(payload.errors[0].code)
          : null;
        const error = new Error(`${apiMessage} status=${response.status}${apiCode ? ` code=${apiCode}` : ''}`);
        error.workersAiCode = apiCode;
        throw error;
      }

      const text = extractWorkersAiText(payload);
      return normalizeInterpolatorWriterResponse(JSON.parse(extractJsonCandidate(text)), request);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Workers AI request timed out after ${DEFAULT_WORKERS_AI_TIMEOUT_MS}ms`);
      }
      lastError = error;
      if (!isWorkersAiResponseFormatRejection(error)) throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError;
}

async function evaluateWorkersAiModel(model, credentials, args) {
  const metadata = workersAiModelMetadata(model);
  const modelReport = {
    target: metadata.target,
    model,
    provider: 'cloudflare-workers-ai',
    selectionReason: metadata.reason,
    fixtures: [],
    passed: 0,
    total: 0,
    errors: 0,
  };

  if (!credentials.available) {
    modelReport.errors = FIXTURES.length;
    modelReport.fixtures = FIXTURES.map((fixture) => ({
      target: metadata.target,
      fixtureId: fixture.id,
      error: 'Cloudflare Workers AI credentials missing: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or CF_ACCOUNT_ID and CF_API_TOKEN.',
      latencyMs: 0,
    }));
    return modelReport;
  }

  for (const fixture of FIXTURES) {
    const startedAt = Date.now();
    logProgress(args, `workers-ai start ${metadata.target}:${fixture.id}`);
    try {
      const payload = await callWorkersAiWriter(model, toLocalWriterRequest(fixture.request), credentials);
      const normalized = normalizeLocalResult(metadata.target, payload);
      const evaluation = evaluateTargetOutput(fixture, metadata.target, normalized);
      evaluation.latencyMs = Date.now() - startedAt;
      modelReport.passed += evaluation.passed;
      modelReport.total += evaluation.total;
      modelReport.fixtures.push(evaluation);
      logProgress(args, `workers-ai done ${metadata.target}:${fixture.id} ${evaluation.passed}/${evaluation.total} ${evaluation.latencyMs}ms`);
    } catch (error) {
      modelReport.errors += 1;
      const errorMessage = String(error?.message || error);
      modelReport.fixtures.push({
        target: metadata.target,
        fixtureId: fixture.id,
        error: errorMessage,
        latencyMs: Date.now() - startedAt,
      });
      logProgress(args, `workers-ai error ${metadata.target}:${fixture.id} ${errorMessage}`);
    }
  }

  return modelReport;
}

async function evaluateOpenRouterModel(model, credentials, args) {
  const metadata = openrouterModelMetadata(model);
  const modelReport = {
    target: metadata.target,
    model,
    provider: 'openrouter',
    selectionReason: metadata.reason,
    fixtures: [],
    passed: 0,
    total: 0,
    errors: 0,
  };

  if (!credentials.available) {
    modelReport.errors = FIXTURES.length;
    modelReport.fixtures = FIXTURES.map((fixture) => ({
      target: metadata.target,
      fixtureId: fixture.id,
      error: 'OpenRouter credentials missing: set OPENROUTER_API_KEY.',
      latencyMs: 0,
    }));
    return modelReport;
  }

  for (const fixture of FIXTURES) {
    const startedAt = Date.now();
    logProgress(args, `openrouter start ${metadata.target}:${fixture.id}`);
    try {
      const payload = await callOpenRouterWriter(model, toLocalWriterRequest(fixture.request), credentials);
      const normalized = normalizeLocalResult(metadata.target, payload);
      const evaluation = evaluateTargetOutput(fixture, metadata.target, normalized);
      evaluation.latencyMs = Date.now() - startedAt;
      modelReport.passed += evaluation.passed;
      modelReport.total += evaluation.total;
      modelReport.fixtures.push(evaluation);
      logProgress(args, `openrouter done ${metadata.target}:${fixture.id} ${evaluation.passed}/${evaluation.total} ${evaluation.latencyMs}ms`);
    } catch (error) {
      modelReport.errors += 1;
      const errorMessage = String(error?.message || error);
      modelReport.fixtures.push({
        target: metadata.target,
        fixtureId: fixture.id,
        error: errorMessage,
        latencyMs: Date.now() - startedAt,
      });
      logProgress(args, `openrouter error ${metadata.target}:${fixture.id} ${errorMessage}`);
    }
  }

  return modelReport;
}

function printHumanReport(report) {
  console.log('Local writer comparison');
  console.log('');
  console.log(`ollama: ${report.baseUrl}`);
  console.log(`candidates: ${report.candidates.map((candidate) => candidate.model).join(', ') || 'none'}`);
  if (report.workersAiCandidates.length > 0) {
    console.log(`workers-ai: ${report.workersAiCredentialsAvailable ? 'credentials present' : 'credentials missing'}`);
    if (report.workersAiCredentialsAvailable) {
      console.log(`workers-ai env: account=${report.workersAiCredentialKeys.accountIdKey} token=${report.workersAiCredentialKeys.apiTokenKey}`);
    }
    for (const candidate of report.workersAiCandidates) {
      console.log(`  ${candidate.id}: ${candidate.reason}`);
    }
  }
  if (report.openrouterCandidates.length > 0) {
    console.log(`openrouter: ${report.openrouterCredentialsAvailable ? 'credentials present' : 'credentials missing'}`);
    if (report.openrouterCredentialsAvailable) {
      console.log(`openrouter env: key=${report.openrouterCredentialKeys.apiKeyKey}`);
    }
    for (const candidate of report.openrouterCandidates) {
      console.log(`  ${candidate.id}: ${candidate.reason}`);
    }
  }
  if (report.inventory.gemmaDiscovered.length === 0 && report.inventory.gemmaConfigured.length === 0) {
    console.log('gemma: no local Gemma writer tag discovered or configured');
  }
  console.log('');

  for (const candidate of report.rankedCandidates) {
    const rate = candidate.total > 0 ? (candidate.passed / candidate.total).toFixed(4) : '0.0000';
    console.log(`${candidate.target} (${candidate.model}): ${candidate.passed}/${candidate.total} rate=${rate} errors=${candidate.errors}`);
    const misses = candidate.fixtures
      .filter((fixture) => !fixture.error)
      .flatMap((fixture) => fixture.checks.filter((check) => !check.pass).map((check) => `${fixture.target}:${check.id}`));
    if (misses.length > 0) console.log(`  misses: ${misses.slice(0, 8).join(', ')}`);
    for (const error of candidate.fixtures.filter((fixture) => fixture.error)) {
      console.log(`  error ${error.fixtureId}: ${error.error}`);
    }
  }

  if (report.winner) {
    console.log('');
    console.log(`winner: ${report.winner.target} (${report.winner.model})`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inventory = await resolveCandidateModels(args);
  const workersAiCredentials = getWorkersAiCredentials();
  const openrouterCredentials = getOpenRouterCredentials();
  const candidates = [];

  for (const model of args.workersAiOnly || args.openrouterOnly ? [] : inventory.candidates) {
    logProgress(args, `local start ${providerForModel(model)} (${model})`);
    candidates.push(await evaluateModel(model));
    logProgress(args, `local done ${providerForModel(model)} (${model})`);
  }

  const workersAiCandidates = args.workersAi
    ? Array.from(new Set(args.workersAiModels.filter(Boolean))).map(workersAiModelMetadata)
    : [];
  if (workersAiCandidates.length > 0) {
    candidates.push(...await Promise.all(
      workersAiCandidates.map((candidate) => evaluateWorkersAiModel(candidate.id, workersAiCredentials, args)),
    ));
  }
  const openrouterCandidates = args.openrouter
    ? Array.from(new Set(args.openrouterModels.filter(Boolean))).map(openrouterModelMetadata)
    : [];
  if (openrouterCandidates.length > 0) {
    for (const candidate of openrouterCandidates) {
      candidates.push(await evaluateOpenRouterModel(candidate.id, openrouterCredentials, args));
    }
  }

  const rankedCandidates = [...candidates].sort(compareResults);
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    workersAiCredentialsAvailable: workersAiCredentials.available,
    workersAiCredentialKeys: {
      accountIdKey: workersAiCredentials.accountIdKey,
      apiTokenKey: workersAiCredentials.apiTokenKey,
    },
    workersAiCandidates,
    openrouterCredentialsAvailable: openrouterCredentials.available,
    openrouterCredentialKeys: {
      apiKeyKey: openrouterCredentials.apiKeyKey,
    },
    openrouterCandidates,
    inventory,
    candidates,
    rankedCandidates,
    winner: rankedCandidates.find((candidate) => candidate.total > 0) ?? null,
  };

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printHumanReport(report);

  if (candidates.length === 0 || candidates.every((candidate) => candidate.errors > 0)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error('local writer comparison failed');
    console.error(error);
    process.exitCode = 1;
  });
}