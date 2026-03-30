import type { PushPayload } from './pushTypes.js';
export interface RoutedPushAction {
    navigateTo?: string | undefined;
    refreshKeys?: string[] | undefined;
    badgeCount?: number | undefined;
}
export declare function routePushPayload(payload: PushPayload): RoutedPushAction;
//# sourceMappingURL=pushRouter.d.ts.map