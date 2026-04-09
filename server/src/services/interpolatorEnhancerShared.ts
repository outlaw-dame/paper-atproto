import { z } from 'zod';
import { ensureSafetyInstructions } from '../lib/safeguards.js';
import type { WriterRequest, WriterResponse } from './qwenWriter.js';

export type InterpolatorEnhancerProvider = 'gemini' | 'openai';

export type InterpolatorEnhancerDecision = {
  decision: 'accept' | 'replace';
  issues: string[];
  response?: unknown;
};

export type InterpolatorEnhancerReviewInput = {
  request: WriterRequest;
  candidate?: WriterResponse;
  qwenFailure?: string;
};

export type InterpolatorEnhancerReviewResult = {
  provider: InterpolatorEnhancerProvider;
  model: string;
  decision: InterpolatorEnhancerDecision;
};

export type InterpolatorEnhancerProviderReview = {
  model: string;
  decision: InterpolatorEnhancerDecision;
};

const InterpolatorEnhancerResponseSchema = z.object({
  collapsedSummary: z.string(),
  expandedSummary: z.string().nullable(),
  whatChanged: z.array(z.string()).max(6),
  contributorBlurbs: z.array(z.object({
    handle: z.string(),
    blurb: z.string(),
  })).max(5),
  abstained: z.boolean(),
  mode: z.enum(['normal', 'descriptive_fallback', 'minimal_fallback']),
});

export const interpolatorEnhancerDecisionSchema = z.object({
  decision: z.enum(['accept', 'replace']),
  issues: z.array(z.string()).max(6),
  response: InterpolatorEnhancerResponseSchema.nullable(),
}).superRefine((value, ctx) => {
  if (value.decision === 'replace' && value.response === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'replace decision requires response',
      path: ['response'],
    });
  }
});

export const INTERPOLATOR_ENHANCER_RESPONSE_JSON_SCHEMA = {
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

const SYSTEM_PROMPT_BASE = `You are the Glympse Interpolator QA and takeover layer.

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
- It treats CONTEXT TO WATCH as missing-context guardrails, not established facts.
- It avoids raw URLs, generic filler, and canned lines like "Replies are active" or "People are reacting".
- In descriptive_fallback, it should not fall back to scaffolding like "visible replies mostly" or "the discussion centers on".
- When top contributors materially shape the thread, collapsedSummary should name at least one contributor handle instead of flattening them into generic reply language.
- In descriptive_fallback it must not copy the root post too closely.
- contributorBlurbs must describe specific acts from replies, never generic role labels.
- whatChanged items must stay concise and grounded in thread signals.

AUDIT CHECKLIST
Replace the candidate when any of the following is true:
- It is generic, stale, vague, or mostly root-post restatement.
- It flattens meaningful contributors into generic "replies".
- It uses generic scaffolding like "visible replies mostly" instead of grounded thread language.
- It misses the root author when the summary needs an anchor.
- It misses a material contributor handle in collapsedSummary when top contributors clearly shape the thread.
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

export const INTERPOLATOR_ENHANCER_SYSTEM_PROMPT = ensureSafetyInstructions(SYSTEM_PROMPT_BASE);

const CANONICAL_PATHS = [
  'server/src/services/qwenWriter.ts — canonical Interpolator writer contract, mode rules, and output shape',
  'src/conversation/sessionAssembler.ts — hot-path session assembly that uses the writer summary as the canonical thread view',
  'src/intelligence/modelClient.ts — downstream fallback and quality expectations for collapsedSummary, whatChanged, and contributor blurbs',
] as const;

export function sanitizeEnhancerText(value: string, maxLen: number): string {
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

export function parseInterpolatorEnhancerJson(raw: string): unknown {
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

  throw Object.assign(new Error('Interpolator enhancer returned invalid JSON'), {
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
    return 'collapsedSummary<=300 chars. characterize root substance in your own words, then describe observable reply patterns. avoid close paraphrase of the root opening words. do not use scaffolding like "visible replies mostly" or "the discussion centers on". if top contributors materially shape the thread, name at least one handle in collapsedSummary.';
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
  lines.push(`ROOT POST — @${sanitizeEnhancerText(request.rootPost.handle, 100)}:`);
  lines.push(sanitizeEnhancerText(request.rootPost.text, 700));

  if (request.selectedComments.length > 0) {
    lines.push('');
    lines.push('REPLIES:');
    request.selectedComments.forEach((comment, index) => {
      lines.push(
        `${index + 1}. @${sanitizeEnhancerText(comment.handle, 100)} [impact:${comment.impactScore.toFixed(2)}${comment.role ? `, role:${sanitizeEnhancerText(comment.role, 40)}` : ''}]: ${sanitizeEnhancerText(comment.text, 340)}`,
      );
    });
  }

  if (request.topContributors.length > 0) {
    lines.push('');
    lines.push('CONTRIBUTOR DETAILS:');
    request.topContributors.forEach((contributor) => {
      const parts = [
        `@${sanitizeEnhancerText(contributor.handle, 100)}`,
        `role:${sanitizeEnhancerText(contributor.role, 40)}`,
        `impact:${contributor.impactScore.toFixed(2)}`,
        sanitizeEnhancerText(contributor.stanceSummary, 180),
      ];
      if (contributor.stanceExcerpt) {
        parts.push(`point:${sanitizeEnhancerText(contributor.stanceExcerpt, 180)}`);
      }
      if (contributor.resonance) {
        parts.push(`resonance:${sanitizeEnhancerText(contributor.resonance, 20)}`);
      }
      if (contributor.agreementSignal) {
        parts.push(`agreement:${sanitizeEnhancerText(contributor.agreementSignal, 100)}`);
      }
      lines.push(`- ${parts.join(' | ')}`);
    });
  }

  if (request.safeEntities.length > 0) {
    lines.push('');
    lines.push('SAFE ENTITIES:');
    request.safeEntities.forEach((entity) => {
      lines.push(`- ${sanitizeEnhancerText(entity.label, 120)} [${sanitizeEnhancerText(entity.type, 40)}]`);
    });
  }

  if (request.entityThemes?.length) {
    lines.push('');
    lines.push('ENTITY THEMES:');
    request.entityThemes.forEach((theme) => lines.push(`- ${sanitizeEnhancerText(theme, 100)}`));
  }

  if (request.whatChangedSignals.length > 0) {
    lines.push('');
    lines.push('THREAD SIGNALS:');
    request.whatChangedSignals.forEach((signal) => lines.push(`- ${sanitizeEnhancerText(signal, 180)}`));
  }

  if (request.perspectiveGaps?.length) {
    lines.push('');
    lines.push('CONTEXT TO WATCH:');
    request.perspectiveGaps.forEach((gap) => lines.push(`- ${sanitizeEnhancerText(gap, 140)}`));
  }

  if (request.factualHighlights.length > 0) {
    lines.push('');
    lines.push('FACTUAL HIGHLIGHTS:');
    request.factualHighlights.forEach((highlight) => lines.push(`- ${sanitizeEnhancerText(highlight, 180)}`));
  }

  if (request.mediaFindings?.length) {
    lines.push('');
    lines.push('MEDIA FINDINGS:');
    request.mediaFindings.forEach((finding) => {
      lines.push(`- ${sanitizeEnhancerText(finding.mediaType, 40)} (${finding.confidence.toFixed(2)}): ${sanitizeEnhancerText(finding.summary, 220)}`);
      if (finding.extractedText) {
        lines.push(`  extracted text: ${sanitizeEnhancerText(finding.extractedText, 220)}`);
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
    lines.push(`INTERPRETIVE EXPLANATION: ${sanitizeEnhancerText(request.interpretiveExplanation, 200)}`);
  }

  return lines.join('\n');
}

export function buildInterpolatorEnhancerPrompt(
  params: InterpolatorEnhancerReviewInput,
): string {
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
    lines.push(`QWEN_FAILURE: ${sanitizeEnhancerText(params.qwenFailure ?? 'unknown failure', 180)}`);
  }

  return lines.join('\n');
}

export function validateInterpolatorEnhancerDecision(
  raw: unknown,
): InterpolatorEnhancerDecision {
  const normalized = typeof raw === 'object' && raw !== null
    ? (() => {
        const record = raw as Record<string, unknown>;
        if (!('response' in record)) {
          return {
            ...record,
            response: null,
          };
        }
        if (typeof record.response === 'object' && record.response !== null && !('expandedSummary' in (record.response as Record<string, unknown>))) {
          return {
            ...record,
            response: {
              ...(record.response as Record<string, unknown>),
              expandedSummary: null,
            },
          };
        }
        return record;
      })()
    : raw;
  const parsed = interpolatorEnhancerDecisionSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error('Interpolator enhancer returned invalid decision');
  }

  const issues = parsed.data.issues
    .map((issue) => sanitizeEnhancerText(issue, 80))
    .filter(Boolean)
    .slice(0, 6);

  return {
    decision: parsed.data.decision,
    issues,
    ...(parsed.data.response ? {
      response: {
        collapsedSummary: parsed.data.response.collapsedSummary,
        whatChanged: parsed.data.response.whatChanged,
        contributorBlurbs: parsed.data.response.contributorBlurbs,
        abstained: parsed.data.response.abstained,
        mode: parsed.data.response.mode,
        ...(typeof parsed.data.response.expandedSummary === 'string'
          ? { expandedSummary: parsed.data.response.expandedSummary }
          : {}),
      },
    } : {}),
  };
}
