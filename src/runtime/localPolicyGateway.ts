import { z } from 'zod';
import type { GenerateTextRequest, GenerateTextResult } from './generationSession';
import type { AnalyzeMediaRequest, AnalyzeMediaResult } from './multimodalSession';

type LocalPolicyTask = 'local_text_generation' | 'local_multimodal';
type ThreatSeverity = 'low' | 'medium' | 'high';
type ToolPolicyMode = 'deny_all';
type ThreatCategory =
  | 'instruction_override'
  | 'tool_override'
  | 'prompt_exfiltration'
  | 'role_spoofing';

interface LocalThreatMatch {
  category: ThreatCategory;
  severity: ThreatSeverity;
  field: string;
}

interface LocalRedactionEvent {
  field: string;
  count: number;
}

interface LocalPolicyAuditSnapshot {
  task: LocalPolicyTask;
  toolPolicy: ToolPolicyMode;
  threats: LocalThreatMatch[];
  redactions: LocalRedactionEvent[];
}

const LocalGenerateTextRequestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  systemPrompt: z.string().max(1200).optional(),
  maxNewTokens: z.number().int().min(16).max(256).optional(),
  temperature: z.number().min(0).max(1.5).optional(),
  topP: z.number().min(0.05).max(1).optional(),
});

const LocalGenerateTextResultSchema = z.object({
  text: z.string().min(1).max(2000),
  tokensGenerated: z.number().int().min(0).optional(),
});

const LocalAnalyzeMediaRequestSchema = z.object({
  mediaUrl: z.string().min(1).max(1000),
  prompt: z.string().min(1).max(2000),
});

const LocalAnalyzeMediaResultSchema = z.object({
  summary: z.string().min(1).max(1200),
});

const THREAT_RULES: ReadonlyArray<{
  category: ThreatCategory;
  severity: ThreatSeverity;
  pattern: RegExp;
}> = [
  {
    category: 'instruction_override',
    severity: 'medium',
    pattern: /\b(?:ignore|disregard|forget|bypass|override)\b[\s\S]{0,60}\b(?:previous|prior|above|earlier|system|developer|safety|policy|instructions?)\b/gi,
  },
  {
    category: 'tool_override',
    severity: 'high',
    pattern: /\b(?:use|call|invoke|run|execute|open|fetch)\b[\s\S]{0,60}\b(?:tool|function|browser|shell|command|curl|http|https)\b/gi,
  },
  {
    category: 'prompt_exfiltration',
    severity: 'high',
    pattern: /\b(?:reveal|print|dump|show|expose|leak|return)\b[\s\S]{0,60}\b(?:system prompt|developer prompt|hidden prompt|secret|api key|token|cookie|credential)\b/gi,
  },
  {
    category: 'role_spoofing',
    severity: 'medium',
    pattern: /(?:^|\n|\r|\b)(?:system|assistant|developer|tool)\s*:\s*/gi,
  },
];

const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g,
  /\b(?:sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{20,})\b/g,
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*[A-Za-z0-9._~+\-\/=]{12,}\b/gi,
];

function createAudit(task: LocalPolicyTask): LocalPolicyAuditSnapshot {
  return {
    task,
    toolPolicy: 'deny_all',
    threats: [],
    redactions: [],
  };
}

function summarizeThreats(audit: LocalPolicyAuditSnapshot): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const threat of audit.threats) {
    const key = `${threat.category}:${threat.severity}`;
    summary[key] = (summary[key] ?? 0) + 1;
  }
  return summary;
}

function logAudit(audit: LocalPolicyAuditSnapshot, stage: 'input' | 'output'): void {
  if (audit.threats.length === 0 && audit.redactions.length === 0) return;
  console.warn('[runtime/llm-policy]', {
    stage,
    task: audit.task,
    toolPolicy: audit.toolPolicy,
    threatCount: audit.threats.length,
    threatSummary: summarizeThreats(audit),
    redactionCount: audit.redactions.reduce((sum, redaction) => sum + redaction.count, 0),
    at: new Date().toISOString(),
  });
}

function sanitizeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .trim();
}

function redactSecrets(value: string, field: string, audit: LocalPolicyAuditSnapshot): string {
  let next = value;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    let count = 0;
    next = next.replace(pattern, () => {
      count += 1;
      return '[redacted-secret]';
    });
    if (count > 0) {
      audit.redactions.push({ field, count });
    }
  }
  return next;
}

function scanThreats(value: string, field: string, audit: LocalPolicyAuditSnapshot): void {
  for (const rule of THREAT_RULES) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(value)) !== null) {
      audit.threats.push({
        category: rule.category,
        severity: rule.severity,
        field,
      });
      if (match.index === rule.pattern.lastIndex) {
        rule.pattern.lastIndex += 1;
      }
      if (audit.threats.length >= 12) return;
    }
  }
}

function sanitizeField(
  value: string | undefined,
  field: string,
  audit: LocalPolicyAuditSnapshot,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = sanitizeText(value);
  const redacted = redactSecrets(normalized, field, audit);
  scanThreats(redacted, field, audit);
  return redacted;
}

export function prepareLocalTextGenerationRequest(raw: GenerateTextRequest): GenerateTextRequest {
  const audit = createAudit('local_text_generation');
  const parsed = LocalGenerateTextRequestSchema.parse({
    prompt: sanitizeField(raw.prompt, 'prompt', audit),
    ...(raw.systemPrompt !== undefined
      ? { systemPrompt: sanitizeField(raw.systemPrompt, 'systemPrompt', audit) }
      : {}),
    ...(raw.maxNewTokens !== undefined ? { maxNewTokens: raw.maxNewTokens } : {}),
    ...(raw.temperature !== undefined ? { temperature: raw.temperature } : {}),
    ...(raw.topP !== undefined ? { topP: raw.topP } : {}),
  });
  logAudit(audit, 'input');
  const next: GenerateTextRequest = {
    prompt: parsed.prompt,
  };

  if (parsed.systemPrompt !== undefined) {
    next.systemPrompt = parsed.systemPrompt;
  }
  if (parsed.maxNewTokens !== undefined) {
    next.maxNewTokens = parsed.maxNewTokens;
  }
  if (parsed.temperature !== undefined) {
    next.temperature = parsed.temperature;
  }
  if (parsed.topP !== undefined) {
    next.topP = parsed.topP;
  }
  if (raw.signal !== undefined) {
    next.signal = raw.signal;
  }

  return next;
}

export function finalizeLocalTextGenerationResult(raw: GenerateTextResult): GenerateTextResult {
  const audit = createAudit('local_text_generation');
  const parsed = LocalGenerateTextResultSchema.parse({
    text: sanitizeField(raw.text, 'text', audit),
    ...(raw.tokensGenerated !== undefined ? { tokensGenerated: raw.tokensGenerated } : {}),
  });
  logAudit(audit, 'output');
  const next: GenerateTextResult = {
    text: parsed.text,
  };

  if (parsed.tokensGenerated !== undefined) {
    next.tokensGenerated = parsed.tokensGenerated;
  }

  return next;
}

export function prepareLocalMultimodalRequest(raw: AnalyzeMediaRequest): AnalyzeMediaRequest {
  const audit = createAudit('local_multimodal');
  const parsed = LocalAnalyzeMediaRequestSchema.parse({
    mediaUrl: sanitizeText(raw.mediaUrl),
    prompt: sanitizeField(raw.prompt, 'prompt', audit),
  });
  logAudit(audit, 'input');
  return parsed;
}

export function finalizeLocalMultimodalResult(raw: AnalyzeMediaResult): AnalyzeMediaResult {
  const audit = createAudit('local_multimodal');
  const parsed = LocalAnalyzeMediaResultSchema.parse({
    summary: sanitizeField(raw.summary, 'summary', audit),
  });
  logAudit(audit, 'output');
  return parsed;
}
