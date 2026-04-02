// ─── Deterministic Context — Source Canonicalization ─────────────────────
// Normalizes URLs and source references into a stable canonical form before
// any scoring or model invocation.
//
// Design constraints:
//   • Pure functions — no network I/O.
//   • Fail-closed: on any parse error, return a safe fallback, never throw.
//   • Never log raw URLs — log only structural metadata (hostname, type).
//   • Restrict recognized URL schemes to https/http only.
//   • Strip known tracking parameters deterministically.

import { MAX_SOURCE_URL_LEN, MAX_SOURCE_LABEL_LEN } from './limits';

// ─── Source type classification ────────────────────────────────────────────

export type SourceType =
  | 'official'   // government, institutional, primary-source domain
  | 'news'       // established news organization
  | 'social'     // social media platform
  | 'docs'       // documentation, standards body, specification
  | 'academic'   // .edu, academic journals, research repositories
  | 'unknown';   // anything not classified above

// ─── Known source classifications ─────────────────────────────────────────
// Keyed by normalized hostname suffix (without www. prefix).
// Order matters: more specific suffixes should come first.

const OFFICIAL_DOMAINS = new Set([
  'gov', 'gov.uk', 'gov.au', 'gov.ca', 'europa.eu', 'un.org', 'who.int',
  'cdc.gov', 'fda.gov', 'nih.gov', 'congress.gov', 'whitehouse.gov',
  'supremecourt.gov', 'sec.gov', 'ftc.gov', 'irs.gov', 'state.gov',
  'justice.gov', 'dol.gov', 'hhs.gov', 'treasury.gov',
]);

const NEWS_DOMAINS = new Set([
  'reuters.com', 'apnews.com', 'nytimes.com', 'washingtonpost.com',
  'wsj.com', 'ft.com', 'bbc.com', 'bbc.co.uk', 'theguardian.com',
  'bloomberg.com', 'politico.com', 'axios.com', 'theatlantic.com',
  'npr.org', 'propublica.org', 'cnn.com', 'nbcnews.com', 'abcnews.go.com',
  'cbsnews.com', 'foxnews.com', 'time.com', 'newsweek.com',
  'usatoday.com', 'latimes.com', 'chicagotribune.com', 'sfchronicle.com',
  'bostonglobe.com', 'msnbc.com', 'pbs.org', 'vox.com', 'thehill.com',
  'huffpost.com', 'buzzfeednews.com', 'vice.com', 'thedailybeast.com',
  'motherjones.com', 'salon.com', 'slate.com', 'reason.com',
  'nationalreview.com', 'weeklystandard.com', 'firstthings.com',
  'foreignpolicy.com', 'foreignaffairs.com', 'economist.com',
  'spectator.co.uk', 'telegraph.co.uk', 'independent.co.uk',
  'dailymail.co.uk', 'thesun.co.uk', 'mirror.co.uk',
  'aljazeera.com', 'dw.com', 'france24.com', 'lemonde.fr',
  'spiegel.de', 'zeitung.de', 'corriere.it', 'elpais.com',
]);

const SOCIAL_DOMAINS = new Set([
  'twitter.com', 'x.com', 'bsky.app', 'bsky.social',
  'facebook.com', 'instagram.com', 'tiktok.com',
  'reddit.com', 'linkedin.com', 'youtube.com', 'youtu.be',
  'mastodon.social', 'threads.net', 'tumblr.com', 'medium.com',
  'substack.com',
]);

const DOCS_DOMAINS = new Set([
  'w3.org', 'ietf.org', 'rfc-editor.org', 'standards.ieee.org',
  'developer.mozilla.org', 'docs.google.com', 'support.google.com',
  'help.twitter.com', 'help.bsky.app',
  'wikipedia.org', 'en.wikipedia.org',
  'stackoverflow.com', 'github.com', 'gitlab.com',
  'docs.github.com', 'npmjs.com', 'pypi.org',
]);

const ACADEMIC_TLD_RE = /\.(edu|ac\.uk|ac\.jp|ac\.au|edu\.au|uni-[a-z]+\.de)$/;
const ACADEMIC_DOMAINS = new Set([
  'arxiv.org', 'pubmed.ncbi.nlm.nih.gov', 'scholar.google.com',
  'semanticscholar.org', 'jstor.org', 'ssrn.com', 'researchgate.net',
  'ncbi.nlm.nih.gov', 'plos.org', 'nature.com', 'science.org',
  'nejm.org', 'thelancet.com', 'jamanetwork.com', 'bmj.com',
]);

// ─── Tracking parameters to strip ─────────────────────────────────────────

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_source_platform', 'utm_creative_format',
  'fbclid', 'gclid', 'dclid', 'msclkid', 'twclid',
  'mc_cid', 'mc_eid', 'yclid', 'ref', 'referrer',
  '_ga', '_gl', 'zanpid', 'origin',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

function isAllowedScheme(url: URL): boolean {
  return url.protocol === 'https:' || url.protocol === 'http:';
}

function classifyHostname(hostname: string): SourceType {
  const h = stripWww(hostname);

  // TLD check for official
  const tld = h.split('.').slice(-2).join('.');
  if (OFFICIAL_DOMAINS.has(tld) || OFFICIAL_DOMAINS.has(h)) return 'official';

  if (NEWS_DOMAINS.has(h)) return 'news';
  if (SOCIAL_DOMAINS.has(h)) return 'social';
  if (DOCS_DOMAINS.has(h)) return 'docs';

  if (ACADEMIC_DOMAINS.has(h) || ACADEMIC_TLD_RE.test(h)) return 'academic';

  return 'unknown';
}

// ─── parseCanonicalUrl ────────────────────────────────────────────────────

/**
 * Parse, validate, and strip tracking parameters from a URL string.
 *
 * Returns null if the URL is invalid or uses a non-http/https scheme.
 * Never throws.
 */
export function parseCanonicalUrl(raw: string): URL | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, MAX_SOURCE_URL_LEN);
  try {
    const url = new URL(trimmed);
    if (!isAllowedScheme(url)) return null;

    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param);
    }

    return url;
  } catch {
    return null;
  }
}

// ─── canonicalizeSourceUrl ────────────────────────────────────────────────

/**
 * Return the canonical URL string for a raw URL.
 *
 * Normalizes:
 *   - Strips www. prefix
 *   - Lowercases hostname
 *   - Removes tracking parameters
 *   - Forces trailing slash on bare hostnames
 *
 * Returns null if the URL is invalid/unsafe.
 */
export function canonicalizeSourceUrl(raw: string): string | null {
  const url = parseCanonicalUrl(raw);
  if (!url) return null;

  // Lowercase hostname, strip www.
  url.hostname = stripWww(url.hostname);

  const result = url.toString();
  return result.length <= MAX_SOURCE_URL_LEN ? result : null;
}

// ─── classifySourceUrl ────────────────────────────────────────────────────

/**
 * Classify a URL string into a SourceType.
 * Returns 'unknown' on parse failure.
 */
export function classifySourceUrl(raw: string): SourceType {
  const url = parseCanonicalUrl(raw);
  if (!url) return 'unknown';
  return classifyHostname(url.hostname);
}

// ─── sourceLabel ─────────────────────────────────────────────────────────

/**
 * Return a human-readable label for a source URL.
 * e.g. "Reuters", "apnews.com", "Official source"
 */
export function sourceLabel(raw: string): string {
  const url = parseCanonicalUrl(raw);
  if (!url) return 'unknown source';

  const h = stripWww(url.hostname);
  const type = classifyHostname(h);

  // Prefer a known publication name for news domains
  const PUBLICATION_NAMES: Record<string, string> = {
    'reuters.com': 'Reuters',
    'apnews.com': 'AP News',
    'nytimes.com': 'The New York Times',
    'washingtonpost.com': 'The Washington Post',
    'wsj.com': 'The Wall Street Journal',
    'ft.com': 'Financial Times',
    'bbc.com': 'BBC', 'bbc.co.uk': 'BBC',
    'theguardian.com': 'The Guardian',
    'bloomberg.com': 'Bloomberg',
    'politico.com': 'Politico',
    'axios.com': 'Axios',
    'theatlantic.com': 'The Atlantic',
    'npr.org': 'NPR',
    'propublica.org': 'ProPublica',
    'cnn.com': 'CNN',
    'foxnews.com': 'Fox News',
    'economist.com': 'The Economist',
  };

  if (PUBLICATION_NAMES[h]) return PUBLICATION_NAMES[h]!.slice(0, MAX_SOURCE_LABEL_LEN);

  if (type === 'official') return `official source (${h})`.slice(0, MAX_SOURCE_LABEL_LEN);
  if (type === 'academic') return `academic source (${h})`.slice(0, MAX_SOURCE_LABEL_LEN);
  if (type === 'docs') return h.slice(0, MAX_SOURCE_LABEL_LEN);

  return h.slice(0, MAX_SOURCE_LABEL_LEN);
}

// ─── CanonicalSource ─────────────────────────────────────────────────────

export interface CanonicalSource {
  rawUrl: string;
  canonicalUrl: string;
  hostname: string;
  type: SourceType;
  label: string;
  /** Quality weight 0–1, higher = more authoritative. */
  quality: number;
}

const SOURCE_TYPE_QUALITY: Record<SourceType, number> = {
  official: 0.95,
  academic: 0.85,
  news: 0.75,
  docs: 0.70,
  social: 0.30,
  unknown: 0.20,
};

/**
 * Build a CanonicalSource from a raw URL string.
 * Returns null if the URL is invalid or unsafe.
 */
export function buildCanonicalSource(rawUrl: string): CanonicalSource | null {
  const canonical = canonicalizeSourceUrl(rawUrl);
  if (!canonical) return null;

  const url = parseCanonicalUrl(rawUrl);
  if (!url) return null;

  const hostname = stripWww(url.hostname);
  const type = classifyHostname(hostname);

  return {
    rawUrl,
    canonicalUrl: canonical,
    hostname,
    type,
    label: sourceLabel(rawUrl),
    quality: SOURCE_TYPE_QUALITY[type],
  };
}

/**
 * Deduplicate a list of canonical sources by hostname.
 * Keeps the highest-quality entry per hostname.
 */
export function deduplicateSources(sources: CanonicalSource[]): CanonicalSource[] {
  const byHost = new Map<string, CanonicalSource>();
  for (const src of sources) {
    const existing = byHost.get(src.hostname);
    if (!existing || src.quality > existing.quality) {
      byHost.set(src.hostname, src);
    }
  }
  return Array.from(byHost.values()).sort((a, b) => b.quality - a.quality);
}
