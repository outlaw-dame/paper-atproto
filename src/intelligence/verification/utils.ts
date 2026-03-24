import type { SourceType, VerificationClaimType, VerificationEntityHint, VerificationReason, VerificationRequest } from './types.js';

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function sanitizeVerificationRequest(input: VerificationRequest, maxTextLength = 1200): VerificationRequest {
  const text = input.text.replace(/\u0000/g, '').trim().slice(0, maxTextLength);
  const embeds = (input.embeds ?? []).slice(0, 6).map((embed) => ({
    url: embed.url.trim(),
    ...(embed.domain !== undefined ? { domain: embed.domain.trim().toLowerCase() } : {}),
    ...(embed.title !== undefined ? { title: embed.title.trim().slice(0, 240) } : {}),
    ...(embed.description !== undefined ? { description: embed.description.trim().slice(0, 600) } : {}),
    ...(embed.mimeType !== undefined ? { mimeType: embed.mimeType } : {}),
  }));

  const media = (input.media ?? []).slice(0, 4).map((item) => ({
    url: item.url.trim(),
    ...(item.alt !== undefined ? { alt: item.alt.trim().slice(0, 300) } : {}),
    ...(item.mimeType !== undefined ? { mimeType: item.mimeType } : {}),
    ...(item.width !== undefined ? { width: item.width } : {}),
    ...(item.height !== undefined ? { height: item.height } : {}),
  }));

  const entities = (input.entities ?? []).slice(0, 12).map((entity) => ({
    ...entity,
    label: entity.label.trim().slice(0, 160),
  }));

  const facets = (input.facets ?? []).slice(0, 24).map((facet) => ({
    type: facet.type,
    text: facet.text.trim().slice(0, 240),
    ...(facet.uri !== undefined ? { uri: facet.uri.trim() } : {}),
  }));

  return { ...input, text, embeds, media, entities, facets };
}

export function inferClaimType(text: string): VerificationClaimType {
  const lower = text.toLowerCase();

  if (!lower) return 'unclear';
  if (/\baccording to\b|\bthe rule says\b|\bthe law says\b|\bthe report says\b/.test(lower)) return 'source_citation';
  if (/\bquote\b|["\u201C\u201D]/.test(text)) return 'quote';
  if (/\b(rule|policy|guideline|standard|section)\b/.test(lower)) return 'rule_interpretation';
  if (/\b\d{1,4}\b|\bpercent\b|\bpoints?\b|\bminutes?\b|\bhours?\b|\byears?\b/.test(lower)) return 'statistical_claim';
  if (/\b(photo|image|video|clip|screenshot)\b/.test(lower)) return 'image_claim';
  if (/\b(today|yesterday|tomorrow|before|after|at \d|\bon \w+ \d{1,2})\b/.test(lower)) return 'timeline_claim';
  if (/\bi think\b|\bi feel\b|\bin my opinion\b|\bshould\b|\bought to\b/.test(lower)) return 'opinion';
  if (/[.?!]/.test(text) && text.split(/\s+/).length >= 7) return 'factual_assertion';
  return 'mixed';
}

export function computeSourceTypeFromUrls(urls: string[]): SourceType {
  const domains = urls.map((url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return '';
    }
  });

  if (domains.some((d) => d.includes('nfl.com') || d.includes('mlb.com') || d.includes('nba.com'))) return 'official_rule';
  if (domains.some((d) => d.endsWith('.gov'))) return 'government_record';
  if (domains.some((d) => d.includes('uscourts.gov') || d.includes('supremecourt.gov'))) return 'court_record';
  if (domains.some((d) => d.includes('ietf.org') || d.includes('w3.org') || d.includes('iso.org'))) return 'standards_body';
  if (domains.some((d) => ['apnews.com', 'reuters.com', 'nytimes.com', 'theguardian.com', 'wsj.com', 'bbc.com'].includes(d))) return 'reputable_reporting';
  if (domains.length > 0) return 'unknown';
  return 'none';
}

export function sourceTypeQuality(sourceType: SourceType): number {
  const table: Record<SourceType, number> = {
    none: 0,
    unknown: 0.2,
    user_screenshot: 0.35,
    secondary_summary: 0.45,
    reverse_image_match: 0.55,
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

export function checkabilityScore(text: string, claimType: VerificationClaimType): number {
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

export function specificityScore(text: string): number {
  let score = 0;
  if (/\b\d{1,4}\b/.test(text)) score += 0.25;
  if (/\b(section|rule|article|page)\b/i.test(text)) score += 0.25;
  if (/[A-Z][a-z]+(?:\s[A-Z][a-z]+)+/.test(text)) score += 0.2;
  if (/\b(today|yesterday|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)) score += 0.15;
  if (/\b%|\bpercent\b|\bpoints?\b|\bdollars?\b|\bminutes?\b|\bhours?\b/i.test(text)) score += 0.15;
  return clamp01(score);
}

export function entityGroundingScore(entities?: VerificationEntityHint[]): number {
  if (!entities?.length) return 0;
  const top = entities.slice(0, 5);
  const sum = top.reduce((acc, entity) => acc + clamp01(entity.confidence), 0);
  return clamp01(sum / top.length);
}

export function buildReasons(input: {
  sourceType: SourceType;
  checkability: number;
  specificity: number;
  quoteFidelity: number;
  entityGrounding: number;
  correctionValue: number;
  contextValue: number;
  corroborationLevel: number;
  contradictionLevel: number;
  mediaContextWarning: boolean;
}): VerificationReason[] {
  const reasons: VerificationReason[] = [];

  if (input.sourceType === 'primary_document') reasons.push('primary-source-cited');
  if (input.sourceType === 'official_rule') reasons.push('official-rule-cited');
  if (input.sourceType === 'official_statement') reasons.push('official-statement-cited');

  if (input.checkability >= 0.65) reasons.push('claim-is-checkable');
  if (input.specificity >= 0.60) reasons.push('specific-date-or-number');
  if (input.quoteFidelity >= 0.65) reasons.push('quote-fidelity-high', 'direct-quote-present');
  if (input.entityGrounding >= 0.60) reasons.push('entity-grounded');
  if (input.correctionValue >= 0.60) reasons.push('corrective-context');
  if (input.contextValue >= 0.60) reasons.push('clarifies-ambiguity');
  if (input.corroborationLevel >= 0.60) reasons.push('multiple-reputable-sources');
  if (input.contradictionLevel >= 0.45) reasons.push('conflicting-reputable-sources');
  if (input.mediaContextWarning) reasons.push('media-recontextualized');

  if (!reasons.length) reasons.push('no-strong-evidence-yet');

  return Array.from(new Set(reasons));
}
