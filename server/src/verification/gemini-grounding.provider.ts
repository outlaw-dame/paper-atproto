import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { env } from '../config/env.js';
import {
  finalizeLlmOutput,
  prepareLlmInput,
} from '../llm/policyGateway.js';
import { withRetry } from '../lib/retry.js';
import type { GroundingResult, GroundingSource, SourceType } from './types.js';

const GroundingRequestSchema = z.object({
  claim: z.string().min(1).max(env.VERIFY_MAX_TEXT_CHARS),
  languageCode: z.string().trim().max(32).optional(),
  urls: z.array(z.string().url().max(1000)).max(env.VERIFY_MAX_URLS).optional(),
});

const GroundingSourceSchema = z.object({
  uri: z.string().url().max(1000),
  title: z.string().max(200).optional(),
  domain: z.string().max(255),
  sourceType: z.enum([
    'none',
    'primary_document',
    'official_rule',
    'official_statement',
    'government_record',
    'court_record',
    'standards_body',
    'reputable_reporting',
    'secondary_summary',
    'user_screenshot',
    'unknown',
  ]),
});

const GroundingResponseSchema = z.object({
  summary: z.string().max(700).nullable(),
  sources: z.array(GroundingSourceSchema).max(env.VERIFY_MAX_URLS),
  corroborationLevel: z.number().min(0).max(1),
  contradictionLevel: z.number().min(0).max(1),
  quoteFidelity: z.number().min(0).max(1),
  contextValue: z.number().min(0).max(1),
  correctionValue: z.number().min(0).max(1),
});

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('Gemini grounding timed out'), { status: 504 }));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function domainFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}

function classifySourceType(domain: string): SourceType {
  const d = domain.toLowerCase();
  if (d.endsWith('.gov') || d.endsWith('.mil')) return 'government_record';
  if (d.includes('nfl.com') || d.includes('nba.com') || d.includes('fifa.com') || d.includes('uefa.com') || d.includes('ncaa.com')) return 'official_statement';
  if (['apnews.com', 'reuters.com', 'bbc.com', 'nytimes.com', 'wsj.com'].some((n) => d.includes(n))) return 'reputable_reporting';
  return 'unknown';
}

export class GeminiGroundingProvider {
  private readonly client: GoogleGenAI | null;
  private readonly model: string;

  constructor(apiKey = env.GEMINI_API_KEY, model = env.GEMINI_GROUNDING_MODEL) {
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
    this.model = model;
  }

  async groundClaim(input: {
    claim: string;
    languageCode?: string;
    urls?: string[];
  }): Promise<GroundingResult> {
    const empty: GroundingResult = {
      summary: null, sources: [], corroborationLevel: 0, contradictionLevel: 0,
      quoteFidelity: 0, contextValue: 0, correctionValue: 0,
    };

    if (!env.VERIFY_GEMINI_GROUNDING_ENABLED || !this.client || !input.claim.trim()) return empty;

    const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `verify-grounding-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const prepared = prepareLlmInput(
      GroundingRequestSchema,
      input,
      {
        task: 'verificationGrounding',
        requestId,
      },
    );

    const prompt = [
      'You are a verification assistant for a social discussion product.',
      'Task:',
      '1. Assess whether the claim is currently supported, partially supported, contested, or unsupported so far.',
      '2. Return concise factual context only.',
      '3. Prefer official, primary, or highly reputable sources.',
      '4. Do not overstate certainty.',
      '',
      `Claim: ${prepared.data.claim}`,
      prepared.data.urls?.length ? `User supplied URLs:\n${prepared.data.urls.join('\n')}` : '',
      '',
      'Return a short grounded explanation.',
    ].filter(Boolean).join('\n');

    const response = await withRetry(
      async () => {
        return withTimeout(
          this.client!.models.generateContent({
            model: this.model,
            contents: prompt,
            config: {
              temperature: 0.1,
              tools: [{ googleSearch: {} }],
            },
          }),
          env.VERIFY_TIMEOUT_MS,
        );
      },
      {
        attempts: env.VERIFY_RETRY_ATTEMPTS,
        baseDelayMs: 300,
        maxDelayMs: 3000,
        jitter: true,
        shouldRetry: (error) => {
          const status = (error as { status?: number })?.status;
          return !status || [408, 425, 429, 500, 502, 503, 504].includes(status);
        },
      },
    );

    const candidate = response.candidates?.[0];
    const groundingMetadata = candidate?.groundingMetadata as Record<string, unknown> | undefined;
    const chunks = (groundingMetadata?.groundingChunks ?? []) as Array<{ web?: { uri?: string; title?: string } }>;

    const sources: GroundingSource[] = chunks
      .map((chunk) => {
        const uri = chunk?.web?.uri;
        const title = chunk?.web?.title;
        if (!uri) return null;
        const domain = domainFromUrl(uri);
        return {
          uri,
          domain,
          sourceType: classifySourceType(domain),
          ...(title !== undefined ? { title } : {}),
        } satisfies GroundingSource;
      })
      .filter((s): s is GroundingSource => s !== null);

    const uniqueDomains = new Set(sources.map((s) => s.domain));

    const finalized = finalizeLlmOutput(
      GroundingResponseSchema,
      {
        summary: typeof response.text === 'string' && response.text.trim().length > 0
          ? response.text
          : null,
        sources,
        corroborationLevel: Math.min(1, uniqueDomains.size / 4),
        contradictionLevel: 0,
        quoteFidelity: sources.length > 0 ? 0.65 : 0,
        contextValue: sources.length > 0 ? 0.7 : 0,
        correctionValue: sources.length > 0 ? 0.55 : 0,
      },
      {
        task: 'verificationGrounding',
        requestId,
      },
    );

    return {
      summary: finalized.data.summary,
      sources: finalized.data.sources as GroundingSource[],
      corroborationLevel: finalized.data.corroborationLevel,
      contradictionLevel: finalized.data.contradictionLevel,
      quoteFidelity: finalized.data.quoteFidelity,
      contextValue: finalized.data.contextValue,
      correctionValue: finalized.data.correctionValue,
    };
  }
}
