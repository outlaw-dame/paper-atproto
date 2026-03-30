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
import { AppBskyEmbedExternal, AppBskyEmbedRecordWithMedia, } from '@atproto/api';
import { extractRecordDisplayText } from '../atproto/recordContent.js';
const AT_URI_RE = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/;
export function parseAtUri(uri) {
    const m = AT_URI_RE.exec(uri);
    if (!m)
        return null;
    const repo = m[1];
    const collection = m[2];
    const rkey = m[3];
    if (!repo || !collection || !rkey)
        return null;
    return { repo, collection, rkey, raw: uri };
}
export function isAtUri(s) {
    return AT_URI_RE.test(s);
}
// ─── DID ──────────────────────────────────────────────────────────────────
const DID_RE = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;
export function parseDid(s) {
    return DID_RE.test(s) ? s : null;
}
export function isDid(s) {
    return DID_RE.test(s);
}
// ─── Handle ───────────────────────────────────────────────────────────────
// A handle is a valid domain-like string, optionally prefixed with @
const HANDLE_RE = /^@?([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
export function parseHandle(s) {
    const stripped = s.startsWith('@') ? s.slice(1) : s;
    return HANDLE_RE.test('@' + stripped) ? stripped.toLowerCase() : null;
}
export function resolveFacets(facets) {
    if (!facets?.length)
        return [];
    const out = [];
    for (const facet of facets) {
        const { byteStart, byteEnd } = facet.index;
        for (const feat of facet.features) {
            if (feat.$type === 'app.bsky.richtext.facet#mention') {
                out.push({ kind: 'mention', byteStart, byteEnd, did: feat.did });
            }
            else if (feat.$type === 'app.bsky.richtext.facet#tag') {
                // Check if this is a cashtag (tag starting with $) or regular hashtag
                const tag = feat.tag;
                if (tag.startsWith('$')) {
                    out.push({ kind: 'cashtag', byteStart, byteEnd, cashtag: tag });
                }
                else {
                    out.push({ kind: 'hashtag', byteStart, byteEnd, tag });
                }
            }
            else if (feat.$type === 'app.bsky.richtext.facet#link') {
                const uri = feat.uri;
                out.push({ kind: 'link', byteStart, byteEnd, uri, domain: canonicalDomain(uri) });
            }
        }
    }
    return out;
}
// ─── Domain ───────────────────────────────────────────────────────────────
export function canonicalDomain(url) {
    try {
        const { hostname } = new URL(url);
        // Strip www. prefix for canonical form
        return hostname.replace(/^www\./, '');
    }
    catch {
        return url;
    }
}
export function resolveLabels(labels) {
    if (!labels?.length)
        return [];
    return labels.map(l => ({
        src: l.src,
        val: l.val,
        neg: l.neg ?? false,
        cts: l.cts,
    }));
}
function resolveExternalPreview(externalEmbed) {
    const ext = externalEmbed?.external ?? externalEmbed;
    const uri = ext?.uri ?? '';
    if (!uri)
        return undefined;
    return {
        uri,
        domain: canonicalDomain(uri),
        title: ext.title,
        description: ext.description,
        thumb: ext.thumb,
    };
}
function resolveQuotedExternalPreview(recordView) {
    const embeds = Array.isArray(recordView?.embeds) ? recordView.embeds : [];
    for (const embedded of embeds) {
        if (AppBskyEmbedExternal.isView(embedded)) {
            return resolveExternalPreview(embedded);
        }
        if (AppBskyEmbedRecordWithMedia.isView(embedded) && AppBskyEmbedExternal.isView(embedded.media)) {
            return resolveExternalPreview(embedded.media);
        }
    }
    return undefined;
}
export function resolveEmbed(embed) {
    if (!embed)
        return null;
    const type = embed.$type;
    if (type === 'app.bsky.embed.images#view' || type === 'app.bsky.embed.images') {
        const imgs = (embed.images ?? []);
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
        const quotedRecord = (rec.value ?? rec.record);
        const quotedExternal = resolveQuotedExternalPreview(rec);
        return {
            kind: 'record',
            quotedUri: rec.uri,
            quotedAuthorDid: rec.author?.did,
            quotedAuthorHandle: rec.author?.handle,
            quotedAuthorDisplayName: rec.author?.displayName,
            quotedText: extractRecordDisplayText(quotedRecord),
            ...(quotedExternal ? { quotedExternal } : {}),
        };
    }
    if (type === 'app.bsky.embed.recordWithMedia#view' || type === 'app.bsky.embed.recordWithMedia') {
        const rec = embed.record?.record ?? {};
        const media = embed.media ?? {};
        const mediaType = media.$type ?? '';
        const imgs = (media.images ?? []);
        const ext = media.external ?? null;
        const quotedExternal = resolveQuotedExternalPreview(rec);
        return {
            kind: 'recordWithMedia',
            quotedUri: rec.uri,
            quotedAuthorDid: rec.author?.did,
            quotedAuthorHandle: rec.author?.handle,
            quotedAuthorDisplayName: rec.author?.displayName,
            quotedText: extractRecordDisplayText((rec.value ?? rec.record)),
            ...(quotedExternal ? { quotedExternal } : {}),
            ...(imgs.length > 0 ? { mediaImages: imgs.map(i => ({ url: i.fullsize ?? i.thumb ?? '', alt: i.alt ?? '' })) } : {}),
            ...(ext && mediaType.includes('external') ? {
                mediaExternal: {
                    uri: ext.uri ?? '',
                    domain: canonicalDomain(ext.uri ?? ''),
                    title: ext.title,
                    description: ext.description,
                    thumb: ext.thumb,
                },
            } : {}),
        };
    }
    return null;
}
export function resolveThread(node, depth = 0, maxDepth = 6) {
    const post = node.post;
    const record = post.record;
    const resolvedText = extractRecordDisplayText(record);
    const parentUri = record.reply?.parent?.uri ?? undefined;
    const resolved = {
        uri: post.uri,
        cid: post.cid,
        authorDid: post.author.did,
        authorHandle: post.author.handle,
        ...(post.author.displayName != null ? { authorName: post.author.displayName } : {}),
        ...(post.author.avatar != null ? { authorAvatar: post.author.avatar } : {}),
        text: resolvedText,
        createdAt: record.createdAt ?? post.indexedAt,
        likeCount: post.likeCount ?? 0,
        replyCount: post.replyCount ?? 0,
        repostCount: post.repostCount ?? 0,
        facets: resolveFacets(record.facets),
        embed: resolveEmbed(post.embed),
        labels: resolveLabels(post.labels),
        depth,
        replies: [],
        ...(parentUri !== undefined ? { parentUri } : {}),
    };
    if (depth < maxDepth && node.replies?.length) {
        resolved.replies = node.replies
            .filter(r => r.$type === 'app.bsky.feed.defs#threadViewPost' && r.post)
            .map(r => {
            const child = resolveThread(r, depth + 1, maxDepth);
            // Stamp the parent's handle onto direct children so the UI can say "↳ @X"
            child.parentAuthorHandle = resolved.authorHandle;
            return child;
        });
    }
    return resolved;
}
export function extractClusterSignals(text, facets, embed, labels) {
    const quotedUris = [];
    const domains = [];
    const mentionedDids = [];
    const hashtags = [];
    const labelValues = labels.map(l => l.val);
    for (const f of facets) {
        if (f.kind === 'mention' && f.did)
            mentionedDids.push(f.did);
        if (f.kind === 'hashtag' && f.tag)
            hashtags.push(f.tag.toLowerCase());
        if (f.kind === 'link' && f.domain)
            domains.push(f.domain);
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
//# sourceMappingURL=atproto.js.map