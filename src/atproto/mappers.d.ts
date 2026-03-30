import { AppBskyFeedDefs, AppBskyNotificationListNotifications } from '@atproto/api';
import type { MockPost } from '../data/mockData.js';
export { hasDisplayableRecordContent } from '../lib/atproto/recordContent.js';
export declare function mapPostViewToMockPost(post: AppBskyFeedDefs.PostView): MockPost;
export declare function mapFeedViewPost(item: AppBskyFeedDefs.FeedViewPost): MockPost;
export interface LiveNotification {
    uri: string;
    cid: string;
    reason: string;
    isRead: boolean;
    indexedAt: string;
    author: {
        did: string;
        handle: string;
        displayName: string;
        avatar?: string;
    };
    subjectUri?: string;
}
export declare function mapNotification(n: AppBskyNotificationListNotifications.Notification): LiveNotification;
//# sourceMappingURL=mappers.d.ts.map