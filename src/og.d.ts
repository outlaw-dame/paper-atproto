/**
 * Utility to fetch and parse OpenGraph metadata from a URL.
 * In a local-first/PWA context, we need a proxy to bypass CORS.
 *
 * Author attribution emulates the Mastodon fediverse:creator feature (added in
 * Mastodon 4.3). When a page includes <meta name="fediverse:creator" content="@user@instance.social">
 * Mastodon shows a "More from…" attribution on link cards. We do the same.
 *
 * Author display-name extraction priority:
 *   1. article:author     — OG article author (name strings only; URLs are skipped)
 *   2. author             — standard meta name
 *   3. dc:creator         — Dublin Core creator
 *
 * Fediverse handle:
 *   - fediverse:creator   — Mastodon/ActivityPub handle like "@user@mastodon.social"
 *   - No ATProto equivalent exists yet (open proposal: atproto#3562)
 */
export interface OGMetadata {
    url: string;
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
    /** Article author display name */
    author?: string;
    /**
     * Fediverse handle from fediverse:creator, e.g. "@user@mastodon.social".
     * This is an ActivityPub/Mastodon handle — no ATProto equivalent exists yet.
     * A linkable profile URL can be derived via fediverseHandleToUrl().
     */
    authorHandle?: string;
    /** Full URL to the author's fediverse profile, derived from authorHandle */
    authorProfileUrl?: string;
}
export declare const fetchOGData: (url: string) => Promise<OGMetadata | null>;
//# sourceMappingURL=og.d.ts.map