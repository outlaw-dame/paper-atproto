import { AppBskyFeedDefs } from '@atproto/api';
import type { MockPost } from '../data/mockData.js';
/**
 * A simplified, recursive function to map a `PostView` to a `MockPost`.
 * This is used for the main post, quoted posts, and reply/root context posts.
 * @param post The `PostView` object from the ATProto API.
 * @returns A `MockPost` object.
 */
export declare function mapPostViewToMockPost(post: AppBskyFeedDefs.PostView): MockPost;
/**
 * Maps a `FeedViewPost` (which includes reply context) to a `MockPost`.
 * @param item The `FeedViewPost` from the ATProto API.
 * @returns A `MockPost` object with reply and thread context.
 */
export declare function mapFeedViewPost(item: AppBskyFeedDefs.FeedViewPost): MockPost;
//# sourceMappingURL=mappers.d.ts.map