export interface InstallState {
    /** True if running as an installed app (standalone or minimal-ui display mode). */
    standalone: boolean;
    /** True if the browser can show a native install prompt (Chromium only). */
    deferredPromptAvailable: boolean;
    /** True if on iOS Safari where only manual installation is possible. */
    isIosSafariInstallCandidate: boolean;
}
export declare function getInstallState(): InstallState;
/** Trigger the native install prompt if available (Chromium only). */
export declare function triggerInstallPrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
//# sourceMappingURL=install.d.ts.map