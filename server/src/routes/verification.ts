import { Hono } from 'hono';
import { z } from 'zod';
import { verifyEvidence } from '../verification/verify-evidence.js';
import { GoogleFactCheckProvider } from '../verification/google-fact-check.provider.js';
import { GeminiGroundingProvider } from '../verification/gemini-grounding.provider.js';
import { GoogleVisionMediaProvider } from '../verification/google-vision-media.provider.js';
import { getEntityLinkingTelemetry, resetEntityLinkingTelemetry } from '../verification/entity-linking.provider.js';
import { ValidationError, UnauthorizedError, AppError } from '../lib/errors.js';
import { requireNonEmptyText, sanitizeText, sanitizeUrls } from '../lib/sanitize.js';
import { env } from '../config/env.js';
import {
  checkUrlAgainstSafeBrowsing,
  shouldBlockSafeBrowsingVerdict,
} from '../services/safeBrowsing.js';
import type { FactCheckMatch, SourceType } from '../verification/types.js';

const VerifyRequestSchema = z.object({
  postUri: z.string().optional(),
  text: z.string(),
  urls: z.array(z.string()).optional(),
  imageUrls: z.array(z.string()).optional(),
  languageCode: z.string().optional(),
  topicHints: z.array(z.string()).optional(),
});

const ProviderFacetSchema = z.object({
  type: z.enum(['link', 'mention', 'tag']),
  text: z.string(),
  uri: z.string().optional(),
}).passthrough();

const ProviderEmbedSchema = z.object({
  url: z.string(),
  domain: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
}).passthrough();

const ProviderMediaSchema = z.object({
  url: z.string(),
  mimeType: z.string().optional(),
  alt: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
}).passthrough();

const ProviderEntitySchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.string(),
  confidence: z.number(),
}).passthrough();

const ProviderVerificationRequestSchema = z.object({
  postUri: z.string().optional(),
  text: z.string().default(''),
  createdAt: z.string().optional(),
  facets: z.array(ProviderFacetSchema).optional(),
  embeds: z.array(ProviderEmbedSchema).optional(),
  media: z.array(ProviderMediaSchema).optional(),
  entities: z.array(ProviderEntitySchema).optional(),
  locale: z.string().optional(),
  languageCode: z.string().optional(),
}).passthrough();

const ProviderClaimSchema = z.object({
  text: z.string(),
  claimType: z.string().optional(),
  checkability: z.number().optional(),
  quotedTextSpans: z.array(z.string()).optional(),
}).passthrough();

const ProviderLookupRequestSchema = z.object({
  request: ProviderVerificationRequestSchema,
  claims: z.array(ProviderClaimSchema).optional().default([]),
}).passthrough();

export const verificationRouter = new Hono();

type ProviderVerificationRequest = z.infer<typeof ProviderVerificationRequestSchema>;
type ProviderClaim = z.infer<typeof ProviderClaimSchema>;

function applySensitiveResponseHeaders(c: any): void {
  c.header('Cache-Control', 'no-store, private');
  c.header('Pragma', 'no-cache');
  c.header('X-Content-Type-Options', 'nosniff');
}

function requireSharedSecretIfConfigured(c: any): void {
  if (!env.VERIFY_SHARED_SECRET) return;
  const presented = c.req.header('x-verify-shared-secret');
  if (presented !== env.VERIFY_SHARED_SECRET) throw new UnauthorizedError();
}

function isSensitiveVerificationPath(path: string): boolean {
  return [
    '/evidence',
    '/claim',
    '/fact-check',
    '/ground',
    '/media',
  ].some((suffix) => path.endsWith(suffix));
}

async function sanitizeVerificationImageUrls(urls: string[] | undefined): Promise<string[]> {
  const sanitized = sanitizeUrls(urls);
  if (sanitized.length === 0) return [];

  const verdicts = await Promise.all(sanitized.map(async (url) => ({
    url,
    verdict: await checkUrlAgainstSafeBrowsing(url),
  })));

  return verdicts
    .filter(({ verdict }) => !shouldBlockSafeBrowsingVerdict(verdict))
    .map(({ url }) => url)
    .slice(0, env.VERIFY_MAX_URLS);
}

function inferProviderClaimType(text: string): string {
  const lower = text.toLowerCase();
  if (!lower) return 'unclear';
  if (/\baccording to\b|\bthe rule says\b|\bthe law says\b|\bthe report says\b/.test(lower)) return 'source_citation';
  if (/\bquote\b|["\u201C\u201D]/.test(text)) return 'quote';
  if (/\b(rule|policy|guideline|standard|section)\b/.test(lower)) return 'rule_interpretation';
  if (/\b(photo|image|video|clip|screenshot)\b/.test(lower)) return 'image_claim';
  if (/\b(today|yesterday|tomorrow|before|after|at \d|\bon \w+ \d{1,2})\b/.test(lower)) return 'timeline_claim';
  if (/\b\d{1,4}\b|\bpercent\b|\bpoints?\b|\bminutes?\b|\bhours?\b|\byears?\b/.test(lower)) return 'statistical_claim';
  if (/\bi think\b|\bi feel\b|\bin my opinion\b|\bshould\b|\bought to\b/.test(lower)) return 'opinion';
  if (text.split(/\s+/).length >= 7) return 'factual_assertion';
  return 'mixed';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function providerCheckabilityScore(text: string, claimType: string): number {
  const lower = text.toLowerCase();
  let score = 0;

  if (claimType !== 'opinion' && claimType !== 'unclear') score += 0.35;
  if (/\baccording to\b|\brecord shows\b|\bthe rule says\b|\bthe law says\b/.test(lower)) score += 0.2;
  if (/\b\d{1,4}\b|\bsection\b|\brule\b|\barticle\b|\bstatute\b|\bminutes?\b|\bhours?\b/.test(lower)) score += 0.2;
  if (/[A-Z][a-z]+(?:\s[A-Z][a-z]+)+/.test(text)) score += 0.1;
  if (text.split(/\s+/).length >= 10) score += 0.1;
  if (/\?/.test(text)) score -= 0.1;

  return clamp01(score);
}

function quotedTextSpans(text: string): string[] {
  const spans: string[] = [];
  const pattern = /["\u201C]([^"\u201D]{1,240})["\u201D]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match[1]?.trim()) spans.push(match[1].trim());
    if (spans.length >= 4) break;
  }
  return spans;
}

function languageCodeForRequest(request: ProviderVerificationRequest): string {
  return sanitizeText(request.languageCode ?? request.locale ?? 'en') || 'en';
}

function collectRequestUrls(request: ProviderVerificationRequest): string[] {
  return sanitizeUrls([
    ...(request.facets ?? []).flatMap((facet) => facet.uri ? [facet.uri] : []),
    ...(request.embeds ?? []).map((embed) => embed.url),
  ]);
}

function collectFactCheckQueries(request: ProviderVerificationRequest, claims: ProviderClaim[]): string[] {
  const values = [
    ...claims.map((claim) => claim.text),
    request.text,
  ].map(sanitizeText).filter(Boolean);

  return Array.from(new Set(values)).slice(0, 3);
}

function factCheckHitFromMatch(match: FactCheckMatch): {
  claimant?: string;
  claimReviewTitle?: string;
  publisher?: string;
  url: string;
  reviewDate?: string;
  textualRating?: string;
  languageCode?: string;
  matchConfidence: number;
} {
  return {
    ...(match.claimant !== undefined ? { claimant: match.claimant } : {}),
    ...(match.reviewTitle !== undefined ? { claimReviewTitle: match.reviewTitle } : {}),
    ...(match.publisherName !== undefined ? { publisher: match.publisherName } : {}),
    url: match.reviewUrl,
    ...(match.reviewDate !== undefined ? { reviewDate: match.reviewDate } : {}),
    ...(match.textualRating !== undefined ? { textualRating: match.textualRating } : {}),
    ...(match.languageCode !== undefined ? { languageCode: match.languageCode } : {}),
    matchConfidence: match.matchConfidence,
  };
}

function dedupeFactCheckMatches(matches: FactCheckMatch[]): FactCheckMatch[] {
  const seen = new Set<string>();
  const out: FactCheckMatch[] = [];
  for (const match of matches) {
    const key = `${match.reviewUrl}\u0000${match.claimText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(match);
  }
  return out.sort((a, b) => b.matchConfidence - a.matchConfidence);
}

function sourceTypeQuality(sourceType: SourceType): number {
  const table: Record<SourceType, number> = {
    none: 0,
    unknown: 0.2,
    user_screenshot: 0.35,
    secondary_summary: 0.45,
    reputable_reporting: 0.68,
    official_statement: 0.78,
    primary_document: 0.84,
    official_rule: 0.92,
    government_record: 0.92,
    court_record: 0.94,
    standards_body: 0.94,
  };
  return table[sourceType] ?? 0.2;
}

function domainFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function emptyGroundingResult() {
  return {
    sources: [],
    corroborationLevel: 0,
    contradictionLevel: 0,
    model: 'noop',
    latencyMs: 0,
  };
}

function emptyMediaResult() {
  return {
    matches: [],
    mediaContextConfidence: 0,
    mediaContextWarning: false,
    model: 'noop',
    latencyMs: 0,
  };
}

verificationRouter.get('/status', async (c) => {
  const provider = env.VERIFY_ENTITY_LINKING_PROVIDER;
  const endpoint = provider === 'wikidata'
    ? env.VERIFY_WIKIDATA_ENDPOINT
    : provider === 'hybrid'
      ? `${env.VERIFY_ENTITY_LINKING_ENDPOINT} | ${env.VERIFY_WIKIDATA_ENDPOINT}`
      : env.VERIFY_ENTITY_LINKING_ENDPOINT;
  const externalLinkingEnabled = provider !== 'heuristic' && Boolean(endpoint);

  return c.json({
    ok: true,
    status: {
      verifyApiEnabled: env.VERIFY_API_ENABLED,
      entityLinking: {
        provider,
        ...(endpoint ? { endpoint } : {}),
        timeoutMs: env.VERIFY_ENTITY_LINKING_TIMEOUT_MS,
        debug: env.VERIFY_ENTITY_LINKING_DEBUG,
        externalLinkingEnabled,
      },
      grounding: {
        provider: 'gemini_google_search',
        enabled: env.VERIFY_GEMINI_GROUNDING_ENABLED,
        providerAvailable: Boolean(env.GEMINI_API_KEY),
      },
      factCheck: {
        provider: 'google_fact_check_tools',
        enabled: Boolean(env.GOOGLE_FACT_CHECK_API_KEY),
        textSearch: 'claims:search',
        imageSearch: 'claims:imageSearch',
      },
      urlSafety: {
        provider: 'google_safe_browsing',
        enabled: Boolean(env.GOOGLE_SAFE_BROWSING_API_KEY),
        purpose: 'url_threat_preflight',
      },
      limits: {
        maxTextChars: env.VERIFY_MAX_TEXT_CHARS,
        maxUrls: env.VERIFY_MAX_URLS,
        timeoutMs: env.VERIFY_TIMEOUT_MS,
        retryAttempts: env.VERIFY_RETRY_ATTEMPTS,
      },
    },
  });
});

verificationRouter.get('/telemetry', (c) => {
  return c.json({ ok: true, telemetry: getEntityLinkingTelemetry() });
});

verificationRouter.delete('/telemetry', (c) => {
  resetEntityLinkingTelemetry();
  return c.json({ ok: true });
});

verificationRouter.post('/claim', async (c) => {
  applySensitiveResponseHeaders(c);
  requireSharedSecretIfConfigured(c);

  const startedAt = Date.now();
  const body = await c.req.json().catch(() => { throw new ValidationError('Invalid JSON body'); });
  const parsed = ProviderVerificationRequestSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError('Invalid claim extraction payload', parsed.error.flatten());

  const text = sanitizeText(parsed.data.text);
  if (!text) {
    return c.json({ claims: [], model: 'heuristic-server', latencyMs: Date.now() - startedAt });
  }

  const claimType = inferProviderClaimType(text);
  return c.json({
    claims: [{
      text,
      claimType,
      checkability: providerCheckabilityScore(text, claimType),
      quotedTextSpans: quotedTextSpans(text),
    }],
    model: 'heuristic-server',
    latencyMs: Date.now() - startedAt,
  });
});

verificationRouter.post('/fact-check', async (c) => {
  applySensitiveResponseHeaders(c);
  requireSharedSecretIfConfigured(c);

  const startedAt = Date.now();
  const body = await c.req.json().catch(() => { throw new ValidationError('Invalid JSON body'); });
  const parsed = ProviderLookupRequestSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError('Invalid fact-check payload', parsed.error.flatten());

  const { request, claims } = parsed.data;
  const provider = new GoogleFactCheckProvider();
  const languageCode = languageCodeForRequest(request);
  const queries = collectFactCheckQueries(request, claims);
  const mediaUrls = await sanitizeVerificationImageUrls((request.media ?? []).map((item) => item.url));

  const [textMatches, imageMatches] = await Promise.all([
    Promise.all(queries.map((query) => provider.searchClaims(query, languageCode, 10))).then((sets) => sets.flat()),
    Promise.all(
      mediaUrls
        .slice(0, 2)
        .map((imageUrl) => provider.imageSearch(imageUrl, languageCode, 10).catch(() => [])),
    ).then((sets) => sets.flat()),
  ]);

  const hits = dedupeFactCheckMatches([...textMatches, ...imageMatches]).map(factCheckHitFromMatch);
  return c.json({
    matched: hits.length > 0,
    hits,
    model: 'google-fact-check-tools',
    latencyMs: Date.now() - startedAt,
  });
});

verificationRouter.post('/ground', async (c) => {
  applySensitiveResponseHeaders(c);
  requireSharedSecretIfConfigured(c);

  const startedAt = Date.now();
  const body = await c.req.json().catch(() => { throw new ValidationError('Invalid JSON body'); });
  const parsed = ProviderLookupRequestSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError('Invalid grounding payload', parsed.error.flatten());

  const { request, claims } = parsed.data;
  const claim = sanitizeText(claims[0]?.text ?? request.text);
  if (!claim) return c.json(emptyGroundingResult());

  const provider = new GeminiGroundingProvider();
  const result = await provider.groundClaim({
    claim,
    languageCode: languageCodeForRequest(request),
    urls: collectRequestUrls(request),
  });
  const contradicts = result.contradictionLevel > result.corroborationLevel;

  return c.json({
    sources: result.sources.map((source) => ({
      url: source.uri,
      ...(source.title !== undefined ? { title: source.title } : {}),
      domain: source.domain,
      sourceType: source.sourceType,
      sourceQuality: sourceTypeQuality(source.sourceType),
      supports: !contradicts,
      contradicts,
    })),
    ...(result.summary !== null ? { summary: result.summary } : {}),
    corroborationLevel: result.corroborationLevel,
    contradictionLevel: result.contradictionLevel,
    model: 'gemini-google-search',
    latencyMs: Date.now() - startedAt,
  });
});

verificationRouter.post('/media', async (c) => {
  applySensitiveResponseHeaders(c);
  requireSharedSecretIfConfigured(c);

  const startedAt = Date.now();
  const body = await c.req.json().catch(() => { throw new ValidationError('Invalid JSON body'); });
  const parsed = ProviderLookupRequestSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError('Invalid media verification payload', parsed.error.flatten());

  const mediaUrls = await sanitizeVerificationImageUrls((parsed.data.request.media ?? []).map((item) => item.url));
  if (mediaUrls.length === 0) return c.json(emptyMediaResult());

  const provider = new GoogleVisionMediaProvider();
  const results = await Promise.all(
    mediaUrls
      .slice(0, 2)
      .map((imageUrl) => provider.verifyImage(imageUrl).catch(() => null)),
  );
  const matches = results.flatMap((result) => {
    if (!result) return [];
    const pageMatches = result.pagesWithMatchingImages.map((url) => {
      const domain = domainFromUrl(url);
      return {
        originalUrl: url,
        ...(domain !== undefined ? { domain } : {}),
        confidence: 0.65,
        notes: 'Page with matching image found by Google Vision Web Detection.',
      };
    });
    const fullMatches = result.fullMatchingImages.map((url) => {
      const domain = domainFromUrl(url);
      return {
        originalUrl: url,
        ...(domain !== undefined ? { domain } : {}),
        confidence: 0.85,
        notes: 'Full matching image found by Google Vision Web Detection.',
      };
    });
    return [...fullMatches, ...pageMatches];
  });
  const mediaContextConfidence = Math.max(0, ...results.map((result) => result?.mediaContextConfidence ?? 0));
  const mismatchRisk = Math.max(0, ...results.map((result) => result?.mismatchRisk ?? 0));

  return c.json({
    matches,
    mediaContextConfidence,
    mediaContextWarning: mismatchRisk >= 0.6,
    model: 'google-vision-web-detection',
    latencyMs: Date.now() - startedAt,
  });
});

verificationRouter.post('/evidence', async (c) => {
  applySensitiveResponseHeaders(c);
  requireSharedSecretIfConfigured(c);

  const body = await c.req.json().catch(() => { throw new ValidationError('Invalid JSON body'); });

  const parsed = VerifyRequestSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError('Invalid verification payload', parsed.error.flatten());

  const input = parsed.data;
  const imageUrls = await sanitizeVerificationImageUrls(input.imageUrls);
  const result = await verifyEvidence({
    ...(input.postUri !== undefined ? { postUri: input.postUri } : {}),
    text: requireNonEmptyText(input.text),
    urls: sanitizeUrls(input.urls),
    imageUrls,
    ...(input.languageCode !== undefined ? { languageCode: input.languageCode } : {}),
    topicHints: (input.topicHints ?? []).map(sanitizeText).filter(Boolean).slice(0, 10),
  });

  return c.json({ ok: true, result });
});

verificationRouter.onError((error, c) => {
  if (isSensitiveVerificationPath(c.req.path)) {
    applySensitiveResponseHeaders(c);
  }
  if (error instanceof AppError) {
    return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as any);
  }
  return c.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal verification error' } }, 500);
});
