export type PushKind = 'mention' | 'reply' | 'follow' | 'dm' | 'moderation' | 'digest' | 'system';
export interface PushPayload {
    version: 1;
    kind: PushKind;
    title: string;
    body?: string;
    url?: string;
    badgeCount?: number;
    iconUrl?: string;
    imageUrl?: string;
    collapseKey?: string;
    receivedAt: string;
}
export interface PushSubscriptionSyncResult {
    ok: boolean;
    endpointHash?: string;
    errorCode?: PushSubscriptionErrorCode;
}
export type PushSubscriptionErrorCode = 'unsupported' | 'not-installed' | 'permission-denied' | 'subscription-failed' | 'sync-failed' | 'auth-required' | 'validation-failed';
//# sourceMappingURL=pushTypes.d.ts.map