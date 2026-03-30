export interface CloudKitAuthState {
    ready: boolean;
    signedIn: boolean;
    errorCode?: string;
}
export interface InitializeCloudKitOptions {
    interactive?: boolean;
}
/** Initialize CloudKit JS. Must be called lazily — never blocks app boot. */
export declare function initializeCloudKit(options?: InitializeCloudKitOptions): Promise<CloudKitAuthState>;
export declare function getCloudKitAuthState(): CloudKitAuthState;
export declare function signInToCloudKit(): Promise<CloudKitAuthState>;
//# sourceMappingURL=auth.d.ts.map
