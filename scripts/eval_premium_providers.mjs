#!/usr/bin/env node

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { evaluateConversationModelQuality } from '../src/evals/aiQualityRubric.ts';
import { PREMIUM_PROVIDER_EVAL_FIXTURES } from '../src/evals/premiumProviderFixtures.ts';

const DEFAULT_BASE_URL = process.env.PREMIUM_EVAL_BASE_URL?.trim() || 'http://127.0.0.1:3011';
const DEFAULT_ACTOR_DID = process.env.PREMIUM_EVAL_ACTOR_DID?.trim() || 'did:plc:testpref';
const PROVIDER_HEADER = 'X-Glympse-AI-Provider';
const DID_HEADER = 'X-Glympse-User-Did';
const CONTENT_TYPE_HEADER = 'content-type';
const DIAGNOSTICS_ENDPOINT = '/api/llm/admin/diagnostics';
const LOCAL_WRITER_ENDPOINT = '/api/llm/write/interpolator';
const DEFAULT_TARGETS = ['local-shipped', 'local-raw', 'gemini', 'openai'];
const TARGET_ALIASES = new Map([
  ['all', 'all'],
  ['local', 'local-shipped'],
  ['local-auto', 'local-shipped'],
  ['local-shipped', 'local-shipped'],
  ['local-enhanced', 'local-shipped'],
  ['local-gemini', 'local-shipped-gemini'],
  ['local-shipped-gemini', 'local-shipped-gemini'],
  ['local-openai', 'local-shipped-openai'],
  ['local-shipped-openai', 'local-shipped-openai'],
  ['local-raw', 'local-raw'],
  ['raw', 'local-raw'],
  ['gemini', 'gemini'],
  ['openai', 'openai'],
]);
const PREMIUM_TARGETS = new Set(['gemini', 'openai']);
const HTTP_RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_HTTP_ATTEMPTS = 3;
const DEFAULT_HTTP_TIMEOUT_MS = 45_000;
const DEFAULT_HTTP_BASE_DELAY_MS = 350;
const DEFAULT_HTTP_MAX_DELAY_MS = 2_500;
const DIAGNOSTICS_STALE_MS = 2 * 60_000;
const MAX_ERROR_PREVIEW_CHARS = 240;
const DEFAULT_BANNED_PHRASES = [
  'the thread centers on',
  'the thread centres on',
  'the visible discussion',
  'visible replies mostly',
  'the discussion centers on',
  'the discussion centres on',
];

export const FIXTURES = PREMIUM_PROVIDER_EVAL_FIXTURES.map((fixture) => ({
  ...fixture,
  request: {
    ...fixture.request,
    actorDid: DEFAULT_ACTOR_DID,
  },
}));

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    targets: [...DEFAULT_TARGETS],
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      args.json = true;
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
    if (arg === '--targets' && argv[index + 1]) {
      args.targets = normalizeTargets(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--targets=')) {
      args.targets = normalizeTargets(arg.slice('--targets='.length));
      continue;
    }
    if (arg === '--providers' && argv[index + 1]) {
      args.targets = normalizePremiumProviders(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--providers=')) {
      args.targets = normalizePremiumProviders(arg.slice('--providers='.length));
    }
  }

  return args;
}

export function normalizePremiumProviders(raw) {
  const allowed = new Set(['gemini', 'openai']);
  const normalized = String(raw)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => allowed.has(value));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ['gemini', 'openai'];
}

export function normalizeTargets(raw) {
  const normalized = String(raw)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => TARGET_ALIASES.get(value))
    .filter(Boolean);

  if (normalized.length === 0 || normalized.includes('all')) {
    return [...DEFAULT_TARGETS];
  }

  return Array.from(new Set(normalized));
}

function sanitizeText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lowerText(value) {
  return sanitizeText(value).toLowerCase();
}

function includesAny(text, candidates) {
  return candidates.some((candidate) => text.includes(candidate.toLowerCase()));
}

function countMatches(text, candidates) {
  return candidates.filter((candidate) => text.includes(candidate.toLowerCase())).length;
}

function buildCombinedOutputText(result) {
  return [
    result.summary,
    result.groundedContext,
    ...(Array.isArray(result.perspectiveGaps) ? result.perspectiveGaps : []),
    ...(Array.isArray(result.followUpQuestions) ? result.followUpQuestions : []),
  ]
    .map((value) => sanitizeText(value))
    .filter(Boolean)
    .join(' ');
}

export function toLocalWriterRequest(request) {
  return {
    threadId: request.threadId,
    summaryMode: request.summaryMode,
    confidence: request.confidence,
    ...(typeof request.visibleReplyCount === 'number' ? { visibleReplyCount: request.visibleReplyCount } : {}),
    rootPost: request.rootPost,
    selectedComments: request.selectedComments,
    topContributors: request.topContributors,
    safeEntities: request.safeEntities,
    factualHighlights: request.factualHighlights,
    whatChangedSignals: request.whatChangedSignals,
    ...(request.mediaFindings ? { mediaFindings: request.mediaFindings } : {}),
    ...(request.threadSignalSummary ? { threadSignalSummary: request.threadSignalSummary } : {}),
    ...(request.interpretiveExplanation ? { interpretiveExplanation: request.interpretiveExplanation } : {}),
    ...(request.entityThemes ? { entityThemes: request.entityThemes } : {}),
  };
}

export function normalizeLocalResult(target, payload) {
  return {
    target,
    summary: sanitizeText(payload?.collapsedSummary),
    groundedContext: sanitizeText(payload?.expandedSummary),
    perspectiveGaps: [],
    followUpQuestions: [],
    meta: {
      mode: sanitizeText(payload?.mode),
      whatChanged: Array.isArray(payload?.whatChanged)
        ? payload.whatChanged.map((value) => sanitizeText(value)).filter(Boolean)
        : [],
      contributorBlurbs: Array.isArray(payload?.contributorBlurbs)
        ? payload.contributorBlurbs.map((entry) => ({
            handle: sanitizeText(entry?.handle),
            blurb: sanitizeText(entry?.blurb),
          })).filter((entry) => entry.handle || entry.blurb)
        : [],
    },
  };
}

function normalizePremiumResult(target, payload) {
  return {
    target,
    summary: sanitizeText(payload?.summary),
    groundedContext: sanitizeText(payload?.groundedContext),
    perspectiveGaps: Array.isArray(payload?.perspectiveGaps)
      ? payload.perspectiveGaps.map((value) => sanitizeText(value)).filter(Boolean)
      : [],
    followUpQuestions: Array.isArray(payload?.followUpQuestions)
      ? payload.followUpQuestions.map((value) => sanitizeText(value)).filter(Boolean)
      : [],
    meta: {
      provider: sanitizeText(payload?.provider),
      confidence: typeof payload?.confidence === 'number' ? payload.confidence : null,
      updatedAt: sanitizeText(payload?.updatedAt),
    },
  };
}

function evaluateInputContract(fixture) {
  const request = fixture.request;
  const checks = [
    {
      id: 'selected_comments',
      pass: Array.isArray(request.selectedComments) && request.selectedComments.length > 0,
      detail: `${request.selectedComments.length} selected comments`,
    },
    {
      id: 'top_contributors',
      pass: Array.isArray(request.topContributors) && request.topContributors.length > 0,
      detail: `${request.topContributors.length} top contributors`,
    },
    {
      id: 'safe_entities',
      pass: Array.isArray(request.safeEntities) && request.safeEntities.length > 0,
      detail: `${request.safeEntities.length} safe entities`,
    },
    {
      id: 'thread_signal_summary',
      pass: Boolean(request.threadSignalSummary),
      detail: request.threadSignalSummary
        ? `source_backed=${request.threadSignalSummary.sourceBackedCount}, evidence=${request.threadSignalSummary.evidencePresent}`
        : 'missing thread signal summary',
    },
    {
      id: 'what_changed_signals',
      pass: Array.isArray(request.whatChangedSignals) && request.whatChangedSignals.length > 0,
      detail: `${request.whatChangedSignals.length} what-changed signals`,
    },
    {
      id: 'interpretive_brief',
      pass: Boolean(request.interpretiveBrief)
        && Array.isArray(request.interpretiveBrief.supports)
        && Array.isArray(request.interpretiveBrief.limits),
      detail: request.interpretiveBrief
        ? `${request.interpretiveBrief.supports.length} supports / ${request.interpretiveBrief.limits.length} limits`
        : 'missing interpretive brief',
    },
    {
      id: 'author_entity_anchor',
      pass: request.safeEntities.some((entity) => lowerText(entity.label) === `@${request.rootPost.handle.toLowerCase()}`),
      detail: `root author @${request.rootPost.handle}`,
    },
  ];

  const passed = checks.filter((check) => check.pass).length;
  return {
    passed,
    total: checks.length,
    checks,
  };
}

function evaluateTargetOutput(fixture, target, result) {
  const outputText = lowerText(buildCombinedOutputText(result));
  const summaryText = lowerText(result.summary);
  const expectations = fixture.expectations;
  const handleMentions = expectations.mustMentionHandles.filter((handle) => outputText.includes(`@${handle.toLowerCase()}`));
  const topicKeywordHits = countMatches(outputText, expectations.topicKeywords);

  const checks = [
    {
      id: 'summary_present',
      pass: sanitizeText(result.summary).length > 0,
      detail: `${sanitizeText(result.summary).length} chars`,
    },
    {
      id: 'complete_sentence',
      pass: /[.!?]$/.test(sanitizeText(result.summary)),
      detail: sanitizeText(result.summary),
    },
    {
      id: 'no_trailing_ellipsis',
      pass: !sanitizeText(result.summary).includes('...'),
      detail: sanitizeText(result.summary),
    },
    {
      id: 'no_generic_scaffolding',
      pass: !includesAny(summaryText, DEFAULT_BANNED_PHRASES),
      detail: sanitizeText(result.summary),
    },
    {
      id: 'participant_mentions',
      pass: handleMentions.length >= expectations.minHandleMentions,
      detail: `${handleMentions.length}/${expectations.minHandleMentions} required handles mentioned`,
    },
    {
      id: 'topic_signal_usage',
      pass: topicKeywordHits >= expectations.minTopicKeywordHits,
      detail: `${topicKeywordHits}/${expectations.minTopicKeywordHits} topic keywords matched`,
    },
    expectations.requireEvidenceGapLanguage
      ? {
          id: 'evidence_gap_language',
          pass: includesAny(outputText, expectations.evidenceGapTerms),
          detail: 'expects language about missing or secondary evidence',
        }
      : {
          id: 'evidence_language',
          pass: includesAny(outputText, expectations.evidenceTerms),
          detail: 'expects language tied to the surfaced evidence',
        },
  ];

  const passed = checks.filter((check) => check.pass).length;
  return {
    target,
    passed,
    total: checks.length,
    checks,
    quality: evaluateConversationModelQuality(fixture, result),
    result,
    handleMentions,
    topicKeywordHits,
  };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headers) {
  const retryAfterMs = headers?.get?.('retry-after-ms');
  if (retryAfterMs) {
    const numeric = Number(retryAfterMs);
    if (Number.isFinite(numeric) && numeric >= 0) return Math.floor(numeric);
  }

  const retryAfter = headers?.get?.('retry-after');
  if (!retryAfter) return null;
  const numeric = Number(retryAfter);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.floor(numeric * 1000);
  }

  const parsedDate = Date.parse(retryAfter);
  return Number.isFinite(parsedDate) ? Math.max(0, parsedDate - Date.now()) : null;
}

function sanitizeErrorPreview(rawText) {
  return sanitizeText(String(rawText ?? '')).slice(0, MAX_ERROR_PREVIEW_CHARS);
}

function computeRetryDelayMs(attempt, headers) {
  const retryAfterMs = parseRetryAfterMs(headers);
  if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)) {
    return Math.min(DEFAULT_HTTP_MAX_DELAY_MS, Math.max(0, retryAfterMs));
  }
  const exponential = Math.min(
    DEFAULT_HTTP_MAX_DELAY_MS,
    DEFAULT_HTTP_BASE_DELAY_MS * (2 ** attempt),
  );
  const jitter = Math.floor(Math.random() * 120);
  return exponential + jitter;
}

async function readJsonResponse(response) {
  const rawText = await response.text();
  if (rawText.trim().length === 0) return {};
  try {
    return JSON.parse(rawText);
  } catch {
    return { error: sanitizeErrorPreview(rawText) };
  }
}

async function fetchJsonWithRetry(url, init, options = {}) {
  let lastError = null;
  const attempts = options.attempts ?? DEFAULT_HTTP_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        const error = new Error(
          sanitizeText(payload?.error || payload?.message || `HTTP ${response.status}`) || `HTTP ${response.status}`,
        );
        error.status = response.status;
        error.headers = response.headers;
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
      const status = error?.status;
      const retryable = status == null || HTTP_RETRYABLE_STATUSES.has(status);
      if (!retryable || attempt === attempts - 1) break;
      await sleep(computeRetryDelayMs(attempt, error?.headers));
    }
  }

  throw lastError;
}

async function postPremiumEvaluation(baseUrl, provider, request) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/premium-ai/interpolator/deep`;
  return fetchJsonWithRetry(endpoint, {
    method: 'POST',
    headers: {
      [CONTENT_TYPE_HEADER]: 'application/json',
      [DID_HEADER]: request.actorDid,
      [PROVIDER_HEADER]: provider,
    },
    body: JSON.stringify(request),
  });
}

function localEnhancerProviderForTarget(target) {
  if (target === 'local-shipped-gemini') return 'gemini';
  if (target === 'local-shipped-openai') return 'openai';
  return null;
}

async function postLocalWriterEvaluationWithProvider(baseUrl, request, preferredProvider = null) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}${LOCAL_WRITER_ENDPOINT}`;
  return fetchJsonWithRetry(endpoint, {
    method: 'POST',
    headers: {
      [CONTENT_TYPE_HEADER]: 'application/json',
      ...(preferredProvider ? { [PROVIDER_HEADER]: preferredProvider } : {}),
    },
    body: JSON.stringify(toLocalWriterRequest(request)),
  });
}

async function readWriterDiagnostics(baseUrl) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}${DIAGNOSTICS_ENDPOINT}`;
  try {
    const payload = await fetchJsonWithRetry(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
    }, {
      attempts: 2,
      timeoutMs: 8_000,
    });
    const writer = payload?.writer ?? null;
    const lastUpdatedAt = sanitizeText(writer?.lastUpdatedAt);
    const lastUpdatedMs = lastUpdatedAt ? Date.parse(lastUpdatedAt) : NaN;
    return {
      snapshot: writer,
      lastUpdatedAt,
      stale: Number.isFinite(lastUpdatedMs) ? Date.now() - lastUpdatedMs > DIAGNOSTICS_STALE_MS : false,
    };
  } catch {
    return null;
  }
}

function summarizeIssueDistributionDelta(before, after) {
  const labels = [];
  for (const [label, value] of Object.entries(after ?? {})) {
    if (label === 'uniqueLabels') continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    const previous = Number(before?.[label] ?? 0);
    const delta = numeric - previous;
    if (delta > 0) labels.push({ label, count: delta });
  }
  return labels.sort((left, right) => right.count - left.count);
}

export function summarizeEnhancerDelta(before, after) {
  const beforeEnhancer = before?.enhancer;
  const afterEnhancer = after?.enhancer;
  if (!beforeEnhancer && !afterEnhancer) return null;

  return {
    invocations: Math.max(0, (afterEnhancer?.invocations ?? 0) - (beforeEnhancer?.invocations ?? 0)),
    reviews: Math.max(0, (afterEnhancer?.reviews ?? 0) - (beforeEnhancer?.reviews ?? 0)),
    candidateTakeovers: Math.max(
      0,
      (afterEnhancer?.appliedTakeovers?.candidate ?? 0) - (beforeEnhancer?.appliedTakeovers?.candidate ?? 0),
    ),
    rescueTakeovers: Math.max(
      0,
      (afterEnhancer?.appliedTakeovers?.rescue ?? 0) - (beforeEnhancer?.appliedTakeovers?.rescue ?? 0),
    ),
    failures: Math.max(0, (afterEnhancer?.failures?.total ?? 0) - (beforeEnhancer?.failures?.total ?? 0)),
    rejectedReplacements: Math.max(
      0,
      (afterEnhancer?.rejectedReplacements?.total ?? 0) - (beforeEnhancer?.rejectedReplacements?.total ?? 0),
    ),
    issueLabels: summarizeIssueDistributionDelta(beforeEnhancer?.issueDistribution, afterEnhancer?.issueDistribution),
    lastFailure: afterEnhancer?.lastFailure ?? null,
  };
}

let rawLocalWriterRunnerPromise = null;

async function getRawLocalWriterRunner() {
  if (!rawLocalWriterRunnerPromise) {
    rawLocalWriterRunnerPromise = (async () => {
      const previous = process.env.GEMINI_INTERPOLATOR_ENHANCER_ENABLED;
      process.env.GEMINI_INTERPOLATOR_ENHANCER_ENABLED = 'false';
      try {
        const module = await import('../server/src/services/qwenWriter.ts');
        if (typeof module.runInterpolatorWriter !== 'function') {
          throw new Error('runInterpolatorWriter was not exported');
        }
        return module.runInterpolatorWriter;
      } catch (error) {
        const message = sanitizeText(error?.message || error);
        throw new Error(
          message.toLowerCase().includes('tsx')
            ? 'local-raw target requires running with `node --import tsx` or `npm run eval:premium-providers`'
            : message,
        );
      } finally {
        if (previous == null) delete process.env.GEMINI_INTERPOLATOR_ENHANCER_ENABLED;
        else process.env.GEMINI_INTERPOLATOR_ENHANCER_ENABLED = previous;
      }
    })();
  }

  return rawLocalWriterRunnerPromise;
}

export async function runTargetEvaluation(baseUrl, target, fixture) {
  if (PREMIUM_TARGETS.has(target)) {
    const payload = await postPremiumEvaluation(baseUrl, target, fixture.request);
    return {
      normalized: normalizePremiumResult(target, payload),
      telemetry: null,
    };
  }

  if (target === 'local-shipped' || target === 'local-shipped-gemini' || target === 'local-shipped-openai') {
    const before = await readWriterDiagnostics(baseUrl);
    const payload = await postLocalWriterEvaluationWithProvider(
      baseUrl,
      fixture.request,
      localEnhancerProviderForTarget(target),
    );
    const after = await readWriterDiagnostics(baseUrl);
    return {
      normalized: normalizeLocalResult(target, payload),
      telemetry: {
        preferredProvider: localEnhancerProviderForTarget(target),
        diagnosticsStaleBefore: before?.stale ?? null,
        diagnosticsStaleAfter: after?.stale ?? null,
        enhancerDelta: summarizeEnhancerDelta(before?.snapshot, after?.snapshot),
      },
    };
  }

  if (target === 'local-raw') {
    const runInterpolatorWriter = await getRawLocalWriterRunner();
    const payload = await runInterpolatorWriter(toLocalWriterRequest(fixture.request));
    return {
      normalized: normalizeLocalResult(target, payload),
      telemetry: {
        enhancerDisabled: true,
      },
    };
  }

  throw new Error(`Unsupported target: ${target}`);
}

function compareResults(left, right) {
  if (right.passed !== left.passed) return right.passed - left.passed;
  return sanitizeText(right.result.summary).length - sanitizeText(left.result.summary).length;
}

function targetLabel(target) {
  return target;
}

async function ensureConversationEvalHealth(baseUrl, targets) {
  const needsHttp = targets.some((target) => target !== 'local-raw');
  if (!needsHttp) return { diagnostics: null };
  return {
    diagnostics: await readWriterDiagnostics(baseUrl),
  };
}

function printHumanReport(report) {
  console.log(`Conversation model evaluation against ${report.baseUrl}`);
  console.log('');

  if (report.bootstrap?.diagnostics === null) {
    console.log('bootstrap: diagnostics unavailable; continuing with live requests only');
    console.log('');
  }

  for (const fixture of report.fixtures) {
    console.log(`${fixture.id}: ${fixture.description}`);
    console.log(`  input contract: ${fixture.inputContract.passed}/${fixture.inputContract.total}`);
    for (const result of fixture.results) {
      if (result.error) {
        console.log(`  ${targetLabel(result.target)}: ERROR - ${result.error}`);
        continue;
      }
      console.log(`  ${targetLabel(result.target)}: ${result.passed}/${result.total} checks • quality ${result.quality?.score ?? 0}/100 ${result.quality?.grade ?? 'n/a'}`);
      console.log(`    summary: ${sanitizeText(result.result.summary)}`);
      if (result.result.groundedContext) {
        console.log(`    context: ${sanitizeText(result.result.groundedContext)}`);
      }
      const failed = result.checks.filter((check) => !check.pass);
      if (failed.length > 0) {
        console.log(`    misses: ${failed.map((check) => check.id).join(', ')}`);
      }
      if (result.telemetry?.enhancerDelta) {
        const delta = result.telemetry.enhancerDelta;
        const labels = delta.issueLabels?.slice(0, 2).map((entry) => `${entry.label}:${entry.count}`).join(', ');
        console.log(
          `    enhancer: invocations=${delta.invocations} reviews=${delta.reviews} candidateTakeovers=${delta.candidateTakeovers} failures=${delta.failures}${labels ? ` issues=${labels}` : ''}`,
        );
      }
      if (result.telemetry?.diagnosticsStaleBefore || result.telemetry?.diagnosticsStaleAfter) {
        console.log(
          `    diagnostics: staleBefore=${String(result.telemetry.diagnosticsStaleBefore)} staleAfter=${String(result.telemetry.diagnosticsStaleAfter)}`,
        );
      }
      if (result.telemetry?.enhancerDisabled) {
        console.log('    enhancer: disabled for raw local measurement');
      }
    }
    if (fixture.winner) {
      console.log(`  winner: ${targetLabel(fixture.winner)}`);
    }
    console.log('');
  }

  console.log('overall:');
  for (const [target, aggregate] of Object.entries(report.overall)) {
    const qualityAverage = aggregate.qualityCount > 0
      ? Math.round((aggregate.qualityTotal / aggregate.qualityCount) * 10) / 10
      : 0;
    console.log(`  ${targetLabel(target)}: ${aggregate.passed}/${aggregate.total} checks • quality ${qualityAverage}/100`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bootstrap = await ensureConversationEvalHealth(args.baseUrl, args.targets);
  const report = {
    baseUrl: args.baseUrl,
    bootstrap,
    fixtures: [],
    overall: {},
  };

  let hadErrors = false;

  for (const fixture of FIXTURES) {
    const inputContract = evaluateInputContract(fixture);
    const fixtureReport = {
      id: fixture.id,
      description: fixture.description,
      inputContract,
      results: [],
      winner: null,
    };

    for (const target of args.targets) {
      try {
        const { normalized, telemetry } = await runTargetEvaluation(args.baseUrl, target, fixture);
        const evaluation = evaluateTargetOutput(fixture, target, normalized);
        evaluation.telemetry = telemetry;
        fixtureReport.results.push(evaluation);
        const aggregate = report.overall[target] ?? { passed: 0, total: 0, qualityTotal: 0, qualityCount: 0 };
        aggregate.passed += evaluation.passed;
        aggregate.total += evaluation.total;
        aggregate.qualityTotal += evaluation.quality.score;
        aggregate.qualityCount += 1;
        report.overall[target] = aggregate;
      } catch (error) {
        hadErrors = true;
        fixtureReport.results.push({
          target,
          error: sanitizeText(error?.message || error),
        });
      }

      await sleep(250);
    }

    const successful = fixtureReport.results.filter((entry) => !entry.error);
    successful.sort(compareResults);
    fixtureReport.winner = successful[0]?.target ?? null;
    report.fixtures.push(fixtureReport);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  if (hadErrors) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error('conversation model evaluation failed');
    console.error(error);
    process.exitCode = 1;
  });
}
