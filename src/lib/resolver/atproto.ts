// ─── Deterministic ATProto Object Resolver ────────────────────────────────
// Pipeline A — Tier 1: pure deterministic parsing, no inference, no network.
//
// Resolves the following ATProto primitives from raw data:
//   • AT URI  → { repo, collection, rkey }
//   • DID     → canonical DID string
//   • Handle  → normalised handle (lowercase, no leading @)
//   • Facets  → typed spans: mention, hashtag, link
//   • Embeds  → typed embed: image, external, record, recordWithMedia
//   • Labels  → { src, val, neg, cts }
//   • Domain  → canonical origin from any URL
//   • Thread  → root + parent chain from a ThreadViewPost
//
// All functions are pure and synchronous — safe to call anywhere.

import type {
  AppBskyFeedDefs,
  AppBskyFeedPost,
  AppBskyRichtextFacet,
  AppBskyEmbedImages,
  AppBskyEmbedExternal,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  ComAtprotoLabelDefs,
} from '@atproto/api';

// ─── AT URI ───────────────────────────────────────────────────────────────
export interface ParsedAtUri {
  repo: string;       // DID or handle
  collection: string; // e.g. app.bsky.feed.post
  rkey: string;       // record key
  raw: string;
}

const AT_URI_RE = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/;

export function parseAtUri(uri: string): ParsedAtUri | null {
  const m = AT_URI_RE.exec(uri);
  if (!m) return null;
  return { repo: m[1], collection: m[2], rkey: m[3], raw: uri };
}

export function isAtUri(s: string): boolean {
  return AT_URI_RE.test(s);
}

// ─── DID ──────────────────────────────────────────────────────────────────
const DID_RE = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;

export function parseDid(s: string): string | null {
  return DID_RE.test(s) ? s : null;
}

export function isDid(s: string): boolean {
  return DID_RE.test(s);
}

// ─── Handle ───────────────────────────────────────────────────────────────
// A handle is a valid domain-like string, optionally prefixed with @
const HANDLE_RE = /^@?([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

export function parseHandle(s: string): string | null {
  const stripped = s.startsWith('@') ? s.slice(1) : s;
  return HANDLE_RE.test('@' + stripped) ? stripped.toLowerCase() : null;
}

// ─── Facets ───────────────────────────────────────────────────────────────
export type FacetKind = 'mention' | 'hashtag' | 'link';

export interface ResolvedFacet {
  kind: FacetKind;
  byteStart: number;
  byteEnd: number;
  // mention
  did?: string;
  // hashtag
  tag?: string;
  // link
  uri?: string;
  domain?: string;
}

export function resolveFacets(facets: AppBskyRichtextFacet.Main[] | undefined): ResolvedFacet[] {
  if (!facets?.length) return [];
  const out: ResolvedFacet[] = [];

  for (const facet of facets) {
    const { byteStart, byteEnd } = facet.index;
    for (const feat of facet.features) {
      if (feat.$type === 'app.bsky.richtext.facet#mention') {
        out.push({ kind: 'mention', byteStart, byteEnd, did: (feat as any).did });
      } else if (feat.$type === 'app.bsky.richtext.facet#tag') {
        out.push({ kind: 'hashtag', byteStart, byteEnd, tag: (feat as any).tag });
      } else if (feat.$type === 'app.bsky.richtext.facet#link') {
        const uri = (feat as any).uri as string;
        out.push({ kind: 'link', byteStart, byteEnd, uri, domain: canonicalDomain(uri) });
      }
    }
  }
  return out;
}

// ─── Domain ───────────────────────────────────────────────────────────────
export function canonicalDomain(url: string): string {
  try {
    const { hostname } = new URL(url);
    // Strip www. prefix for canonical form
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ─── Labels ───────────────────────────────────────────────────────────────
export interface ResolvedLabel {
  src: string;   // labeler DID
  val: string;   // label value e.g. "!hide", "porn", "graphic-media"
  neg: boolean;  // negation (removal)
  cts: string;   // ISO timestamp
}

export function resolveLabels(labels: ComAtprotoLabelDefs.Label[] | undefined): ResolvedLabel[] {
  if (!labels?.length) return [];
  return labels.map(l => ({
    src: l.src,
    val: l.val,
    neg: l.neg ?? false,
    cts: l.cts,
  }));
}

// ─── Embeds ───────────────────────────────────────────────────────────────
export type EmbedKind = 'images' | 'external' | 'record' | 'recordWithMedia';

export interface ResolvedEmbed {
  kind: EmbedKind;
  // images
  images?: { url: string; alt: string; aspectRatio?: { width: number; height: number } }[];
  // external
  external?: { uri: string; domain: string; title?: string; description?: string; thumb?: string };
  // record (quote post)
  quotedUri?: string;
  quotedAuthorDid?: string;
  quotedText?: string;
  // recordWithMedia: both images and record
  mediaImages?: { url: string; alt: string }[];
}

export function resolveEmbed(embed: any): ResolvedEmbed | null {
  if (!embed) return null;

  const type = embed.$type as string;

  if (type === 'app.bsky.embed.images#view' || type === 'app.bsky.embed.images') {
    const imgs = (embed.images ?? []) as any[];
    return {
      kind: 'images',
      images: imgs.map(i => ({
        url: i.fullsize ?? i.thumb ?? '',
        alt: i.alt ?? '',
        aspectRatio: i.aspectRatio,
      })),
    };
  }

  if (type === 'app.bsky.embed.external#view' || type === 'app.bsky.embed.external') {
    const ext = embed.external ?? embed;
    const uri = ext.uri ?? '';
    return {
      kind: 'external',
      external: {
        uri,
        domain: canonicalDomain(uri),
        title: ext.title,
        description: ext.description,
        thumb: ext.thumb,
      },
    };
  }

  if (type === 'app.bsky.embed.record#view' || type === 'app.bsky.embed.record') {
    const rec = embed.record ?? embed;
    return {
      kind: 'record',
      quotedUri: rec.uri,
      quotedAuthorDid: rec.author?.did,
      quotedText: (rec.value ?? rec.record)?.text,
    };
  }

  if (type === 'app.bsky.embed.recordWithMedia#view' || type === 'app.bsky.embed.recordWithMedia') {
    const rec = embed.record?.record ?? {};
    const media = embed.media ?? {};
    const imgs = (media.images ?? []) as any[];
    return {
      kind: 'recordWithMedia',
      quotedUri: rec.uri,
      quotedAuthorDid: rec.author?.did,
      quotedText: (rec.value ?? rec.record)?.text,
      mediaImages: imgs.map(i => ({ url: i.fullsize ?? i.thumb ?? '', alt: i.alt ?? '' })),
    };
  }

  return null;
}

// ─── Thread graph ─────────────────────────────────────────────────────────
export interface ThreadNode {
  uri: string;
  cid: string;
  authorDid: string;
  authorHandle: string;
  authorName?: string;    // display name (may be absent)
  authorAvatar?: string; // avatar URL (may be absent)
  text: string;
  createdAt: string;
  likeCount: number;
  replyCount: number;
  repostCount: number;
  facets: ResolvedFacet[];
  embed: ResolvedEmbed | null;
  labels: ResolvedLabel[];
  depth: number;
  replies: ThreadNode[];
}

export function resolveThread(
  node: AppBskyFeedDefs.ThreadViewPost,
  depth = 0,
  maxDepth = 6
): ThreadNode {
  const post = node.post as AppBskyFeedDefs.PostView;
  const record = post.record as AppBskyFeedPost.Record;

  const resolved: ThreadNode = {
    uri: post.uri,
    cid: post.cid,
    authorDid: post.author.did,
    authorHandle: post.author.handle,
    authorName: post.author.displayName ?? undefined,
    authorAvatar: post.author.avatar ?? undefined,
    text: record.text ?? '',
    createdAt: record.createdAt ?? post.indexedAt,
    likeCount: post.likeCount ?? 0,
    replyCount: post.replyCount ?? 0,
    repostCount: post.repostCount ?? 0,
    facets: resolveFacets(record.facets as any),
    embed: resolveEmbed(post.embed),
    labels: resolveLabels(post.labels as any),
    depth,
    replies: [],
  };

  if (depth < maxDepth && node.replies?.length) {
    resolved.replies = (node.replies as AppBskyFeedDefs.ThreadViewPost[])
      .filter(r => r.$type === 'app.bsky.feed.defs#threadViewPost' && r.post)
      .map(r => resolveThread(r, depth + 1, maxDepth));
  }

  return resolved;
}

// ─── Cluster grouping signals ──────────────────────────────────────────────
// These are the deterministic signals used by Pipeline A step 3 (clustering).
// They are extracted from a resolved post/thread without any inference.

export interface ClusterSignals {
  quotedUris: string[];       // shared quoted post URIs
  domains: string[];          // canonical domains from external embeds + facet links
  mentionedDids: string[];    // mentioned actor DIDs
  hashtags: string[];         // hashtag values (lowercase, no #)
  labelValues: string[];      // label values
}

export function extractClusterSignals(
  text: string,
  facets: ResolvedFacet[],
  embed: ResolvedEmbed | null,
  labels: ResolvedLabel[]
): ClusterSignals {
  const quotedUris: string[] = [];
  const domains: string[] = [];
  const mentionedDids: string[] = [];
  const hashtags: string[] = [];
  const labelValues: string[] = labels.map(l => l.val);

  for (const f of facets) {
    if (f.kind === 'mention' && f.did) mentionedDids.push(f.did);
    if (f.kind === 'hashtag' && f.tag) hashtags.push(f.tag.toLowerCase());
    if (f.kind === 'link' && f.domain) domains.push(f.domain);
  }

  if (embed) {
    if (embed.kind === 'external' && embed.external?.domain) {
      domains.push(embed.external.domain);
    }
    if ((embed.kind === 'record' || embed.kind === 'recordWithMedia') && embed.quotedUri) {
      quotedUris.push(embed.quotedUri);
    }
  }

  return {
    quotedUris: [...new Set(quotedUris)],
    domains: [...new Set(domains)],
    mentionedDids: [...new Set(mentionedDids)],
    hashtags: [...new Set(hashtags)],
    labelValues: [...new Set(labelValues)],
  };
}
