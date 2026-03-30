export interface AppleEnhancementAvailability {
    /** CloudKit JS script loaded and container config present. */
    cloudKitJsAvailable: boolean;
    /** App is running as an installed Home Screen web app. */
    pwaInstalled: boolean;
    /** Web Push permission is granted and usable in this context. */
    notificationsUsable: boolean;
    /** Badging API is available. */
    badgingUsable: boolean;
    /** Running on a WebKit-based browser — coarse signal only. */
    likelyAppleWebKit: boolean;
}
//# sourceMappingURL=types.d.ts.map