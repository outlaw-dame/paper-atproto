import { withRetry } from '../lib/retry.js';
import { env } from '../config/env.js';
import {
  createGoogleGenAIClient,
  geminiThinkingConfig,
  isGemini3Model,
  resolveGeminiModel,
} from '../lib/googleGenAi.js';
import { ensureSafetyInstructions } from '../lib/safeguards.js';
import { recordWriterEnhancerSkip } from '../llm/writerDiagnostics.js';
import type { WriterRequest, WriterResponse } from './qwenWriter.js';

type EnhancerDecision = {
  decision: 'accept' | 'replace';
  issues: string[];
  response?: unknown;
};

const ENHANCER_HTTP_RETRY_ATTEMPTS = 3;
const ENHANCER_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'issues'],
  properties: {
    decision: {
      type: 'string',
      enum: ['accept', 'replace'],
    },
    issues: {
      type: 'array',
      items: {
        type: 'string',
      },
      maxItems: 6,
    },
    response: {
      type: 'object',
      additionalProperties: false,
      required: ['collapsedSummary', 'whatChanged', 'contributorBlurbs', 'abstained', 'mode'],
      properties: {
        collapsedSummary: { type: 'string' },
        expandedSummary: { type: 'string' },
        whatChanged: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 6,
        },
        contributorBlurbs: {
          type: 'array',
          maxItems: 5,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['handle', 'blurb'],
            properties: {
              handle: { type: 'string' },
              blurb: { type: 'string' },
            },
          },
        },
        abstained: { type: 'boolean' },
        mode: {
          type: 'string',
          enum: ['normal', 'descriptive_fallback', 'minimal_fallback'],
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT_BASE = `You are the Gemini Interpolator QA and takeover layer for Glympse.

You are reviewing a candidate output from the base Interpolator writer.
Your job is to verify whether the candidate performed the canonical Interpolator function correctly.

You must know the writer's contract:
- It summarizes a social thread from structured input only.
- It never invents people, entities, claims, sources, or chronology.
- It leads with thread substance, not vague framing about "the thread" or "the discussion".
- It names the root author when that helps anchor who is making the claim or framing the post.
- It names one or two contributors by handle when they materially shape the thread.
- It reflects observable reply behavior when replies exist.
- It only mentions entities already present in VERIFIED ENTITIES / SAFE ENTITIES.
- It avoids raw URLs, generic filler, and canned lines like "Replies are active" or "People are reacting".
- In descriptive_fallback it must not copy the root post too closely.
- contributorBlurbs must describe specific acts from replies, never generic role labels.
- whatChanged items must stay concise and grounded in thread signals.

AUDIT CHECKLIST
Replace the candidate when any of the following is true:
- It is generic, stale, vague, or mostly root-post restatement.
- It flattens meaningful contributors into generic "replies".
- It misses the root author when the summary needs an anchor.
- It ignores visible reply behavior or thread signals.
- It invents claims, people, entities, or sources.
- It violates mode-specific format or length constraints.
- It starts with a banned opener or uses raw URLs / narrated-link phrasing.
- contributorBlurbs are generic or unsupported.
- The base writer failed and there is no usable candidate to accept.

DECISION RULE
- Return "accept" only when the candidate already fulfills the contract cleanly.
- Return "replace" when you can produce a clearly better canonical writer response.

OUTPUT JSON ONLY
{
  "decision": "accept" | "replace",
  "issues": ["short issue labels"],
  "response": {
    "collapsedSummary": "string",
    "expandedSummary": "optional string",
    "whatChanged": ["string"],
    "contributorBlurbs": [{ "handle": "string", "blurb": "string" }],
    "abstained": false,
    "mode": "normal | descriptive_fallback | minimal_fallback"
  }
}

If decision is "accept", omit response.
If decision is "replace", response is required and must fully satisfy the canonical writer contract.
Return JSON only. No markdown. No code fences.`;

const SYSTEM_PROMPT = ensureSafetyInstructions(SYSTEM_PROMPT_BASE);

const CANONICAL_PATHS = [
  'server/src/services/qwenWriter.ts — canonical Interpolator writer contract, mode rules, and output shape',
  'src/conversation/sessionAssembler.ts — hot-path session assembly that uses the writer summary as the canonical thread view',
  'src/intelligence/modelClient.ts — downstream fallback and quality expectations for collapsedSummary, whatChanged, and contributor blurbs',
] as const;

function enhancerEnabled(): boolean {
  return Boolean(env.GEMINI_INTERPOLATOR_ENHANCER_ENABLED && env.GEMINI_API_KEY);
}

function sanitizeText(value: string, maxLen: number): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function normalizeLikelyJson(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, '\'')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

function looksLikeTruncatedJson(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('"')) {
    return false;
  }
  return !trimmed.endsWith('}') && !trimmed.endsWith(']') && !trimmed.endsWith('"');
}

function parseEnhancerJson(raw: string): unknown {
  const trimmed = raw.trim();
  const extracted = extractJsonObject(trimmed);
  const candidates = [
    trimmed,
    normalizeLikelyJson(trimmed),
    extracted,
    normalizeLikelyJson(extracted),
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === 'string') {
        const nested = normalizeLikelyJson(extractJsonObject(parsed));
        return JSON.parse(nested);
      }
      return parsed;
    } catch {
      // Try the next repair candidate.
    }
  }

  throw Object.assign(new Error('Gemini interpolator enhancer returned invalid JSON'), {
    status: 502,
    preview: normalizeLikelyJson(raw).slice(0, 220),
    responseChars: raw.length,
    retryable: looksLikeTruncatedJson(raw),
  });
}

function buildModeConstraints(mode: WriterRequest['summaryMode']): string {
  if (mode === 'minimal_fallback') {
    return 'Exactly 2 sentences. concrete root-post substance + observable reply activity. whatChanged=[] contributorBlurbs=[] collapsedSummary<=240 chars.';
  }
  if (mode === 'descriptive_fallback') {
    return 'collapsedSummary<=280 chars. characterize root substance in your own words, then describe observable reply patterns. avoid close paraphrase of the root opening words.';
  }
  return 'collapsedSummary 1-3 sentences, max 500 chars. expandedSummary optional only if useful. whatChanged up to 6 concise items. contributorBlurbs up to 5.';
}

function buildStructuredBrief(request: WriterRequest): string {
  const lines: string[] = [];
  lines.push(`MODE: ${request.summaryMode}`);
  lines.push(`MODE CONSTRAINTS: ${buildModeConstraints(request.summaryMode)}`);
  lines.push(
    `CONFIDENCE: surface=${request.confidence.surfaceConfidence.toFixed(2)} entity=${request.confidence.entityConfidence.toFixed(2)} interpretive=${request.confidence.interpretiveConfidence.toFixed(2)}`,
  );
  if (typeof request.visibleReplyCount === 'number') {
    lines.push(`VISIBLE REPLIES: ${request.visibleReplyCount}`);
  }

  lines.push('');
  lines.push(`ROOT POST — @${sanitizeText(request.rootPost.handle, 100)}:`);
  lines.push(sanitizeText(request.rootPost.text, 700));

  if (request.selectedComments.length > 0) {
    lines.push('');
    lines.push('REPLIES:');
    request.selectedComments.forEach((comment, index) => {
      lines.push(
        `${index + 1}. @${sanitizeText(comment.handle, 100)} [impact:${comment.impactScore.toFixed(2)}${comment.role ? `, role:${sanitizeText(comment.role, 40)}` : ''}]: ${sanitizeText(comment.text, 340)}`,
      );
    });
  }

  if (request.topContributors.length > 0) {
    lines.push('');
    lines.push('CONTRIBUTOR DETAILS:');
    request.topContributors.forEach((contributor) => {
      const parts = [
        `@${sanitizeText(contributor.handle, 100)}`,
        `role:${sanitizeText(contributor.role, 40)}`,
        `impact:${contributor.impactScore.toFixed(2)}`,
        sanitizeText(contributor.stanceSummary, 180),
      ];
      if (contributor.stanceExcerpt) {
        parts.push(`point:${sanitizeText(contributor.stanceExcerpt, 180)}`);
      }
      if (contributor.resonance) {
        parts.push(`resonance:${sanitizeText(contributor.resonance, 20)}`);
      }
      if (contributor.agreementSignal) {
        parts.push(`agreement:${sanitizeText(contributor.agreementSignal, 100)}`);
      }
      lines.push(`- ${parts.join(' | ')}`);
    });
  }

  if (request.safeEntities.length > 0) {
    lines.push('');
    lines.push('SAFE ENTITIES:');
    request.safeEntities.forEach((entity) => {
      lines.push(`- ${sanitizeText(entity.label, 120)} [${sanitizeText(entity.type, 40)}]`);
    });
  }

  if (request.entityThemes?.length) {
    lines.push('');
    lines.push('ENTITY THEMES:');
    request.entityThemes.forEach((theme) => lines.push(`- ${sanitizeText(theme, 100)}`));
  }

  if (request.whatChangedSignals.length > 0) {
    lines.push('');
    lines.push('THREAD SIGNALS:');
    request.whatChangedSignals.forEach((signal) => lines.push(`- ${sanitizeText(signal, 180)}`));
  }

  if (request.factualHighlights.length > 0) {
    lines.push('');
    lines.push('FACTUAL HIGHLIGHTS:');
    request.factualHighlights.forEach((highlight) => lines.push(`- ${sanitizeText(highlight, 180)}`));
  }

  if (request.mediaFindings?.length) {
    lines.push('');
    lines.push('MEDIA FINDINGS:');
    request.mediaFindings.forEach((finding) => {
      lines.push(`- ${sanitizeText(finding.mediaType, 40)} (${finding.confidence.toFixed(2)}): ${sanitizeText(finding.summary, 220)}`);
      if (finding.extractedText) {
        lines.push(`  extracted text: ${sanitizeText(finding.extractedText, 220)}`);
      }
    });
  }

  if (request.threadSignalSummary) {
    const summary = request.threadSignalSummary;
    lines.push('');
    lines.push(
      `THREAD SIGNAL SUMMARY: new_angles=${summary.newAnglesCount} clarifications=${summary.clarificationsCount} source_backed=${summary.sourceBackedCount} factual=${summary.factualSignalPresent ? 'yes' : 'no'} evidence=${summary.evidencePresent ? 'yes' : 'no'}`,
    );
  }

  if (request.interpretiveExplanation) {
    lines.push('');
    lines.push(`INTERPRETIVE EXPLANATION: ${sanitizeText(request.interpretiveExplanation, 200)}`);
  }

  return lines.join('\n');
}

function buildUserPrompt(params: {
  request: WriterRequest;
  candidate?: WriterResponse;
  qwenFailure?: string;
}): string {
  const lines: string[] = [];
  lines.push('CANONICAL IMPLEMENTATION PATHS');
  CANONICAL_PATHS.forEach((path) => lines.push(`- ${path}`));
  lines.push('');
  lines.push('STRUCTURED THREAD BRIEF');
  lines.push(buildStructuredBrief(params.request));

  lines.push('');
  lines.push('BASE WRITER STATUS');
  if (params.candidate) {
    lines.push('QWEN_STATUS: candidate_available');
    lines.push('CANDIDATE_RESPONSE_JSON:');
    lines.push(JSON.stringify(params.candidate));
  } else {
    lines.push('QWEN_STATUS: failed');
    lines.push(`QWEN_FAILURE: ${sanitizeText(params.qwenFailure ?? 'unknown failure', 180)}`);
  }

  return lines.join('\n');
}

function resolveTimeoutMs(model: string): number {
  const configured = Number.isFinite(env.LLM_TIMEOUT_MS) ? env.LLM_TIMEOUT_MS : 10_000;
  if (isGemini3Model(model)) {
    return Math.max(12_000, Math.min(configured + 4_000, 15_000));
  }
  return Math.max(10_000, Math.min(configured, 12_000));
}

function validateDecision(raw: unknown): EnhancerDecision {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Gemini interpolator enhancer returned non-object response');
  }

  const record = raw as Record<string, unknown>;
  const decision = record.decision === 'replace' ? 'replace' : record.decision === 'accept' ? 'accept' : null;
  if (!decision) {
    throw new Error('Gemini interpolator enhancer returned invalid decision');
  }

  const issues = Array.isArray(record.issues)
    ? record.issues
        .filter((issue): issue is string => typeof issue === 'string')
        .map((issue) => sanitizeText(issue, 80))
        .filter(Boolean)
        .slice(0, 6)
    : [];

  return {
    decision,
    issues,
    ...(decision === 'replace' && record.response ? { response: record.response } : {}),
  };
}

export async function reviewInterpolatorWriter(params: {
  request: WriterRequest;
  candidate?: WriterResponse;
  qwenFailure?: string;
}): Promise<EnhancerDecision | null> {
  if (!enhancerEnabled()) {
    recordWriterEnhancerSkip('disabled');
    return null;
  }

  const client = createGoogleGenAIClient();
  if (!client) {
    recordWriterEnhancerSkip('unconfigured');
    return null;
  }

  const prompt = buildUserPrompt(params);
  const model = resolveGeminiModel('interpolator-enhancer', env.GEMINI_INTERPOLATOR_ENHANCER_MODEL);
  const timeoutMs = resolveTimeoutMs(model);
  const rawText = await withRetry(
    async () => {
      const response = await client.models.generateContent({
        model,
        contents: `${SYSTEM_PROMPT}\n\n${prompt}`,
        config: {
          maxOutputTokens: 420,
          responseMimeType: 'application/json',
          responseJsonSchema: ENHANCER_RESPONSE_JSON_SCHEMA,
          ...(!isGemini3Model(model)
            ? {
                temperature: 0.1,
                topP: 0.85,
              }
            : {}),
          ...geminiThinkingConfig(model, 'minimal'),
          httpOptions: {
            timeout: timeoutMs,
            retryOptions: {
              attempts: ENHANCER_HTTP_RETRY_ATTEMPTS,
            },
          },
        },
      });
      const text = sanitizeText(response.text ?? '', 8_000);
      if (!text) {
        throw Object.assign(new Error('Gemini interpolator enhancer returned empty output'), { status: 502 });
      }
      parseEnhancerJson(text);
      return text;
    },
    {
      attempts: 2,
      baseDelayMs: 300,
      maxDelayMs: 1_200,
      jitter: true,
      shouldRetry: (error) => {
        const status = (error as { status?: number })?.status;
        const retryable = (error as { retryable?: unknown })?.retryable === true;
        return retryable || (!status || [408, 425, 429, 500, 502, 503, 504].includes(status));
      },
    },
  );

  const parsed = parseEnhancerJson(rawText);

  return validateDecision(parsed);
}
