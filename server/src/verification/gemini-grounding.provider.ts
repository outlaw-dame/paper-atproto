import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import type { GroundingResult, GroundingSource, SourceType } from './types.js';

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

    if (!this.client || !input.claim.trim()) return empty;

    const prompt = [
      'You are a verification assistant for a social discussion product.',
      'Task:',
      '1. Assess whether the claim is currently supported, partially supported, contested, or unsupported so far.',
      '2. Return concise factual context only.',
      '3. Prefer official, primary, or highly reputable sources.',
      '4. Do not overstate certainty.',
      '',
      `Claim: ${input.claim}`,
      input.urls?.length ? `User supplied URLs:\n${input.urls.join('\n')}` : '',
      '',
      'Return a short grounded explanation.',
    ].filter(Boolean).join('\n');

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        temperature: 0.1,
        tools: [{ googleSearch: {} }],
      },
    });

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

    return {
      summary: response.text ?? null,
      sources,
      corroborationLevel: Math.min(1, uniqueDomains.size / 4),
      contradictionLevel: 0,
      quoteFidelity: sources.length > 0 ? 0.65 : 0,
      contextValue: sources.length > 0 ? 0.7 : 0,
      correctionValue: sources.length > 0 ? 0.55 : 0,
    };
  }
}
