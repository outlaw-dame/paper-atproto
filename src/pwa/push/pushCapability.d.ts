export interface PushCapability {
    supported: boolean;
    /** On iOS/iPadOS, push only works reliably in standalone mode. */
    installedContextPreferred: boolean;
    permission: NotificationPermission | 'unsupported';
}
export declare function getPushCapability(): PushCapability;
//# sourceMappingURL=pushCapability.d.ts.map