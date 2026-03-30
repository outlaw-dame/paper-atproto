import type { AppBskyFeedDefs, AppBskyRichtextFacet, ComAtprotoLabelDefs } from '@atproto/api';
export interface ParsedAtUri {
    repo: string;
    collection: string;
    rkey: string;
    raw: string;
}
export declare function parseAtUri(uri: string): ParsedAtUri | null;
export declare function isAtUri(s: string): boolean;
export declare function parseDid(s: string): string | null;
export declare function isDid(s: string): boolean;
export declare function parseHandle(s: string): string | null;
export type FacetKind = 'mention' | 'hashtag' | 'link' | 'cashtag';
export interface ResolvedFacet {
    kind: FacetKind;
    byteStart: number;
    byteEnd: number;
    did?: string;
    tag?: string;
    uri?: string;
    cashtag?: string;
    domain?: string;
}
export declare function resolveFacets(facets: AppBskyRichtextFacet.Main[] | undefined): ResolvedFacet[];
export declare function canonicalDomain(url: string): string;
export interface ResolvedLabel {
    src: string;
    val: string;
    neg: boolean;
    cts: string;
}
export declare function resolveLabels(labels: ComAtprotoLabelDefs.Label[] | undefined): ResolvedLabel[];
export type EmbedKind = 'images' | 'external' | 'record' | 'recordWithMedia';
export interface ResolvedEmbed {
    kind: EmbedKind;
    images?: {
        url: string;
        alt: string;
        aspectRatio?: {
            width: number;
            height: number;
        };
    }[];
    external?: {
        uri: string;
        domain: string;
        title?: string;
        description?: string;
        thumb?: string;
    };
    quotedUri?: string;
    quotedAuthorDid?: string;
    quotedAuthorHandle?: string;
    quotedAuthorDisplayName?: string;
    quotedText?: string;
    quotedExternal?: {
        uri: string;
        domain: string;
        title?: string;
        description?: string;
        thumb?: string;
    };
    mediaImages?: {
        url: string;
        alt: string;
    }[];
    mediaExternal?: {
        uri: string;
        domain: string;
        title?: string;
        description?: string;
        thumb?: string;
    };
}
export declare function resolveEmbed(embed: any): ResolvedEmbed | null;
export interface ThreadNode {
    uri: string;
    cid: string;
    authorDid: string;
    authorHandle: string;
    authorName?: string;
    authorAvatar?: string;
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
    parentUri?: string;
    parentAuthorHandle?: string;
}
export declare function resolveThread(node: AppBskyFeedDefs.ThreadViewPost, depth?: number, maxDepth?: number): ThreadNode;
export interface ClusterSignals {
    quotedUris: string[];
    domains: string[];
    mentionedDids: string[];
    hashtags: string[];
    labelValues: string[];
}
export declare function extractClusterSignals(text: string, facets: ResolvedFacet[], embed: ResolvedEmbed | null, labels: ResolvedLabel[]): ClusterSignals;
//# sourceMappingURL=atproto.d.ts.map