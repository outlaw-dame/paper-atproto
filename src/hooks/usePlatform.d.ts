export interface PlatformInfo {
    isIOS: boolean;
    isAndroid: boolean;
    isMobile: boolean;
    isPWA: boolean;
    isStandalone: boolean;
    prefersCoarsePointer: boolean;
    hasAnyCoarsePointer: boolean;
    hasAnyFinePointer: boolean;
    canHover: boolean;
}
export declare function usePlatform(): PlatformInfo;
export interface ButtonTokens {
    height: number;
    borderRadius: number;
    fontSize: number;
    fontWeight: number;
    paddingH: number;
    activeScale: number;
}
export declare function getButtonTokens(platform: PlatformInfo): ButtonTokens;
export interface IconBtnTokens {
    size: number;
    borderRadius: number;
}
export declare function getIconBtnTokens(platform: PlatformInfo): IconBtnTokens;
//# sourceMappingURL=usePlatform.d.ts.map