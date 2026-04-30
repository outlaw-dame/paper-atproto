import { z } from 'zod';
import type { SafetyFilterResult } from '../services/safetyFilters.js';
import { ValidationError } from '../lib/errors.js';

export type LlmPolicyTask =
  | 'interpolator'
  | 'media'
  | 'searchStory'
  | 'composerGuidance'
  | 'composerClassifier'
  | 'premiumDeep'
  | 'verificationGrounding'
  | 'localTextGeneration'
  | 'localMultimodal';

type LlmAuditLevel = 'info' | 'warn' | 'error';
type ThreatSeverity = 'low' | 'medium' | 'high';
type ToolPolicyMode = 'deny_all' | 'allowlisted';
type RedactionKind =
  | 'bearer_token'
  | 'jwt'
  | 'api_key'
  | 'cookie_like'
  | 'generic_secret';

type ThreatCategory =
  | 'instruction_override'
  | 'tool_override'
  | 'prompt_exfiltration'
  | 'role_spoofing'
  | 'document_attack_marker';

export interface LlmThreatMatch {
  category: ThreatCategory;
  severity: ThreatSeverity;
  path: string;
  pattern: string;
}

export interface LlmRedactionEvent {
  kind: RedactionKind;
  path: string;
  count: number;
}

export interface LlmPolicyAuditSnapshot {
  task: LlmPolicyTask;
  requestId: string;
  toolPolicy: ToolPolicyMode;
  threats: LlmThreatMatch[];
  redactions: LlmRedactionEvent[];
}

interface LlmThreatRule {
  category: ThreatCategory;
  severity: ThreatSeverity;
  pattern: RegExp;
}

interface LlmRedactionRule {
  kind: RedactionKind;
  pattern: RegExp;
  replacement: string;
}

type PathPolicy = {
  skipThreatScan?: boolean;
  skipRedaction?: boolean;
};

type LlmPolicyContext = {
  task: LlmPolicyTask;
  requestId: string;
  toolPolicy?: ToolPolicyMode;
  pathPolicy?: (path: string) => PathPolicy;
};

type PreparedInput<T> = {
  data: T;
  audit: LlmPolicyAuditSnapshot;
};

type FinalizedOutput<T> = {
  data: T;
  audit: LlmPolicyAuditSnapshot;
  safetyMetadata?: SafetyFilterResult;
};

const THREAT_RULES: readonly LlmThreatRule[] = [
  {
    category: 'instruction_override',
    severity: 'medium',
    pattern: /\b(?:ignore|disregard|forget|bypass|override)\b[\s\S]{0,60}\b(?:previous|prior|above|earlier|system|developer|safety|policy|instructions?)\b/gi,
  },
  {
    category: 'tool_override',
    severity: 'high',
    pattern: /\b(?:use|call|invoke|run|execute|open|fetch|download)\b[\s\S]{0,60}\b(?:tool|function|browser|shell|command|curl|http|https|url)\b/gi,
  },
  {
    category: 'prompt_exfiltration',
    severity: 'high',
    pattern: /\b(?:reveal|print|dump|show|expose|leak|return)\b[\s\S]{0,60}\b(?:system prompt|developer prompt|hidden prompt|prompt text|secret|api key|token|cookie|credential)\b/gi,
  },
  {
    category: 'role_spoofing',
    severity: 'medium',
    pattern: /(?:^|\n|\r|\b)(?:system|assistant|developer|tool)\s*:\s*/gi,
  },
  {
    category: 'document_attack_marker',
    severity: 'medium',
    pattern: /(?:begin|start)\s+(?:system|developer|hidden)\s+prompt|<\s*system\s*>|<\s*assistant\s*>|do not summarize|instead of summarizing/gi,
  },
];

const REDACTION_RULES: readonly LlmRedactionRule[] = [
  {
    kind: 'bearer_token',
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
    replacement: 'Bearer [redacted-secret]',
  },
  {
    kind: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g,
    replacement: '[redacted-secret]',
  },
  {
    kind: 'api_key',
    pattern: /\b(?:sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{20,})\b/g,
    replacement: '[redacted-secret]',
  },
  {
    kind: 'cookie_like',
    pattern: /\b(?:session|auth|refresh|access|api)[-_]?(?:token|key|cookie|secret)?\s*=\s*[^;\s]+/gi,
    replacement: '[redacted-secret]',
  },
  {
    kind: 'generic_secret',
    pattern: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*[A-Za-z0-9._~+\-\/=]{12,}\b/gi,
    replacement: '[redacted-secret]',
  },
];

const NON_SEMANTIC_PATH_SEGMENTS = new Set([
  'threadid',
  'storyid',
  'actordid',
  'id',
  'uri',
  'did',
  'createdat',
  'mediaurl',
  'mode',
  'summarymode',
]);

function logPolicyEvent(level: LlmAuditLevel, event: string, payload: Record<string, unknown>): void {
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  logger('[llm/policy/audit]', {
    event,
    at: new Date().toISOString(),
    ...payload,
  });
}

function normalizeTransportText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .trim();
}

function pathTail(path: string): string {
  const segment = path.split('.').pop() ?? path;
  return segment.replace(/\[\d+\]/g, '').toLowerCase();
}

function defaultPathPolicy(path: string): PathPolicy {
  const tail = pathTail(path);
  if (NON_SEMANTIC_PATH_SEGMENTS.has(tail)) {
    return {
      skipThreatScan: true,
      skipRedaction: true,
    };
  }
  return {};
}

function applyRedactions(
  value: string,
  path: string,
  redactions: LlmRedactionEvent[],
): string {
  let next = value;

  for (const rule of REDACTION_RULES) {
    rule.pattern.lastIndex = 0;
    let count = 0;
    next = next.replace(rule.pattern, () => {
      count += 1;
      return rule.replacement;
    });
    if (count > 0) {
      redactions.push({
        kind: rule.kind,
        path,
        count,
      });
    }
  }

  return next;
}

function scanThreats(
  value: string,
  path: string,
  threats: LlmThreatMatch[],
): void {
  for (const rule of THREAT_RULES) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(value)) !== null) {
      threats.push({
        category: rule.category,
        severity: rule.severity,
        path,
        pattern: rule.pattern.source,
      });
      if (match.index === rule.pattern.lastIndex) {
        rule.pattern.lastIndex += 1;
      }
      if (threats.length >= 16) return;
    }
  }
}

function sanitizeValue(
  value: unknown,
  path: string,
  pathPolicy: (path: string) => PathPolicy,
  threats: LlmThreatMatch[],
  redactions: LlmRedactionEvent[],
): unknown {
  if (typeof value === 'string') {
    const normalized = normalizeTransportText(value);
    const policy = pathPolicy(path);
    const redacted = policy.skipRedaction ? normalized : applyRedactions(normalized, path, redactions);
    if (!policy.skipThreatScan) {
      scanThreats(redacted, path, threats);
    }
    return redacted;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitizeValue(entry, `${path}[${index}]`, pathPolicy, threats, redactions));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return Object.fromEntries(
      entries.map(([key, entry]) => [
        key,
        sanitizeValue(entry, path ? `${path}.${key}` : key, pathPolicy, threats, redactions),
      ]),
    );
  }

  return value;
}

function createAuditSnapshot(context: LlmPolicyContext): LlmPolicyAuditSnapshot {
  return {
    task: context.task,
    requestId: context.requestId,
    toolPolicy: context.toolPolicy ?? 'deny_all',
    threats: [],
    redactions: [],
  };
}

function highestThreatSeverity(threats: readonly LlmThreatMatch[]): ThreatSeverity | 'none' {
  if (threats.some((threat) => threat.severity === 'high')) return 'high';
  if (threats.some((threat) => threat.severity === 'medium')) return 'medium';
  if (threats.some((threat) => threat.severity === 'low')) return 'low';
  return 'none';
}

function summarizeThreats(
  threats: readonly LlmThreatMatch[],
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const threat of threats) {
    const key = `${threat.category}:${threat.severity}`;
    summary[key] = (summary[key] ?? 0) + 1;
  }
  return summary;
}

function summarizeRedactions(
  redactions: readonly LlmRedactionEvent[],
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const redaction of redactions) {
    summary[redaction.kind] = (summary[redaction.kind] ?? 0) + redaction.count;
  }
  return summary;
}

function emitAudit(context: LlmPolicyContext, stage: 'input' | 'output', audit: LlmPolicyAuditSnapshot): void {
  const severity = highestThreatSeverity(audit.threats);
  logPolicyEvent(
    audit.threats.length > 0 || audit.redactions.length > 0 ? 'warn' : 'info',
    `llm_policy_${stage}_screened`,
    {
      requestId: context.requestId,
      task: context.task,
      toolPolicy: audit.toolPolicy,
      threatCount: audit.threats.length,
      highestThreatSeverity: severity,
      redactionCount: audit.redactions.reduce((sum, entry) => sum + entry.count, 0),
      threatSummary: summarizeThreats(audit.threats),
      redactionSummary: summarizeRedactions(audit.redactions),
    },
  );
}

function parseWithSchema<T extends z.ZodTypeAny>(schema: T, value: unknown, message: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(message, {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function prepareLlmInput<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  context: LlmPolicyContext,
): PreparedInput<z.infer<T>> {
  const audit = createAuditSnapshot(context);
  const pathPolicy = context.pathPolicy ?? defaultPathPolicy;
  const sanitized = sanitizeValue(value, '', pathPolicy, audit.threats, audit.redactions);
  const data = parseWithSchema(schema, sanitized, 'Invalid request');

  emitAudit(context, 'input', audit);
  return { data, audit };
}

export function enforceNoToolsAuthorized(
  context: LlmPolicyContext,
  requestedTools: readonly string[] = [],
): void {
  if (requestedTools.length === 0) return;

  logPolicyEvent('error', 'llm_policy_tool_authorization_denied', {
    requestId: context.requestId,
    task: context.task,
    requestedTools,
    toolPolicy: context.toolPolicy ?? 'deny_all',
  });
  throw new ValidationError('Tool authorization denied for this LLM task.');
}

export function finalizeLlmOutput<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  context: LlmPolicyContext,
  options?: {
    filter?: (data: z.infer<T>) => { filtered: z.infer<T>; safetyMetadata: SafetyFilterResult };
  },
): FinalizedOutput<z.infer<T>> {
  const audit = createAuditSnapshot(context);
  const data = parseWithSchema(schema, value, 'LLM output failed schema validation');

  const filteredResult = options?.filter ? options.filter(data) : undefined;
  const filteredValue = filteredResult?.filtered ?? data;
  const finalData = parseWithSchema(schema, filteredValue, 'LLM output failed schema validation after filtering');

  const sanitizedValue = sanitizeValue(finalData, '', defaultPathPolicy, audit.threats, audit.redactions);
  const sanitizedData = parseWithSchema(
    schema,
    sanitizedValue,
    'LLM output failed schema validation after sanitization',
  );
  emitAudit(context, 'output', audit);

  return {
    data: sanitizedData,
    audit,
    ...(filteredResult ? { safetyMetadata: filteredResult.safetyMetadata } : {}),
  };
}
